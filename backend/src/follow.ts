import { randomBytes } from 'node:crypto';
import type { LiveEngine, OperatorType, PreparedNetwork } from '../../packages/core/src/index.ts';
import { HttpError } from './http.ts';
import type { Kv } from './redis.ts';

// Family share links. A rider sharing a trip makes a link; whoever opens it sees the bus move and
// when it should reach the rider's stop. A link is tied to one shared trip and only shows the bus,
// which anyone waiting can see anyway, and the rider's stop. It stops working when the trip ends:
// it then says so for an hour, and after that it is gone. Kept in memory, or in Redis when
// REDIS_URL is set.

type Share = { sessionId: string; destStopId?: string; createdAt: number; endedAt?: number };

export type FollowView = {
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  dest: { id: string; name: string } | null;
  /** The bus as riders see it, or null before it is on the route or after it was last heard from long ago. */
  bus: { lat: number; lng: number; lastSeenSec: number; nextStop: string | null; etaMin: number | null } | null;
  ended: boolean;
  /** The same names in Bengali script where the network has them, for the page in Bengali. */
  bn: { headsign: string | null; dest: string | null; nextStop: string | null };
};

const ENDED_KEPT_MS = 60 * 60_000;
const MAX_PER_TRIP = 5;
/** A link is kept at most this long, even if nobody ends its trip. */
const LONGEST_MS = 24 * 3600_000;

type Awaitable<T> = T | Promise<T>;

/** Family follow links, in memory (createShareStore) or in Redis (redisShareStore). */
export type ShareStore = {
  /** A new link for a trip the caller is sharing (they hold its session id). */
  create(sessionId: string, patternId: string, net: PreparedNetwork, destStopId: unknown, now?: number): Awaitable<{ token: string; path: string }>;
  view(token: string, live: LiveEngine, net: PreparedNetwork, now?: number): Awaitable<FollowView>;
  /** Call every 30 s: ended trips' links say so for an hour, then go. */
  sweep(live: LiveEngine, now?: number): Awaitable<void>;
  /** The trip ended: its links now say so. */
  endSession(sessionId: string, now?: number): Awaitable<void>;
};

type Stored = Share & { patternId: string };

/** The rider's stop counts only if this bus goes there. */
function destOf(net: PreparedNetwork, patternId: string, destStopId: unknown) {
  const pp = net.patterns.get(patternId);
  return typeof destStopId === 'string' && pp?.pattern.stopIds.includes(destStopId) ? destStopId : undefined;
}

const newToken = () => randomBytes(16).toString('base64url');

/** What a link shows now; `ended` says whether its trip is over. */
function viewOf(share: Stored | undefined, ended: boolean, live: LiveEngine, net: PreparedNetwork, now: number): FollowView {
  const pp = share ? net.patterns.get(share.patternId) : undefined;
  if (!share || !pp) throw new HttpError(404, 'This link has expired.');
  const destStop = share.destStopId ? net.stops.get(share.destStopId) : undefined;
  const last = net.stops.get(pp.pattern.stopIds[pp.pattern.stopIds.length - 1]);
  const base = {
    routeNumber: pp.route.number,
    operator: pp.route.operator,
    headsign: pp.pattern.headsign,
    dest: destStop ? { id: destStop.id, name: destStop.name } : null,
  };
  const bn = {
    headsign: last?.nameBn && last.name === pp.pattern.headsign ? last.nameBn : null,
    dest: destStop?.nameBn ?? null,
    nextStop: null as string | null,
  };
  if (ended) return { ...base, bus: null, ended: true, bn };
  const v = live.vehicleOfSession(share.sessionId, now);
  if (!v) return { ...base, bus: null, ended: false, bn };
  const next = pp.stopAlong.findIndex((m) => m > v.alongM + 15);
  const nextStop = next < 0 ? undefined : net.stops.get(pp.pattern.stopIds[next]);
  const eta = share.destStopId ? live.etaOfSession(share.sessionId, share.destStopId, now) : undefined;
  return {
    ...base,
    bus: {
      lat: v.lat,
      lng: v.lng,
      lastSeenSec: v.lastSeenSec,
      nextStop: nextStop?.name ?? null,
      etaMin: eta === undefined ? null : Math.round(eta),
    },
    ended: false,
    bn: { ...bn, nextStop: nextStop?.nameBn ?? null },
  };
}

