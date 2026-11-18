import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

// Record-route mode through the real API: a ride becomes a road path, and the places the bus
// stood still become the direction's stops, matched to stops already there.

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-rec-'));
const TOKEN = 'test-admin-token';
let base = '';
let close: () => Promise<void>;
let net: PreparedNetwork;

before(async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: TOKEN, quiet: true });
  base = `http://127.0.0.1:${s.port}`;
  close = s.close;
  net = prepareNetwork((await (await fetch(`${base}/api/network`)).json()) as Network);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

async function admin(method: string, p: string, body?: unknown, key: string | null = TOKEN) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

type P = { lat: number; lng: number; accuracy: number; ts: number };

/** A ride on D2 from Howrah Station to Esplanade: standing at the start, at BBD Bag, somewhere with no stop, and at the end. */
function ride(): P[] {
  const pp = net.patterns.get('D2-UP')!;
  const at = (id: string) => pp.stopAlong[pp.pattern.stopIds.indexOf(id)];
  const end = at('esplanade');
  const odd = (at('bbd-bag') + end) / 2; // a halt between stops: traffic, or a stop nobody mapped
  const points: P[] = [];
  let ts = Date.now() - 3 * 3600_000;
  let along = 0;
  const push = (m: number) => {
    points.push({ ...pointAlong(pp.line, Math.min(m, pp.line.length)), accuracy: 8, ts });
    ts += 2_000;
  };
  const stand = (seconds: number) => {
    for (let s = 0; s < seconds; s += 2) push(along);
  };
  const drive = (to: number) => {
    while (along < to) {
      along = Math.min(to, along + 16);
      push(along);
    }
  };
  stand(26);
  drive(at('bbd-bag'));
  stand(30);
  drive(odd);
  stand(26);
  drive(end);
  stand(40);
  // A poor fix and a jump, which are left out.
  points.splice(20, 0, { ...pointAlong(pp.line, 50), accuracy: 300, ts: points[19].ts + 500 });
  points.splice(40, 0, { lat: points[39].lat + 0.05, lng: points[39].lng, accuracy: 5, ts: points[39].ts + 900 });
  return points;
}

test('a recorded ride becomes a direction’s road path and its stops', async () => {
  assert.equal((await admin('POST', '/api/admin/recordings', { name: 'x' }, null)).status, 401, 'admins only');
  const { recording } = (await admin('POST', '/api/admin/recordings', { name: 'D2 Howrah to Esplanade' })).body;
  assert.match(recording.id, /^r-[0-9a-f]{12}$/);

  const points = ride();
  for (let i = 0; i < points.length; i += 100) {
    assert.equal((await admin('POST', `/api/admin/recordings/${recording.id}/points`, { points: points.slice(i, i + 100) })).status, 200);
  }
  const done = (await admin('POST', `/api/admin/recordings/${recording.id}/finish`)).body.recording;
  assert.equal(done.pointCount, points.length);
  const pp = net.patterns.get('D2-UP')!;
  const expected = pp.stopAlong[pp.pattern.stopIds.indexOf('esplanade')];
  assert.ok(Math.abs(done.lengthM - expected) < 60, `${done.lengthM} m against ${Math.round(expected)} m: the jump was left out`);
  assert.ok(done.path.length >= 2 && done.path.length < points.length / 4, 'the path is simplified');
  assert.deepEqual(
    done.halts.map((h: { stop: { id: string } | null }) => h.stop?.id ?? null),
    ['howrah-stn', 'bbd-bag', null, 'esplanade'],
  );
  assert.ok(done.halts.every((h: { seconds: number }) => h.seconds >= 20));

  // A new route direction with only its two ends, to which the recording is applied.
  const route = {
    number: 'R1',
    operator: 'private',
    firstBus: '06:00',
    lastBus: '21:00',
    defaultHeadwayMin: 15,
    patterns: [{ id: 'R1-UP', direction: 'UP', headsign: 'Esplanade', stopIds: ['howrah-stn', 'esplanade'] }],
  };
  assert.equal((await admin('PUT', '/api/admin/routes/r1', route)).status, 200);
  const applied = await admin('POST', `/api/admin/recordings/${recording.id}/apply`, { routeId: 'r1', patternId: 'R1-UP', stops: true });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.newStops, 1);

  const network = (await admin('GET', '/api/network', undefined, null)).body as Network;
  const r1 = network.routes.find((r) => r.id === 'r1')!.patterns[0];
  assert.deepEqual(r1.shape, done.path);
  assert.equal(r1.stopIds.length, 4);
  assert.deepEqual([r1.stopIds[0], r1.stopIds[1], r1.stopIds[3]], ['howrah-stn', 'bbd-bag', 'esplanade']);
  const added = network.stops.find((s) => s.id === r1.stopIds[2])!;
  assert.match(added.name, /^New stop 1 \(from D2 Howrah to Esplanade\)$/);

  assert.equal((await admin('POST', `/api/admin/recordings/${recording.id}/apply`, { routeId: 'r1', patternId: 'NOPE' })).status, 404);
  assert.deepEqual((await admin('GET', '/api/admin/recordings')).body.recordings.map((r: { name: string }) => r.name), ['D2 Howrah to Esplanade']);
  assert.equal((await admin('DELETE', `/api/admin/recordings/${recording.id}`)).status, 200);
  assert.deepEqual((await admin('GET', '/api/admin/recordings')).body.recordings, []);
});

test('a recording with too few good positions cannot be finished or used', async () => {
  const { recording } = (await admin('POST', '/api/admin/recordings', {})).body;
  assert.match(recording.name, /^Recording \d{4}-\d\d-\d\d \d\d:\d\d$/);
  await admin('POST', `/api/admin/recordings/${recording.id}/points`, { points: [{ lat: 22.5, lng: 88.3, accuracy: 500, ts: Date.now() }] });
  assert.equal((await admin('POST', `/api/admin/recordings/${recording.id}/finish`)).status, 400);
  assert.equal((await admin('POST', `/api/admin/recordings/${recording.id}/apply`, { routeId: 'd2', patternId: 'D2-UP' })).status, 409);
  assert.equal((await admin('POST', `/api/admin/recordings/${recording.id}/points`, { points: [] })).status, 400);
});
