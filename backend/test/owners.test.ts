import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pointAlong } from '../../packages/core/src/index.ts';
import { addBus, addConductor, addOwner, addTestRoute, boot, conductorTrip, dirs, firstSignIn, nextPhone, PASSWORD, ride, today, TOKEN } from './owner-helpers.ts';

// The owner dashboard through the real API: owners, their buses, their conductors signing in and
// sharing them, and the trips kept for the owner, on a short test route so a whole trip takes seconds.

test('an admin adds a bus owner, who signs in with the key from the link; a wrong key is refused', async () => {
  const app = await boot();
  assert.equal((await app.call('POST', '/api/admin/owners', { name: 'Sen Transport' })).status, 401, 'only admins add owners');
  assert.equal((await app.call('POST', '/api/admin/owners', { name: '  ' }, { key: TOKEN })).status, 400);
  const { key } = await addOwner(app, 'Sen Transport');
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);

  const r = await app.call('GET', '/api/owner/overview', undefined, { key });
  assert.equal(r.status, 200);
  assert.equal(r.body.owner.name, 'Sen Transport');
  assert.equal(r.body.date, today());
  assert.deepEqual(r.body.buses, []);
  assert.deepEqual(r.body.trips, []);
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key: 'not-the-key' })).status, 401);
  assert.equal((await app.call('GET', '/api/owner/overview')).status, 401);
  assert.equal((await app.call('GET', '/api/owner/overview?date=yesterday', undefined, { key })).status, 400);
  // Only a hash of the key is kept on the server.
  assert.ok(!readFileSync(path.join(app.dir, 'owners.json'), 'utf8').includes(key));

  const page = await fetch(`${app.base}/owner`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self';/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(await page.text(), /<script src="\/owner.js" defer><\/script>/);
});

test('owners add their buses; plates are checked', async () => {
  const app = await boot();
  const sen = await addOwner(app, 'Sen Transport');
  const das = await addOwner(app, 'Das Travels');
  const bus = await addBus(app, sen.key, ' wb 19a-1234 ', 'Morning D2');
  assert.equal(bus.plate, 'WB 19A-1234');
  assert.equal(bus.label, 'Morning D2');
  assert.equal((bus as Record<string, unknown>).code, undefined, 'buses have no conductor code any more');

  const again = await app.call('POST', '/api/owner/buses', { plate: 'WB19A1234' }, { key: das.key });
  assert.equal(again.status, 409, 'the same bus cannot be added twice, with or without spaces');
  const bad = await app.call('POST', '/api/owner/buses', { plate: 'ABC' }, { key: sen.key });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /WB 19 A 1234/);

  // Another owner can neither change nor remove this bus.
  assert.equal((await app.call('PUT', `/api/owner/buses/${bus.id}`, { label: 'Mine now' }, { key: das.key })).status, 404);
  assert.equal((await app.call('DELETE', `/api/owner/buses/${bus.id}`, undefined, { key: das.key })).status, 404);

  const renamed = await app.call('PUT', `/api/owner/buses/${bus.id}`, { plate: 'WB 19 A 1234', label: '' }, { key: sen.key });
  assert.equal(renamed.body.bus.plate, 'WB 19 A 1234');
  assert.equal(renamed.body.bus.label, undefined);
  const overview = await app.call('GET', '/api/owner/overview', undefined, { key: sen.key });
  assert.deepEqual(overview.body.buses.map((b: { plate: string }) => b.plate), ['WB 19 A 1234']);
  assert.deepEqual((await app.call('GET', '/api/owner/overview', undefined, { key: das.key })).body.buses, []);
});

