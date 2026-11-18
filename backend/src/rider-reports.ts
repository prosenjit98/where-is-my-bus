import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_REPORT_CONFIG,
  findSightings,
  reportable,
  reportedArrivals,
  type Arrival,
  type PreparedNetwork,
  type Report,
  type ReportConfig,
} from '../../packages/core/src/index.ts';
import type { Kv } from './redis.ts';

// "Route X just passed this stop" reports (core reports.ts), shared by every server through Redis.
//
// Arrival times are asked for far more often than reports are made: a busy stop is on a hundred
// route directions or more, and many riders ask every few seconds. So the reports are not read
// from Redis for each question. They are all in one sorted set, by time, and each server keeps a
// copy, read again at most once a second, then answers from memory exactly as the in-memory book
// does. A phone reporting the same bus at the same stop again is caught by a key that only one
// report can set (SET NX), whichever server it reaches.

type Awaitable<T> = T | Promise<T>;

/** Riders' reports, in memory (core createReportBook) or in Redis (redisReportBook). */
export type ReportStore = {
  add(input: { patternId: string; stopId: string; reporter: string }, now?: number): Awaitable<{ agreed: boolean } | 'repeat' | 'unknown'>;
  arrivals(stopId: string, now?: number): Awaitable<Arrival[]>;
};

const REFRESH_MS = 1_000;

export function redisReportBook(kv: Kv, getNet: () => PreparedNetwork, config: Partial<ReportConfig> = {}): ReportStore {
  const cfg: ReportConfig = { ...DEFAULT_REPORT_CONFIG, ...config };
  const setKey = `${kv.prefix}reports`;
  const keepMs = cfg.keepS * 1000;

  let byPattern = new Map<string, Report[]>();
  let readAt = 0;
  let reading: Promise<void> | null = null;

  function index(list: Report[]) {
    const m = new Map<string, Report[]>();
    for (const r of list) {
      const l = m.get(r.patternId);
      if (l) l.push(r);
      else m.set(r.patternId, [r]);
    }
    byPattern = m;
  }

  /** The copy, read again when it is older than a second (or `force`); one read at a time. */
  async function fresh(force = false) {
    if (!force && Date.now() - readAt < REFRESH_MS) return;
    reading ??= (async () => {
      const at = Date.now();
      await kv.cmd(['ZREMRANGEBYSCORE', setKey, '-inf', at - keepMs]);
      const raw = await kv.cmd<string[]>(['ZRANGEBYSCORE', setKey, at - keepMs, '+inf']);
      index(raw.map((x) => JSON.parse(x) as Report));
      readAt = at;
    })().finally(() => {
      reading = null;
    });
    await reading;
  }

  const sightingsOf = (net: PreparedNetwork, now: number) => (patternId: string) => findSightings(net, patternId, byPattern.get(patternId) ?? [], now, cfg);

  return {
    async add(input, now = Date.now()) {
      const net = getNet();
      if (!reportable(net, input.patternId, input.stopId)) return 'unknown';
      const seen = createHash('sha256').update(`${input.reporter}|${input.patternId}|${input.stopId}`).digest('base64url');
      const first = await kv.cmd<string | null>(['SET', `${kv.prefix}report:seen:${seen}`, '1', 'PX', cfg.repeatAfterS * 1000, 'NX']);
      if (first === null) return 'repeat';
      const report: Report = { ...input, ts: now };
      // A random part keeps two reports in the same millisecond apart in the set.
      await kv.cmd(['ZADD', setKey, now, JSON.stringify({ ...report, n: randomBytes(4).toString('hex') })]);
      await kv.cmd(['PEXPIRE', setKey, keepMs]);
      await fresh(true);
      const sightings = findSightings(net, input.patternId, byPattern.get(input.patternId) ?? [], now, cfg);
      return { agreed: sightings.some((s) => s.stopId === input.stopId && now - s.at <= cfg.agreeWithinS * 1000) };
    },

    async arrivals(stopId, now = Date.now()) {
      await fresh();
      const net = getNet();
      return reportedArrivals(net, stopId, sightingsOf(net, now), now, cfg);
    },
  };
}
