import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { normalizePlate } from '../../packages/core/src/index.ts';
import { iso, isEmpty, type Db } from './db.ts';
import { HttpError } from './http.ts';

// Bus owners and their buses, their staff (managers and conductors), route syndicates, and
// contributors who record routes. Everyone signs in with their mobile number and a password (on
// /signin, or in the phone app), and only once approved: owners, managers, syndicates and
// contributors by the admin, conductors by their owner or the admin. A conductor signed in is
// trusted as a conductor: at the start of a trip they give the bus's number plate, which must be one
// of their owner's buses, and the trip is kept for the owner (triplog.ts). Each device they sign in
// on gets its own key. Only hashes of keys and passwords are stored; the mobile number is kept in
// full so the admin can call to check who signed up.
//
// The server reads them from memory; each change is saved first, to a JSON file or to PostgreSQL
// tables (RegistryStore), and only then swapped in. In PostgreSQL every change adds one to a
// version: a server whose copy is older (another server changed something) reads them again and
// makes its change once more on the fresh copy.

/** An owner's people: the owner, managers who run the buses, and conductors who share them. */
export type Role = 'owner' | 'manager' | 'conductor';

/** How someone signs in: a mobile number and a password, then a key for each device. */
export type Login = {
  /** One key per device signed in, MAX_KEYS at most; only their hashes. */
  keyHashes: string[];
  /** As +91 and ten digits, for the admin to check who it is. */
  phone?: string;
  /** A keyed hash of the number, to find the account by it. */
  phoneHash?: string;
  phoneEnd?: string;
  passwordHash?: string;
  /** Set by the admin: it only lets them choose a password of their own. */
  tempPassword?: boolean;
};

export type Person = Login & {
  id: string;
  name: string;
  role: Role;
  /** Staff who signed up and wait for approval (conductors: by their owner too): they cannot sign in yet. */
  pending?: boolean;
  createdAt: string;
};

export type Owner = {
  id: string;
  name: string;
  people: Person[];
  /** Signed up and not yet approved by the admin: nobody signs in for them yet. */
  pending?: boolean;
  createdAt: string;
};

export type Bus = {
  id: string;
  ownerId: string;
  /** The registration number as painted on the bus: "WB 19 A 1234". */
  plate: string;
  /** The owner's own name for the bus. */
  label?: string;
  createdAt: string;
};

/** A route syndicate: its members' buses on its routes, read-only. One person signs in for it. */
export type Syndicate = Login & {
  id: string;
  name: string;
  routeIds: string[];
  ownerIds: string[];
  contactName?: string;
  /** Signed up and not yet approved; the admin also chooses its routes and members. */
  pending?: boolean;
  createdAt: string;
};

/** Someone who records routes from inside buses for the admins to check (recordings.ts). */
export type Contributor = Login & {
  id: string;
  name: string;
  /** Signed up and not yet approved by the admin. */
  pending?: boolean;
  createdAt: string;
};

export type AccountKind = Role | 'syndicate' | 'contributor';

/** Who a mobile number or a key signs in. */
export type Account =
  | { kind: Role; owner: Owner; person: Person }
  | { kind: 'syndicate'; syndicate: Syndicate }
  | { kind: 'contributor'; contributor: Contributor };

/** An account by its ids, to find it again in a copy being changed. */
export type AccountRef = { ownerId: string; personId: string } | { syndicateId: string } | { contributorId: string };

export type Registry = { owners: Owner[]; buses: Bus[]; syndicates: Syndicate[]; contributors: Contributor[] };

/** As saved before: one key per owner, and one per syndicate. */
type SavedOwner = Omit<Owner, 'people'> & { people?: Person[]; keyHash?: string };
type SavedSyndicate = Omit<Syndicate, 'keyHashes'> & { keyHashes?: string[]; keyHash?: string };
/** Buses had a conductor code until conductors signed in. */
type SavedBus = Bus & { code?: string };
type SavedRegistry = { owners?: SavedOwner[]; buses?: SavedBus[]; syndicates?: SavedSyndicate[]; contributors?: Contributor[] };

/** Where the registry is kept. */
export type RegistryStore = {
  /** `legacy`: saved in an older form, to be saved again in the new one at once. */
  load(): Promise<{ registry: Registry; version: number; legacy: boolean }>;
  /** Saves `next` over `prev`, unless what is saved is no longer `version`; the new version. */
  save(prev: Registry, next: Registry, version: number): Promise<number | 'conflict'>;
  /** The version saved now, cheaply; missing where only this server writes (a file). */
  version?(): Promise<number>;
};

