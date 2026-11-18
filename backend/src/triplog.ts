import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { istNow, type IngestResult, type OperatorType, type PreparedNetwork, type PreparedPattern } from '../../packages/core/src/index.ts';
import { isEmpty, type Db } from './db.ts';
import type { Bus } from './owners.ts';

// Trips of owners' buses, for the owner dashboard, by the day the trip started in Indian time.
// Only a summary is kept: where on the route the bus was first and furthest seen, and when, not
// its positions. Running trips are saved every 30 s, so a restart carries them on. Kept in files
// (one of JSON lines per day; when a trip is written again because it carried on after a gap, its
// later line replaces the earlier one) or in PostgreSQL tables when DATABASE_URL is set (TripStore).

export type TripEnd = 'phone' | 'no_signal' | 'bus_removed';

export type TripRecord = {
  id: string;
  ownerId: string;
  busId: string;
  plate: string;
  patternId: string;
  routeId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  /** When the conductor started sharing. */
  startedAt: number;
  /** When the bus left the place it was first seen, usually the first stop. */
  departedAt: number;
  /** When the bus last moved on along the route, and how far along it was then. */
  movedAt: number;
  movedM: number;
  lastSeenAt: number;
  endedAt?: number;
  ended?: TripEnd;
  /** Metres along the route where the bus was first and furthest seen. */
  fromM: number;
  toM: number;
  fromStop: string;
  toStop: string;
  /** Stops from fromStop to toStop, both counted, of stopCount on the route direction. */
  stops: number;
  stopCount: number;
  /** Seen at the first stop and at the last one. */
  wholeRoute: boolean;
  positions: number;
};

/** A conductor's phone sharing a registered bus, and the trip it is on once the bus is on the route. */
type Link = { busId: string; ownerId: string; plate: string; patternId: string; startedAt: number; tripId?: string };

const CARRY_ON_MS = 20 * 60_000;
/** A stop counts as reached when the bus came this close to it. */
const REACHED_M = 100;
/** First seen this close to the first stop counts as starting there. */
const AT_START_M = 300;
/** Further than this from where it was first seen, the bus has left. */
const LEFT_M = 100;
const MOVED_M = 20;
/** Shorter trips are not kept: the bus never really went anywhere. */
export const MIN_TRIP_M = 300;

export const dayOf = (ts: number) => istNow(new Date(ts)).dateISO;

/** Where trips are kept. */
export type TripStore = {
  /** The trips that were running when this server last saved. */
  loadRunning(): Promise<TripRecord[]>;
  saveRunning(trips: TripRecord[]): Promise<void>;
  /** A finished trip; a trip saved again replaces what was saved for it. */
  saveTrip(t: TripRecord): Promise<void>;
  /** Finished trips that started on these days (both counted), of these owners or of all. */
  tripsBetween(fromISO: string, toISO: string, ownerIds?: string[]): Promise<TripRecord[]>;
  /** Trips that started before this day go. */
  prune(oldestDateISO: string): Promise<void>;
};

/**
 * Every server keeps the same trips in memory (live-cluster.ts), but only the leader saves them,
 * so each is saved once. Reading goes on as usual.
 */
export function leaderOnly(store: TripStore, isLeader: () => boolean): TripStore {
  return {
    ...store,
    saveRunning: async (trips) => (isLeader() ? store.saveRunning(trips) : undefined),
    saveTrip: async (t) => (isLeader() ? store.saveTrip(t) : undefined),
    prune: async (oldest) => (isLeader() ? store.prune(oldest) : undefined),
  };
}

/** One file of JSON lines per day, and running.json for the trips running now. */
export async function fileTripStore(dir: string): Promise<TripStore> {
  await mkdir(dir, { recursive: true });
  const runningFile = path.join(dir, 'running.json');
  const dayFile = (dateISO: string) => path.join(dir, `${dateISO}.jsonl`);

  const cache = new Map<string, { mtimeMs: number; size: number; trips: TripRecord[] }>();
  async function readDay(dateISO: string): Promise<TripRecord[]> {
    const file = dayFile(dateISO);
    let info;
    try {
      info = await stat(file);
    } catch {
      return [];
    }
    const hit = cache.get(dateISO);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.trips;
    const trips = parseTripLines(await readFile(file, 'utf8'));
    if (cache.size > 60) cache.clear();
    cache.set(dateISO, { mtimeMs: info.mtimeMs, size: info.size, trips });
    return trips;
  }

  return {
    loadRunning: () => readRunningFile(runningFile),
    async saveRunning(trips) {
      const tmp = `${runningFile}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ savedAt: new Date().toISOString(), trips })}\n`);
      await rename(tmp, runningFile);
    },
    saveTrip: (t) => appendFile(dayFile(dayOf(t.startedAt)), `${JSON.stringify(t)}\n`),
    async tripsBetween(fromISO, toISO, ownerIds) {
      const owners = ownerIds && new Set(ownerIds);
      const out: TripRecord[] = [];
      for (let day = fromISO; day <= toISO; day = dayOf(Date.parse(`${day}T12:00:00+05:30`) + 86_400_000)) {
        for (const t of await readDay(day)) if (!owners || owners.has(t.ownerId)) out.push(t);
      }
      return out;
    },
    async prune(oldest) {
      for (const f of await readdir(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
        if (m && m[1] < oldest) await unlink(path.join(dir, f)).catch(() => undefined);
      }
    },
  };
}