test('a conductor signed in shares a bus by its plate: it is on its owner’s dashboard, and the trip is kept', async () => {
  const app = await boot();
  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  await addBus(app, sen.key, 'WB 19 A 1234', 'Morning T1');
  const ratan = await addConductor(app, sen);
  const length = net.patterns.get('T1-UP')!.line.length;

  // The plate works however it is typed; the bus is the owner's, as they registered it.
  const start = await conductorTrip(app, ratan.key, 'T1-UP', 'wb19-a 1234');
  assert.equal(start.status, 200);
  assert.equal(start.body.role, 'conductor');
  assert.deepEqual(start.body.bus, { plate: 'WB 19 A 1234', owner: 'Sen Transport' }, 'the conductor is told who sees the trips');
  const sessionId = start.body.sessionId as string;

  const pings = ride(net, 0, length);
  const half = Math.floor(pings.length / 2);
  await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: pings.slice(0, 3) });
  await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: pings.slice(3, half) });

  let o = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  const now = o.buses[0].now;
  assert.equal(now.state, 'on_route');
  assert.equal(now.routeNumber, 'T1');
  assert.equal(now.headsign, 'Own C');
  assert.equal(now.nextStop, 'Own C');
  assert.equal(o.trips.length, 1);
  assert.equal(o.trips[0].running, true);
  assert.equal(o.trips[0].fromStop, 'Own A');
  const riders = (await app.call('GET', '/api/patterns/T1-UP/vehicles')).body.vehicles;
  assert.equal(riders.length, 1);
  assert.equal(riders[0].plate, '1234', 'riders see the registered plate digits');
  assert.equal(riders[0].source, 'conductor');

  await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: pings.slice(half) });
  assert.equal((await app.call('POST', `/api/trips/${sessionId}/end`)).body.ended, true);

  o = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  const b = o.buses[0];
  assert.equal(b.now, null, 'not sharing any more');
  assert.equal(o.trips.length, 1);
  const trip = o.trips[0];
  assert.equal(trip.running, false);
  assert.equal(trip.ended, 'phone');
  assert.equal(trip.wholeRoute, true);
  assert.deepEqual([trip.fromStop, trip.toStop, trip.stops, trip.stopCount], ['Own A', 'Own C', 3, 3]);
  assert.equal(trip.km, Math.round(length / 100) / 10);
  assert.equal(trip.plate, 'WB 19 A 1234');
  assert.equal(trip.departedAt, pings[0].ts, 'left when the first position was taken');
  assert.equal(trip.movedAt, pings[pings.length - 1].ts, 'and last moved at the end of the route');
  assert.deepEqual(b.day, { trips: 1, wholeRoute: 1, km: trip.km, firstAt: trip.departedAt, lastAt: trip.movedAt });
  assert.equal(b.lastTrip.id, trip.id);
  assert.equal(b.week.length, 7);
  assert.deepEqual(b.week[6], { date: today(), trips: 1, wholeRoute: 1, km: trip.km });

  // The day's file has the trip's summary, not its positions.
  const lines = readFileSync(path.join(app.dir, 'trips', `${today()}.jsonl`), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0]);
  assert.equal(saved.id, trip.id);
  assert.equal(saved.lat, undefined);

  const csv = await app.call('GET', `/api/owner/trips.csv?from=${today()}&to=${today()}`, undefined, { key: sen.key });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(csv.headers.get('content-disposition') ?? '', /attachment; filename="bus-trips-/);
  const rows = String(csv.body).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^Date,Bus,Bus name,Route,Towards,Left,Last moved,Minutes,From,To,Stops,Km,End to end,Ended$/);
  assert.match(rows[1], new RegExp(`^${today()},WB 19 A 1234,Morning T1,T1,Own C,\\d\\d:\\d\\d,\\d\\d:\\d\\d,\\d+,Own A,Own C,3 of 3,${trip.km},yes,sharing stopped$`));
  assert.equal((await app.call('GET', '/api/owner/trips.csv?from=2026-01-01&to=2026-06-01', undefined, { key: sen.key })).status, 400, 'up to 62 days');

  // A rider sharing the same bus is not anyone's trip.
  const rider = await app.call('POST', '/api/trips', { patternId: 'T1-UP', plate: '1234' });
  await app.call('POST', `/api/trips/${rider.body.sessionId}/pings`, { pings: ride(net, 0, length) });
  await app.call('POST', `/api/trips/${rider.body.sessionId}/end`);
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body.trips.length, 1);
});

