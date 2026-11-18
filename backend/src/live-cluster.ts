import { HttpError } from './http.ts';
import type { Kv } from './redis.ts';

// Live buses on several servers. One server can take in every bus's positions (tools/bench-scale.ts:
// 30,000 buses cost about 8% of a core) but cannot answer 100,000 riders. So every server keeps a
// copy of the live buses and answers riders from it, and the copies are kept the same by feeding
// them the same events in the same order:
//
// - Whatever changes the live buses (a phone starts or stops sharing, sends positions, a bus is
//   removed, the half-minute tidy-up, a new network) is an event. The server that gets the request
//   adds the event to a Redis stream, and every server, itself included, applies the stream's
//   events in order. The request is answered with what applying it gave on its own server.
// - Applying an event depends only on the event (it carries the time it happened) and on the
//   events before it, so every copy ends the same. New bus ids are made from the event's place in
//   the stream for the same reason.
// - One server is the leader, chosen through a Redis key that it renews (a lease): it adds the
//   half-minute tidy-up to the stream and is the only one saving trips and learned times, so they
//   are saved once. If it stops, another takes over within the lease, with its copy already full.
// - A server that starts while others run reads the trips being shared from Redis, then the
//   stream from that point on. Within one round of positions (10 s) it shows every bus too.
//
// Without Redis there is one server: events are applied at once, and it is the leader.

export type LiveEvent =
  | { t: 'start'; id: string; patternId: string; role: 'conductor' | 'rider'; plate?: string; bus?: { id: string; ownerId: string; plate: string }; now: number }
  | { t: 'pings'; id: string; pings: unknown[]; now: number }
  | { t: 'end'; id: string; now: number }
  | { t: 'dropBus'; busId: string; now: number }
  | { t: 'tick'; now: number }
  | { t: 'network'; version: number };

export type LiveCluster = {
  /** Applies the event on every server; what applying it gave here. */
  submit(ev: LiveEvent): Promise<unknown>;
  isLeader(): boolean;
  /** Whether this server's copy is complete: false for its first seconds after joining others. */
  ready(): boolean;
  /** Ids for new buses: made from the event being applied, so every copy makes the same ones. */
  newId(): string;
  close(): Promise<void>;
};

export type ClusterOptions = {
  kv: Kv | null;
  instanceId: string;
  apply: (ev: LiveEvent) => unknown;
  /** How long a leader's claim lasts unless renewed; another server takes over after it. */
  leaseMs?: number;
  log?: (line: string) => void;
};

/** The stream keeps about this many events: a minute or more of every bus in a city of 30,000. */
const STREAM_LEN = 300_000;
const WAIT_MS = 10_000;
const WARM_UP_MS = 12_000;

