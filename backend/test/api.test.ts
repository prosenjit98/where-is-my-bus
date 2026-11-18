import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pointAlong, prepareNetwork, type Network } from '../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-'));
const dataFile = path.join(dir, 'network.json');
const TOKEN = 'test-admin-token';
let base = '';
let close: () => Promise<void>;

before(async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile, adminToken: TOKEN, quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('health and network download, with "unchanged" on the second request', async () => {
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.networkVersion, 1);
  const net = await call('GET', '/api/network');
  assert.equal(net.body.stops.length, 22);
  const again = await fetch(`${base}/api/network?since=1`);
  assert.equal(again.status, 304);
});

test('search understands local names', async () => {
  const r = await call('GET', '/api/search?q=dharmatala');
  assert.equal(r.body.results[0].id, 'esplanade');
});

test('plan returns grouped routes', async () => {
  const r = await call('GET', '/api/plan?from=stop:esplanade&to=stop:jadavpur-8b&time=10:00&date=2026-10-27');
  assert.equal(r.status, 200);
  const leg = r.body.options[0].legs.find((l: { kind: string }) => l.kind === 'bus');
  assert.deepEqual(leg.choices.map((c: { routeNumber: string }) => c.routeNumber).sort(), ['D2', 'D3']);
  const bad = await call('GET', '/api/plan?from=stop:nowhere&to=stop:esplanade');
  assert.equal(bad.status, 404);
});

test('a shared trip shows up as a live bus at the next stops, then ends', async () => {
  const net = prepareNetwork(JSON.parse(readFileSync(dataFile, 'utf8')) as Network);
  const pp = net.patterns.get('D2-UP')!;
  const trip = await call('POST', '/api/trips', { patternId: 'D2-UP', plate: 'WB-19-1234' });
  assert.equal(trip.status, 200);
  assert.equal(trip.body.role, 'rider');
  const now = Date.now();
  const pings = [0, 1, 2, 3].map((i) => ({ ...pointAlong(pp.line, 200 + i * 50), accuracy: 10, ts: now - (3 - i) * 10_000 }));
  const sent = await call('POST', `/api/trips/${trip.body.sessionId}/pings`, { pings });
  assert.equal(sent.body.accepted, 4);

  const arr = await call('GET', '/api/arrivals?stops=park-street,esplanade');
  const liveBus = arr.body.arrivals['park-street'].find((a: { live: boolean; patternId: string }) => a.live && a.patternId === 'D2-UP');
  assert.ok(liveBus, 'live D2 bus expected at Park Street');
  assert.equal(liveBus.plate, '1234');

  const buses = await call('GET', '/api/patterns/D2-UP/vehicles');
  assert.equal(buses.body.vehicles.length, 1);

  assert.deepEqual((await call('POST', `/api/trips/${trip.body.sessionId}/end`)).body, { ended: true });
  const gone = await call('POST', `/api/trips/${trip.body.sessionId}/pings`, { pings });
  assert.equal(gone.status, 404);
});

test('the conductor role needs a conductor signed in', async () => {
  const anyone = await call('POST', '/api/trips', { patternId: 'D5-UP', role: 'conductor', plate: 'WB 19 A 1234' });
  assert.equal(anyone.status, 401);
  assert.match(anyone.body.error, /Sign in as a conductor/);
  // Riders need nothing.
  assert.equal((await call('POST', '/api/trips', { patternId: 'D5-UP', plate: '1234' })).body.role, 'rider');
});

test('admin changes need the token, are validated, and bump the version', async () => {
  const stop = { name: 'Rashbehari More', nameBn: 'রাসবিহারী মোড়', aliases: ['Rashbehari'], lat: 22.5174, lng: 88.3487 };
  assert.equal((await call('PUT', '/api/admin/stops/rashbehari', stop)).status, 401);
  const ok = await call('PUT', '/api/admin/stops/rashbehari', stop, TOKEN);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, 2);
  assert.equal((await call('GET', '/api/search?q=rashbehari')).body.results[0].id, 'rashbehari');

  const badRoute = {
    number: 'X1',
    operator: 'private',
    firstBus: '06:00',
    lastBus: '22:00',
    defaultHeadwayMin: 10,
    patterns: [{ id: 'X1-UP', direction: 'UP', headsign: 'Nowhere', stopIds: ['esplanade', 'nowhere'] }],
  };
  const rejected = await call('PUT', '/api/admin/routes/x1', badRoute, TOKEN);
  assert.equal(rejected.status, 400);
  assert.ok(rejected.body.details.some((d: string) => d.includes('unknown stop "nowhere"')));

  const used = await call('DELETE', '/api/admin/stops/esplanade', undefined, TOKEN);
  assert.equal(used.status, 409);

  const saved = JSON.parse(readFileSync(dataFile, 'utf8')) as Network;
  assert.equal(saved.version, 2);
  assert.ok(saved.stops.some((s) => s.id === 'rashbehari'));
});

test('admin page is served with security headers', async () => {
  const res = await fetch(`${base}/admin`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(/script-src[^;]*/.exec(csp)?.[0] ?? '', /unsafe-inline/, 'the admin script is a file, so inline scripts are refused');
  const html = await res.text();
  assert.match(html, /Where Is My Bus/);
  assert.match(html, /<script src="\/admin.js"><\/script>/);
  // The map library and fonts come from this server, so the policy names no other site for them.
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/);
  assert.equal((await fetch(`${base}/admin.js`)).status, 200);
  assert.equal((await fetch(`${base}/web/vendor/leaflet/leaflet.js`)).status, 200);
});

