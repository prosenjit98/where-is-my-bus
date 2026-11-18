import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

// Family share links through the real API: a rider's link shows the bus and when it reaches their
// stop, and stops working when the trip ends.

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-follow-'));
let base = '';
let close: () => Promise<void>;
let net: PreparedNetwork;

before(async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: 'x', quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
  net = prepareNetwork((await (await fetch(`${base}/api/network`)).json()) as Network);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

/** A rider on D2 towards Garia, a few hundred metres before Esplanade. */
async function riderOnD2() {
  const pp = net.patterns.get('D2-UP')!;
  const esplanade = pp.stopAlong[pp.pattern.stopIds.indexOf('esplanade')];
  const { sessionId } = (await call('POST', '/api/trips', { patternId: 'D2-UP' })).body;
  const t0 = Date.now() - 60_000;
  const pings = Array.from({ length: 7 }, (_, i) => ({ ...pointAlong(pp.line, esplanade - 400 + 50 * i), accuracy: 10, ts: t0 + i * 10_000 }));
  assert.equal((await call('POST', `/api/trips/${sessionId}/pings`, { pings })).body.accepted, 7);
  return sessionId as string;
}

test('a rider’s link shows their bus, its next stop and when it reaches their stop', async () => {
  const sessionId = await riderOnD2();
  const made = await call('POST', `/api/trips/${sessionId}/share`, { destStopId: 'park-street' });
  assert.equal(made.status, 200);
  assert.match(made.body.token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(made.body.path, `/follow/${made.body.token}`);

  const view = (await call('GET', `/api/follow/${made.body.token}`)).body;
  assert.equal(view.routeNumber, 'D2');
  assert.equal(view.headsign, 'Garia More');
  assert.deepEqual(view.dest, { id: 'park-street', name: 'Park Street' });
  assert.equal(view.ended, false);
  assert.equal(view.bus.nextStop, 'Esplanade');
  assert.ok(view.bus.etaMin >= 2 && view.bus.etaMin <= 15, `eta ${view.bus.etaMin}`);
  assert.equal(view.bus.lastSeenSec < 30, true);

  // The last stop of the route has an arrival time too.
  const toEnd = (await call('POST', `/api/trips/${sessionId}/share`, { destStopId: 'garia' })).body;
  assert.ok((await call('GET', `/api/follow/${toEnd.token}`)).body.bus.etaMin > view.bus.etaMin);
  // A stop the bus does not go to is left out.
  const elsewhere = (await call('POST', `/api/trips/${sessionId}/share`, { destStopId: 'sector-v' })).body;
  const v2 = (await call('GET', `/api/follow/${elsewhere.token}`)).body;
  assert.equal(v2.dest, null);
  assert.equal(v2.bus.etaMin, null);

  // When the trip ends, the link says so.
  await call('POST', `/api/trips/${sessionId}/end`);
  const ended = (await call('GET', `/api/follow/${made.body.token}`)).body;
  assert.equal(ended.ended, true);
  assert.equal(ended.bus, null);
  assert.equal((await call('POST', `/api/trips/${sessionId}/share`, {})).status, 404, 'no new links for an ended trip');
});

test('unknown links have expired, a trip has at most five, and the page keeps the link to itself', async () => {
  const missing = await call('GET', '/api/follow/not-a-real-token');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'This link has expired.');

  const sessionId = await riderOnD2();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', `/api/trips/${sessionId}/share`, {})).status, 200);
  assert.equal((await call('POST', `/api/trips/${sessionId}/share`, {})).status, 429);

  const page = await fetch(`${base}/follow/anything`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self';/);
  // Map tile requests carry only the site's address, never the link.
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin');
  assert.match(await page.text(), /<script src="\/follow.js" defer><\/script>/);
  await call('POST', `/api/trips/${sessionId}/end`);
});