test('a trip carries on after the server restarts, and after a gap in the signal', async () => {
  let app = await boot();
  const dir = app.dir;
  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 04 F 5678');
  const ratan = await addConductor(app, sen);
  const length = net.patterns.get('T1-UP')!.line.length;
  const pings = ride(net, 0, length);
  const third = Math.floor(pings.length / 3);

  const first = await conductorTrip(app, ratan.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${first.body.sessionId}/pings`, { pings: pings.slice(0, third) });
  await app.close();

  // After the restart the phone's trip is unknown, so it starts a new one, still signed in.
  app = await boot(dir);
  assert.equal((await app.call('POST', `/api/trips/${first.body.sessionId}/pings`, { pings: pings.slice(third, third + 1) })).status, 404);
  const second = await conductorTrip(app, ratan.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${second.body.sessionId}/pings`, { pings: pings.slice(third, 2 * third) });
  // The conductor ends sharing by mistake, then starts again.
  await app.call('POST', `/api/trips/${second.body.sessionId}/end`);
  const third3 = await conductorTrip(app, ratan.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${third3.body.sessionId}/pings`, { pings: pings.slice(2 * third) });
  await app.call('POST', `/api/trips/${third3.body.sessionId}/end`);

  const o = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  assert.equal(o.trips.length, 1, 'one trip, not three pieces');
  assert.equal(o.trips[0].wholeRoute, true);
  assert.deepEqual([o.trips[0].fromStop, o.trips[0].toStop], ['Own A', 'Own C']);
  assert.equal(o.buses[0].day.trips, 1);

  // The return trip is a new one.
  const back = await conductorTrip(app, ratan.key, 'T1-DOWN', bus.plate);
  const down = net.patterns.get('T1-DOWN')!.line;
  const ts = Date.now() - 60_000;
  await app.call('POST', `/api/trips/${back.body.sessionId}/pings`, {
    pings: Array.from({ length: 11 }, (_, i) => ({ ...pointAlong(down, 60 * i), accuracy: 10, ts: ts + i * 5_000 })),
  });
  await app.call('POST', `/api/trips/${back.body.sessionId}/end`);
  const after = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  assert.deepEqual(after.trips.map((t: { headsign: string; wholeRoute: boolean }) => [t.headsign, t.wholeRoute]), [['Own C', true], ['Own A', false]]);
  assert.equal(after.buses[0].day.trips, 2);
  assert.equal(after.buses[0].day.wholeRoute, 1);
  assert.ok(existsSync(path.join(dir, 'trips', 'running.json')));
});

test('a conductor the owner removes cannot share any more; a removed bus’s trips stay', async () => {
  const app = await boot();
  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 19 A 4321');
  const ratan = await addConductor(app, sen, 'Ratan Das');
  const mitu = await addConductor(app, sen, 'Mitu Roy');
  const s = await conductorTrip(app, ratan.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${s.body.sessionId}/pings`, { pings: ride(net, 0, 900) });

  assert.equal((await app.call('DELETE', `/api/owner/people/${ratan.id}`, undefined, { key: sen.key })).status, 200);
  const refused = await conductorTrip(app, ratan.key, 'T1-UP', bus.plate);
  assert.equal(refused.status, 401, 'a removed conductor is signed out');
  const other = await conductorTrip(app, mitu.key, 'T1-UP', bus.plate);
  assert.equal(other.body.role, 'conductor', 'another conductor of the owner still shares');
  await app.call('POST', `/api/trips/${other.body.sessionId}/end`);
  // The trip that was running when the conductor was removed carries on.
  const o = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  assert.equal(o.buses[0].now.state, 'on_route');

  assert.equal((await app.call('DELETE', `/api/owner/buses/${bus.id}`, undefined, { key: sen.key })).status, 200);
  const gone = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body;
  assert.deepEqual(gone.buses, []);
  assert.equal(gone.trips.length, 1, 'its trip today is still listed');
  assert.equal(gone.trips[0].plate, 'WB 19 A 4321');
  assert.equal(gone.trips[0].ended, 'bus_removed');
  // Later positions from its phone are not kept for anyone.
  await app.call('POST', `/api/trips/${s.body.sessionId}/pings`, { pings: ride(net, 900, 1100) });
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body.trips[0].toStop, 'Own B');
});

test('an admin renames an owner, sets a new password for them, and removes the owner', async () => {
  const app = await boot();
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 19 A 1111');
  const ratan = await addConductor(app, sen);

  const list = (await app.call('GET', '/api/admin/owners', undefined, { key: TOKEN })).body.owners;
  assert.deepEqual(list.map((o: { name: string; buses: { plate: string }[] }) => [o.name, o.buses.map((b) => b.plate)]), [['Sen Transport', ['WB 19 A 1111']]]);
  assert.equal(list[0].keyHash, undefined);
  assert.equal(list[0].people[0].passwordHash, undefined, 'only whether there is a password');
  assert.deepEqual([list[0].people[0].phone, list[0].people[0].password], [`+91${sen.phone}`, 'set']);
  assert.equal((await app.call('GET', '/api/admin/owners')).status, 401);

  assert.equal((await app.call('PUT', `/api/admin/owners/${sen.id}`, { name: 'Sen and Sons' }, { key: TOKEN })).body.owner.name, 'Sen and Sons');
  const { password } = (await app.call('POST', `/api/admin/owners/${sen.id}/people/${list[0].people[0].id}/password`, {}, { key: TOKEN })).body;
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).status, 401, 'a new password from the admin signs every device out');
  const key = await firstSignIn(app, sen.phone, password);
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key })).body.owner.name, 'Sen and Sons');

  assert.equal((await app.call('DELETE', `/api/admin/owners/${sen.id}`, undefined, { key: TOKEN })).status, 200);
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key })).status, 401);
  assert.equal((await conductorTrip(app, ratan.key, 'D2-UP', bus.plate)).status, 401, 'the removed owner’s conductors are signed out');
  assert.equal((await app.call('DELETE', `/api/admin/owners/${sen.id}`, undefined, { key: TOKEN })).status, 404);
});