const MAX_KEYS = 5;
const MAX_PEOPLE = 10;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('base64url');

const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex')}`;
const newKey = () => randomBytes(24).toString('base64url');

export const refOf = (a: Account): AccountRef =>
  a.kind === 'syndicate' ? { syndicateId: a.syndicate.id } : a.kind === 'contributor' ? { contributorId: a.contributor.id } : { ownerId: a.owner.id, personId: a.person.id };
export const loginOf = (a: Account): Login => (a.kind === 'syndicate' ? a.syndicate : a.kind === 'contributor' ? a.contributor : a.person);
/** Approved, so they may sign in. */
export const approved = (a: Account) =>
  a.kind === 'syndicate' ? !a.syndicate.pending : a.kind === 'contributor' ? !a.contributor.pending : !a.owner.pending && !a.person.pending;
/** The name to greet them by. */
export const nameOf = (a: Account) => (a.kind === 'syndicate' ? a.syndicate.contactName ?? a.syndicate.name : a.kind === 'contributor' ? a.contributor.name : a.person.name);

/** The secret phone numbers are hashed with, made on first start and kept beside the data. */
export async function loadSecret(file: string): Promise<string> {
  if (existsSync(file)) return (await readFile(file, 'utf8')).trim();
  const secret = randomBytes(32).toString('base64url');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function load(raw: SavedRegistry): Registry {
  const owners = (raw.owners ?? []).map(({ keyHash, people, ...o }): Owner => ({
    ...o,
    people: people ?? [{ id: newId('p'), name: o.name, role: 'owner', keyHashes: keyHash ? [keyHash] : [], createdAt: o.createdAt }],
  }));
  const syndicates = (raw.syndicates ?? []).map(({ keyHash, keyHashes, ...s }): Syndicate => ({ ...s, keyHashes: keyHashes ?? (keyHash ? [keyHash] : []) }));
  const buses = (raw.buses ?? []).map(({ code: _code, ...b }): Bus => b);
  return { owners, buses, syndicates, contributors: raw.contributors ?? [] };
}

async function readRegistryFile(file: string): Promise<{ registry: Registry; legacy: boolean }> {
  const saved = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as SavedRegistry) : {};
  // A file from before owners had several people, or syndicates several keys.
  const legacy = !!(saved.owners?.some((o) => !o.people) || saved.syndicates?.some((s) => !s.keyHashes) || saved.buses?.some((b) => b.code !== undefined));
  return { registry: load(saved), legacy };
}

/** One JSON file, written whole, to a copy first and renamed over the old one. */
export function fileRegistryStore(file: string): RegistryStore {
  return {
    async load() {
      return { ...(await readRegistryFile(file)), version: 0 };
    },
    async save(_prev, next, version) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
      await rename(tmp, file); // atomic on the same disk, so a crash never leaves half a file
      return version + 1;
    },
  };
}

// ---- PostgreSQL: tables owners, people, buses and syndicates (db.ts) ----

type LoginRow = {
  key_hashes: string[];
  phone: string | null;
  phone_hash: string | null;
  phone_end: string | null;
  password_hash: string | null;
  temp_password: boolean;
};

function loginFromRow(r: LoginRow): Login {
  const l: Login = { keyHashes: r.key_hashes };
  if (r.phone) l.phone = r.phone;
  if (r.phone_hash) l.phoneHash = r.phone_hash;
  if (r.phone_end) l.phoneEnd = r.phone_end;
  if (r.password_hash) l.passwordHash = r.password_hash;
  if (r.temp_password) l.tempPassword = true;
  return l;
}

const loginValues = (l: Login) => [l.keyHashes, l.phone ?? null, l.phoneHash ?? null, l.phoneEnd ?? null, l.passwordHash ?? null, l.tempPassword === true];

/** What was removed, and what is new or different, by id. */
function diff<T extends { id: string }>(prev: T[], next: T[]) {
  const before = new Map(prev.map((x) => [x.id, JSON.stringify(x)]));
  const ids = new Set(next.map((x) => x.id));
  return { removed: prev.filter((x) => !ids.has(x.id)).map((x) => x.id), changed: next.filter((x) => before.get(x.id) !== JSON.stringify(x)) };
}