/** A day file's trips; a later line for a trip replaces an earlier one. */
function parseTripLines(text: string): TripRecord[] {
  const byId = new Map<string, TripRecord>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as TripRecord;
      byId.set(t.id, t);
    } catch {
      // A line still being written.
    }
  }
  return [...byId.values()];
}

async function readRunningFile(file: string): Promise<TripRecord[]> {
  try {
    return (JSON.parse(await readFile(file, 'utf8')) as { trips?: TripRecord[] }).trips ?? [];
  } catch {
    return []; // Nothing saved yet.
  }
}

/**
 * Trips in PostgreSQL: table trips for finished ones, running_trips for those running, each marked
 * with the server that runs it (`serverId`, stable across restarts), since live buses are in that
 * server's memory. The first time, on empty tables, the day files in `importDir` are copied in.
 */
export async function pgTripStore(db: Db, serverId: string, importDir?: string): Promise<TripStore> {
  const insert = `INSERT INTO trips (id, owner_id, bus_id, route_id, day, started_at, departed_at, ended_at, record)
    VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, bus_id = EXCLUDED.bus_id, route_id = EXCLUDED.route_id, day = EXCLUDED.day,
      started_at = EXCLUDED.started_at, departed_at = EXCLUDED.departed_at, ended_at = EXCLUDED.ended_at, record = EXCLUDED.record`;
  const values = (t: TripRecord) => [t.id, t.ownerId, t.busId, t.routeId, dayOf(t.startedAt), t.startedAt, t.departedAt, t.endedAt ?? null, JSON.stringify(t)];

  async function saveRunning(trips: TripRecord[]) {
    await db.tx(async (c) => {
      await c.query('DELETE FROM running_trips WHERE server_id = $1 AND NOT (id = ANY($2::text[]))', [serverId, trips.map((t) => t.id)]);
      if (!trips.length) return;
      await c.query(
        `INSERT INTO running_trips (id, server_id, record, saved_at)
         SELECT id, $1, rec::jsonb, now() FROM unnest($2::text[], $3::text[]) AS u (id, rec)
         ON CONFLICT (id) DO UPDATE SET server_id = EXCLUDED.server_id, record = EXCLUDED.record, saved_at = now()`,
        [serverId, trips.map((t) => t.id), trips.map((t) => JSON.stringify(t))],
      );
    });
  }

  if (importDir && existsSync(importDir) && (await isEmpty(db, 'trips')) && (await isEmpty(db, 'running_trips'))) {
    await db.tx(async (c) => {
      await c.query('LOCK TABLE trips IN EXCLUSIVE MODE');
      if (!(await isEmpty(c, 'trips'))) return;
      for (const f of (await readdir(importDir)).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
        for (const t of parseTripLines(await readFile(path.join(importDir, f), 'utf8'))) await c.query(insert, values(t));
      }
    });
    const running = await readRunningFile(path.join(importDir, 'running.json'));
    if (running.length) await saveRunning(running);
  }

  return {
    loadRunning: async () =>
      (await db.pool.query<{ record: TripRecord }>('SELECT record FROM running_trips WHERE server_id = $1', [serverId])).rows.map((r) => r.record),
    saveRunning,
    async saveTrip(t) {
      await db.pool.query(insert, values(t));
    },
    // One query whatever the number of owners and days, on the (owner_id, day) and (day) indexes.
    tripsBetween: async (fromISO, toISO, ownerIds) =>
      (
        await db.pool.query<{ record: TripRecord }>(
          ownerIds
            ? 'SELECT record FROM trips WHERE owner_id = ANY($3::text[]) AND day BETWEEN $1::date AND $2::date'
            : 'SELECT record FROM trips WHERE day BETWEEN $1::date AND $2::date',
          ownerIds ? [fromISO, toISO, ownerIds] : [fromISO, toISO],
        )
      ).rows.map((r) => r.record),
    async prune(oldest) {
      await db.pool.query('DELETE FROM trips WHERE day < $1::date', [oldest]);
    },
  };
}