export function createShareStore(): ShareStore {
  const shares = new Map<string, Stored>();

  return {
    create(sessionId, patternId, net, destStopId, now = Date.now()) {
      if ([...shares.values()].filter((s) => s.sessionId === sessionId).length >= MAX_PER_TRIP) {
        throw new HttpError(429, 'This trip already has enough links. Send one of those.');
      }
      const token = newToken();
      shares.set(token, { sessionId, patternId, destStopId: destOf(net, patternId, destStopId), createdAt: now });
      return { token, path: `/follow/${token}` };
    },

    view(token, live, net, now = Date.now()) {
      const share = shares.get(token);
      const ended = !!share && (share.endedAt !== undefined || !live.hasSession(share.sessionId));
      if (share && ended && share.endedAt === undefined) share.endedAt = now;
      return viewOf(share, ended, live, net, now);
    },

    sweep(live, now = Date.now()) {
      for (const [token, s] of shares) {
        if (s.endedAt === undefined && !live.hasSession(s.sessionId)) s.endedAt = now;
        if (s.endedAt !== undefined && now - s.endedAt > ENDED_KEPT_MS) shares.delete(token);
      }
    },

    endSession(sessionId, now = Date.now()) {
      for (const s of shares.values()) if (s.sessionId === sessionId && s.endedAt === undefined) s.endedAt = now;
    },
  };
}

/**
 * Links in Redis, so every server can open them and they survive a restart. Every server has the
 * same live buses (live-cluster.ts), so any can tell a trip is over; only the leader writes that
 * down, so it is written once. An ended link is kept an hour, by Redis's own expiry.
 */
export function redisShareStore(kv: Kv, isLeader: () => boolean): ShareStore {
  const P = kv.prefix;
  const shareKey = (token: string) => `${P}share:${token}`;
  const sessionKey = (sessionId: string) => `${P}share:session:${sessionId}`;
  const allKey = `${P}share:all`;
  type Rec = Stored;

  async function markEnded(token: string, rec: Rec, now: number) {
    await kv.cmd(['SET', shareKey(token), JSON.stringify({ ...rec, endedAt: now }), 'PX', ENDED_KEPT_MS, 'XX']);
  }

  return {
    async create(sessionId, patternId, net, destStopId, now = Date.now()) {
      const token = newToken();
      const rec: Rec = { sessionId, patternId, destStopId: destOf(net, patternId, destStopId), createdAt: now };
      // Counted and added in one step, so links made at once cannot pass the limit together.
      const ok = await kv.script<number>(
        `if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
         redis.call('SADD', KEYS[1], ARGV[2]); redis.call('PEXPIRE', KEYS[1], ARGV[4])
         redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
         redis.call('SADD', KEYS[3], ARGV[2]); redis.call('PEXPIRE', KEYS[3], ARGV[4])
         return 1`,
        [sessionKey(sessionId), shareKey(token), allKey],
        [MAX_PER_TRIP, token, JSON.stringify(rec), LONGEST_MS],
      );
      if (!ok) throw new HttpError(429, 'This trip already has enough links. Send one of those.');
      return { token, path: `/follow/${token}` };
    },

    async view(token, live, net, now = Date.now()) {
      const raw = await kv.cmd<string | null>(['GET', shareKey(token)]);
      const rec = raw ? (JSON.parse(raw) as Rec) : undefined;
      const ended = !!rec && (rec.endedAt !== undefined || !live.hasSession(rec.sessionId));
      if (rec && ended && rec.endedAt === undefined && isLeader()) await markEnded(token, rec, now);
      return viewOf(rec, ended, live, net, now);
    },

    async sweep(live, now = Date.now()) {
      const tokens = await kv.cmd<string[]>(['SMEMBERS', allKey]);
      if (!tokens.length) return;
      const recs = await kv.cmd<(string | null)[]>(['MGET', ...tokens.map(shareKey)]);
      for (const [i, raw] of recs.entries()) {
        if (!raw) {
          await kv.cmd(['SREM', allKey, tokens[i]]); // gone by its expiry
          continue;
        }
        const rec = JSON.parse(raw) as Rec;
        if (rec.endedAt === undefined && !live.hasSession(rec.sessionId)) await markEnded(tokens[i], rec, now);
      }
    },

    async endSession(sessionId, now = Date.now()) {
      for (const token of await kv.cmd<string[]>(['SMEMBERS', sessionKey(sessionId)])) {
        const raw = await kv.cmd<string | null>(['GET', shareKey(token)]);
        const rec = raw ? (JSON.parse(raw) as Rec) : undefined;
        if (rec && rec.endedAt === undefined) await markEnded(token, rec, now);
      }
    },
  };
}