async function readRegistryRows(c: pg.PoolClient): Promise<{ registry: Registry; version: number }> {
  const version = Number((await c.query('SELECT version FROM registry_version WHERE id = 1')).rows[0].version);
  const owners = new Map<string, Owner>();
  for (const r of (await c.query('SELECT * FROM owners ORDER BY seq')).rows) {
    const o: Owner = { id: r.id, name: r.name, people: [], createdAt: iso(r.created_at) as string };
    if (r.pending) o.pending = true;
    owners.set(o.id, o);
  }
  for (const r of (await c.query('SELECT * FROM people ORDER BY seq')).rows) {
    const p: Person = { id: r.id, name: r.name, role: r.role, createdAt: iso(r.created_at) as string, ...loginFromRow(r) };
    if (r.pending) p.pending = true;
    owners.get(r.owner_id)?.people.push(p);
  }
  const buses = (await c.query('SELECT * FROM buses ORDER BY seq')).rows.map((r): Bus => {
    const b: Bus = { id: r.id, ownerId: r.owner_id, plate: r.plate, createdAt: iso(r.created_at) as string };
    if (r.label) b.label = r.label;
    return b;
  });
  const syndicates = (await c.query('SELECT * FROM syndicates ORDER BY seq')).rows.map((r): Syndicate => {
    const s: Syndicate = { id: r.id, name: r.name, routeIds: r.route_ids, ownerIds: r.owner_ids, createdAt: iso(r.created_at) as string, ...loginFromRow(r) };
    if (r.contact_name) s.contactName = r.contact_name;
    if (r.pending) s.pending = true;
    return s;
  });
  const contributors = (await c.query('SELECT * FROM contributors ORDER BY seq')).rows.map((r): Contributor => {
    const x: Contributor = { id: r.id, name: r.name, createdAt: iso(r.created_at) as string, ...loginFromRow(r) };
    if (r.pending) x.pending = true;
    return x;
  });
  return { registry: { owners: [...owners.values()], buses, syndicates, contributors }, version };
}

async function writeRegistryRows(c: pg.PoolClient, prev: Registry, next: Registry) {
  const ownerOnly = (r: Registry) => r.owners.map(({ people: _people, ...o }) => o);
  const peopleOf = (r: Registry) => r.owners.flatMap((o) => o.people.map((p) => ({ ...p, ownerId: o.id })));
  const owners = diff(ownerOnly(prev), ownerOnly(next));
  const people = diff(peopleOf(prev), peopleOf(next));
  const buses = diff(prev.buses, next.buses);
  const syndicates = diff(prev.syndicates, next.syndicates);
  const contributors = diff(prev.contributors, next.contributors);

  // Removals first, so a mobile number given up in this change can be used again in it.
  if (buses.removed.length) await c.query('DELETE FROM buses WHERE id = ANY($1::text[])', [buses.removed]);
  if (people.removed.length) await c.query('DELETE FROM people WHERE id = ANY($1::text[])', [people.removed]);
  if (syndicates.removed.length) await c.query('DELETE FROM syndicates WHERE id = ANY($1::text[])', [syndicates.removed]);
  if (contributors.removed.length) await c.query('DELETE FROM contributors WHERE id = ANY($1::text[])', [contributors.removed]);
  if (owners.removed.length) await c.query('DELETE FROM owners WHERE id = ANY($1::text[])', [owners.removed]);

  for (const o of owners.changed) {
    await c.query(
      `INSERT INTO owners (id, name, pending, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pending = EXCLUDED.pending, created_at = EXCLUDED.created_at`,
      [o.id, o.name, o.pending === true, o.createdAt],
    );
  }
  for (const p of people.changed) {
    await c.query(
      `INSERT INTO people (id, owner_id, name, role, pending, created_at, key_hashes, phone, phone_hash, phone_end, password_hash, temp_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, name = EXCLUDED.name, role = EXCLUDED.role, pending = EXCLUDED.pending,
         created_at = EXCLUDED.created_at, key_hashes = EXCLUDED.key_hashes, phone = EXCLUDED.phone, phone_hash = EXCLUDED.phone_hash,
         phone_end = EXCLUDED.phone_end, password_hash = EXCLUDED.password_hash, temp_password = EXCLUDED.temp_password`,
      [p.id, p.ownerId, p.name, p.role, p.pending === true, p.createdAt, ...loginValues(p)],
    );
  }
  for (const b of buses.changed) {
    await c.query(
      `INSERT INTO buses (id, owner_id, plate, label, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, plate = EXCLUDED.plate, label = EXCLUDED.label, created_at = EXCLUDED.created_at`,
      [b.id, b.ownerId, b.plate, b.label ?? null, b.createdAt],
    );
  }
  for (const s of syndicates.changed) {
    await c.query(
      `INSERT INTO syndicates (id, name, route_ids, owner_ids, contact_name, pending, created_at, key_hashes, phone, phone_hash, phone_end, password_hash, temp_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, route_ids = EXCLUDED.route_ids, owner_ids = EXCLUDED.owner_ids,
         contact_name = EXCLUDED.contact_name, pending = EXCLUDED.pending, created_at = EXCLUDED.created_at, key_hashes = EXCLUDED.key_hashes,
         phone = EXCLUDED.phone, phone_hash = EXCLUDED.phone_hash, phone_end = EXCLUDED.phone_end, password_hash = EXCLUDED.password_hash,
         temp_password = EXCLUDED.temp_password`,
      [s.id, s.name, s.routeIds, s.ownerIds, s.contactName ?? null, s.pending === true, s.createdAt, ...loginValues(s)],
    );
  }
  for (const x of contributors.changed) {
    await c.query(
      `INSERT INTO contributors (id, name, pending, created_at, key_hashes, phone, phone_hash, phone_end, password_hash, temp_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pending = EXCLUDED.pending, created_at = EXCLUDED.created_at, key_hashes = EXCLUDED.key_hashes,
         phone = EXCLUDED.phone, phone_hash = EXCLUDED.phone_hash, phone_end = EXCLUDED.phone_end, password_hash = EXCLUDED.password_hash,
         temp_password = EXCLUDED.temp_password`,
      [x.id, x.name, x.pending === true, x.createdAt, ...loginValues(x)],
    );
  }
}