export async function openTripLog(opts: { dir?: string; store?: TripStore; keepDays: number; getNet: () => PreparedNetwork }) {
  const { keepDays, getNet } = opts;
  const store = opts.store ?? (await fileTripStore(opts.dir ?? 'trips'));

  const running = new Map<string, TripRecord>();
  const links = new Map<string, Link>();
  /** Each bus's latest finished trip, which can still carry on. */
  const lastDone = new Map<string, TripRecord>();
  let dirty = false;
  let prunedAt = 0;

  // The trips that were running when the server last stopped.
  for (const t of await store.loadRunning()) running.set(t.id, t);

  // Saved one at a time, in order.
  let writing: Promise<unknown> = Promise.resolve();
  function write(job: () => Promise<unknown>) {
    writing = writing.then(job).catch((e: unknown) => console.error('Could not save bus trips:', e));
    return writing;
  }

  const hasPhones = (tripId: string) => [...links.values()].some((l) => l.tripId === tripId);

  function place(t: TripRecord, pp: PreparedPattern) {
    const stopIds = pp.pattern.stopIds;
    const last = stopIds.length - 1;
    const reachedBy = (m: number) => {
      let i = 0;
      while (i < last && pp.stopAlong[i + 1] <= m + REACHED_M) i++;
      return i;
    };
    const from = reachedBy(t.fromM);
    const to = reachedBy(t.toM);
    const name = (i: number) => getNet().stops.get(stopIds[i])?.name ?? stopIds[i];
    t.fromStop = name(from);
    t.toStop = name(to);
    t.stops = to - from + 1;
    t.stopCount = stopIds.length;
    t.wholeRoute = t.fromM <= pp.stopAlong[0] + AT_START_M && to === last;
  }

  function finish(t: TripRecord, how: TripEnd, now: number) {
    running.delete(t.id);
    for (const l of links.values()) if (l.tripId === t.id) l.tripId = undefined;
    dirty = true;
    if (t.toM - t.fromM < MIN_TRIP_M) return;
    t.ended = how;
    t.endedAt = how === 'phone' ? now : t.lastSeenAt;
    lastDone.set(t.busId, t);
    // As it is now: the trip may carry on, and change, before this is saved.
    const done = { ...t };
    void write(() => store.saveTrip(done));
  }

  /**
   * The same bus on the same route direction again, from about where it was last seen, within
   * 20 minutes: after no signal, a restart, a second phone or a trip ended by mistake. That is
   * the same trip, not a new one.
   */
  function carryOn(link: Link, along: number, now: number): TripRecord | undefined {
    const fits = (t: TripRecord) =>
      t.busId === link.busId && t.patternId === link.patternId && !t.wholeRoute && now - t.lastSeenAt <= CARRY_ON_MS && along >= t.toM - 500;
    for (const t of running.values()) if (fits(t)) return t;
    const done = lastDone.get(link.busId);
    if (!done || !fits(done)) return undefined;
    lastDone.delete(link.busId);
    delete done.ended;
    delete done.endedAt;
    running.set(done.id, done);
    return done;
  }

  function begin(link: Link, pp: PreparedPattern, along: number, at: number): TripRecord {
    // A bus runs one trip at a time, so a trip of this bus that nobody shares any more is over.
    for (const t of [...running.values()]) if (t.busId === link.busId && !hasPhones(t.id)) finish(t, 'no_signal', at);
    const t: TripRecord = {
      id: `t-${randomBytes(8).toString('hex')}`,
      ownerId: link.ownerId,
      busId: link.busId,
      plate: link.plate,
      patternId: pp.id,
      routeId: pp.route.id,
      routeNumber: pp.route.number,
      operator: pp.route.operator,
      headsign: pp.pattern.headsign,
      startedAt: link.startedAt,
      departedAt: at,
      movedAt: at,
      movedM: along,
      lastSeenAt: at,
      fromM: along,
      toM: along,
      fromStop: '',
      toStop: '',
      stops: 1,
      stopCount: pp.pattern.stopIds.length,
      wholeRoute: false,
      positions: 0,
    };
    running.set(t.id, t);
    return t;
  }

  /** Trips older than keepDays go: they are kept only as long as owners need them. */
  const prune = (now: number) => write(() => store.prune(dayOf(now - keepDays * 86_400_000)));

  function saveRunning() {
    const trips = [...running.values()].map((t) => ({ ...t }));
    return write(() => store.saveRunning(trips));
  }

  /**
   * Trips that started on these days (both counted), running ones included, of these owners or
   * of all, by departure. One read of the store, however many owners and days.
   */
  async function tripsBetween(fromISO: string, toISO: string, ownerIds?: string[]): Promise<TripRecord[]> {
    await writing; // trips that just finished are saved first
    const owners = ownerIds && new Set(ownerIds);
    const byId = new Map((await store.tripsBetween(fromISO, toISO, ownerIds)).map((t) => [t.id, t]));
    for (const t of running.values()) {
      const day = dayOf(t.startedAt);
      if (day >= fromISO && day <= toISO) byId.set(t.id, t);
    }
    return [...byId.values()]
      .filter((t) => (!owners || owners.has(t.ownerId)) && t.toM - t.fromM >= MIN_TRIP_M)
      .sort((a, b) => a.departedAt - b.departedAt);
  }

  return {
    /** A conductor started sharing with a bus's code. Its trip begins once the bus is on the route. */
    start(sessionId: string, bus: Pick<Bus, 'id' | 'ownerId' | 'plate'>, patternId: string, now: number) {
      links.set(sessionId, { busId: bus.id, ownerId: bus.ownerId, plate: bus.plate, patternId, startedAt: now });
    },

    update(sessionId: string, result: IngestResult, now: number) {
      const link = links.get(sessionId);
      if (!link || !result.accepted || result.alongM === undefined) return;
      const pp = getNet().patterns.get(link.patternId);
      if (!pp) return;
      // A batch covers up to a minute: its first position says where the bus was when it began.
      const along = result.alongM;
      const at = Math.min(result.seenAt ?? now, now);
      const firstAlong = Math.min(result.firstAlongM ?? along, along);
      const firstAt = Math.min(result.firstSeenAt ?? at, at);
      let t = link.tripId ? running.get(link.tripId) : undefined;
      if (!t) {
        t = carryOn(link, firstAlong, now) ?? begin(link, pp, firstAlong, firstAt);
        link.tripId = t.id;
      }
      t.lastSeenAt = Math.max(t.lastSeenAt, at);
      t.positions += result.accepted;
      if (firstAlong < t.fromM) t.fromM = firstAlong;
      if (along <= t.fromM + LEFT_M) t.departedAt = at;
      else if (firstAlong <= t.fromM + LEFT_M) t.departedAt = firstAt;
      if (along > t.toM) t.toM = along;
      if (along >= t.movedM + MOVED_M) {
        t.movedM = along;
        t.movedAt = at;
      }
      place(t, pp);
      dirty = true;
    },

    endSession(sessionId: string, now: number) {
      const link = links.get(sessionId);
      if (!link) return;
      links.delete(sessionId);
      const t = link.tripId ? running.get(link.tripId) : undefined;
      if (t && !hasPhones(t.id)) finish(t, 'phone', now);
    },

    /** The bus was removed: its running trip ends here, and later positions are not kept. */
    dropBus(busId: string, now: number) {
      for (const [id, l] of links) if (l.busId === busId) links.delete(id);
      for (const t of [...running.values()]) if (t.busId === busId) finish(t, 'bus_removed', now);
      lastDone.delete(busId);
    },

    /** The owner of the bus a phone is sharing, if it shares a registered bus. */
    ownerOf: (sessionId: string) => links.get(sessionId)?.ownerId,

    /** Phones sharing this bus now, with the trip each is on. */
    phonesOn(busId: string) {
      return [...links.entries()]
        .filter(([, l]) => l.busId === busId)
        .map(([sessionId, l]) => ({ sessionId, patternId: l.patternId, startedAt: l.startedAt, trip: l.tripId ? running.get(l.tripId) : undefined }));
    },

    tripsBetween,

    /** An owner's trips that started on this day, running ones included, by departure. */
    tripsOn: (dateISO: string, ownerId: string) => tripsBetween(dateISO, dateISO, [ownerId]),

    /** Call every 30 s, with whether the live engine still has a phone's trip. */
    async sweep(now: number, isLive: (sessionId: string) => boolean) {
      // The live engine forgets a phone after 15 minutes without word from it.
      for (const id of [...links.keys()]) {
        if (!isLive(id)) {
          links.delete(id);
          dirty = true;
        }
      }
      for (const t of [...running.values()]) {
        if (!hasPhones(t.id) && now - t.lastSeenAt > CARRY_ON_MS) finish(t, 'no_signal', now);
      }
      if (dirty) {
        dirty = false;
        await saveRunning();
      }
      if (now - prunedAt > 3600_000) {
        prunedAt = now;
        await prune(now);
      }
    },

    async close() {
      await saveRunning();
      await writing;
    },
  };
}

export type TripLog = Awaited<ReturnType<typeof openTripLog>>;
