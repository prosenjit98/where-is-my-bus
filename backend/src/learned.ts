import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTravelTimes, istNow, type PreparedNetwork, type TravelTimesSnapshot } from '../../packages/core/src/index.ts';
import type { Db } from './db.ts';

// Learned travel times (core learn.ts) and the arrival-time error report. Storage sits behind a
// small interface: a JSON file, or a row in PostgreSQL when DATABASE_URL is set. With several
// servers, each learns from the buses it hears and the last one to save wins.

export type SnapshotStore<T> = { load(): Promise<T | null>; save(value: T): Promise<void> };

/** One JSON file, written to a copy first and renamed over the old one, so a crash never leaves half a file. */
export function fileStore<T>(file: string): SnapshotStore<T> {
  return {
    async load() {
      if (!existsSync(file)) return null;
      try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async save(value) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value)}\n`);
      await rename(tmp, file);
    },
  };
}

/**
 * One named document in PostgreSQL (db.ts). The first time, the JSON file this server kept before is
 * read instead, when there is one; it is saved here at the next save.
 */
export function pgStore<T>(db: Db, name: string, importFile?: string): SnapshotStore<T> {
  return {
    async load() {
      const row = (await db.pool.query<{ doc: T }>('SELECT doc FROM snapshots WHERE name = $1', [name])).rows[0];
      if (row) return row.doc;
      return importFile ? fileStore<T>(importFile).load() : null;
    },
    async save(value) {
      await db.pool.query(
        'INSERT INTO snapshots (name, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (name) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()',
        [name, JSON.stringify(value)],
      );
    },
  };
}

export async function openTravelTimes(store: SnapshotStore<TravelTimesSnapshot>) {
  const model = createTravelTimes(await store.load());
  return {
    model,
    async save() {
      if (model.hasChanges()) await store.save(model.snapshot());
    },
  };
}

type Horizon = { n: number; sumAbs: number; sumSigned: number; within2: number };
type AccuracySnapshot = { version: 1; days: Record<string, Record<string, Record<'5' | '10', Horizon>>> };

export type RouteAccuracy = {
  routeId: string;
  routeNumber: string;
  /** Predictions 10 and 5 minutes before conductors' buses reached a stop, against when they did. */
  horizons: Record<'10' | '5', { predictions: number; typicalErrorMin: number | null; lateBiasMin: number | null; within2MinShare: number | null }>;
};

/**
 * How close the arrival times were, per route and day in Indian time: the plan's measure of trust
 * ("within 2 minutes most of the time, 10 minutes ahead"). Kept for 60 days.
 */
export async function openAccuracy(store: SnapshotStore<AccuracySnapshot>) {
  const snap: AccuracySnapshot = (await store.load()) ?? { version: 1, days: {} };
  let changed = false;
  return {
    add(r: { routeId: string; horizonMin: 5 | 10; errorSec: number; ts: number }) {
      const day = istNow(new Date(r.ts)).dateISO;
      const routes = (snap.days[day] ??= {});
      const h = ((routes[r.routeId] ??= { '5': { n: 0, sumAbs: 0, sumSigned: 0, within2: 0 }, '10': { n: 0, sumAbs: 0, sumSigned: 0, within2: 0 } })[
        String(r.horizonMin) as '5' | '10'
      ]);
      h.n++;
      h.sumAbs += Math.abs(r.errorSec);
      h.sumSigned += r.errorSec;
      if (Math.abs(r.errorSec) <= 120) h.within2++;
      changed = true;
    },

    /** The last `days` days, per route that had predictions. */
    report(net: PreparedNetwork, now = Date.now(), days = 7): RouteAccuracy[] {
      const since = istNow(new Date(now - (days - 1) * 86_400_000)).dateISO;
      const totals = new Map<string, Record<'5' | '10', Horizon>>();
      for (const [day, routes] of Object.entries(snap.days)) {
        if (day < since) continue;
        for (const [routeId, hs] of Object.entries(routes)) {
          const t = totals.get(routeId) ?? { '5': { n: 0, sumAbs: 0, sumSigned: 0, within2: 0 }, '10': { n: 0, sumAbs: 0, sumSigned: 0, within2: 0 } };
          for (const k of ['5', '10'] as const) {
            t[k].n += hs[k].n;
            t[k].sumAbs += hs[k].sumAbs;
            t[k].sumSigned += hs[k].sumSigned;
            t[k].within2 += hs[k].within2;
          }
          totals.set(routeId, t);
        }
      }
      const view = (h: Horizon) => ({
        predictions: h.n,
        typicalErrorMin: h.n ? Math.round(h.sumAbs / h.n / 6) / 10 : null,
        // Positive: buses came later than predicted.
        lateBiasMin: h.n ? Math.round(-h.sumSigned / h.n / 6) / 10 : null,
        within2MinShare: h.n ? Math.round((h.within2 / h.n) * 100) / 100 : null,
      });
      return [...totals]
        .map(([routeId, t]) => ({ routeId, routeNumber: net.routes.get(routeId)?.number ?? routeId, horizons: { '10': view(t['10']), '5': view(t['5']) } }))
        .sort((a, b) => a.routeNumber.localeCompare(b.routeNumber, undefined, { numeric: true }));
    },

    async save(now = Date.now()) {
      if (!changed) return;
      const oldest = istNow(new Date(now - 60 * 86_400_000)).dateISO;
      for (const day of Object.keys(snap.days)) if (day < oldest) delete snap.days[day];
      changed = false;
      await store.save(snap);
    },
  };
}
