import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pointAlong } from '../../packages/core/src/index.ts';
import { alertsOf, QUIET_ALERT_MS } from '../src/dashboard.ts';
import { createOtpBook, indianMobile } from '../src/otp.ts';
import { hashKey } from '../src/owners.ts';
import type { TripRecord } from '../src/triplog.ts';
import { addBus, addOwner, addTestRoute, type App, boot, conductorTrip, dirs, firstSignIn, ride, today, TOKEN } from './owner-helpers.ts';

// What owners and syndicates see beyond their buses: alerts about trips that stopped short, and a
// route syndicate's read-only view. Signing up and in is in accounts.test.ts.

const overview = async (app: App, key: string) => (await app.call('GET', '/api/owner/overview', undefined, { key })).body;

test('Indian mobile numbers are read however they are typed', () => {
  for (const typed of ['9830012345', '098300 12345', '+91 98300-12345', '919830012345', '0091 98300 12345']) {
    assert.equal(indianMobile(typed), '+919830012345', typed);
  }
  for (const bad of ['12345', '5830012345', '+1 415 555 0100', '98300123456', '']) assert.equal(indianMobile(bad), null, bad);
});

test('one code a minute for each phone, by default', () => {
  const book = createOtpBook();
  assert.ok('code' in book.issue('+919830012345', 0));
  const soon = book.issue('+919830012345', 20_000);
  assert.deepEqual(soon, { waitSec: 40 });
  assert.ok('code' in book.issue('+919830012345', 61_000));
  assert.equal(book.check('+919830012345', '123', 61_000 + 11 * 60_000), 'expired');
});