test('conductors wait for their owner’s approval, share only their owner’s buses, and do not see the dashboard', async () => {
  const app = await boot();
  const sen = await addOwner(app, 'Sen Transport');
  const das = await addOwner(app, 'Das Travels');
  await addBus(app, sen.key, 'WB 19 A 2222');
  await addBus(app, das.key, 'WB 19 B 3333');

  const phone = nextPhone();
  const up = await app.call('POST', '/api/accounts/sign-up', { kind: 'conductor', name: 'Ratan Das', phone, password: PASSWORD, ownerPhone: sen.phone });
  assert.equal(up.status, 200);
  assert.deepEqual([up.body.pending, up.body.kind, up.body.ownerName], [true, 'conductor', 'Sen Transport']);
  const waiting = await app.call('POST', '/api/accounts/sign-in', { phone, password: PASSWORD });
  assert.equal(waiting.status, 403, 'not before the owner approves');
  assert.match(waiting.body.error, /waiting for your bus owner to approve it/);
  const people = (await app.call('GET', '/api/owner/overview', undefined, { key: sen.key })).body.people;
  assert.ok(people.some((p: { id: string; role: string; pending: boolean }) => p.id === up.body.id && p.role === 'conductor' && p.pending), 'the owner sees them waiting');
  assert.equal((await app.call('POST', `/api/owner/people/${up.body.id}/approve`, undefined, { key: das.key })).status, 404, 'another owner cannot approve them');
  assert.equal((await app.call('POST', `/api/owner/people/${up.body.id}/approve`, undefined, { key: sen.key })).status, 200);

  const signIn = await app.call('POST', '/api/accounts/sign-in', { phone, password: PASSWORD });
  assert.deepEqual([signIn.status, signIn.body.kind], [200, 'conductor']);
  const key = signIn.body.key as string;
  const me = (await app.call('GET', '/api/accounts/me', undefined, { key })).body;
  assert.deepEqual([me.kind, me.name, me.owner], ['conductor', 'Ratan Das', 'Sen Transport']);

  const theirs = await conductorTrip(app, key, 'D2-UP', 'WB 19 B 3333');
  assert.equal(theirs.status, 400, 'not another owner’s bus');
  assert.match(theirs.body.error, /None of Sen Transport’s buses has the number plate/);
  assert.equal((await app.call('POST', '/api/trips', { patternId: 'D2-UP', role: 'conductor', plate: 'WB 19 A 2222' })).status, 401, 'not without signing in');
  assert.equal((await conductorTrip(app, key, 'D2-UP', '')).status, 400, 'the plate is needed');
  assert.equal((await conductorTrip(app, key, 'D2-UP', 'wb 19 a 2222')).body.role, 'conductor');
  // The owner can share their own bus as its conductor too.
  assert.equal((await conductorTrip(app, sen.key, 'D2-UP', 'WB 19 A 2222')).body.role, 'conductor');

  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key })).status, 403, 'a conductor does not see the dashboard');
  assert.equal((await app.call('POST', '/api/owner/buses', { plate: 'WB 19 C 4444' }, { key })).status, 403);
  // Managers are approved by the admin, not by the owner.
  const manager = await app.call('POST', '/api/accounts/sign-up', { kind: 'manager', name: 'Mina Sen', phone: nextPhone(), password: PASSWORD, ownerPhone: sen.phone });
  assert.equal((await app.call('POST', `/api/owner/people/${manager.body.id}/approve`, undefined, { key: sen.key })).status, 403);
});

test('trips older than the history limit are deleted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wimb-owners-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'trips'));
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  writeFileSync(path.join(dir, 'trips', `${old}.jsonl`), '{}\n');
  writeFileSync(path.join(dir, 'trips', `${recent}.jsonl`), '{}\n');
  const app = await boot(dir, { tripHistoryDays: 30 });
  assert.deepEqual(readdirSync(path.join(dir, 'trips')).filter((f) => f.endsWith('.jsonl')), [`${recent}.jsonl`]);
  await app.close();
});