/**
 * The registry in PostgreSQL. Only the rows a change touched are written. The first time, on empty
 * tables, the owners file this server kept before is copied in when there is one.
 */
export function pgRegistryStore(db: Db, importFile?: string): RegistryStore {
  const empty = (): Registry => ({ owners: [], buses: [], syndicates: [], contributors: [] });
  return {
    async load() {
      if (importFile && existsSync(importFile) && (await isEmpty(db, 'owners')) && (await isEmpty(db, 'syndicates'))) {
        const { registry } = await readRegistryFile(importFile);
        await db.tx(async (c) => {
          // Only the first server to get here copies the file in.
          await c.query('SELECT version FROM registry_version WHERE id = 1 FOR UPDATE');
          if ((await isEmpty(c, 'owners')) && (await isEmpty(c, 'syndicates'))) {
            await writeRegistryRows(c, empty(), registry);
            await c.query('UPDATE registry_version SET version = version + 1 WHERE id = 1');
          }
        });
      }
      const c = await db.pool.connect();
      try {
        // One consistent picture of all four tables.
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const out = await readRegistryRows(c);
        await c.query('COMMIT');
        return { ...out, legacy: false };
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    version: async () => Number((await db.pool.query('SELECT version FROM registry_version WHERE id = 1')).rows[0].version),
    save: (prev, next, version) =>
      db.tx(async (c) => {
        const now = Number((await c.query('SELECT version FROM registry_version WHERE id = 1 FOR UPDATE')).rows[0].version);
        if (now !== version) return 'conflict' as const;
        await writeRegistryRows(c, prev, next);
        await c.query('UPDATE registry_version SET version = $1 WHERE id = 1', [version + 1]);
        return version + 1;
      }),
  };
}

/** "wb 19a-1234 " becomes "WB 19A-1234": capitals, single spaces. */
function cleanPlate(raw: unknown): string {
  const plate = String(raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  const bare = plate.replace(/[ -]/g, '');
  if (!/^[A-Z0-9 -]+$/.test(plate) || bare.length < 4 || bare.length > 15 || !normalizePlate(plate)) {
    throw new HttpError(400, 'Type the number plate as painted on the bus, for example WB 19 A 1234.');
  }
  return plate;
}

const plateKey = (plate: string) => plate.replace(/[ -]/g, '');

function cleanName(raw: unknown, what: string, max: number, required: boolean): string | undefined {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name && required) throw new HttpError(400, `Add the ${what}.`);
  if (name.length > max) throw new HttpError(400, `Keep the ${what} to ${max} characters.`);
  return name || undefined;
}


export type SignUp = {
  kind: AccountKind;
  /** The person's name; for an owner, their own or their company's. */
  name: unknown;
  /** A syndicate's name. */
  orgName?: unknown;
  /** As +91 and ten digits (otp.ts indianMobile). */
  phone: string;
  passwordHash: string;
  /** Staff: their owner's mobile number. */
  ownerPhone?: string;
};

export async function openOwnerRegistry(
  where: string | RegistryStore,
  opts: { phoneSecret?: string; /** After each change is saved: to tell other servers. */ onSaved?: () => void } = {},
) {
  const store = typeof where === 'string' ? fileRegistryStore(where) : where;
  const loaded = await store.load();
  let reg: Registry = loaded.registry;
  let version = loaded.version;
  let byKeyHash = new Map<string, { owner: Owner; person: Person }>();
  let byPhone = new Map<string, Account>();
  let syndicateByKey = new Map<string, Syndicate>();
  let contributorByKey = new Map<string, Contributor>();
  const index = () => {
    byKeyHash = new Map();
    byPhone = new Map();
    syndicateByKey = new Map();
    contributorByKey = new Map();
    for (const owner of reg.owners) {
      for (const person of owner.people) {
        for (const h of person.keyHashes) byKeyHash.set(h, { owner, person });
        if (person.phoneHash) byPhone.set(person.phoneHash, { kind: person.role, owner, person });
      }
    }
    for (const s of reg.syndicates) {
      for (const h of s.keyHashes) syndicateByKey.set(h, s);
      if (s.phoneHash) byPhone.set(s.phoneHash, { kind: 'syndicate', syndicate: s });
    }
    for (const x of reg.contributors) {
      for (const h of x.keyHashes) contributorByKey.set(h, x);
      if (x.phoneHash) byPhone.set(x.phoneHash, { kind: 'contributor', contributor: x });
    }
  };
  index();

  const phoneHash = (phone: string) => {
    if (!opts.phoneSecret) throw new Error('Accounts need phoneSecret to find people by their number.');
    return createHmac('sha256', opts.phoneSecret).update(phone).digest('base64url');
  };

  // Changes are applied one at a time to a copy, saved, then swapped in, like network edits.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  /** Reads what is saved again, when it is newer than this copy. */
  async function refresh() {
    const fresh = await store.load();
    if (fresh.version === version) return;
    reg = fresh.registry;
    version = fresh.version;
    index();
  }

  function change<T>(edit: (draft: Registry) => T): Promise<T> {
    return enqueue(async () => {
      for (let attempt = 1; ; attempt++) {
        const draft = structuredClone(reg);
        const out = edit(draft);
        const saved = await store.save(reg, draft, version);
        if (saved === 'conflict') {
          // Another server changed something first: make this change again on what it saved.
          if (attempt >= 5) throw new HttpError(503, 'Too many changes at once. Try again in a moment.');
          await refresh();
          continue;
        }
        reg = draft;
        version = saved;
        index();
        opts.onSaved?.();
        return out;
      }
    });
  }

  // A file from before owners had several people, or syndicates several keys, is saved in the new
  // form at once, so the owner's id as a person stays the same from now on.
  if (loaded.legacy) await change(() => undefined);

  const findOwner = (draft: Registry, id: string) => {
    const owner = draft.owners.find((o) => o.id === id);
    if (!owner) throw new HttpError(404, 'There is no bus owner with that id.');
    return owner;
  };
  const findPerson = (owner: Owner, id: string) => {
    const person = owner.people.find((p) => p.id === id);
    if (!person) throw new HttpError(404, 'There is nobody with that id.');
    return person;
  };
  const findBus = (draft: Registry, ownerId: string, id: string) => {
    const bus = draft.buses.find((b) => b.id === id && b.ownerId === ownerId);
    if (!bus) throw new HttpError(404, 'You have no bus with that id.');
    return bus;
  };
  const findSyndicate = (draft: Registry, id: string) => {
    const s = draft.syndicates.find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'There is no syndicate with that id.');
    return s;
  };
  const findContributor = (draft: Registry, id: string) => {
    const x = draft.contributors.find((c) => c.id === id);
    if (!x) throw new HttpError(404, 'There is no contributor with that id.');
    return x;
  };
  const findLogin = (draft: Registry, ref: AccountRef): Login =>
    'syndicateId' in ref
      ? findSyndicate(draft, ref.syndicateId)
      : 'contributorId' in ref
        ? findContributor(draft, ref.contributorId)
        : findPerson(findOwner(draft, ref.ownerId), ref.personId);
  const checkPlateFree = (draft: Registry, plate: string, exceptId?: string) => {
    if (draft.buses.some((b) => b.id !== exceptId && plateKey(b.plate) === plateKey(plate))) {
      throw new HttpError(409, 'A bus with this number plate has already been added. If it is yours, ask the admin to check.');
    }
  };
  const checkMembers = (draft: Registry, ownerIds: string[]) => {
    for (const id of ownerIds) findOwner(draft, id);
  };
  const logins = (draft: Registry): Login[] => [...draft.owners.flatMap((o) => o.people), ...draft.syndicates, ...draft.contributors];
  /** A mobile number signs in one account only. */
  const checkPhoneFree = (draft: Registry, hash: string, except?: Login) => {
    if (logins(draft).some((l) => l.phoneHash === hash && l !== except)) {
      throw new HttpError(409, 'This mobile number already has an account. Sign in with it, or ask the Where Is My Bus team to set a new password.');
    }
  };
  const phoneFields = (phone: string) => ({ phone, phoneHash: phoneHash(phone), phoneEnd: phone.slice(-4) });

  /**
   * A key this server does not know may have just been given out by another server, before the
   * message saying so arrived: the saved version is checked (at most every 200 ms, one check at a
   * time), and everything read again if it moved on.
   */
  let checkedAt = 0;
  let checking: Promise<void> | null = null;
  function catchUp(): Promise<void> {
    if (!store.version) return Promise.resolve();
    checking ??= (async () => {
      if (Date.now() - checkedAt < 200) return;
      checkedAt = Date.now();
      if ((await store.version!()) !== version) await enqueue(refresh);
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  return {
    /** Another server changed something: read it all again (after any change of ours being saved). */
    reload: () => enqueue(refresh),
    catchUp,

    owners: () => reg.owners,
    owner: (id: string) => reg.owners.find((o) => o.id === id),
    /** The owner and the person a key signs in. */
    signIn: (key: string) => (key ? byKeyHash.get(hashKey(key)) : undefined),
    buses: (ownerId?: string) => (ownerId ? reg.buses.filter((b) => b.ownerId === ownerId) : reg.buses),
    bus: (id: string) => reg.buses.find((b) => b.id === id),
    /** One of this owner's buses, by its number plate however it is typed: "wb 19a-1234". */
    busByPlate: (ownerId: string, plate: unknown) => {
      const key = plateKey(String(plate ?? '').toUpperCase());
      return key ? reg.buses.find((b) => b.ownerId === ownerId && plateKey(b.plate) === key) : undefined;
    },

    // ---- Accounts: signing up and in with a mobile number and a password (server.ts, passwords.ts) ----

    /** The account with this mobile number, if any. */
    account: (phone: string): Account | undefined => byPhone.get(phoneHash(phone)),

    /** The account with these ids, if it is still there. */
    byRef: (ref: AccountRef): Account | undefined => {
      if ('syndicateId' in ref) {
        const syndicate = reg.syndicates.find((s) => s.id === ref.syndicateId);
        return syndicate ? { kind: 'syndicate', syndicate } : undefined;
      }
      if ('contributorId' in ref) {
        const contributor = reg.contributors.find((x) => x.id === ref.contributorId);
        return contributor ? { kind: 'contributor', contributor } : undefined;
      }
      const owner = reg.owners.find((o) => o.id === ref.ownerId);
      const person = owner?.people.find((p) => p.id === ref.personId);
      return owner && person ? { kind: person.role, owner, person } : undefined;
    },

    /** The account a key signs in, if any. */
    accountByKey: (key: string): Account | undefined => {
      if (!key) return undefined;
      const h = hashKey(key);
      const who = byKeyHash.get(h);
      if (who) return { kind: who.person.role, ...who };
      const syndicate = syndicateByKey.get(h);
      if (syndicate) return { kind: 'syndicate', syndicate };
      const contributor = contributorByKey.get(h);
      return contributor ? { kind: 'contributor', contributor } : undefined;
    },

    /** A new account, waiting for approval. Staff (managers, conductors) name their owner by the owner's mobile number. */
    signUp: (input: SignUp) => {
      const hash = phoneHash(input.phone);
      const login = { keyHashes: [], ...phoneFields(input.phone), passwordHash: input.passwordHash };
      const createdAt = new Date().toISOString();
      if (input.kind === 'syndicate') {
        const name = cleanName(input.orgName, 'syndicate’s name', 80, true) as string;
        const contactName = cleanName(input.name, 'your name', 60, true) as string;
        return change((draft) => {
          checkPhoneFree(draft, hash);
          const s: Syndicate = { id: newId('s'), name, routeIds: [], ownerIds: [], contactName, pending: true, createdAt, ...login };
          draft.syndicates.push(s);
          return { kind: input.kind, id: s.id, name };
        });
      }
      if (input.kind === 'contributor') {
        const name = cleanName(input.name, 'your name', 60, true) as string;
        return change((draft) => {
          checkPhoneFree(draft, hash);
          const x: Contributor = { id: newId('c'), name, pending: true, createdAt, ...login };
          draft.contributors.push(x);
          return { kind: input.kind, id: x.id, name };
        });
      }
      if (input.kind === 'manager' || input.kind === 'conductor') {
        const role = input.kind;
        const name = cleanName(input.name, 'your name', 60, true) as string;
        const ownerHash = input.ownerPhone ? phoneHash(input.ownerPhone) : '';
        return change((draft) => {
          checkPhoneFree(draft, hash);
          const owner = draft.owners.find((o) => o.people.some((p) => p.role === 'owner' && p.phoneHash === ownerHash));
          if (!owner) throw new HttpError(400, 'No bus owner has an account with that mobile number. Ask your owner for the number they sign in with.');
          if (owner.people.length >= MAX_PEOPLE) throw new HttpError(400, `An owner can have up to ${MAX_PEOPLE} people.`);
          const person: Person = { id: newId('p'), name, role, pending: true, createdAt, ...login };
          owner.people.push(person);
          return { kind: input.kind, id: person.id, name, ownerName: owner.name };
        });
      }
      const name = cleanName(input.name, 'name', 80, true) as string;
      return change((draft) => {
        checkPhoneFree(draft, hash);
        const person: Person = { id: newId('p'), name, role: 'owner', createdAt, ...login };
        const owner: Owner = { id: newId('o'), name, people: [person], pending: true, createdAt };
        draft.owners.push(owner);
        return { kind: input.kind, id: owner.id, name };
      });
    },

    /** A key for one more device. */
    newSession: (ref: AccountRef) => {
      const key = newKey();
      return change((draft) => {
        const login = findLogin(draft, ref);
        login.keyHashes = [...login.keyHashes, hashKey(key)].slice(-MAX_KEYS);
        return { key };
      });
    },

    /** Signing out on one device: its key stops working. */
    endSession: (key: string) => {
      const h = hashKey(key);
      return change((draft) => {
        for (const login of logins(draft)) login.keyHashes = login.keyHashes.filter((k) => k !== h);
        return { signedOut: true };
      });
    },

    /**
     * A new password; every device is signed out. `signIn`: this device gets a new key. `temp`: from
     * the admin, and it only lets them choose their own. The admin can add the number of someone
     * who has none, from before passwords.
     */
    setPassword: (ref: AccountRef, passwordHash: string, opts: { temp: boolean; signIn: boolean; phone?: string }) => {
      const key = opts.signIn ? newKey() : '';
      const hash = opts.phone ? phoneHash(opts.phone) : '';
      return change((draft) => {
        const login = findLogin(draft, ref);
        if (opts.phone) {
          checkPhoneFree(draft, hash, login);
          Object.assign(login, phoneFields(opts.phone));
        }
        if (!login.phoneHash) throw new HttpError(400, 'Add their mobile number: they sign in with it.');
        login.passwordHash = passwordHash;
        login.keyHashes = key ? [hashKey(key)] : [];
        if (opts.temp) login.tempPassword = true;
        else delete login.tempPassword;
        return { key };
      });
    },

    /** The admin approves an owner, so they and their approved staff can sign in. */
    approveOwner: (id: string) =>
      change((draft) => {
        const owner = findOwner(draft, id);
        delete owner.pending;
        return owner;
      }),

    approvePerson: (ownerId: string, personId: string) =>
      change((draft) => {
        const owner = findOwner(draft, ownerId);
        const person = findPerson(owner, personId);
        delete person.pending;
        return { owner, person };
      }),

    renameOwner: (id: string, name: unknown) => {
      const clean = cleanName(name, 'owner’s name', 80, true) as string;
      return change((draft) => {
        const owner = findOwner(draft, id);
        owner.name = clean;
        return owner;
      });
    },

    /** Added by the admin, so approved at once, with a temporary password (made by the caller). */
    addOwner: (name: unknown, phone: string, passwordHash: string) => {
      const clean = cleanName(name, 'owner’s name', 80, true) as string;
      const hash = phoneHash(phone);
      return change((draft) => {
        checkPhoneFree(draft, hash);
        const createdAt = new Date().toISOString();
        const person: Person = { id: newId('p'), name: clean, role: 'owner', keyHashes: [], ...phoneFields(phone), passwordHash, tempPassword: true, createdAt };
        const owner: Owner = { id: newId('o'), name: clean, people: [person], createdAt };
        draft.owners.push(owner);
        return owner;
      });
    },

    removeOwner: (id: string) =>
      change((draft) => {
        findOwner(draft, id);
        const removed = draft.buses.filter((b) => b.ownerId === id).map((b) => b.id);
        draft.owners = draft.owners.filter((o) => o.id !== id);
        draft.buses = draft.buses.filter((b) => b.ownerId !== id);
        for (const s of draft.syndicates) s.ownerIds = s.ownerIds.filter((o) => o !== id);
        return { removedBuses: removed };
      }),

    /** Staff stop signing in for an owner: removed by the owner, or turned down by the admin. */
    removePerson: (ownerId: string, personId: string) =>
      change((draft) => {
        const owner = findOwner(draft, ownerId);
        if (findPerson(owner, personId).role === 'owner') throw new HttpError(400, 'The owner is not removed here: remove the whole owner instead.');
        owner.people = owner.people.filter((p) => p.id !== personId);
        return { removed: personId };
      }),

    // ---- Buses ----

    addBus: (ownerId: string, input: { plate?: unknown; label?: unknown }) => {
      const plate = cleanPlate(input.plate);
      const label = cleanName(input.label, 'bus’s name', 40, false);
      return change((draft) => {
        if (findOwner(draft, ownerId).pending) {
          throw new HttpError(403, 'The Where Is My Bus team checks new owners before they add buses. You can add them here once they have.');
        }
        checkPlateFree(draft, plate);
        const bus: Bus = { id: newId('b'), ownerId, plate, createdAt: new Date().toISOString() };
        if (label) bus.label = label;
        draft.buses.push(bus);
        return bus;
      });
    },

    updateBus: (ownerId: string, id: string, input: { plate?: unknown; label?: unknown }) => {
      const plate = input.plate === undefined ? undefined : cleanPlate(input.plate);
      const label = cleanName(input.label, 'bus’s name', 40, false);
      return change((draft) => {
        const bus = findBus(draft, ownerId, id);
        if (plate !== undefined) {
          checkPlateFree(draft, plate, id);
          bus.plate = plate;
        }
        if (input.label !== undefined) {
          if (label) bus.label = label;
          else delete bus.label;
        }
        return bus;
      });
    },

    removeBus: (ownerId: string, id: string) =>
      change((draft) => {
        findBus(draft, ownerId, id);
        draft.buses = draft.buses.filter((b) => b.id !== id);
        return { removed: id };
      }),

    // ---- Route syndicates (the server checks the route ids against the network) ----

    syndicates: () => reg.syndicates,
    syndicateByKey: (key: string) => (key ? syndicateByKey.get(hashKey(key)) : undefined),

    /** Added by the admin, so approved at once; its contact signs in with a temporary password. */
    addSyndicate: (input: { name: unknown; routeIds: string[]; ownerIds: string[]; contactName: unknown; phone: string; passwordHash: string }) => {
      const name = cleanName(input.name, 'syndicate’s name', 80, true) as string;
      const contactName = cleanName(input.contactName, 'name of the person who signs in for it', 60, true) as string;
      const hash = phoneHash(input.phone);
      return change((draft) => {
        checkMembers(draft, input.ownerIds);
        checkPhoneFree(draft, hash);
        const syndicate: Syndicate = {
          id: newId('s'),
          name,
          routeIds: [...new Set(input.routeIds)],
          ownerIds: [...new Set(input.ownerIds)],
          contactName,
          keyHashes: [],
          ...phoneFields(input.phone),
          passwordHash: input.passwordHash,
          tempPassword: true,
          createdAt: new Date().toISOString(),
        };
        draft.syndicates.push(syndicate);
        return syndicate;
      });
    },

    /** Changed by the admin; `approve` also lets a syndicate that signed up sign in. */
    updateSyndicate: (id: string, input: { name: unknown; routeIds: string[]; ownerIds: string[] }, opts: { approve?: boolean } = {}) => {
      const name = cleanName(input.name, 'syndicate’s name', 80, true) as string;
      return change((draft) => {
        const s = findSyndicate(draft, id);
        checkMembers(draft, input.ownerIds);
        Object.assign(s, { name, routeIds: [...new Set(input.routeIds)], ownerIds: [...new Set(input.ownerIds)] });
        if (opts.approve) delete s.pending;
        return s;
      });
    },

    removeSyndicate: (id: string) =>
      change((draft) => {
        findSyndicate(draft, id);
        draft.syndicates = draft.syndicates.filter((s) => s.id !== id);
        return { removed: id };
      }),

    // ---- Contributors (recordings.ts): the admin approves or removes them ----

    contributors: () => reg.contributors,
    contributor: (id: string) => reg.contributors.find((x) => x.id === id),

    approveContributor: (id: string) =>
      change((draft) => {
        const x = findContributor(draft, id);
        delete x.pending;
        return x;
      }),

    removeContributor: (id: string) =>
      change((draft) => {
        findContributor(draft, id);
        draft.contributors = draft.contributors.filter((x) => x.id !== id);
        return { removed: id };
      }),
  };
}

export type OwnerRegistry = Awaited<ReturnType<typeof openOwnerRegistry>>;
