import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Returned by handlers that wrote the response themselves. */
export const HANDLED = Symbol('handled');

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
};

export type Handler = (ctx: Ctx) => unknown;

type RouteDef = { method: string; re: RegExp; keys: string[]; handler: Handler };

export function createRouter() {
  const routes: RouteDef[] = [];
  // "/api/trips/:id" captures one part of the path as params.id; a trailing "*" captures the rest as params.rest.
  const add = (method: string) => (path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = path
      .replace(/\./g, '\\.')
      .replace(/:([a-zA-Z]+)/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })
      .replace(/\*$/, () => {
        keys.push('rest');
        return '(.+)';
      });
    routes.push({ method, re: new RegExp(`^${pattern}/?$`), keys, handler });
  };

  function match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'wrong_method' | null {
    let pathExists = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathExists = true;
      // HEAD is GET without the body (Node leaves it out), so health checks can use it.
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { handler: r.handler, params };
    }
    return pathExists ? 'wrong_method' : null;
  }

  return { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), match };
}

export async function readJson<T>(req: IncomingMessage, limitBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new HttpError(413, 'The request is too large.');
    chunks.push(buf);
  }
  if (!size) throw new HttpError(400, 'The request body is empty.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
};

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CORS_HEADERS,
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/**
 * Fixed-window rate limiter. Indian mobile networks put many users behind one
 * IP address (carrier-grade NAT), so per-IP limits must stay generous; per-trip
 * limits do the real work.
 */
/**
 * Forgets entries whose window has passed once there are many, at most once a second: with a city
 * of riders there are more addresses within one window than the threshold, and looking through
 * them all for every new one would cost more than answering.
 */
function sweeper<T extends { resetAt: number }>(map: Map<string, T>) {
  let sweptAt = 0;
  return (now: number) => {
    if (map.size <= 50_000 || now - sweptAt < 1_000) return;
    sweptAt = now;
    for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
  };
}

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const sweep = sweeper(hits);
  return (key: string, now = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || h.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      sweep(now);
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}

/**
 * Counts failures, such as wrong conductor codes. A key with too many in the window is blocked
 * until the window ends, even for a right code, so guessing cannot go on in the background.
 */
export function createFailureLimiter(limit: number, windowMs: number) {
  const fails = new Map<string, { count: number; resetAt: number }>();
  const sweep = sweeper(fails);
  return {
    blocked(key: string, now = Date.now()): boolean {
      const f = fails.get(key);
      return f !== undefined && f.resetAt > now && f.count >= limit;
    },
    fail(key: string, now = Date.now()) {
      const f = fails.get(key);
      if (f && f.resetAt > now) {
        f.count++;
        return;
      }
      fails.set(key, { count: 1, resetAt: now + windowMs });
      sweep(now);
    },
  };
}
