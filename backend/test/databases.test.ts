import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import pg from 'pg';
import { createClient } from 'redis';
import type { SmsSender } from '../src/otp.ts';
import { addBus, addConductor, addOwner, addTestRoute, boot, conductorTrip, dirs, firstSignIn, nextPhone, PASSWORD, ride, TOKEN, today, type App } from './owner-helpers.ts';

// The server with PostgreSQL and Redis (db.ts, redis.ts), against real ones: TEST_DATABASE_URL and
// TEST_REDIS_URL, or DATABASE_URL and REDIS_URL (npm run test:db reads them from backend/.env).
// Each run works in a schema and under a key prefix of its own, removed at the end, so it never
// touches the app's data. Without both, these tests are skipped.

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || '';
const skip = !DB_URL || !REDIS_URL ? 'set TEST_DATABASE_URL and TEST_REDIS_URL (or run npm run test:db) to run these' : false;

const run = randomBytes(4).toString('hex');
const schemas: string[] = [];
const prefixes: string[] = [];

/** Options for a server on a fresh schema and prefix (or the given ones, to share them). */
function storage(name: string, shared?: { databaseSchema: string; redisPrefix: string }) {
  const s = shared ?? { databaseSchema: `wimb_test_${run}_${name}`, redisPrefix: `wimbtest:${run}:${name}:` };
  if (!shared) {
    schemas.push(s.databaseSchema);
    prefixes.push(s.redisPrefix);
  }
  return { databaseUrl: DB_URL, redisUrl: REDIS_URL, ...s };
}

after(async () => {
  if (skip) return;
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  for (const s of schemas) await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  await c.end();
  const r = createClient({ url: REDIS_URL, RESP: 2 });
  await r.connect();
  for (const p of prefixes) {
    let cursor = '0';
    do {
      const [next, keys] = (await r.sendCommand(['SCAN', cursor, 'MATCH', `${p}*`, 'COUNT', '500'])) as [string, string[]];
      cursor = next;
      if (keys.length) await r.sendCommand(['DEL', ...keys]);
    } while (cursor !== '0');
  }
  await r.close();
});

function fakeSms() {
  const sent: { to: string; text: string }[] = [];
  const sender: SmsSender = { describe: 'the test', send: async (to, text) => void sent.push({ to, text }) };
  return { sender, lastCode: () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '')?.[1] ?? '' };
}

