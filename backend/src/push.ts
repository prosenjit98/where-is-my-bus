import type { IncomingMessage, ServerResponse } from 'node:http';
import { CORS_HEADERS } from './http.ts';

// Live buses pushed to the pages showing them (server-sent events), instead of every open page
// asking every few seconds. A page subscribes to topics, such as the route directions on its map;
// when a bus on one of them sends positions, the page gets a fresh snapshot within a second. A
// snapshot also goes out every 15 seconds, so buses that went quiet drop off and proxies do not
// close a silent connection. All of this lives in this server's memory: with several servers
// behind a load balancer, they would pass changed() on to each other through Redis pub/sub.

type Stream = {
  res: ServerResponse;
  ip: string;
  event: string;
  topics: string[];
  /** The data to send now; null when the page may no longer see it (a sign-in key was replaced). */
  snapshot: () => unknown;
  pending: ReturnType<typeof setTimeout> | null;
  refresher: ReturnType<typeof setInterval>;
  ender: ReturnType<typeof setTimeout>;
};

export type PushOptions = {
  maxStreams?: number;
  maxPerIp?: number;
  /** A burst of changes becomes one snapshot, this long after the first. */
  debounceMs?: number;
  refreshMs?: number;
  /** Streams end after this long; browsers open them again by themselves. */
  maxAgeMs?: number;
};

export function createPushHub(opts: PushOptions = {}) {
  const cfg = { maxStreams: 10_000, maxPerIp: 12, debounceMs: 1_000, refreshMs: 15_000, maxAgeMs: 30 * 60_000, ...opts };
  const streams = new Set<Stream>();
  const byTopic = new Map<string, Set<Stream>>();
  const perIp = new Map<string, number>();

  function end(s: Stream) {
    if (!streams.delete(s)) return;
    for (const t of s.topics) {
      const set = byTopic.get(t);
      set?.delete(s);
      if (set && !set.size) byTopic.delete(t);
    }
    const n = (perIp.get(s.ip) ?? 1) - 1;
    if (n > 0) perIp.set(s.ip, n);
    else perIp.delete(s.ip);
    if (s.pending) clearTimeout(s.pending);
    clearInterval(s.refresher);
    clearTimeout(s.ender);
    s.res.end();
  }

  function push(s: Stream) {
    s.pending = null;
    // A phone on a network too slow to keep up is let go; it connects again.
    if (s.res.writableLength > 256_000) return end(s);
    let data: unknown;
    try {
      data = s.snapshot();
    } catch (e) {
      console.error('A live snapshot failed:', e);
      return end(s);
    }
    if (data === null) return end(s);
    s.res.write(`event: ${s.event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  return {
    /** Whether one more stream from this address would be taken. */
    canOpen: (ip: string) => streams.size < cfg.maxStreams && (perIp.get(ip) ?? 0) < cfg.maxPerIp,

    /** Answers with a stream of `event` snapshots for these topics, the first one at once. */
    open(req: IncomingMessage, res: ServerResponse, ip: string, event: string, topics: string[], snapshot: () => unknown) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // nginx and similar proxies would otherwise hold the events back.
        'x-accel-buffering': 'no',
        ...CORS_HEADERS,
      });
      // How long a browser waits before connecting again after the stream ends.
      res.write('retry: 5000\n\n');
      const s: Stream = {
        res,
        ip,
        event,
        topics,
        snapshot,
        pending: null,
        refresher: setInterval(() => push(s), cfg.refreshMs),
        ender: setTimeout(() => end(s), cfg.maxAgeMs),
      };
      s.refresher.unref();
      s.ender.unref();
      streams.add(s);
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      for (const t of topics) {
        const set = byTopic.get(t);
        if (set) set.add(s);
        else byTopic.set(t, new Set([s]));
      }
      req.on('close', () => end(s));
      res.on('error', () => end(s));
      push(s);
    },

    /** Something on this topic changed: its streams get a snapshot soon. */
    changed(topic: string) {
      for (const s of byTopic.get(topic) ?? []) {
        if (!s.pending) s.pending = setTimeout(() => push(s), cfg.debounceMs);
      }
    },

    count: () => streams.size,

    close() {
      for (const s of [...streams]) end(s);
    },
  };
}

export type PushHub = ReturnType<typeof createPushHub>;
