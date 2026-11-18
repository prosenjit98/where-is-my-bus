import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addBus, addOwner, addTestRoute, boot, conductorTrip, ride, TOKEN } from './owner-helpers.ts';

// The admin panel's dashboard: the network, the buses on the road, owners, their trips today.

test('the dashboard shows the network, the buses on the road, owners and today’s trips', async () => {
  const app = await boot();
  assert.equal((await app.call('GET', '/api/admin/dashboard')).status, 401, 'admins only');
  const empty = (await app.call('GET', '/api/admin/dashboard', undefined, { key: TOKEN })).body;
  assert.deepEqual([empty.live.buses, empty.today.trips, empty.owners.owners, empty.suggestions], [0, 0, 0, 0]);
  assert.equal(empty.network.routes, 7);
  assert.equal(empty.network.stops, 22);
  assert.equal(empty.network.modes.bus, 7);
  assert.equal(empty.today.byHour.length, 24);

  const net = await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 19 A 1234');
  const start = await conductorTrip(app, sen.key, 'T1-UP', bus.plate);
  await app.call('POST', `/api/trips/${start.body.sessionId}/pings`, { pings: ride(net, 0, 700) });
  await app.call('POST', '/api/corrections', { kind: 'stop', text: 'The Own B stop is across the road.' });

  const d = (await app.call('GET', '/api/admin/dashboard', undefined, { key: TOKEN })).body;
  assert.equal(d.network.routes, 8);
  assert.equal(d.network.stops, 25);
  assert.deepEqual([d.live.buses, d.live.byConductors], [1, 1]);
  assert.deepEqual(d.live.routes.map((r: { routeNumber: string; buses: number }) => [r.routeNumber, r.buses]), [['T1', 1]]);
  assert.equal(d.live.vehicles[0].routeNumber, 'T1');
  assert.deepEqual([d.owners.owners, d.owners.buses, d.owners.people, d.owners.waiting], [1, 1, 1, []]);
  assert.equal(d.today.trips, 1);
  assert.equal(d.today.byHour.reduce((a: number, b: number) => a + b, 0), 1);
  assert.ok(d.today.km >= 0.6 && d.today.km <= 0.8, String(d.today.km));
  assert.equal(d.suggestions, 1);

  // A conductor who stops before the end of the route shows up as something to look at.
  await app.call('POST', `/api/trips/${start.body.sessionId}/end`);
  const after = (await app.call('GET', '/api/admin/dashboard', undefined, { key: TOKEN })).body;
  assert.deepEqual(after.today.alerts.map((a: { plate: string; kind: string }) => [a.plate, a.kind]), [['WB 19 A 1234', 'stopped']]);
  assert.equal(after.live.buses, 0);
});
