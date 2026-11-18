import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveEngine } from '../src/index.ts';
import { demo, drive, pointOn, T0 } from './helpers.ts';

const net = demo();
const pp = net.patterns.get('D2-UP')!;
const engine = () => createLiveEngine(() => net);

test('one rider on a bus gives a live arrival time downstream', () => {
  const e = engine();
  const { sessionId } = e.startSession({ patternId: 'D2-UP' }, T0);
  const res = e.ingest(sessionId, drive(pp, { startM: 0, mps: 5, count: 7, everyS: 10, t0: T0 }), T0 + 60_000);
  assert.equal(res.accepted, 7);
  const arrival = e.arrivals('park-street', T0 + 60_000).find((a) => a.patternId === 'D2-UP' && a.live);
  assert.ok(arrival);
  assert.ok(arrival.etaMin > 8 && arrival.etaMin < 20, `eta ${arrival.etaMin}`);
  assert.equal(arrival.confidence, 'medium');
  assert.equal(arrival.riders, 1);
});

test('without tracked buses, arrivals fall back to the usual frequency', () => {
  const e = engine();
  const a = e.arrivals('park-street', T0).find((x) => x.patternId === 'D2-UP');
  assert.ok(a);
  assert.equal(a.live, false);
  assert.equal(a.headwayMin, 9);
  assert.equal(a.etaMin, 4.5);
});

test('two phones on the same bus count as one bus with two riders', () => {
  const e = engine();
  const a = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  e.ingest(a, drive(pp, { startM: 1000, mps: 5, count: 4, everyS: 10, t0: T0 }), T0 + 40_000);
  e.ingest(b, drive(pp, { startM: 1040, mps: 5, count: 4, everyS: 10, t0: T0 + 2000 }), T0 + 40_000);
  const buses = e.vehiclesOnPattern('D2-UP', T0 + 40_000);
  assert.equal(buses.length, 1);
  assert.equal(buses[0].riders, 2);
  assert.equal(buses[0].confidence, 'high');
});