export async function openLiveCluster(opts: ClusterOptions): Promise<LiveCluster> {
  const { kv, instanceId, apply } = opts;
  if (!kv) {
    // One server: applied at once.
    return {
      submit: async (ev) => apply(ev),
      isLeader: () => true,
      ready: () => true,
      newId: () => crypto.randomUUID(),
      close: async () => undefined,
    };
  }

  const P = kv.prefix;
  const streamKey = `${P}live:events`;
  const sessionsKey = `${P}live:sessions`;
  const leaderKey = `${P}live:leader`;
  const leaseMs = opts.leaseMs ?? 15_000;
  const log = opts.log ?? console.log;

  // ---- Applying the stream ----

  let seed = '';
  let seq = 0;
  type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };
  const waiting = new Map<string, Waiter>();
  /** Results of our own events applied before their XADD answer came back. */
  const early = new Map<string, { at: number; result?: unknown; error?: unknown }>();

  function settle(id: string, result: unknown, error: unknown) {
    const w = waiting.get(id);
    if (!w) {
      early.set(id, { at: Date.now(), result, error });
      return;
    }
    waiting.delete(id);
    clearTimeout(w.timer);
    if (error) w.reject(error);
    else w.resolve(result);
  }

  async function applyEntry(id: string, fields: string[]) {
    const f: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) f[fields[i]] = fields[i + 1];
    let result: unknown;
    let error: unknown;
    seed = id;
    seq = 0;
    try {
      result = await apply(JSON.parse(f.e) as LiveEvent);
    } catch (e) {
      error = e;
    } finally {
      seed = '';
    }
    if (f.o === instanceId) settle(id, result, error);
  }

  // Joining: the trips being shared, then the stream from where it was when they were read.
  const latest = (await kv.cmd<[string, string[]][]>(['XREVRANGE', streamKey, '+', '-', 'COUNT', 1]))[0];
  let last = latest?.[0] ?? '0-0';
  const shared = Object.values(pairs(await kv.cmd<string[]>(['HGETALL', sessionsKey])))
    .map((raw) => JSON.parse(raw) as LiveEvent & { t: 'start' })
    .sort((a, b) => a.now - b.now);
  for (const ev of shared) {
    try {
      await apply(ev);
    } catch {
      // A route that is gone: its trip is not carried on.
    }
  }
  const joinedAt = Date.now();
  const warm = !latest; // nobody else running: nothing to catch up on

  const reader = await kv.connection();
  let closed = false;
  const reading = (async () => {
    while (!closed) {
      let reply: [string, [string, string[]][]][] | null;
      try {
        reply = await reader.cmd(['XREAD', 'COUNT', 1000, 'BLOCK', 1000, 'STREAMS', streamKey, last]);
      } catch (e) {
        if (closed) return;
        log(`Could not read live events: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (!reply) continue;
      for (const [id, fields] of reply[0][1]) {
        last = id;
        await applyEntry(id, fields);
      }
      const lagMs = Date.now() - Number(last.split('-')[0]);
      if (lagMs > 30_000) log(`This server is ${Math.round(lagMs / 1000)} s behind the live events. It needs more CPU, or fewer servers per machine.`);
    }
  })();

  const tidy = setInterval(() => {
    const old = Date.now() - 30_000;
    for (const [id, r] of early) if (r.at < old) early.delete(id);
  }, 10_000);
  tidy.unref();

  // ---- The leader ----

  let leader = false;
  async function campaign() {
    try {
      const won = await kv!.script<number>(
        `local v = redis.call('GET', KEYS[1])
         if v == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]) return 1 end
         if not v then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
         return 0`,
        [leaderKey],
        [instanceId, leaseMs],
      );
      if (won === 1 && !leader) log(`  This server now leads the live buses (${instanceId})`);
      leader = won === 1;
    } catch {
      // Without Redis nobody can be sure to lead: stop, so two never do.
      leader = false;
    }
  }
  await campaign();
  const campaigner = setInterval(() => void campaign(), Math.max(200, Math.floor(leaseMs / 3)));
  campaigner.unref();

  const ADD_START = `local id = redis.call('XADD', KEYS[1], 'MAXLEN', '~', ARGV[1], '*', 'e', ARGV[2], 'o', ARGV[3])
    redis.call('HSET', KEYS[2], ARGV[4], ARGV[2])
    return id`;
  const ADD_END = `local id = redis.call('XADD', KEYS[1], 'MAXLEN', '~', ARGV[1], '*', 'e', ARGV[2], 'o', ARGV[3])
    redis.call('HDEL', KEYS[2], ARGV[4])
    return id`;

  return {
    async submit(ev) {
      const json = JSON.stringify(ev);
      let id: string;
      if (ev.t === 'start') id = await kv.script<string>(ADD_START, [streamKey, sessionsKey], [STREAM_LEN, json, instanceId, ev.id]);
      else if (ev.t === 'end') id = await kv.script<string>(ADD_END, [streamKey, sessionsKey], [STREAM_LEN, json, instanceId, ev.id]);
      else id = await kv.cmd<string>(['XADD', streamKey, 'MAXLEN', '~', STREAM_LEN, '*', 'e', json, 'o', instanceId]);
      const done = early.get(id);
      if (done) {
        early.delete(id);
        if (done.error) throw done.error;
        return done.result;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new HttpError(503, 'The server is too busy right now. Try again in a moment.'));
        }, WAIT_MS);
        waiting.set(id, { resolve, reject, timer });
      });
    },

    isLeader: () => leader,
    ready: () => warm || Date.now() - joinedAt > WARM_UP_MS,
    newId: () => (seed ? `${seed}-${seq++}` : crypto.randomUUID()),

    async close() {
      closed = true;
      clearInterval(campaigner);
      clearInterval(tidy);
      if (leader) {
        // Let another server take over at once instead of after the lease.
        await kv
          .script(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, [leaderKey], [instanceId])
          .catch(() => undefined);
        leader = false;
      }
      await reader.close();
      await reading;
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.reject(new HttpError(503, 'The server is stopping.'));
      }
      waiting.clear();
    },
  };
}

/** The trips list newcomers read: those the live buses forgot (15 minutes without word) go. Leader only. */
export async function tidySharedTrips(kv: Kv, hasSession: (id: string) => boolean, now = Date.now()) {
  const all = pairs(await kv.cmd<string[]>(['HGETALL', `${kv.prefix}live:sessions`]));
  // A trip added in the last minute may not have reached this server's copy yet: it stays.
  const gone = Object.entries(all)
    .filter(([id, raw]) => !hasSession(id) && (JSON.parse(raw) as { now: number }).now < now - 60_000)
    .map(([id]) => id);
  if (gone.length) await kv.cmd(['HDEL', `${kv.prefix}live:sessions`, ...gone]);
}

function pairs(reply: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) out[reply[i]] = reply[i + 1];
  return out;
}
