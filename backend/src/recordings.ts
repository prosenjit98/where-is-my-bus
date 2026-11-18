import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { haversine, type LatLng, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { isEmpty, type Db } from './db.ts';
import { HttpError } from './http.ts';

// Record-route mode: staff ride a route once with a phone. The positions become the route's road
// path, and the places where the bus stood still become suggested stops, matched to a stop already
// there when one is close. Nothing changes for riders until an admin applies a recording to a route
// direction in the admin panel. One file per recording, or one row each in PostgreSQL.
//
// Approved contributors record from the phone app too (by), and tap "Stop here" at each stop
// (marks), naming it if they like: a marked stop counts as a halt even if the bus hardly stood.

export type RecPoint = { lat: number; lng: number; accuracy?: number; ts: number };

export type Halt = {
  lat: number;
  lng: number;
  /** How long the bus stood there. */
  seconds: number;
  at: number;
  /** A stop already in the network within MATCH_M, if any. */
  stop: { id: string; name: string; distM: number } | null;
  /** Marked by the person recording ("Stop here"), with the name they gave it, if any. */
  marked?: boolean;
  name?: string;
};

/** A stop the person recording marked as the bus reached it. */
export type Mark = { lat: number; lng: number; ts: number; name?: string };

export type Recording = {
  id: string;
  name: string;
  startedAt: number;
  finishedAt?: number;
  points: RecPoint[];
  path?: [number, number][];
  halts?: Halt[];
  lengthM?: number;
  minutes?: number;
  /** Recorded by a contributor in the phone app; missing when recorded by staff in the admin panel. */
  by?: { contributorId: string; name: string };
  marks?: Mark[];
};

export type RecordingSummary = Omit<Recording, 'points' | 'path' | 'halts' | 'marks'> & { points: number; halts: number; marks: number };

const MAX_POINTS = 20_000;
const MAX_RECORDINGS = 200;
/** Recordings one contributor may have waiting for the admins at once. */
const MAX_PER_CONTRIBUTOR = 20;
const MAX_MARKS = 300;
/** Positions less accurate than this are left out. */
const WORST_ACCURACY_M = 50;
/** Faster than this between two positions is a GPS jump, not the bus. */
const FASTEST_MPS = 35;
/** Standing within HALT_M for HALT_S or longer is a halt. */
const HALT_M = 30;
const HALT_S = 20;
const MATCH_M = 80;
/** The road path is simplified to within this, as the OpenStreetMap importer does. */
const SIMPLIFY_M = 4;

/** Positions in order, without poor fixes, repeats or jumps. */
export function cleanPoints(points: RecPoint[]): RecPoint[] {
  const sorted = points.filter((p) => (p.accuracy ?? 0) <= WORST_ACCURACY_M).sort((a, b) => a.ts - b.ts);
  const out: RecPoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.ts <= last.ts) continue;
    if (last && haversine(last, p) / ((p.ts - last.ts) / 1000) > FASTEST_MPS) continue;
    out.push(p);
  }
  return out;
}

