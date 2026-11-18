import { api } from './api.ts';
import type { Network } from './core.ts';

// Small things (places, recent searches, the trip) live in localStorage. The network can grow
// to several megabytes with road paths, so it goes in Cache Storage when the browser has it.

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // A damaged copy is treated as none.
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or switched off: the app still works, it just forgets.
  }
}

const NETWORK_KEY = 'wimb.network.v1';
const NETWORK_CACHE = 'wimb-data';
const NETWORK_URL = '/saved/network.json';

function isNetwork(n: unknown): n is Network {
  const x = n as Network | null;
  return !!x && typeof x.version === 'number' && Array.isArray(x.stops) && Array.isArray(x.routes);
}

export async function loadSavedNetwork(): Promise<Network | null> {
  try {
    if ('caches' in globalThis) {
      const hit = await (await caches.open(NETWORK_CACHE)).match(NETWORK_URL);
      const n: unknown = hit ? await hit.json() : null;
      if (isNetwork(n)) return n;
    }
  } catch {
    // Fall through to localStorage.
  }
  const n = readJson<Network>(NETWORK_KEY);
  return isNetwork(n) ? n : null;
}

async function saveNetwork(n: Network) {
  const text = JSON.stringify(n);
  try {
    if ('caches' in globalThis) {
      const cache = await caches.open(NETWORK_CACHE);
      await cache.put(NETWORK_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
      writeJson(NETWORK_KEY, null);
      return;
    }
  } catch {
    // Fall through to localStorage.
  }
  try {
    localStorage.setItem(NETWORK_KEY, text);
  } catch {
    // Too big for localStorage: it is downloaded again next time.
  }
}

/** Downloads the network only when the server has a different version. */
export async function syncNetwork(currentVersion: number): Promise<{ network?: Network; offline: boolean }> {
  try {
    const res = await api.network(currentVersion || undefined);
    if (res === 'unchanged') return { offline: false };
    await saveNetwork(res);
    return { network: res, offline: false };
  } catch {
    return { offline: true };
  }
}

/**
 * A random id for this browser, so two reports of a bus are known to come from two people. It
 * says nothing about who you are, and it never leaves this site.
 */
export function deviceId(): string {
  const saved = readJson<string>('wimb.device.v1');
  if (saved) return saved;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  writeJson('wimb.device.v1', id);
  return id;
}