test('alerts: a trip that stopped before the end of the route, or went quiet', async () => {
  const app = await boot();
  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 19 A 1234');
  const start = await conductorTrip(app, sen.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${start.body.sessionId}/pings`, { pings: ride(net, 0, 700) });
  assert.deepEqual((await overview(app, sen.key)).alerts, [], 'nothing to look into while it runs');
  await app.call('POST', `/api/trips/${start.body.sessionId}/end`);
  const [alert] = (await overview(app, sen.key)).alerts;
  assert.deepEqual([alert.kind, alert.plate, alert.afterStop, alert.stops, alert.stopCount, alert.ended], ['stopped', 'WB 19 A 1234', 'Own B', 2, 3, 'phone']);

  // The rule itself, for a trip still running with no position: quiet after 5 minutes, unless at the end.
  const pp = net.patterns.get('T1-UP')!;
  const now = Date.now();
  const trip = (over: Partial<TripRecord>): TripRecord => ({
    id: 't', ownerId: 'o', busId: 'b', plate: 'WB 1', patternId: 'T1-UP', routeId: 't1', routeNumber: 'T1', operator: 'private',
    headsign: 'Own C', startedAt: now - 900_000, departedAt: now - 900_000, movedAt: now - 400_000, movedM: 700, lastSeenAt: now - 400_000,
    fromM: 0, toM: 700, fromStop: 'Own A', toStop: 'Own B', stops: 2, stopCount: 3, wholeRoute: false, positions: 20, ...over,
  });
  assert.deepEqual(alertsOf([trip({})], net, now).map((a) => a.kind), ['quiet']);
  assert.deepEqual(alertsOf([trip({ lastSeenAt: now - QUIET_ALERT_MS + 30_000 })], net, now), []);
  assert.deepEqual(alertsOf([trip({ toM: pp.line.length - 20, toStop: 'Own C', stops: 3 })], net, now), [], 'at the end of the route');
  assert.deepEqual(alertsOf([trip({ ended: 'no_signal', endedAt: now })], net, now).map((a) => a.kind), ['stopped']);
  assert.deepEqual(alertsOf([trip({ ended: 'bus_removed', endedAt: now })], net, now), []);
});

test('a syndicate sees its members’ buses on its routes, read-only', async () => {
  const app = await boot();
  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const das = await addOwner(app, 'Das Travels');
  const a = await addBus(app, sen.key, 'WB 19 A 1001');
  const b = await addBus(app, das.key, 'WB 19 A 2002');
  // Bus A on T1, the syndicate's route; bus B on D2, which is not.
  const ta = await conductorTrip(app, sen.key, 'T1-UP', a.plate);
  await app.call('POST', `/api/trips/${ta.body.sessionId}/pings`, { pings: ride(net, 0, 700) });
  const d2 = net.patterns.get('D2-UP')!;
  const tb = await conductorTrip(app, das.key, 'D2-UP', b.plate);
  const pings = Array.from({ length: 12 }, (_, i) => ({ ...pointAlong(d2.line, 300 + 75 * i), accuracy: 10, ts: Date.now() - (12 - i) * 5_000 }));
  await app.call('POST', `/api/trips/${tb.body.sessionId}/pings`, { pings });

  // The admin adds it with the person who signs in for it, who gets a temporary password.
  const contact = { contactName: 'Bijoy Saha', phone: '9830044444' };
  assert.equal((await app.call('POST', '/api/admin/syndicates', { name: 'T1 syndicate', routeIds: ['nope'], ownerIds: [sen.id], ...contact }, { key: TOKEN })).status, 400);
  assert.equal((await app.call('POST', '/api/admin/syndicates', { name: 'T1 syndicate', routeIds: ['t1'], ownerIds: [], ...contact }, { key: TOKEN })).status, 400);
  assert.equal((await app.call('POST', '/api/admin/syndicates', { name: 'T1 syndicate', routeIds: ['t1'], ownerIds: [sen.id], contactName: 'Bijoy Saha' }, { key: TOKEN })).status, 400, 'a number to sign in with');
  const made = await app.call('POST', '/api/admin/syndicates', { name: 'T1 syndicate', routeIds: ['t1'], ownerIds: [sen.id, das.id], ...contact }, { key: TOKEN });
  assert.equal(made.status, 200);
  assert.deepEqual([made.body.syndicate.contactName, made.body.syndicate.phone, made.body.syndicate.password], ['Bijoy Saha', '+919830044444', 'temporary']);
  const key = await firstSignIn(app, '9830044444', made.body.password);

  const view = await overview(app, key);
  assert.equal(view.kind, 'syndicate');
  assert.deepEqual(view.syndicate.routes.map((r: { number: string }) => r.number), ['T1']);
  assert.deepEqual(view.syndicate.members.map((m: { name: string }) => m.name), ['Sen Transport', 'Das Travels']);
  const byPlate = new Map(view.buses.map((x: { plate: string }) => [x.plate, x]));
  const seenA = byPlate.get('WB 19 A 1001') as { owner: string; now: { state: string } | null };
  const seenB = byPlate.get('WB 19 A 2002') as { now: unknown };
  assert.deepEqual([seenA.owner, seenA.now?.state], ['Sen Transport', 'on_route']);
  assert.equal(seenB.now, null, 'not on the syndicate’s routes');
  assert.deepEqual(view.trips.map((t: { plate: string; routeNumber: string }) => [t.plate, t.routeNumber]), [['WB 19 A 1001', 'T1']]);
  assert.equal(view.people, undefined);

  // Read-only.
  assert.equal((await app.call('POST', '/api/owner/buses', { plate: 'WB 19 A 3003' }, { key })).status, 403);
  const csv = await fetch(`${app.base}/api/owner/trips.csv?from=${today()}&to=${today()}`, { headers: { authorization: `Bearer ${key}` } });
  const lines = (await csv.text()).trim().split('\r\n');
  assert.match(lines[0], /^.?Date,Bus,Owner,Bus name,Route/);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /^\d{4}-\d{2}-\d{2},WB 19 A 1001,Sen Transport,,T1,Own C,/);
  // Das Travels' own view still has its D2 trip.
  assert.deepEqual((await overview(app, das.key)).trips.map((t: { routeNumber: string }) => t.routeNumber), ['D2']);

  // A new password from the admin signs its devices out; a removed owner leaves the syndicate.
  const id = made.body.syndicate.id as string;
  const temp = (await app.call('POST', `/api/admin/syndicates/${id}/password`, {}, { key: TOKEN })).body.password as string;
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key })).status, 401);
  const fresh = await firstSignIn(app, '9830044444', temp, 'Syndicate-pass-2');
  await app.call('DELETE', `/api/admin/owners/${das.id}`, undefined, { key: TOKEN });
  assert.deepEqual((await app.call('GET', '/api/admin/syndicates', undefined, { key: TOKEN })).body.syndicates[0].ownerIds, [sen.id]);
  assert.equal((await overview(app, fresh)).buses.length, 1);
  assert.equal((await app.call('DELETE', `/api/admin/syndicates/${id}`, undefined, { key: TOKEN })).status, 200);
  assert.equal((await app.call('GET', '/api/owner/overview', undefined, { key: fresh })).status, 401);
});

test('an owners file from before managers and passwords still signs everyone in', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wimb-owners-'));
  dirs.push(dir);
  const key = 'an-old-sign-in-key-from-before-managers';
  const syndicateKey = 'an-old-syndicate-key-from-before-passwords';
  const old = {
    owners: [{ id: 'o-old', name: 'Old Owner', keyHash: hashKey(key), createdAt: '2026-10-01T00:00:00.000Z' }],
    buses: [],
    syndicates: [{ id: 's-old', name: 'Old syndicate', routeIds: ['d2'], ownerIds: ['o-old'], keyHash: hashKey(syndicateKey), createdAt: '2026-10-01T00:00:00.000Z' }],
  };
  writeFileSync(path.join(dir, 'owners.json'), JSON.stringify(old));
  const app = await boot(dir);
  const seen = await overview(app, key);
  assert.deepEqual([seen.owner.name, seen.me.role], ['Old Owner', 'owner']);
  assert.equal((await overview(app, syndicateKey)).kind, 'syndicate');
  const saved = JSON.parse(readFileSync(path.join(dir, 'owners.json'), 'utf8'));
  assert.equal(saved.owners[0].keyHash, undefined);
  assert.deepEqual(saved.owners[0].people[0].keyHashes, [hashKey(key)]);
  assert.equal(saved.owners[0].people[0].id, seen.me.id, 'saved at once, so the id stays');
  assert.deepEqual([saved.syndicates[0].keyHash, saved.syndicates[0].keyHashes], [undefined, [hashKey(syndicateKey)]]);

  // They had no number or password: the admin gives them both, to sign in on /signin from now on.
  assert.equal((await app.call('POST', `/api/admin/owners/o-old/people/${seen.me.id}/password`, {}, { key: TOKEN })).status, 400, 'a number first');
  const reset = await app.call('POST', `/api/admin/owners/o-old/people/${seen.me.id}/password`, { phone: '9830033333' }, { key: TOKEN });
  assert.equal(reset.status, 200);
  assert.equal((await overview(app, await firstSignIn(app, '9830033333', reset.body.password))).owner.name, 'Old Owner');
  await app.close();
});
