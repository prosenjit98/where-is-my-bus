import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

// The web app and the shared core are served straight from their source folders.
// TypeScript is sent to browsers as JavaScript with the types stripped, the same way Node
// runs it, so the browser plans journeys with exactly the server's code and there is no build step.

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export type StaticFile = { body: Buffer | string; type: string; etag: string };

export function isServable(file: string): boolean {
  return TYPES[path.extname(file).toLowerCase()] !== undefined && !path.basename(file).startsWith('.');
}

/** Files under `root` only: anything that resolves outside it, or has another extension, is not found. */
export function createStaticFiles(root: string) {
  const base = path.resolve(root);
  const cache = new Map<string, { mtimeMs: number; size: number; file: StaticFile }>();

  return async function get(relPath: string): Promise<StaticFile | null> {
    if (relPath.includes('\0') || !isServable(relPath)) return null;
    const full = path.resolve(base, relPath);
    if (!full.startsWith(base + path.sep)) return null;
    // Tools installed next to the app (node_modules) and hidden folders are never served.
    const parts = path.relative(base, full).split(path.sep);
    if (parts.some((p) => p === 'node_modules' || p.startsWith('.'))) return null;
    let info;
    try {
      info = await stat(full);
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.file;
    const raw = await readFile(full);
    const ext = path.extname(full).toLowerCase();
    const body = ext === '.ts' ? stripTypeScriptTypes(raw.toString('utf8'), { mode: 'strip' }) : raw;
    const etag = `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
    const file: StaticFile = { body, type: TYPES[ext], etag };
    cache.set(full, { mtimeMs: info.mtimeMs, size: info.size, file });
    return file;
  };
}

/** Every servable file under `dir`, as paths relative to it with forward slashes. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string) {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (isServable(child)) out.push(child);
    }
  }
  await walk('');
  return out.sort();
}
