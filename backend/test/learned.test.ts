import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pointAlong, prepareNetwork, type Network } from '../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

// Learned travel times through the real API: buses tracked on a route teach the server how long
// its stretches take, and both the server's planner and the apps' table use them.

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-learn-'));
const TOKEN = 'test-admin-token';
let base = '';
let close: () => Promise<void>;

before(async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: TOKEN, quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown, key?: string) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('buses tracked on a route teach it how long its stretches take', async () => {
  for (const [id, name, lat] of [['l-a', 'Learn A', 22.564], ['l-b', 'Learn B', 22.5586], ['l-c', 'Learn C', 22.5532]] as const) {
    await call('PUT', `/api/admin/stops/${id}`, { name, lat, lng: 88.351 }, TOKEN);
  }
  await call('PUT', '/api/admin/routes/l1', {
    number: 'L1', operator: 'private', firstBus: '00:00', lastBus: '23:59', defaultHeadwayMin: 10,
    patterns: [{ id: 'L1-UP', direction: 'UP', headsign: 'Learn C', stopIds: ['l-a', 'l-b', 'l-c'] }],
  }, TOKEN);
  const net = prepareNetwork((await call('GET', '/api/network')).body as Network);
  const pp = net.patterns.get('L1-UP')!;

  const usual = (await call('GET', '/api/plan?from=stop:l-a&to=stop:l-c')).body.options[0].legs.find((l: { kind: string }) => l.kind === 'bus');
  assert.ok(usual.rideMin > 4, `the flat 14 km/h estimate: ${usual.rideMin} min`);

  // Three buses drive the route at 10 m/s, each reporting every 5 seconds.
  for (let trip = 0; trip < 3; trip++) {
    const { sessionId } = (await call('POST', '/api/trips', { patternId: 'L1-UP' })).body;
    const t0 = Date.now() - 150_000;
    const pings = [];
    for (let s = 0; s * 10 <= pp.line.length + 20; s += 5) pings.push({ ...pointAlong(pp.line, Math.min(pp.line.length, s * 10)), accuracy: 8, ts: t0 + s * 1000 });
    const r = (await call('POST', `/api/trips/${sessionId}/pings`, { pings })).body;
    assert.equal(r.rejected, 0);
    await call('POST', `/api/trips/${sessionId}/end`);
  }

  const table = (await call('GET', '/api/travel-times')).body;
  assert.match(table.bucket, /^(wd|sat|sun)\d{1,2}$/);
  const segs = table.patterns['L1-UP'];
  assert.equal(segs.length, 2);
  // The first stop counts as passed 15 m after it, so its stretch is a little shorter.
  for (const [i, s] of segs.entries()) assert.ok(Math.abs(s - (pp.stopAlong[i + 1] - pp.stopAlong[i]) / 10) <= 3, `stretch ${i}: ${s} s`);

  const learned = (await call('GET', '/api/plan?from=stop:l-a&to=stop:l-c')).body.options[0].legs.find((l: { kind: string }) => l.kind === 'bus');
  assert.ok(Math.abs(learned.rideMin - (segs[0] + segs[1]) / 60) < 0.2, `${learned.rideMin} min from what was learned`);

  const acc = (await call('GET', '/api/admin/accuracy', undefined, TOKEN)).body;
  assert.equal(acc.learnedStretchHours, 2);
  assert.deepEqual(acc.routes, [], 'no conductor buses to check yet');
  assert.equal((await call('GET', '/api/admin/accuracy')).status, 401);
});

test('what was learned is saved when the server stops, and kept for the next start', async () => {
  await close();
  assert.ok(existsSync(path.join(dir, 'travel-times.json')));
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: TOKEN, quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
  assert.equal((await call('GET', '/api/travel-times')).body.patterns['L1-UP'].length, 2);
});
