import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// PostgreSQL, when DATABASE_URL is set: the network, owners and their buses, trips, recordings,
// suggestions and the learned travel times live here instead of in files next to the network file
// (section 6.15 of the plan). The tables are made on start; each change to them is one more entry
// in MIGRATIONS, applied once, in order. On a database with no data yet, what the files hold is
// copied in, so moving a server over keeps everything.

export type Db = {
  pool: pg.Pool;
  schema: string;
  /** Runs `fn` in one transaction: all of it is saved, or none. */
  tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (name text PRIMARY KEY, value text NOT NULL);

  -- The network (store.ts): its version, region and notice, then one row per stop, landmark and
  -- route, in the order they were added. changed_in is the version that last changed the row, so a
  -- server can read only what changed since its copy.
  CREATE TABLE network_meta (
    id int PRIMARY KEY CHECK (id = 1),
    version int NOT NULL,
    doc jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE network_items (
    kind text NOT NULL CHECK (kind IN ('stop', 'landmark', 'route')),
    id text NOT NULL,
    seq bigserial UNIQUE,
    doc jsonb NOT NULL,
    changed_in int NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX network_items_changed ON network_items (changed_in);

  -- Learned travel times and the accuracy report (learned.ts), saved every few minutes.
  CREATE TABLE snapshots (name text PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

  -- Owners, their people and buses, and syndicates (owners.ts). Every change adds one to the
  -- version, so a server holding an older copy finds out and reads them again.
  CREATE TABLE registry_version (id int PRIMARY KEY CHECK (id = 1), version bigint NOT NULL);
  INSERT INTO registry_version VALUES (1, 0);

  CREATE TABLE owners (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    name text NOT NULL,
    pending boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  );

  CREATE TABLE people (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'manager')),
    pending boolean NOT NULL DEFAULT false,
    key_hashes text[] NOT NULL DEFAULT '{}',
    phone text,
    phone_hash text,
    phone_end text,
    password_hash text,
    temp_password boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  );
  CREATE INDEX people_owner ON people (owner_id);

  CREATE TABLE buses (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
    plate text NOT NULL,
    label text,
    code text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL
  );
  CREATE INDEX buses_owner ON buses (owner_id);

  CREATE TABLE syndicates (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    name text NOT NULL,
    route_ids text[] NOT NULL DEFAULT '{}',
    owner_ids text[] NOT NULL DEFAULT '{}',
    contact_name text,
    pending boolean NOT NULL DEFAULT false,
    key_hashes text[] NOT NULL DEFAULT '{}',
    phone text,
    phone_hash text,
    phone_end text,
    password_hash text,
    temp_password boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  );

  -- Owners' finished trips (triplog.ts), by the day they started in Indian time. Kept after an
  -- owner or bus is removed, like the day files were, until they are older than TRIP_HISTORY_DAYS.
  CREATE TABLE trips (
    id text PRIMARY KEY,
    owner_id text NOT NULL,
    bus_id text NOT NULL,
    route_id text NOT NULL,
    day date NOT NULL,
    started_at bigint NOT NULL,
    departed_at bigint NOT NULL,
    ended_at bigint,
    record jsonb NOT NULL
  );
  CREATE INDEX trips_owner_day ON trips (owner_id, day);
  CREATE INDEX trips_day ON trips (day);

  -- Trips running when each server last saved, so a restart carries them on.
  CREATE TABLE running_trips (
    id text PRIMARY KEY,
    server_id text NOT NULL,
    record jsonb NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX running_trips_server ON running_trips (server_id);

  -- Record-route mode (recordings.ts): the positions, and once finished the path and the halts.
  CREATE TABLE recordings (
    id text PRIMARY KEY,
    name text NOT NULL,
    started_at bigint NOT NULL,
    finished_at bigint,
    doc jsonb NOT NULL
  );

  -- Riders' suggested fixes (corrections.ts).
  CREATE TABLE corrections (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    kind text NOT NULL,
    text text NOT NULL,
    route_id text,
    stop_id text,
    status text NOT NULL,
    note text,
    created_at timestamptz NOT NULL,
    reviewed_at timestamptz
  );
  CREATE INDEX corrections_status ON corrections (status);
  `,
  // Conductors sign in instead of typing a bus's code; contributors record routes from buses.
  `
  ALTER TABLE buses DROP COLUMN code;
  ALTER TABLE people DROP CONSTRAINT people_role_check;
  ALTER TABLE people ADD CONSTRAINT people_role_check CHECK (role IN ('owner', 'manager', 'conductor'));
  CREATE TABLE contributors (
    seq bigserial UNIQUE,
    id text PRIMARY KEY,
    name text NOT NULL,
    pending boolean NOT NULL DEFAULT false,
    key_hashes text[] NOT NULL DEFAULT '{}',
    phone text,
    phone_hash text,
    phone_end text,
    password_hash text,
    temp_password boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  );
  ALTER TABLE recordings ADD COLUMN contributor_id text;
  CREATE INDEX recordings_contributor ON recordings (contributor_id);
  `,
];

export async function openDb(url: string, schema = 'public'): Promise<Db> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('DATABASE_SCHEMA may only use lowercase letters, digits and underscores.');
  const pool = new pg.Pool({ connectionString: url, max: 10, options: `-c search_path=${schema}` });
  pool.on('error', (e) => console.error('A PostgreSQL connection failed:', e.message));

  async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  let c: pg.PoolClient;
  try {
    c = await pool.connect();
  } catch (e) {
    await pool.end();
    throw new Error(`Could not connect to PostgreSQL (DATABASE_URL): ${(e as Error).message}`);
  }
  try {
    // Servers starting together make the schema and tables one after the other: even CREATE
    // SCHEMA IF NOT EXISTS fails when two run it at the same moment.
    await c.query('SELECT pg_advisory_lock(hashtext($1))', [`wimb-migrate-${schema}`]);
    try {
      await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const done = new Set((await c.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
      for (const [i, sql] of MIGRATIONS.entries()) {
        if (done.has(i + 1)) continue;
        await c.query('BEGIN');
        try {
          await c.query(sql);
          await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtext($1))', [`wimb-migrate-${schema}`]);
    }
  } finally {
    c.release();
  }

  return { pool, schema, tx, close: () => pool.end() };
}

/**
 * A secret kept in the database, made once and then shared by every server: the first time, the
 * one in `importFile` if there is one (so phone numbers hashed with it still match).
 */
export async function dbSecret(db: Db, name: string, importFile?: string): Promise<string> {
  const read = async () => (await db.pool.query<{ value: string }>('SELECT value FROM settings WHERE name = $1', [name])).rows[0]?.value;
  const found = await read();
  if (found) return found;
  const value = importFile && existsSync(importFile) ? (await readFile(importFile, 'utf8')).trim() : randomBytes(32).toString('base64url');
  await db.pool.query('INSERT INTO settings (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [name, value]);
  // Another server may have made it first: theirs is the one.
  return (await read()) as string;
}

/** Whether a table has no rows yet, so files may be copied into it. */
export async function isEmpty(db: Db | pg.PoolClient, table: string): Promise<boolean> {
  const q = 'pool' in db ? db.pool : db;
  return (await q.query(`SELECT NOT EXISTS (SELECT 1 FROM ${table}) AS empty`)).rows[0].empty as boolean;
}

/** A timestamp column back as the ISO text the app keeps. */
export const iso = (v: Date | string | null | undefined) => (v === null || v === undefined ? undefined : new Date(v).toISOString());
