import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { iso, isEmpty, type Db } from './db.ts';
import { HttpError } from './http.ts';

// Riders' suggested fixes ("this bus also stops at…", "the last bus is later"), kept for the admins,
// who mark each one done or dismissed in the admin panel. Nothing changes in the network until an
// admin changes it. One JSON file, saved like the network (a copy, then renamed over the old one), or
// a PostgreSQL table when DATABASE_URL is set.

export type CorrectionKind = 'stop' | 'route' | 'times' | 'other';
export type CorrectionStatus = 'new' | 'done' | 'dismissed';

export type Correction = {
  id: string;
  kind: CorrectionKind;
  text: string;
  routeId?: string;
  stopId?: string;
  createdAt: string;
  status: CorrectionStatus;
  note?: string;
  reviewedAt?: string;
};

const KINDS = new Set<CorrectionKind>(['stop', 'route', 'times', 'other']);
const STATUSES = new Set<CorrectionStatus>(['new', 'done', 'dismissed']);
/** Reviewed suggestions beyond this many are dropped, oldest first; new ones are always kept. */
const KEEP_REVIEWED = 2000;

/** Where suggestions are kept. */
export type CorrectionStore = {
  /** A new one; reviewed ones beyond `keepReviewed` go, oldest first. */
  add(c: Correction, keepReviewed: number): Promise<void>;
  /** Oldest first. */
  all(status?: CorrectionStatus): Promise<Correction[]>;
  counts(): Promise<{ new: number; all: number }>;
  get(id: string): Promise<Correction | undefined>;
  /** Saves a changed one in its place. */
  update(c: Correction): Promise<void>;
};

export function fileCorrectionStore(file: string, initial: Correction[]): CorrectionStore {
  let list = initial;
  let queue: Promise<unknown> = Promise.resolve();
  function save(next: () => Correction[]) {
    const run = async () => {
      const value = next();
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
      await rename(tmp, file);
      list = value;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    add: (c, keep) =>
      save(() => {
        const reviewed = list.filter((x) => x.status !== 'new');
        const drop = new Set(reviewed.slice(0, Math.max(0, reviewed.length - keep)).map((x) => x.id));
        return [...list.filter((x) => !drop.has(x.id)), c];
      }),
    all: async (status) => list.filter((c) => !status || c.status === status),
    counts: async () => ({ new: list.filter((c) => c.status === 'new').length, all: list.length }),
    get: async (id) => list.find((c) => c.id === id),
    update: (c) => save(() => list.map((x) => (x.id === c.id ? c : x))),
  };
}

const readFileList = async (file: string) => (existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Correction[]) : []);

function fromRow(r: Record<string, unknown>): Correction {
  const c: Correction = { id: r.id as string, kind: r.kind as CorrectionKind, text: r.text as string, createdAt: iso(r.created_at as Date) as string, status: r.status as CorrectionStatus };
  if (r.route_id) c.routeId = r.route_id as string;
  if (r.stop_id) c.stopId = r.stop_id as string;
  if (r.note) c.note = r.note as string;
  if (r.reviewed_at) c.reviewedAt = iso(r.reviewed_at as Date);
  return c;
}

/** Table corrections. The first time, on an empty table, the file this server kept before is copied in. */
export async function pgCorrectionStore(db: Db, importFile?: string): Promise<CorrectionStore> {
  const insert = `INSERT INTO corrections (id, kind, text, route_id, stop_id, status, note, created_at, reviewed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  const values = (c: Correction) => [c.id, c.kind, c.text, c.routeId ?? null, c.stopId ?? null, c.status, c.note ?? null, c.createdAt, c.reviewedAt ?? null];
  if (importFile && existsSync(importFile) && (await isEmpty(db, 'corrections'))) {
    const list = await readFileList(importFile);
    await db.tx(async (c) => {
      await c.query('LOCK TABLE corrections IN EXCLUSIVE MODE');
      if (!(await isEmpty(c, 'corrections'))) return;
      for (const x of list) await c.query(insert, values(x));
    });
  }
  return {
    add: (c, keep) =>
      db.tx(async (q) => {
        await q.query(insert, values(c));
        await q.query(
          `DELETE FROM corrections WHERE id IN (SELECT id FROM corrections WHERE status <> 'new' ORDER BY seq DESC OFFSET $1)`,
          [keep],
        );
      }),
    all: async (status) =>
      (
        await db.pool.query(
          status ? 'SELECT * FROM corrections WHERE status = $1 ORDER BY seq' : 'SELECT * FROM corrections ORDER BY seq',
          status ? [status] : [],
        )
      ).rows.map(fromRow),
    async counts() {
      const r = (await db.pool.query(`SELECT count(*) FILTER (WHERE status = 'new') AS new, count(*) AS all FROM corrections`)).rows[0];
      return { new: Number(r.new), all: Number(r.all) };
    },
    get: async (id) => {
      const r = (await db.pool.query('SELECT * FROM corrections WHERE id = $1', [id])).rows[0];
      return r ? fromRow(r) : undefined;
    },
    async update(c) {
      await db.pool.query('UPDATE corrections SET kind = $2, text = $3, route_id = $4, stop_id = $5, status = $6, note = $7, created_at = $8, reviewed_at = $9 WHERE id = $1', values(c));
    },
  };
}

export async function openCorrections(where: string | CorrectionStore, known: { route: (id: string) => boolean; stop: (id: string) => boolean }) {
  const store = typeof where === 'string' ? fileCorrectionStore(where, await readFileList(where)) : where;

  return {
    async add(input: { kind?: unknown; text?: unknown; routeId?: unknown; stopId?: unknown }): Promise<Correction> {
      const kind = (KINDS.has(input.kind as CorrectionKind) ? input.kind : 'other') as CorrectionKind;
      const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
      if (text.length < 5) throw new HttpError(400, 'Say a little more, so the team can find and fix it.');
      if (text.length > 600) throw new HttpError(400, 'Keep it to 600 characters.');
      const c: Correction = { id: `c-${randomBytes(6).toString('hex')}`, kind, text, createdAt: new Date().toISOString(), status: 'new' };
      // Only a route or stop that exists is kept as the subject; the text says the rest.
      if (typeof input.routeId === 'string' && known.route(input.routeId)) c.routeId = input.routeId;
      if (typeof input.stopId === 'string' && known.stop(input.stopId)) c.stopId = input.stopId;
      await store.add(c, KEEP_REVIEWED);
      return c;
    },

    /** Newest first; only those with one status when given. */
    async list(status?: string): Promise<Correction[]> {
      const wanted = STATUSES.has(status as CorrectionStatus) ? (status as CorrectionStatus) : undefined;
      return (await store.all(wanted)).reverse();
    },

    counts: () => store.counts(),

    async review(id: string, input: { status?: unknown; note?: unknown }): Promise<Correction> {
      const status = input.status as CorrectionStatus;
      if (!STATUSES.has(status)) throw new HttpError(400, 'The status must be new, done or dismissed.');
      const found = await store.get(id);
      if (!found) throw new HttpError(404, 'There is no suggestion with that id.');
      const note = String(input.note ?? '').trim().slice(0, 300);
      const updated: Correction = { ...found, status, reviewedAt: new Date().toISOString() };
      if (note) updated.note = note;
      else delete updated.note;
      await store.update(updated);
      return updated;
    },
  };
}

export type Corrections = Awaited<ReturnType<typeof openCorrections>>;
