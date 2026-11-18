import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

// What riders tell each other and the admins, through the real API: "this bus just passed",
// and suggested fixes for the review queue.

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-community-'));
const TOKEN = 'test-admin-token';
let base = '';
let close: () => Promise<void>;
let net: PreparedNetwork;

before(async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: TOKEN, trustProxy: true, quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
  net = prepareNetwork((await (await fetch(`${base}/api/network`)).json()) as Network);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const report = (patternId: string, stopId: string, device: string, ip = '10.0.0.1') => call('POST', '/api/reports', { patternId, stopId, device }, { ip });

test('two people reporting the same bus tell the stops further on, never as Live', async () => {
  assert.deepEqual((await report('D3-UP', 'park-street', 'phone-a')).body, { accepted: true, agreed: false, repeat: false });
  assert.deepEqual((await report('D3-UP', 'park-street', 'phone-a')).body, { accepted: false, agreed: false, repeat: true });
  let at = (await call('GET', '/api/arrivals?stops=gariahat')).body.arrivals.gariahat;
  assert.equal(at.some((a: { reported?: unknown }) => a.reported), false, 'one person alone is not enough');

  assert.deepEqual((await report('D3-UP', 'park-street', 'phone-b', '10.0.0.2')).body, { accepted: true, agreed: true, repeat: false });
  at = (await call('GET', '/api/arrivals?stops=gariahat')).body.arrivals.gariahat;
  const seen = at.find((a: { reported?: unknown }) => a.reported);
  assert.ok(seen, JSON.stringify(at));
  assert.equal(seen.routeNumber, 'D3');
  assert.equal(seen.live, false);
  assert.equal(seen.reported.stopId, 'park-street');
  assert.equal(seen.reported.reporters, 2);
  assert.ok(seen.etaMin > 0);
  // Planning for now does not take it as a live wait. (Late at night no demo route runs, so there
  // may be no options at all: then there is nothing to take as live either.)
  const p = (await call('GET', '/api/plan?from=stop:gariahat&to=stop:jadavpur-8b')).body;
  for (const o of p.options as { legs: { kind: string; waitIsLive: boolean }[] }[]) {
    assert.ok(o.legs.filter((l) => l.kind === 'bus').every((l) => !l.waitIsLive));
  }
});

test('one report agrees with a tracked bus at the stop; reports at the last stop or off the route are refused', async () => {
  const pp = net.patterns.get('D5-UP')!;
  const moulali = pp.stopAlong[pp.pattern.stopIds.indexOf('moulali')];
  const { sessionId } = (await call('POST', '/api/trips', { patternId: 'D5-UP' })).body;
  const t0 = Date.now() - 40_000;
  const pings = Array.from({ length: 5 }, (_, i) => ({ ...pointAlong(pp.line, moulali - 100 + 40 * i), accuracy: 10, ts: t0 + i * 8_000 }));
  await call('POST', `/api/trips/${sessionId}/pings`, { pings });
  assert.equal((await report('D5-UP', 'moulali', 'phone-c', '10.0.0.3')).body.agreed, true);
  await call('POST', `/api/trips/${sessionId}/end`);

  assert.equal((await report('D5-UP', 'sector-v', 'phone-c', '10.0.0.3')).status, 400, 'its last stop');
  assert.equal((await report('D5-UP', 'garia', 'phone-c', '10.0.0.3')).status, 400, 'not on the route');
});

test('suggested fixes reach the admins’ queue, who mark them done or dismissed', async () => {
  const sent = await call('POST', '/api/corrections', { kind: 'route', text: 'D2 also stops at Lake Mall now.', routeId: 'd2', stopId: 'nowhere' }, { ip: '10.0.1.1' });
  assert.equal(sent.status, 200);
  assert.match(sent.body.id, /^c-[0-9a-f]{12}$/);
  assert.equal((await call('POST', '/api/corrections', { kind: 'stop', text: 'bad' }, { ip: '10.0.1.1' })).status, 400, 'too short to act on');

  assert.equal((await call('GET', '/api/admin/corrections')).status, 401);
  const queue = (await call('GET', '/api/admin/corrections?status=new', undefined, { key: TOKEN })).body;
  assert.equal(queue.counts.new, 1);
  const [c] = queue.corrections;
  assert.equal(c.text, 'D2 also stops at Lake Mall now.');
  assert.equal(c.routeId, 'd2');
  assert.equal(c.stopId, undefined, 'an unknown stop is left out');

  const done = await call('PUT', `/api/admin/corrections/${c.id}`, { status: 'done', note: 'Added Lake Mall to D2.' }, { key: TOKEN });
  assert.equal(done.body.correction.status, 'done');
  assert.equal(done.body.correction.note, 'Added Lake Mall to D2.');
  assert.deepEqual((await call('GET', '/api/admin/corrections?status=new', undefined, { key: TOKEN })).body.corrections, []);
  assert.equal((await call('GET', '/api/admin/corrections?status=done', undefined, { key: TOKEN })).body.corrections.length, 1);
  assert.equal((await call('PUT', `/api/admin/corrections/${c.id}`, { status: 'fixed' }, { key: TOKEN })).status, 400);
  assert.equal((await call('PUT', '/api/admin/corrections/c-000000000000', { status: 'done' }, { key: TOKEN })).status, 404);

  for (let i = 0; i < 9; i++) await call('POST', '/api/corrections', { text: `Suggestion number ${i}` }, { ip: '10.0.1.2' });
  assert.equal((await call('POST', '/api/corrections', { text: 'One more suggestion' }, { ip: '10.0.1.2' })).status, 200);
  assert.equal((await call('POST', '/api/corrections', { text: 'And one too many' }, { ip: '10.0.1.2' })).status, 429);
});