test('the rider web app is served with a strict policy, and its TypeScript arrives as JavaScript', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self';/);
  assert.match(await page.text(), /\/web\/src\/main\.ts/);

  const core = await fetch(`${base}/packages/core/src/planner.ts`);
  assert.equal(core.status, 200);
  assert.match(core.headers.get('content-type') ?? '', /text\/javascript/);
  const js = await core.text();
  assert.match(js, /export function plan\(/);
  assert.doesNotMatch(js, /import type|: PreparedNetwork/, 'types are stripped');

  const again = await fetch(`${base}/packages/core/src/planner.ts`, { headers: { 'if-none-match': core.headers.get('etag') ?? '' } });
  assert.equal(again.status, 304);

  const sw = await (await fetch(`${base}/sw.js`)).text();
  assert.match(sw, /const VERSION = '[\w-]{12}'/);
  assert.match(sw, /"\/web\/src\/main\.ts"/);
  assert.match(sw, /"\/packages\/core\/src\/planner\.ts"/);
});

test('files outside the app folders are never served', async () => {
  for (const p of [
    '/web/..%2F..%2Fbackend%2Fsrc%2Fserver.ts',
    '/web/..%5C..%5Cbackend%5Csrc%5Cserver.ts',
    '/web/package.json',
    '/web/node_modules/typescript/package.json',
    '/packages/core/src/..%2F..%2F..%2Fbackend%2Fsrc%2Fserver.ts',
  ]) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('HEAD works for health checks', async () => {
  const res = await fetch(`${base}/api/health`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('a phone whose clock is ten minutes slow still shares its bus', async () => {
  const net = prepareNetwork(JSON.parse(readFileSync(dataFile, 'utf8')) as Network);
  const pp = net.patterns.get('D3-UP')!;
  const slow = Date.now() - 10 * 60_000;
  const pings = [0, 1, 2].map((i) => ({ ...pointAlong(pp.line, 300 + i * 50), accuracy: 10, ts: slow - (2 - i) * 10_000 }));
  const a = await call('POST', '/api/trips', { patternId: 'D3-UP' });
  assert.equal((await call('POST', `/api/trips/${a.body.sessionId}/pings`, { pings })).body.lastOutcome, 'stale');
  const b = await call('POST', '/api/trips', { patternId: 'D3-UP' });
  const sent = await call('POST', `/api/trips/${b.body.sessionId}/pings`, { pings, sentAt: slow });
  assert.equal(sent.body.accepted, 3);
  await call('POST', `/api/trips/${a.body.sessionId}/end`);
  await call('POST', `/api/trips/${b.body.sessionId}/end`);
});

// That such a bus never sets a "Live" wait is tested in the planner tests, at a fixed time of day.
test('a bus nobody has heard from for over two minutes is shown with low confidence', async () => {
  const net = prepareNetwork(JSON.parse(readFileSync(dataFile, 'utf8')) as Network);
  const pp = net.patterns.get('D6-UP')!;
  const t = await call('POST', '/api/trips', { patternId: 'D6-UP' });
  const old = Date.now() - 150_000;
  const pings = [0, 1, 2].map((i) => ({ ...pointAlong(pp.line, 100 + i * 40), accuracy: 10, ts: old - (2 - i) * 10_000 }));
  assert.equal((await call('POST', `/api/trips/${t.body.sessionId}/pings`, { pings })).body.accepted, 3);
  const arr = await call('GET', '/api/arrivals?stops=ultadanga');
  const bus = arr.body.arrivals.ultadanga.find((a: { live: boolean; patternId: string }) => a.live && a.patternId === 'D6-UP');
  assert.equal(bus?.confidence, 'low');
  assert.ok(bus.lastSeenSec >= 120);
  await call('POST', `/api/trips/${t.body.sessionId}/end`);
});

test('an admin saves a Metro line with its colour; an unknown mode or colour is refused', async () => {
  const line = {
    number: 'Blue',
    operator: 'govt',
    mode: 'metro',
    color: 'blue',
    firstBus: '07:00',
    lastBus: '22:00',
    defaultHeadwayMin: 7,
    patterns: [{ id: 'TEST-METRO-UP', direction: 'UP', headsign: 'Park Street', stopIds: ['esplanade', 'park-street'] }],
  };
  assert.equal((await call('PUT', '/api/admin/routes/test-metro', line, TOKEN)).status, 200);
  const routes = async () => ((await call('GET', '/api/network')).body as Network).routes;
  const metro = (await routes()).find((r) => r.id === 'test-metro');
  assert.deepEqual([metro?.mode, metro?.color], ['metro', 'blue']);
  // A bus keeps no mode or colour in the file.
  const bus = { ...line, mode: 'bus', color: '', patterns: [{ ...line.patterns[0], id: 'TEST-BUS-UP' }] };
  assert.equal((await call('PUT', '/api/admin/routes/test-bus', bus, TOKEN)).status, 200);
  const saved = (await routes()).find((r) => r.id === 'test-bus');
  assert.deepEqual([saved?.mode, saved?.color], [undefined, undefined]);
  for (const [field, value] of [['mode', 'tram'], ['color', 'violet']]) {
    assert.equal((await call('PUT', '/api/admin/routes/test-metro', { ...line, [field]: value }, TOKEN)).status, 400, field);
  }
  // The Metro runs to its timetable: it is not shared like a bus.
  const shared = await call('POST', '/api/trips', { patternId: 'TEST-METRO-UP' });
  assert.equal(shared.status, 400);
  assert.match(shared.body.error, /Only buses can be shared/);
});
