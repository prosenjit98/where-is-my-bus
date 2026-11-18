import { createClient } from 'redis';

// Redis, when REDIS_URL is set: what is short-lived and shared between servers. One-time codes,
// password-change steps, family follow links and riders' reports are kept here with their expiry,
// and servers tell each other through pub/sub that live buses moved (push.ts) or that owners or the
// network changed. Every key starts with a prefix (REDIS_PREFIX, "wimb:" by default), so one Redis
// can serve several copies of the app.

export type Kv = {
  prefix: string;
  /** Any Redis command, as its words: ['SET', key, value, 'PX', '1000']. */
  cmd<T = unknown>(args: (string | number)[]): Promise<T>;
  /** Runs a Lua script on the server, as one step nobody else's commands come between. */
  script<T = unknown>(lua: string, keys: string[], args: (string | number)[]): Promise<T>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  /** A connection of its own, for commands that wait (XREAD BLOCK) and would hold up everything else. */
  connection(): Promise<{ cmd<T = unknown>(args: (string | number)[]): Promise<T>; close(): Promise<void> }>;
  close(): Promise<void>;
};

export async function openRedis(url: string, prefix = 'wimb:'): Promise<Kv> {
  // RESP2 replies are plain strings, numbers and arrays, whatever the client library's version.
  const client = createClient({ url, RESP: 2 });
  let lastError = 0;
  const logError = (e: Error) => {
    // A Redis that went away is reported once a minute, not on every reconnect attempt.
    if (Date.now() - lastError > 60_000) {
      lastError = Date.now();
      console.error('Redis connection problem:', e.message);
    }
  };
  client.on('error', logError);
  try {
    await client.connect();
  } catch (e) {
    client.destroy();
    throw new Error(`Could not connect to Redis (REDIS_URL): ${(e as Error).message}`);
  }
  // Pub/sub needs a connection of its own.
  let sub: ReturnType<typeof client.duplicate> | null = null;
  const extra = new Set<{ destroy(): void }>();
  const cmd = <T>(args: (string | number)[]) => client.sendCommand(args.map(String)) as Promise<T>;

  return {
    prefix,
    cmd,
    script: <T>(lua: string, keys: string[], args: (string | number)[]) => cmd<T>(['EVAL', lua, keys.length, ...keys, ...args]),
    async publish(channel, message) {
      await cmd(['PUBLISH', prefix + channel, message]);
    },
    async subscribe(channel, onMessage) {
      if (!sub) {
        sub = client.duplicate();
        sub.on('error', logError);
        await sub.connect();
      }
      await sub.subscribe(prefix + channel, (message: string) => onMessage(message));
    },
    async connection() {
      const own = client.duplicate();
      own.on('error', logError);
      await own.connect();
      extra.add(own);
      return {
        cmd: <T>(args: (string | number)[]) => own.sendCommand(args.map(String)) as Promise<T>,
        async close() {
          extra.delete(own);
          // A command waiting (XREAD BLOCK) would hold a polite close up; this connection has nothing to finish.
          own.destroy();
        },
      };
    },
    async close() {
      for (const c of extra) c.destroy();
      extra.clear();
      if (sub) await sub.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}
