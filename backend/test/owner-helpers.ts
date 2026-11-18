import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { istNow, pointAlong, prepareNetwork, type Network, type Ping, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { startServer, type ServerOptions } from '../src/server.ts';

// Shared by the owner dashboard tests: a server on a temporary folder, a short test route, and
// owners and buses made through the API.

export const TOKEN = 'test-admin-token';
export const dirs: string[] = [];
const servers: { close: () => Promise<void> }[] = [];

after(async () => {
  for (const s of servers) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

export async function boot(dir?: string, extra: Partial<ServerOptions> = {}) {
  const d = dir ?? mkdtempSync(path.join(tmpdir(), 'wimb-owners-'));
  if (!dir) dirs.push(d);
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(d, 'network.json'), adminToken: TOKEN, trustProxy: true, quiet: true, ...extra });
  servers.push(s);
  const base = `http://127.0.0.1:${s.port}`;
  async function call(method: string, p: string, body?: unknown, opts: { key?: string; ip?: string } = {}) {
    const res = await fetch(base + p, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
        ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
  return { dir: d, base, call, close: s.close };
}

export type App = Awaited<ReturnType<typeof boot>>;

/** Route T1: three stops 600 m apart, south from Esplanade, running all day. */
export async function addTestRoute(app: App): Promise<PreparedNetwork> {
  const stops = [
    ['own-a', 'Own A', 22.5640],
    ['own-b', 'Own B', 22.5586],
    ['own-c', 'Own C', 22.5532],
  ] as const;
  for (const [id, name, lat] of stops) {
    assert.equal((await app.call('PUT', `/api/admin/stops/${id}`, { name, lat, lng: 88.3510 }, { key: TOKEN })).status, 200);
  }
  const route = {
    number: 'T1',
    operator: 'private',
    firstBus: '00:00',
    lastBus: '23:59',
    defaultHeadwayMin: 10,
    patterns: [
      { id: 'T1-UP', direction: 'UP', headsign: 'Own C', stopIds: ['own-a', 'own-b', 'own-c'] },
      { id: 'T1-DOWN', direction: 'DOWN', headsign: 'Own A', stopIds: ['own-c', 'own-b', 'own-a'] },
    ],
  };
  assert.equal((await app.call('PUT', '/api/admin/routes/t1', route, { key: TOKEN })).status, 200);
  return prepareNetwork((await app.call('GET', '/api/network')).body as Network);
}

/** Positions every 5 s at 15 m/s along T1-UP from one point to another, ending just now. */
export function ride(net: PreparedNetwork, fromM: number, toM: number, endAt = Date.now() - 1_000): Ping[] {
  const line = net.patterns.get('T1-UP')!.line;
  const steps = Math.ceil((toM - fromM) / 75);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const along = Math.min(toM, fromM + 75 * i);
    return { ...pointAlong(line, along), accuracy: 10, speed: 15, ts: endAt - (steps - i) * 5_000 };
  });
}

/** The password people choose in the tests. */
export const PASSWORD = 'Bus-owner-2026';

let phoneSeq = 0;
/** A new mobile number each time: 98300 00001, 98300 00002… */
export const nextPhone = () => `98300${String(++phoneSeq).padStart(5, '0')}`;

/** Signs in with a temporary password from the admin and chooses their own; the key for the API. */
export async function firstSignIn(app: App, phone: string, temp: string, password = PASSWORD) {
  const first = await app.call('POST', '/api/accounts/sign-in', { phone, password: temp });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.mustChange, true);
  const set = await app.call('POST', '/api/accounts/password', { changeToken: first.body.changeToken, password });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  return set.body.key as string;
}

/** An owner the admin adds, who signs in once and chooses their password. */
export async function addOwner(app: App, name: string) {
  const phone = nextPhone();
  const r = await app.call('POST', '/api/admin/owners', { name, phone }, { key: TOKEN });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.owner.id as string, key: await firstSignIn(app, phone, r.body.password as string), phone };
}

export async function addBus(app: App, key: string, plate: string, label?: string) {
  const r = await app.call('POST', '/api/owner/buses', { plate, label }, { key });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.bus as { id: string; plate: string; label?: string };
}

/** A conductor who signs up with their owner's number, is approved by the owner, and signs in. */
export async function addConductor(app: App, owner: { key: string; phone: string }, name = 'Ratan Das') {
  const phone = nextPhone();
  const up = await app.call('POST', '/api/accounts/sign-up', { kind: 'conductor', name, phone, password: PASSWORD, ownerPhone: owner.phone });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const id = up.body.id as string;
  const ok = await app.call('POST', `/api/owner/people/${id}/approve`, undefined, { key: owner.key });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const signIn = await app.call('POST', '/api/accounts/sign-in', { phone, password: PASSWORD });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
  assert.equal(signIn.body.kind, 'conductor');
  return { id, key: signIn.body.key as string, phone };
}

/** A conductor signed in starts sharing the bus with this number plate. */
export const conductorTrip = (app: App, key: string, patternId: string, plate: string, ip?: string) =>
  app.call('POST', '/api/trips', { patternId, role: 'conductor', plate }, { key, ip });

export const today = () => istNow().dateISO;
