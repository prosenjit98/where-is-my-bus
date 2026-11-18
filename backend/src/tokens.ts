import type { Kv } from './redis.ts';

// Short-lived tokens, each standing for a value until it expires or is used: for example the step
// between signing in with a temporary password and choosing one's own. In memory, or in Redis when
// REDIS_URL is set, so the second step works on whichever server it reaches.

export type TokenStore<T> = {
  put(token: string, value: T): Promise<void>;
  get(token: string): Promise<T | undefined>;
  remove(token: string): Promise<void>;
  /** Drops expired ones; Redis does this by itself. */
  sweep(now?: number): void;
};

export function memoryTokens<T>(ttlMs: number): TokenStore<T> {
  const all = new Map<string, { value: T; expires: number }>();
  return {
    async put(token, value) {
      all.set(token, { value, expires: Date.now() + ttlMs });
    },
    async get(token) {
      const t = all.get(token);
      return t && t.expires >= Date.now() ? t.value : undefined;
    },
    async remove(token) {
      all.delete(token);
    },
    sweep(now = Date.now()) {
      for (const [token, t] of all) if (t.expires < now) all.delete(token);
    },
  };
}

export function redisTokens<T>(kv: Kv, name: string, ttlMs: number): TokenStore<T> {
  const key = (token: string) => `${kv.prefix}${name}:${token}`;
  return {
    async put(token, value) {
      await kv.cmd(['SET', key(token), JSON.stringify(value), 'PX', ttlMs]);
    },
    async get(token) {
      const raw = await kv.cmd<string | null>(['GET', key(token)]);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async remove(token) {
      await kv.cmd(['DEL', key(token)]);
    },
    sweep: () => undefined,
  };
}