/** Asks until `check` passes, for up to 5 s: other servers hear of a change through Redis. */
async function eventually(what: string, check: () => Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} did not happen within 5 s`);
}

async function rows(schema: string, sql: string): Promise<Record<string, unknown>[]> {
  const c = new pg.Client({ connectionString: DB_URL, options: `-c search_path=${schema}` });
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}

/** How many snapshots a live stream (push.ts) sends within `ms`. */
async function countEvents(app: App, p: string, ms: number, during: () => Promise<void>): Promise<number> {
  const ctrl = new AbortController();
  const res = await fetch(app.base + p, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  let text = '';
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    } catch {
      // Ended by the abort below.
    }
  })();
  await new Promise((r) => setTimeout(r, 300)); // the first snapshot, sent at once
  await during();
  await new Promise((r) => setTimeout(r, ms));
  ctrl.abort();
  await reading;
  return text.split('event: vehicles').length - 1;
}

test('with PostgreSQL and Redis, two servers share everything, and it outlives them', { skip }, async () => {
  const sms = fakeSms();
  const shared = storage('main');
  const a = await boot(undefined, { ...shared, serverId: 'a', sms: sms.sender });
  const b = await boot(undefined, { ...shared, serverId: 'b', sms: sms.sender });
  assert.deepEqual((await a.call('GET', '/api/health')).body.storage, { database: 'postgresql', shared: 'redis' });

  // The network: edited on one server, the other reads the change.
  const net = await addTestRoute(a);
  const version = (await a.call('GET', '/api/network')).body.version as number;
  await eventually('server b reading the new network', async () => (await b.call('GET', '/api/network')).body.version === version);
  assert.ok((await b.call('GET', '/api/network')).body.routes.some((r: { id: string }) => r.id === 't1'));

  // Owners: added on one, signing in on the other.
  const sen = await addOwner(a, 'Sen Transport');
  const bus = await addBus(a, sen.key, 'WB 19 A 1234');
  await eventually('server b knowing the owner', async () => (await b.call('POST', '/api/accounts/sign-in', { phone: sen.phone, password: PASSWORD })).status === 200);
  // The step from a temporary password to one's own, begun on one server and finished on the other.
  const phone = nextPhone();
  const added = await a.call('POST', '/api/admin/owners', { name: 'Das Travels', phone }, { key: TOKEN });
  const first = await a.call('POST', '/api/accounts/sign-in', { phone, password: added.body.password });
  assert.equal(first.body.mustChange, true);
  await eventually('server b knowing the second owner', async () => (await b.call('GET', '/api/admin/owners', undefined, { key: TOKEN })).body.owners.length === 2);
  const own = await b.call('POST', '/api/accounts/password', { changeToken: first.body.changeToken, password: PASSWORD });
  assert.equal(own.status, 200, JSON.stringify(own.body));

  // Buses added on both servers at the same moment: whichever saves second sees it was not the
  // latest and makes its change again on top of the other's.
  const [x, y] = await Promise.all([
    a.call('POST', '/api/owner/buses', { plate: 'WB 19 B 1111' }, { key: sen.key }),
    b.call('POST', '/api/owner/buses', { plate: 'WB 19 B 2222' }, { key: sen.key }),
  ]);
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal(y.status, 200, JSON.stringify(y.body));
  for (const app of [a, b]) {
    await eventually('both servers seeing all three buses', async () => {
      const o = (await app.call('GET', '/api/admin/owners', undefined, { key: TOKEN })).body.owners.find((w: { id: string }) => w.id === sen.id);
      return o?.buses.length === 3;
    });
  }
  assert.equal((await rows(shared.databaseSchema, 'SELECT * FROM buses')).length, 3);

  // A forgotten password: the code is sent by one server and checked by the other.
  assert.equal((await a.call('POST', '/api/accounts/forgot/code', { phone: sen.phone })).status, 200);
  const reset = await b.call('POST', '/api/accounts/forgot/reset', { phone: sen.phone, code: sms.lastCode(), password: 'Fresh-pass-9' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const key = reset.body.key as string;

  // A conductor's trip on server a: pushed to a map open on server b, linked for family, and kept for the owner.
  // A conductor signs up and is approved on server b, and shares the bus through server a.
  const ratan = await addConductor(b, { key, phone: sen.phone });
  const trip = (await conductorTrip(a, ratan.key, 'T1-UP', bus.plate)).body;
  assert.equal(trip.role, 'conductor');
  const link = await a.call('POST', `/api/trips/${trip.sessionId}/share`, { destStopId: 'own-c' });
  assert.equal(link.status, 200);
  const pings = ride(net, 0, 900);
  const events = await countEvents(b, '/api/live?patterns=T1-UP', 1_800, async () => {
    assert.equal((await a.call('POST', `/api/trips/${trip.sessionId}/pings`, { pings })).body.accepted > 0, true);
  });
  assert.ok(events >= 2, `the map on server b got the first snapshot and one more when the bus moved (${events})`);
  assert.equal((await a.call('GET', `/api/follow/${link.body.token}`)).body.ended, false);
  assert.equal((await a.call('POST', `/api/trips/${trip.sessionId}/end`)).status, 200);
  assert.equal((await b.call('GET', `/api/follow/${link.body.token}`)).body.ended, true, 'server b sees the link of a trip ended on a');
  // Server a saves the finished trip just after answering.
  await eventually('the trip ended on server a showing in the owner’s day on server b', async () =>
    (await b.call('GET', `/api/owner/overview?date=${today()}`, undefined, { key })).body.trips?.length === 1);
  assert.equal((await rows(shared.databaseSchema, 'SELECT * FROM trips')).length, 1);

  // Riders' reports: two people on two servers agree.
  assert.equal((await a.call('POST', '/api/reports', { patternId: 'T1-UP', stopId: 'own-a', device: 'phone-1' })).body.agreed, false);
  const second = await b.call('POST', '/api/reports', { patternId: 'T1-UP', stopId: 'own-a', device: 'phone-2' });
  assert.equal(second.body.agreed, true);
  assert.equal((await b.call('POST', '/api/reports', { patternId: 'T1-UP', stopId: 'own-a', device: 'phone-2' })).body.repeat, true);
  await new Promise((r) => setTimeout(r, 1_100)); // each server reads the reports again once a second
  const arrivals = (await a.call('GET', '/api/arrivals?stops=own-b')).body.arrivals['own-b'];
  assert.ok(arrivals.some((x: { reported?: unknown }) => x.reported), 'server a shows the bus riders saw');

  // Suggestions and recordings.
  assert.equal((await a.call('POST', '/api/corrections', { kind: 'stop', text: 'This bus also stops at the market', routeId: 't1' })).status, 200);
  assert.equal((await b.call('GET', '/api/admin/corrections', undefined, { key: TOKEN })).body.counts.new, 1);
  const rec = (await b.call('POST', '/api/admin/recordings', { name: 'Morning ride' }, { key: TOKEN })).body.recording;
  const points = ride(net, 0, 1200).map(({ lat, lng, ts }) => ({ lat, lng, ts, accuracy: 5 }));
  assert.deepEqual((await a.call('POST', `/api/admin/recordings/${rec.id}/points`, { points }, { key: TOKEN })).body, { points: points.length });
  assert.equal((await b.call('GET', '/api/admin/recordings', undefined, { key: TOKEN })).body.recordings[0].points, points.length);

  // Both servers stop; a new one on an empty folder has it all.
  await a.close();
  await b.close();
  const c = await boot(undefined, { ...shared, serverId: 'c' });
  assert.equal((await c.call('GET', '/api/network')).body.version, version);
  assert.equal((await c.call('GET', `/api/owner/overview?date=${today()}`, undefined, { key })).body.trips.length, 1);
  assert.equal((await c.call('POST', '/api/accounts/sign-in', { phone: sen.phone, password: 'Fresh-pass-9' })).status, 200);
  assert.equal((await c.call('GET', '/api/admin/corrections', undefined, { key: TOKEN })).body.corrections.length, 1);
  assert.equal((await c.call('GET', `/api/admin/recordings/${rec.id}`, undefined, { key: TOKEN })).body.recording.pointCount, points.length);
});

test('every server keeps the same live buses, a newcomer catches up, and a leader always takes over', { skip }, async () => {
  const shared = storage('live');
  // Short lease and tidy-up, so the test sees a leader change within seconds.
  const fast = { ...shared, liveLeaseMs: 1_000, sweepMs: 300 };
  const a = await boot(undefined, { ...fast, serverId: 'a' });
  const b = await boot(undefined, { ...fast, serverId: 'b' });
  const net = await addTestRoute(a);
  const sen = await addOwner(a, 'Sen Transport');
  const bus = await addBus(a, sen.key, 'WB 19 C 4321');
  await eventually('server b reading the route', async () => (await b.call('GET', '/api/network')).body.routes.some((r: { id: string }) => r.id === 't1'));

  const health = async (app: App) => (await app.call('GET', '/api/health')).body.live as { leader: boolean; ready: boolean };
  assert.equal([await health(a), await health(b)].filter((h) => h.leader).length, 1, 'exactly one leader');

  // Started on a, positions sent to b: both servers show the same bus.
  const trip = (await conductorTrip(a, sen.key, 'T1-UP', bus.plate)).body;
  const pings = ride(net, 0, 400);
  const sent = await b.call('POST', `/api/trips/${trip.sessionId}/pings`, { pings });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(sent.body.accepted > 0);
  const onA = (await a.call('GET', '/api/patterns/T1-UP/vehicles')).body.vehicles;
  const onB = (await b.call('GET', '/api/patterns/T1-UP/vehicles')).body.vehicles;
  assert.equal(onA.length, 1);
  assert.deepEqual(onA.map((v: { id: string }) => v.id), onB.map((v: { id: string }) => v.id), 'the same bus, with the same id, on both');
  await new Promise((r) => setTimeout(r, 1_100)); // arrivals are reused for a second
  const comes = (await b.call('GET', '/api/arrivals?stops=own-b')).body.arrivals['own-b'];
  assert.ok(comes.some((x: { live: boolean }) => x.live), 'server b predicts the bus at the next stop');
  // A follow link made on b for the trip started on a.
  assert.equal((await b.call('POST', `/api/trips/${trip.sessionId}/share`, {})).status, 200);

  // A server that starts now knows the trip at once, and the bus after its next positions.
  const c = await boot(undefined, { ...fast, serverId: 'c' });
  assert.equal((await health(c)).ready, false, 'it says it is still catching up');
  const more = ride(net, 400, 1150, Date.now() + 4_000).filter((p) => p.ts > pings[pings.length - 1].ts);
  const late = await c.call('POST', `/api/trips/${trip.sessionId}/pings`, { pings: more });
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal((await c.call('GET', '/api/patterns/T1-UP/vehicles')).body.vehicles.length, 1);

  // Running trips are saved by the leader alone, under the servers' common name.
  await eventually('the running trip being saved', async () => (await rows(shared.databaseSchema, 'SELECT server_id FROM running_trips')).length === 1);
  assert.equal((await rows(shared.databaseSchema, 'SELECT server_id FROM running_trips'))[0].server_id, 'cluster');

  // The leader stops: one of the others leads within the lease, and the trip carries on there.
  const leaders = [a, b, c];
  const leader = (await Promise.all(leaders.map(health))).findIndex((h) => h.leader);
  await leaders[leader].close();
  const rest = leaders.filter((_, i) => i !== leader);
  await eventually('another server taking the lead', async () => (await Promise.all(rest.map(health))).filter((h) => h.leader).length === 1);
  const ended = await rest[0].call('POST', `/api/trips/${trip.sessionId}/end`);
  assert.deepEqual(ended.body, { ended: true });
  await eventually('the trip showing as ended on the other server', async () =>
    (await rest[1].call('GET', '/api/patterns/T1-UP/vehicles')).body.vehicles.length === 0);
});

test('what a server kept in files is copied into an empty database', { skip }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wimb-import-'));
  dirs.push(dir);
  const files = await boot(dir);
  await addTestRoute(files);
  const phone = nextPhone();
  const made = await files.call('POST', '/api/admin/owners', { name: 'Sen Transport', phone }, { key: TOKEN });
  await firstSignIn(files, phone, made.body.password);
  await files.call('POST', '/api/corrections', { kind: 'other', text: 'The last bus is later now' });
  const { version, routes } = (await files.call('GET', '/api/network')).body as { version: number; routes: unknown[] };
  await files.close();

  const s = storage('import');
  const moved = await boot(dir, s);
  assert.equal((await moved.call('GET', '/api/network')).body.version, version);
  // Signing in by number works only with the same secret: it was copied in too.
  assert.equal((await moved.call('POST', '/api/accounts/sign-in', { phone, password: PASSWORD })).status, 200);
  assert.equal((await moved.call('GET', '/api/admin/corrections', undefined, { key: TOKEN })).body.corrections.length, 1);
  assert.equal((await rows(s.databaseSchema, `SELECT * FROM network_items WHERE kind = 'route'`)).length, routes.length, 'a row per route');
  assert.equal((await rows(s.databaseSchema, 'SELECT * FROM owners')).length, 1);
});
