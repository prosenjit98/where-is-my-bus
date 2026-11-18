import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Kv } from './redis.ts';

// Signing in with a phone number and a one-time code sent by SMS, for bus owners and their
// managers. The SMS itself goes through whatever gateway the operator has (SmsSender): a web
// address that gets the number and the text, or, for trying it out, the server's log. Codes are
// kept as hashes, in memory or in Redis when REDIS_URL is set, and work for 10 minutes and 5 guesses.

export type SmsSender = {
  /** Where messages go, for the server's start-up lines. */
  describe: string;
  send(to: string, text: string): Promise<void>;
};

/** For trying it out: each message is written to the server's log instead of sent. */
export function logSender(log: (line: string) => void): SmsSender {
  return { describe: 'the server log (SMS_TO_LOG=1)', send: async (to, text) => log(`SMS to ${to}: ${text}`) };
}

/** Any SMS gateway behind a web address. It gets {"to": "+91…", "text": "…"} as JSON. */
export function webhookSender(url: string, token = ''): SmsSender {
  return {
    describe: url,
    async send(to, text) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`The SMS gateway answered ${res.status}.`);
    },
  };
}

/** An Indian mobile number as +91 and its ten digits, from what people type: "098300 12345", "+91 98300-12345". */
export function indianMobile(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

type Pending = { hash: Buffer; expires: number; tries: number; sentAt: number };

export function createOtpBook(cfg = { ttlMs: 10 * 60_000, maxTries: 5, resendMs: 60_000, perHour: 5 }) {
  const codes = new Map<string, Pending>();
  const sent = new Map<string, number[]>();
  const digest = (phone: string, code: string) => createHash('sha256').update(`${phone}|${code}`).digest();

  return {
    /** A new code for this phone, or how many seconds until one can be sent. */
    issue(phone: string, now = Date.now()): { code: string } | { waitSec: number } {
      const last = codes.get(phone);
      if (last && now - last.sentAt < cfg.resendMs) return { waitSec: Math.ceil((cfg.resendMs - (now - last.sentAt)) / 1000) };
      const times = (sent.get(phone) ?? []).filter((t) => now - t < 3600_000);
      if (times.length >= cfg.perHour) return { waitSec: Math.ceil((times[0] + 3600_000 - now) / 1000) };
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      codes.set(phone, { hash: digest(phone, code), expires: now + cfg.ttlMs, tries: 0, sentAt: now });
      sent.set(phone, [...times, now]);
      return { code };
    },

    /** Whether the code is right. It stays usable until spent, expired or guessed wrong too often. */
    check(phone: string, code: unknown, now = Date.now()): 'ok' | 'wrong' | 'expired' {
      const p = codes.get(phone);
      if (!p || now > p.expires || p.tries >= cfg.maxTries) return 'expired';
      if (!timingSafeEqual(digest(phone, String(code ?? '').replace(/\D/g, '')), p.hash)) {
        p.tries++;
        return 'wrong';
      }
      return 'ok';
    },

    /** The code did its job. */
    spend(phone: string) {
      codes.delete(phone);
    },

    sweep(now = Date.now()) {
      for (const [phone, p] of codes) if (now > p.expires) codes.delete(phone);
      for (const [phone, times] of sent) if (!times.some((t) => now - t < 3600_000)) sent.delete(phone);
    },
  };
}

type Awaitable<T> = T | Promise<T>;
type OtpConfig = { ttlMs: number; maxTries: number; resendMs: number; perHour: number };

/** The one-time codes, in memory (createOtpBook) or in Redis (redisOtpBook). */
export type OtpBook = {
  issue(phone: string, now?: number): Awaitable<{ code: string } | { waitSec: number }>;
  check(phone: string, code: unknown, now?: number): Awaitable<'ok' | 'wrong' | 'expired'>;
  spend(phone: string): Awaitable<void>;
  sweep(now?: number): Awaitable<void>;
};

// Each step is one Lua script, so two requests at once cannot both slip past a limit.
const ISSUE_LUA = `
local now = tonumber(ARGV[1])
local sentAt = redis.call('HGET', KEYS[1], 'sentAt')
if sentAt and now - tonumber(sentAt) < tonumber(ARGV[3]) then
  return {'wait', tostring(math.ceil((tonumber(ARGV[3]) - (now - tonumber(sentAt))) / 1000))}
end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - 3600000)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
  local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return {'wait', tostring(math.ceil((tonumber(first[2]) + 3600000 - now) / 1000))}
end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'hash', ARGV[5], 'tries', 0, 'sentAt', now)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], now, ARGV[6])
redis.call('PEXPIRE', KEYS[2], 3600000)
return {'ok'}
`;

const CHECK_LUA = `
local h = redis.call('HMGET', KEYS[1], 'hash', 'tries')
if not h[1] then return 'expired' end
if tonumber(h[2]) >= tonumber(ARGV[2]) then return 'expired' end
if h[1] == ARGV[1] then return 'ok' end
redis.call('HINCRBY', KEYS[1], 'tries', 1)
return 'wrong'
`;

/**
 * The same rules with the codes in Redis, so every server knows them and they survive a restart.
 * Only a hash of each code is kept, and Redis lets codes and send counts expire by themselves.
 */
export function redisOtpBook(kv: Kv, cfg: OtpConfig = { ttlMs: 10 * 60_000, maxTries: 5, resendMs: 60_000, perHour: 5 }): OtpBook {
  const digest = (phone: string, code: string) => createHash('sha256').update(`${phone}|${code}`).digest('hex');
  const keys = (phone: string) => [`${kv.prefix}otp:code:${phone}`, `${kv.prefix}otp:sent:${phone}`];
  return {
    async issue(phone, now = Date.now()) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const out = await kv.script<string[]>(ISSUE_LUA, keys(phone), [now, cfg.ttlMs, cfg.resendMs, cfg.perHour, digest(phone, code), `${now}:${randomInt(0, 1e9)}`]);
      return out[0] === 'ok' ? { code } : { waitSec: Number(out[1]) };
    },
    async check(phone, code) {
      const given = digest(phone, String(code ?? '').replace(/\D/g, ''));
      return kv.script<'ok' | 'wrong' | 'expired'>(CHECK_LUA, keys(phone).slice(0, 1), [given, cfg.maxTries]);
    },
    async spend(phone) {
      await kv.cmd(['DEL', keys(phone)[0]]);
    },
    sweep: () => undefined,
  };
}
