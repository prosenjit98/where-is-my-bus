import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTripTracker, prepareNetwork, type Network } from '../src/index.ts';
import { demo, pointOn, T0 } from './helpers.ts';

const net = demo();
const pp = net.patterns.get('D2-UP')!;
const parkStreet = pp.stopAlong[pp.pattern.stopIds.indexOf('park-street')];
const fixAt = (along: number, ts: number, sideM = 0) => ({ ...pointOn(pp, along, sideM), accuracy: 12, ts });

test('next stop, stop alarm, arrival and passing the stop', () => {
  const t = createTripTracker(net, 'D2-UP', 'park-street', { alarmBeforeM: 800 });
  let s = t.update(fixAt(100, T0));
  assert.equal(s.status, 'on_route');
  assert.equal(s.nextStopId, 'bbd-bag');
  assert.equal(s.stopsToGo, 3);
  assert.equal(s.alarm, 'waiting');

  // About 3 km in 6 minutes: fast for Kolkata, but a bus can do it.
  s = t.update(fixAt(parkStreet - 600, T0 + 360_000));
  assert.equal(s.alarm, 'due');
  assert.equal(s.nextStopName, 'Park Street');
  t.markAlarmDone();
  assert.equal(t.state().alarm, 'done');

  s = t.update(fixAt(parkStreet - 20, T0 + 480_000));
  assert.equal(s.status, 'arrived');
  assert.equal(s.suggestEnd, false);

  s = t.update(fixAt(parkStreet + 450, T0 + 540_000));
  assert.equal(s.status, 'passed_destination');
  assert.equal(s.suggestEnd, true);
});

test('leaving the route for 90 seconds suggests ending the trip', () => {
  const t = createTripTracker(net, 'D2-UP', null);
  t.update(fixAt(400, T0));
  let s = t.update(fixAt(450, T0 + 10_000, 400));
  assert.equal(s.status, 'off_route');
  assert.equal(s.suggestEnd, false);
  s = t.update(fixAt(460, T0 + 105_000, 420));
  assert.equal(s.suggestEnd, true);
  assert.equal(s.alarm, 'off');
});

test('a route that doubles back never snaps to its far side and ends the trip early', () => {
  // Out along one road, round a corner, and back along a road 89 m to the north.
  const n: Network = {
    version: 1,
    updatedAt: '2026-10-27T00:00:00.000Z',
    region: 'Test',
    stops: [
      { id: 'a', name: 'A', lat: 22.5, lng: 88.3 },
      { id: 'b', name: 'B', lat: 22.5, lng: 88.32 },
      { id: 'c', name: 'C', lat: 22.5008, lng: 88.31 },
      { id: 'd', name: 'D', lat: 22.5008, lng: 88.3 },
    ],
    routes: [
      {
        id: 'u', number: 'U1', operator: 'private', firstBus: '05:00', lastBus: '23:00', defaultHeadwayMin: 10,
        patterns: [{
          id: 'U1-UP', direction: 'UP', headsign: 'D', stopIds: ['a', 'b', 'c', 'd'],
          shape: [[22.5, 88.3], [22.5, 88.32], [22.5008, 88.32], [22.5008, 88.3]],
        }],
      },
    ],
  };
  const t = createTripTracker(prepareNetwork(n), 'U1-UP', 'c');
  assert.equal(t.update({ lat: 22.5, lng: 88.303, accuracy: 15, ts: T0 }).status, 'on_route');
  // GPS noise pulls this fix 55 m north, nearer the road back than the road out.
  const s = t.update({ lat: 22.5005, lng: 88.305, accuracy: 20, ts: T0 + 10_000 });
  assert.equal(s.status, 'on_route');
  assert.equal(s.suggestEnd, false);
  assert.ok(s.alongM !== null && s.alongM < 1000, `along ${s.alongM}`);
  assert.equal(s.alarm, 'waiting');
});

test('starting the trip on the way to the stop does not end it', () => {
  const t = createTripTracker(net, 'D2-UP', 'park-street');
  // Three minutes walking 400 m away from the route.
  for (let i = 0; i <= 18; i++) t.update(fixAt(300, T0 + i * 10_000, 400));
  let s = t.state();
  assert.equal(s.status, 'off_route');
  assert.equal(s.suggestEnd, false);
  // On the bus; then off it for 90 seconds, which does end the trip.
  s = t.update(fixAt(320, T0 + 200_000));
  assert.equal(s.status, 'on_route');
  t.update(fixAt(400, T0 + 210_000, 400));
  s = t.update(fixAt(410, T0 + 305_000, 400));
  assert.equal(s.suggestEnd, true);
});

test('a trip that never reaches the route ends after the boarding grace', () => {
  const t = createTripTracker(net, 'D2-UP', null, { boardingGraceS: 600 });
  t.update(fixAt(300, T0, 400));
  assert.equal(t.update(fixAt(300, T0 + 599_000, 400)).suggestEnd, false);
  assert.equal(t.update(fixAt(300, T0 + 601_000, 400)).suggestEnd, true);
});

test('a bus crawling in a jam is still on the route', () => {
  const t = createTripTracker(net, 'D2-UP', 'garia');
  for (let i = 0; i < 20; i++) t.update(fixAt(2000 + i * 2, T0 + i * 15_000));
  const s = t.state();
  assert.equal(s.status, 'on_route');
  assert.equal(s.suggestEnd, false);
});