test('a phone a kilometre behind is a different bus', () => {
  const e = engine();
  const a = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  e.ingest(a, drive(pp, { startM: 2000, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  e.ingest(b, drive(pp, { startM: 900, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  assert.equal(e.vehiclesOnPattern('D2-UP', T0 + 30_000).length, 2);
});

test('plate digits keep two buses racing side by side apart', () => {
  const e = engine();
  const a = e.startSession({ patternId: 'D2-UP', plate: 'WB 04 F 1234' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP', plate: '5678' }, T0).sessionId;
  e.ingest(a, drive(pp, { startM: 1500, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  e.ingest(b, drive(pp, { startM: 1510, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  const buses = e.vehiclesOnPattern('D2-UP', T0 + 30_000);
  assert.equal(buses.length, 2);
  assert.deepEqual(buses.map((v) => v.plate).sort(), ['1234', '5678']);
});

test('a conductor phone alone is trusted', () => {
  const e = engine();
  const c = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
  e.ingest(c, drive(pp, { startM: 300, mps: 4, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  const [bus] = e.vehiclesOnPattern('D2-UP', T0 + 30_000);
  assert.equal(bus.source, 'conductor');
  assert.equal(bus.confidence, 'high');
});

test('a rider who walks away from the route is detected and detached', () => {
  const e = engine();
  const s = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  e.ingest(s, drive(pp, { startM: 500, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 20_000);
  const away = drive(pp, { startM: 600, mps: 1, count: 12, everyS: 10, t0: T0 + 30_000, sideM: 400 });
  const res = e.ingest(s, away, T0 + 150_000);
  assert.equal(res.lastOutcome, 'off_route');
  assert.equal(res.suggestEnd, true);
  assert.equal(e.vehiclesOnPattern('D2-UP', T0 + 150_000).length, 0);
});

test('fake GPS, poor accuracy and impossible speed are ignored', () => {
  const e = engine();
  const s = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  const p = pointOn(pp, 500);
  assert.equal(e.ingest(s, [{ ...p, ts: T0, mock: true }], T0).lastOutcome, 'mock');
  assert.equal(e.ingest(s, [{ ...p, ts: T0 + 1000, accuracy: 900 }], T0 + 1000).lastOutcome, 'low_accuracy');
  assert.equal(e.ingest(s, [{ ...p, ts: T0 + 2000 }], T0 + 2000).lastOutcome, 'accepted');
  const far = pointOn(pp, 890); // 390 m in 10 s is 140 km/h
  assert.equal(e.ingest(s, [{ ...far, ts: T0 + 12_000 }], T0 + 12_000).lastOutcome, 'jump');
  assert.equal(e.ingest(s, [{ ...p, ts: T0 - 600_000 }], T0 + 12_000).lastOutcome, 'stale');
});

test('buses nobody reports for 10 minutes disappear', () => {
  const e = engine();
  const s = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  e.ingest(s, drive(pp, { startM: 300, mps: 4, count: 2, everyS: 10, t0: T0 }), T0 + 10_000);
  e.sweep(T0 + 11 * 60_000);
  assert.equal(e.stats().vehicles, 0);
  assert.equal(e.arrivals('park-street', T0 + 11 * 60_000).filter((a) => a.live).length, 0);
});

test('several riders leaving the path at one place is flagged as a likely diversion', () => {
  const e = engine();
  for (const offset of [0, 40]) {
    const s = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
    e.ingest(s, drive(pp, { startM: 1200 + offset, mps: 5, count: 2, everyS: 10, t0: T0 }), T0 + 10_000);
    e.ingest(s, drive(pp, { startM: 1300 + offset, mps: 5, count: 2, everyS: 10, t0: T0 + 20_000, sideM: 400 }), T0 + 40_000);
  }
  const alerts = e.possibleDiversions(T0 + 60_000);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].routeNumber, 'D2');
  assert.equal(alerts[0].sessions, 2);
});

test('phones still walking to the stop are not told to stop, and do not look like a diversion', () => {
  const e = engine();
  for (const offset of [0, 40]) {
    const s = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
    // Three minutes, 400 m from the route, before ever being on it.
    const res = e.ingest(s, drive(pp, { startM: 1200 + offset, mps: 1, count: 18, everyS: 10, t0: T0, sideM: 400 }), T0 + 180_000);
    assert.equal(res.lastOutcome, 'off_route');
    assert.equal(res.suggestEnd, false);
  }
  assert.equal(e.possibleDiversions(T0 + 200_000).length, 0);
});

test('two phones on one bus that start far apart become one bus', () => {
  const e = engine();
  const a = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP' }, T0).sessionId;
  for (let i = 0; i < 14; i++) {
    const ts = T0 + i * 10_000;
    const along = 1000 + 5 * 10 * i;
    e.ingest(a, [{ ...pointOn(pp, along), accuracy: 15, ts }], ts);
    // B's first fix, just after GPS started, is 250 m out.
    e.ingest(b, [{ ...pointOn(pp, i === 0 ? along + 250 : along + 10), accuracy: i === 0 ? 90 : 15, ts: ts + 500 }], ts + 500);
  }
  const buses = e.vehiclesOnPattern('D2-UP', T0 + 140_000);
  assert.equal(buses.length, 1);
  assert.equal(buses[0].riders, 2);
  assert.equal(buses[0].confidence, 'high');
});

test('two conductors are always two buses, however close', () => {
  const e = engine();
  const a = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
  // Ten metres apart for over two minutes: close enough to join and to merge, if they were riders.
  for (let i = 0; i < 14; i++) {
    const ts = T0 + i * 10_000;
    e.ingest(a, [{ ...pointOn(pp, 2000 + 50 * i), accuracy: 15, ts }], ts);
    e.ingest(b, [{ ...pointOn(pp, 2010 + 50 * i), accuracy: 15, ts }], ts);
  }
  const buses = e.vehiclesOnPattern('D2-UP', T0 + 140_000);
  assert.equal(buses.length, 2);
  assert.ok(buses.every((v) => v.source === 'conductor' && v.riders === 1));
});

test('two conductor phones on one registered bus are one bus', () => {
  const e = engine();
  // The conductor and the driver both share with the bus's own code.
  const a = e.startSession({ patternId: 'D2-UP', role: 'conductor', plate: 'WB 19 A 1234', busId: 'b-1' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP', role: 'conductor', plate: 'WB 19 A 1234', busId: 'b-1' }, T0).sessionId;
  for (let i = 0; i < 6; i++) {
    const ts = T0 + i * 10_000;
    e.ingest(a, [{ ...pointOn(pp, 2000 + 50 * i), accuracy: 15, ts }], ts);
    e.ingest(b, [{ ...pointOn(pp, 2010 + 50 * i), accuracy: 15, ts }], ts);
  }
  const buses = e.vehiclesOnPattern('D2-UP', T0 + 60_000);
  assert.equal(buses.length, 1);
  assert.equal(buses[0].riders, 2);
  assert.equal(buses[0].source, 'conductor');
});

test('registered buses are told apart by their ids, even when their plates end in the same digits', () => {
  const e = engine();
  // WB 19 A 1234 and WB 04 F 1234 both end in 1234, and neither phone is a conductor's.
  const a = e.startSession({ patternId: 'D2-UP', plate: 'WB 19 A 1234', busId: 'b-1' }, T0).sessionId;
  const b = e.startSession({ patternId: 'D2-UP', plate: 'WB 04 F 1234', busId: 'b-2' }, T0).sessionId;
  for (let i = 0; i < 14; i++) {
    const ts = T0 + i * 10_000;
    e.ingest(a, [{ ...pointOn(pp, 2000 + 50 * i), accuracy: 15, ts }], ts);
    e.ingest(b, [{ ...pointOn(pp, 2010 + 50 * i), accuracy: 15, ts }], ts);
  }
  assert.equal(e.vehiclesOnPattern('D2-UP', T0 + 140_000).length, 2);
  // A rider who typed the digits joins one of them, as before.
  const r = e.startSession({ patternId: 'D2-UP', plate: '1234' }, T0 + 140_000).sessionId;
  e.ingest(r, [{ ...pointOn(pp, 2655), accuracy: 15, ts: T0 + 141_000 }], T0 + 141_000);
  assert.equal(e.vehiclesOnPattern('D2-UP', T0 + 141_000).length, 2);
});

test('the bus a phone is on can be looked up, once the phone is on the route', () => {
  const e = engine();
  const c = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
  assert.equal(e.vehicleOfSession(c, T0), undefined);
  const res = e.ingest(c, drive(pp, { startM: 300, mps: 4, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  assert.equal(res.seenAt, T0 + 20_000, 'the time of the latest accepted position');
  assert.equal(res.firstSeenAt, T0);
  assert.ok(Math.abs((res.firstAlongM ?? 0) - 300) < 5 && Math.abs((res.alongM ?? 0) - 380) < 5, `${res.firstAlongM} to ${res.alongM}`);
  const bus = e.vehicleOfSession(c, T0 + 30_000);
  assert.ok(bus);
  assert.equal(bus.id, res.vehicleId);
  assert.deepEqual(bus, e.vehiclesOnPattern('D2-UP', T0 + 30_000)[0]);
  assert.equal(e.vehicleOfSession('nope'), undefined);
});

test('arrivals leave out buses reaching the end of their route', () => {
  const e = engine();
  const atGaria = e.arrivals('garia', T0).map((a) => a.patternId);
  assert.ok(atGaria.includes('D2-DOWN'));
  assert.ok(!atGaria.includes('D2-UP'), 'D2-UP ends at Garia');
});

test('unknown trips are rejected with a clear error', () => {
  const e = engine();
  assert.throws(() => e.ingest('nope', []), /ended/);
  assert.throws(() => e.startSession({ patternId: 'nope' }), /does not exist/);
});
