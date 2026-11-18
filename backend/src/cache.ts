// Answers kept for a short while and reused, for questions many people ask at once (which buses
// come to this stop, how to get from A to B). At most `max` answers are kept; the oldest go first.

export type TtlCache<T> = {
  /** The kept answer for `key` while younger than `ttlMs` (or the cache's own), otherwise `make()` kept. */
  get(key: string, make: () => T, ttlMs?: number): T;
  clear(): void;
};

export function ttlCache<T>(defaultTtlMs: number, max: number): TtlCache<T> {
  const kept = new Map<string, { value: T; until: number }>();
  return {
    get(key, make, ttlMs = defaultTtlMs) {
      if (ttlMs <= 0) return make();
      const now = Date.now();
      const hit = kept.get(key);
      if (hit && hit.until > now) return hit.value;
      const value = make();
      kept.delete(key);
      kept.set(key, { value, until: now + ttlMs });
      if (kept.size > max) {
        // A Map keeps the order things were added: the first ones are the oldest.
        for (const k of kept.keys()) {
          kept.delete(k);
          if (kept.size <= max * 0.9) break;
        }
      }
      return value;
    },
    clear: () => kept.clear(),
  };
}
