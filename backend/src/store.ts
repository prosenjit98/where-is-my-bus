import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Network } from '../../packages/core/src/index.ts';
import type { Db } from './db.ts';

// The network: stops, landmarks and routes with their directions and road paths. The server plans
// with all of it in memory. It is kept in a JSON file, or in PostgreSQL when DATABASE_URL is set.
//
// In PostgreSQL each stop, landmark and route is a row of its own, so the network can grow to
// thousands of routes (tens of MB with their road paths) and an admin edit to one route still
// writes one row. Each row remembers the network version that last changed it, so another server
// that hears of a change reads only the rows that changed since its own copy.

export type NetworkStore = {
  /** Where it is kept, for the server's start-up lines. */
  describe: string;
  load(): Promise<Network>;
  /** Saves `next` over `prev`; 'conflict' when someone else (another server) saved a newer version first. */
  save(prev: Network, next: Network): Promise<'ok' | 'conflict'>;
  /** The saved network when it is newer than `current`, read as changes to it; null when it is not. */
  refresh(current: Network): Promise<Network | null>;
};

export async function loadNetwork(file: string, seedFile: string): Promise<Network> {
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true });
    await copyFile(seedFile, file);
  }
  return JSON.parse(await readFile(file, 'utf8')) as Network;
}

export async function saveNetwork(file: string, network: Network): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(network, null, 2)}\n`);
  await rename(tmp, file); // atomic on the same disk, so a crash never leaves half a file
}

export function fileNetworkStore(file: string, seedFile: string): NetworkStore {
  return {
    describe: file,
    load: () => loadNetwork(file, seedFile),
    async save(_prev, next) {
      await saveNetwork(file, next);
      return 'ok';
    },
    // Only this server writes the file.
    refresh: async () => null,
  };
}

// ---- PostgreSQL: network_meta (one row) and network_items (one row per stop, landmark or route) ----

type Kind = 'stop' | 'landmark' | 'route';
type Item = { id: string };
type Meta = Omit<Network, 'stops' | 'landmarks' | 'routes'> & { hasLandmarks?: boolean };

const KINDS: Kind[] = ['stop', 'landmark', 'route'];
const listOf = (n: Network, kind: Kind): Item[] => (kind === 'stop' ? n.stops : kind === 'landmark' ? (n.landmarks ?? []) : n.routes);
const metaOf = ({ stops: _s, landmarks, routes: _r, ...rest }: Network): Meta => ({ ...rest, hasLandmarks: landmarks !== undefined });
const digest = (json: string) => createHash('sha1').update(json).digest('base64');

function assemble(meta: Meta, lists: Record<Kind, Item[]>): Network {
  const { hasLandmarks, ...rest } = meta;
  const n = { ...rest, stops: lists.stop, routes: lists.route } as Network;
  if (hasLandmarks || lists.landmark.length) n.landmarks = lists.landmark as Network['landmarks'];
  return n;
}

/**
 * The network in PostgreSQL. The first time, it is copied from `importFile` when there is one (the
 * network this server kept in a file), otherwise from the seed.
 */
export function pgNetworkStore(db: Db, importFile: string, seedFile: string): NetworkStore {
  /** What each saved row holds, as a hash: an edit writes only the rows whose hash changed. */
  let saved = new Map<string, string>();
  const key = (kind: Kind, id: string) => `${kind}:${id}`;
  const remember = (n: Network) => {
    saved = new Map();
    for (const kind of KINDS) for (const item of listOf(n, kind)) saved.set(key(kind, item.id), digest(JSON.stringify(item)));
  };

  async function upsert(c: pg.PoolClient, kind: Kind, items: { id: string; json: string }[], version: number) {
    // In batches, so importing a whole city is a few statements, not thousands.
    for (let i = 0; i < items.length; i += 500) {
      const batch = items.slice(i, i + 500);
      await c.query(
        `INSERT INTO network_items (kind, id, doc, changed_in)
         SELECT $1, id, doc::jsonb, $4 FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS u (id, doc, n) ORDER BY n
         ON CONFLICT (kind, id) DO UPDATE SET doc = EXCLUDED.doc, changed_in = EXCLUDED.changed_in`,
        [kind, batch.map((x) => x.id), batch.map((x) => x.json), version],
      );
    }
  }

  async function writeAll(c: pg.PoolClient, n: Network) {
    await c.query('INSERT INTO network_meta (id, version, doc) VALUES (1, $1, $2)', [n.version, JSON.stringify(metaOf(n))]);
    for (const kind of KINDS) await upsert(c, kind, listOf(n, kind).map((x) => ({ id: x.id, json: JSON.stringify(x) })), n.version);
  }

  async function readMeta(q: pg.Pool | pg.PoolClient) {
    return (await q.query<{ version: number; doc: Meta }>('SELECT version, doc FROM network_meta WHERE id = 1')).rows[0];
  }

  /** The rows changed after `since` (all of them for -1), and every id in order, read as one picture. */
  async function read(since: number, current: Network | null): Promise<Network | null> {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const meta = await readMeta(c);
      if (!meta || (current && meta.version === current.version)) {
        await c.query('COMMIT');
        return null;
      }
      const order = (await c.query<{ kind: Kind; id: string }>('SELECT kind, id FROM network_items ORDER BY seq')).rows;
      const changed = new Map<string, Item>();
      for (const r of (await c.query<{ kind: Kind; id: string; doc: Item }>('SELECT kind, id, doc FROM network_items WHERE changed_in > $1', [since])).rows) {
        changed.set(key(r.kind, r.id), r.doc);
      }
      await c.query('COMMIT');
      const had = new Map<string, Item>();
      if (current) for (const kind of KINDS) for (const item of listOf(current, kind)) had.set(key(kind, item.id), item);
      const lists: Record<Kind, Item[]> = { stop: [], landmark: [], route: [] };
      for (const r of order) {
        const item = changed.get(key(r.kind, r.id)) ?? had.get(key(r.kind, r.id));
        if (item) lists[r.kind].push(item);
      }
      const n = assemble({ ...meta.doc, version: meta.version }, lists);
      remember(n);
      return n;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    describe: `PostgreSQL (schema ${db.schema})`,

    async load() {
      if (!(await readMeta(db.pool))) {
        const first = JSON.parse(await readFile(existsSync(importFile) ? importFile : seedFile, 'utf8')) as Network;
        await db.tx(async (c) => {
          // Only the first server to get here copies it in.
          await c.query('LOCK TABLE network_meta IN EXCLUSIVE MODE');
          if (!(await readMeta(c))) await writeAll(c, first);
        });
      }
      return (await read(-1, null)) as Network;
    },

    save: (prev, next) =>
      db.tx(async (c) => {
        const row = (await c.query<{ version: number }>('SELECT version FROM network_meta WHERE id = 1 FOR UPDATE')).rows[0];
        if (!row || row.version !== prev.version) return 'conflict' as const;
        const after = new Map<string, string>();
        for (const kind of KINDS) {
          const changed: { id: string; json: string }[] = [];
          for (const item of listOf(next, kind)) {
            const json = JSON.stringify(item);
            const h = digest(json);
            after.set(key(kind, item.id), h);
            if (saved.get(key(kind, item.id)) !== h) changed.push({ id: item.id, json });
          }
          const gone = [...saved.keys()].filter((k) => k.startsWith(`${kind}:`) && !after.has(k)).map((k) => k.slice(kind.length + 1));
          if (gone.length) await c.query('DELETE FROM network_items WHERE kind = $1 AND id = ANY($2::text[])', [kind, gone]);
          await upsert(c, kind, changed, next.version);
        }
        await c.query('UPDATE network_meta SET version = $1, doc = $2, updated_at = now() WHERE id = 1', [next.version, JSON.stringify(metaOf(next))]);
        saved = after;
        return 'ok' as const;
      }),

    refresh: (current) => read(current.version, current),
  };
}