/** Douglas-Peucker on a local flat projection: plenty for a city. */
export function simplify(points: LatLng[], toleranceM = SIMPLIFY_M): LatLng[] {
  if (points.length < 3) return points;
  const lat0 = (points[0].lat * Math.PI) / 180;
  const xy = points.map((p) => [p.lng * 111_320 * Math.cos(lat0), p.lat * 110_540]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1;
    let worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0 && worstD > toleranceM) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function nearestStop(net: PreparedNetwork, at: LatLng): Halt['stop'] {
  let stop: Halt['stop'] = null;
  for (const s of net.network.stops) {
    const d = haversine(at, s);
    if (d <= MATCH_M && (!stop || d < stop.distM)) stop = { id: s.id, name: s.name, distM: Math.round(d) };
  }
  return stop;
}

/**
 * The stops marked by the person recording, with the halts found that are not near one of them,
 * in the order the bus reached them.
 */
export function haltsWithMarks(points: RecPoint[], marks: Mark[], net: PreparedNetwork): Halt[] {
  const marked: Halt[] = marks.map((m) => {
    const h: Halt = { lat: Math.round(m.lat * 1e6) / 1e6, lng: Math.round(m.lng * 1e6) / 1e6, seconds: 0, at: m.ts, stop: nearestStop(net, m), marked: true };
    if (m.name) h.name = m.name;
    return h;
  });
  const found = findHalts(points, net).filter((h) => !marks.some((m) => haversine(h, m) <= MATCH_M));
  return [...marked, ...found].sort((a, b) => a.at - b.at);
}

/** Where the bus stood still: HALT_S or more within HALT_M of where it stopped. */
export function findHalts(points: RecPoint[], net: PreparedNetwork): Halt[] {
  const out: Halt[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && haversine(points[i], points[j + 1]) <= HALT_M) j++;
    const seconds = (points[j].ts - points[i].ts) / 1000;
    if (seconds >= HALT_S) {
      const group = points.slice(i, j + 1);
      const at: LatLng = { lat: group.reduce((s, p) => s + p.lat, 0) / group.length, lng: group.reduce((s, p) => s + p.lng, 0) / group.length };
      const stop = nearestStop(net, at);
      out.push({ lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6, seconds: Math.round(seconds), at: points[i].ts, stop });
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

const summary = (r: Recording): RecordingSummary => ({
  id: r.id,
  name: r.name,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  lengthM: r.lengthM,
  minutes: r.minutes,
  points: r.points.length,
  halts: r.halts?.length ?? 0,
  marks: r.marks?.length ?? 0,
  ...(r.by ? { by: r.by } : {}),
});

/** Where recordings are kept. */
export type RecordingStore = {
  /** All of them, or one contributor's. */
  count(contributorId?: string): Promise<number>;
  /** Newest first; all of them, or one contributor's. */
  summaries(contributorId?: string): Promise<RecordingSummary[]>;
  get(id: string): Promise<Recording | undefined>;
  /** Saves the whole recording. */
  put(r: Recording): Promise<void>;
  /**
   * Adds positions at the end, after `check` (which throws to refuse) has seen whether the
   * recording finished and how many it has; how many it has now. Undefined when there is none.
   */
  append(id: string, points: RecPoint[], check: (s: { finished: boolean; count: number }) => void): Promise<number | undefined>;
  /** Adds a marked stop, after `check` saw the recording; how many marks it has now. Undefined when there is none. */
  addMark(id: string, mark: Mark, check: (r: Recording) => void): Promise<number | undefined>;
  remove(id: string): Promise<boolean>;
};

/** One JSON file per recording, kept in memory too. */
export async function fileRecordingStore(dir: string): Promise<RecordingStore> {
  await mkdir(dir, { recursive: true });
  const all = await readRecordingFiles(dir);
  let writing: Promise<unknown> = Promise.resolve();
  function save(r: Recording) {
    const body = `${JSON.stringify(r)}\n`;
    const file = path.join(dir, `${r.id}.json`);
    writing = writing.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    });
    return writing;
  }
  return {
    count: async (contributorId) => [...all.values()].filter((r) => !contributorId || r.by?.contributorId === contributorId).length,
    summaries: async (contributorId) =>
      [...all.values()].filter((r) => !contributorId || r.by?.contributorId === contributorId).sort((a, b) => b.startedAt - a.startedAt).map(summary),
    get: async (id) => all.get(id),
    async put(r) {
      all.set(r.id, r);
      await save(r);
    },
    async append(id, points, check) {
      const r = all.get(id);
      if (!r) return undefined;
      check({ finished: r.finishedAt !== undefined, count: r.points.length });
      r.points.push(...points);
      await save(r);
      return r.points.length;
    },
    async addMark(id, mark, check) {
      const r = all.get(id);
      if (!r) return undefined;
      check(r);
      (r.marks ??= []).push(mark);
      await save(r);
      return r.marks.length;
    },
    async remove(id) {
      if (!all.delete(id)) return false;
      await unlink(path.join(dir, `${id}.json`)).catch(() => undefined);
      return true;
    },
  };
}

async function readRecordingFiles(dir: string): Promise<Map<string, Recording>> {
  const all = new Map<string, Recording>();
  for (const f of await readdir(dir)) {
    if (!/^r-[0-9a-f]+\.json$/.test(f)) continue;
    try {
      const r = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as Recording;
      all.set(r.id, r);
    } catch {
      // A file cut short by a crash is left alone.
    }
  }
  return all;
}

/**
 * Recordings in PostgreSQL, one row each with the positions in a JSON document. The first time, on
 * an empty table, the recording files in `importDir` are copied in.
 */
export async function pgRecordingStore(db: Db, importDir?: string): Promise<RecordingStore> {
  const put = async (q: Db['pool'] | pg.PoolClient, r: Recording) => {
    await q.query(
      `INSERT INTO recordings (id, name, started_at, finished_at, contributor_id, doc) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at,
         contributor_id = EXCLUDED.contributor_id, doc = EXCLUDED.doc`,
      [r.id, r.name, r.startedAt, r.finishedAt ?? null, r.by?.contributorId ?? null, JSON.stringify(r)],
    );
  };
  if (importDir && existsSync(importDir) && (await isEmpty(db, 'recordings'))) {
    await db.tx(async (c) => {
      await c.query('LOCK TABLE recordings IN EXCLUSIVE MODE');
      if (!(await isEmpty(c, 'recordings'))) return;
      for (const r of (await readRecordingFiles(importDir)).values()) await put(c, r);
    });
  }
  return {
    count: async (contributorId) =>
      Number(
        (await db.pool.query(contributorId ? 'SELECT count(*) AS n FROM recordings WHERE contributor_id = $1' : 'SELECT count(*) AS n FROM recordings', contributorId ? [contributorId] : []))
          .rows[0].n,
      ),
    // The positions stay in the database: only how many there are comes back.
    summaries: async (contributorId) =>
      (
        await db.pool.query(
          `SELECT doc - 'points' - 'path' - 'halts' - 'marks' AS doc, jsonb_array_length(doc->'points') AS points,
             coalesce(jsonb_array_length(doc->'halts'), 0) AS halts, coalesce(jsonb_array_length(doc->'marks'), 0) AS marks
           FROM recordings ${contributorId ? 'WHERE contributor_id = $1' : ''} ORDER BY started_at DESC`,
          contributorId ? [contributorId] : [],
        )
      ).rows.map((r) => ({ ...r.doc, points: r.points, halts: r.halts, marks: r.marks }) as RecordingSummary),
    get: async (id) => (await db.pool.query<{ doc: Recording }>('SELECT doc FROM recordings WHERE id = $1', [id])).rows[0]?.doc,
    put: (r) => put(db.pool, r),
    append: (id, points, check) =>
      db.tx(async (c) => {
        const row = (
          await c.query('SELECT finished_at IS NOT NULL AS finished, jsonb_array_length(doc->\'points\') AS count FROM recordings WHERE id = $1 FOR UPDATE', [id])
        ).rows[0];
        if (!row) return undefined;
        check({ finished: row.finished, count: row.count });
        await c.query(`UPDATE recordings SET doc = jsonb_set(doc, '{points}', (doc->'points') || $2::jsonb) WHERE id = $1`, [id, JSON.stringify(points)]);
        return row.count + points.length;
      }),
    addMark: (id, mark, check) =>
      db.tx(async (c) => {
        const row = (await c.query<{ doc: Recording }>(`SELECT doc - 'points' - 'path' AS doc FROM recordings WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!row) return undefined;
        check({ ...row.doc, points: [] });
        await c.query(`UPDATE recordings SET doc = jsonb_set(doc, '{marks}', coalesce(doc->'marks', '[]'::jsonb) || $2::jsonb) WHERE id = $1`, [id, JSON.stringify([mark])]);
        return (row.doc.marks?.length ?? 0) + 1;
      }),
    remove: async (id) => ((await db.pool.query('DELETE FROM recordings WHERE id = $1', [id])).rowCount ?? 0) > 0,
  };
}

export async function openRecordings(where: string | RecordingStore) {
  const store = typeof where === 'string' ? await fileRecordingStore(where) : where;

  const find = async (id: string) => {
    const r = await store.get(id);
    if (!r) throw new HttpError(404, 'There is no recording with that id.');
    return r;
  };

  return {
    /** All of them (the admin), or one contributor's own. */
    list: (contributorId?: string) => store.summaries(contributorId),
    get: find,

    /** A recording belongs to the contributor who made it: anyone else is told there is none. */
    async own(id: string, contributorId: string) {
      const r = await find(id);
      if (r.by?.contributorId !== contributorId) throw new HttpError(404, 'There is no recording with that id.');
      return r;
    },

    async create(name: unknown, now = Date.now(), by?: { contributorId: string; name: string }) {
      if ((await store.count()) >= MAX_RECORDINGS) throw new HttpError(409, `There are ${MAX_RECORDINGS} recordings already. Delete some first.`);
      if (by && (await store.count(by.contributorId)) >= MAX_PER_CONTRIBUTOR) {
        throw new HttpError(409, `You have ${MAX_PER_CONTRIBUTOR} recordings waiting for the team. They need to check some before you record more.`);
      }
      const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const r: Recording = { id: `r-${randomBytes(6).toString('hex')}`, name: clean || `Recording ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`, startedAt: now, points: [] };
      if (by) r.by = by;
      await store.put(r);
      return summary(r);
    },

    /** "Stop here": where the bus is now, with the stop's name if the contributor gave one. */
    async addMark(id: string, raw: unknown) {
      const m = (raw ?? {}) as { lat?: unknown; lng?: unknown; ts?: unknown; name?: unknown };
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number' || Math.abs(m.lat) > 90 || Math.abs(m.lng) > 180 || typeof m.ts !== 'number') {
        throw new HttpError(400, 'Send the stop as lat, lng and ts.');
      }
      const name = String(m.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const mark: Mark = { lat: m.lat, lng: m.lng, ts: m.ts };
      if (name) mark.name = name;
      const count = await store.addMark(id, mark, (r) => {
        if (r.finishedAt) throw new HttpError(409, 'This recording has finished.');
        if ((r.marks?.length ?? 0) >= MAX_MARKS) throw new HttpError(413, 'This recording has enough stops. Finish it and start another.');
      });
      if (count === undefined) throw new HttpError(404, 'There is no recording with that id.');
      return { marks: count };
    },

    async addPoints(id: string, raw: unknown) {
      const points = Array.isArray(raw)
        ? raw
          .filter((p): p is RecPoint => !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && typeof p.ts === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
          .map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts, ...(typeof p.accuracy === 'number' ? { accuracy: p.accuracy } : {}) }))
        : [];
      const count = await store.append(id, points, (s) => {
        if (s.finished) throw new HttpError(409, 'This recording has finished.');
        if (!Array.isArray(raw) || raw.length === 0 || raw.length > 300) throw new HttpError(400, 'Send between 1 and 300 positions.');
        if (s.count + points.length > MAX_POINTS) throw new HttpError(413, 'This recording is long enough. Finish it and start another.');
      });
      if (count === undefined) throw new HttpError(404, 'There is no recording with that id.');
      return { points: count };
    },

    /** The road path and the halts, from the positions so far. */
    async finish(id: string, net: PreparedNetwork, now = Date.now()) {
      const r = await find(id);
      const points = cleanPoints(r.points);
      if (points.length < 2) throw new HttpError(400, 'The recording has too few good positions to make a path.');
      const path2 = simplify(points);
      r.path = path2.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]);
      r.halts = r.marks?.length ? haltsWithMarks(points, r.marks, net) : findHalts(points, net);
      let length = 0;
      for (let i = 1; i < points.length; i++) length += haversine(points[i - 1], points[i]);
      r.lengthM = Math.round(length);
      r.minutes = Math.round((points[points.length - 1].ts - points[0].ts) / 60_000);
      r.finishedAt = r.finishedAt ?? now;
      await store.put(r);
      return r;
    },

    async remove(id: string) {
      if (!(await store.remove(id))) throw new HttpError(404, 'There is no recording with that id.');
      return { removed: id };
    },
  };
}
