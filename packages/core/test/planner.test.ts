import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isBusLeg,
  laterTrackedText,
  liveEtasFrom,
  plan,
  prepareNetwork,
  validateNetwork,
  waitText,
  type Arrival,
  type PlanOption,
} from '../src/index.ts';
import { demo, demoNetwork } from './helpers.ts';

const net = demo();
const stop = (stopId: string) => ({ kind: 'stop' as const, stopId });
const at = (hhmm: string, dateISO = '2026-10-27') => {
  const [h, m] = hhmm.split(':').map(Number);
  return { minuteOfDay: h * 60 + m, dateISO };
};
const busLegs = (o: PlanOption) => o.legs.filter(isBusLeg);
const routeNumbers = (o: PlanOption, leg = 0) => busLegs(o)[leg].choices.map((c) => c.routeNumber).sort();

test('parallel routes between the same stops become one "take any of these" option', () => {
  const r = plan(net, stop('esplanade'), stop('jadavpur-8b'), at('10:00'));
  const first = r.options[0];
  assert.equal(first.transfers, 0);
  assert.deepEqual(routeNumbers(first), ['D2', 'D3']);
  // D2 every 9 min and D3 every 10 min together: a bus about every 4.7 min, so about 2.4 min wait.
  const leg = busLegs(first)[0];
  assert.equal(leg.waitMin, 2.4);
  assert.equal(leg.waitIsLive, false);
});

test('no direct bus: one change at the best stop', () => {
  const r = plan(net, stop('tollygunge'), stop('sector-v'), at('10:00'));
  const first = r.options[0];
  assert.equal(first.transfers, 1);
  const [leg1, leg2] = busLegs(first);
  assert.deepEqual(leg1.choices.map((c) => c.routeNumber), ['D1']);
  assert.equal(leg1.alightStopId, 'esplanade');
  assert.deepEqual(leg2.choices.map((c) => c.routeNumber), ['D5']);
});

test('a direct bus hides slower journeys with a change', () => {
  const r = plan(net, stop('esplanade'), stop('sector-v'), at('10:00'));
  assert.equal(r.options[0].transfers, 0);
  assert.deepEqual(routeNumbers(r.options[0]), ['D5']);
  assert.ok(r.options.every((o) => o.transfers === 0));
});

test('time-window variants: D1 stops at Park Street only before 1 pm', () => {
  const morning = plan(net, stop('howrah-stn'), stop('park-street'), at('09:00'));
  assert.deepEqual(routeNumbers(morning.options[0]), ['D1', 'D2']);
  const afternoon = plan(net, stop('howrah-stn'), stop('park-street'), at('15:00'));
  assert.deepEqual(routeNumbers(afternoon.options[0]), ['D2']);
});

test('late at night there are no buses, and the planner says which routes start later', () => {
  const r = plan(net, stop('esplanade'), stop('jadavpur-8b'), at('23:30'));
  assert.equal(r.options.filter((o) => o.id !== 'walk').length, 0);
  assert.deepEqual(r.notRunning.map((n) => n.routeNumber).sort(), ['D2', 'D3']);
});

test('starting from a point walks to the nearest useful stop', () => {
  const home = { kind: 'point' as const, lat: 22.5196, lng: 88.3655, label: 'Home' };
  const r = plan(net, home, stop('esplanade'), at('10:00'));
  const first = r.options[0];
  assert.equal(first.legs[0].kind, 'walk');
  assert.equal(busLegs(first)[0].boardStopId, 'gariahat');
  assert.deepEqual(routeNumbers(first), ['D2', 'D3']);
});

test('a tracked bus sooner than the usual wait sets the wait', () => {
  const r = plan(net, stop('esplanade'), stop('jadavpur-8b'), {
    ...at('10:00'),
    liveEtas: (patternId, stopId) => (patternId === 'D3-UP' && stopId === 'esplanade' ? [1.5, 15] : undefined),
  });
  const leg = busLegs(r.options[0])[0];
  assert.equal(leg.waitIsLive, true);
  assert.equal(leg.waitMin, 1.5);
  assert.equal(leg.livePatternId, 'D3-UP');
  assert.equal(leg.choices[0].routeNumber, 'D3');
  assert.equal(waitText(leg, (id) => id), 'D3 reaches esplanade in 2 min');
});

test('a tracked bus later than the usual wait does not hide the buses nobody is tracking', () => {
  // D2 and D3 together come about every 4.7 min, so a tracked D3 in 4 min is no better than usual.
  const r = plan(net, stop('esplanade'), stop('jadavpur-8b'), {
    ...at('10:00'),
    liveEtas: (patternId, stopId) => (patternId === 'D3-UP' && stopId === 'esplanade' ? [4, 15] : undefined),
  });
  const leg = busLegs(r.options[0])[0];
  assert.equal(leg.waitIsLive, false);
  assert.equal(leg.waitMin, 2.4);
  assert.deepEqual(leg.choices.find((c) => c.routeNumber === 'D3')?.liveEtasMin, [4, 15]);
  assert.equal(laterTrackedText(leg), 'A tracked D3 is 4 min away');
});

test('a bus nobody has heard from for a while never sets a live wait', () => {
  const arrival = (confidence: Arrival['confidence']): Arrival => ({
    patternId: 'D3-UP', routeId: 'd3', routeNumber: 'D3', operator: 'mini', headsign: 'Jadavpur 8B',
    live: true, etaMin: 1, confidence,
  });
  assert.deepEqual(liveEtasFrom(() => [arrival('medium')])('D3-UP', 'esplanade'), [1]);
  assert.equal(liveEtasFrom(() => [arrival('low')])('D3-UP', 'esplanade'), undefined);
});

test('a bus that arrives before you can walk to the stop is not counted', () => {
  const home = { kind: 'point' as const, lat: 22.5196, lng: 88.3655 };
  const r = plan(net, home, stop('esplanade'), {
    ...at('10:00'),
    liveEtas: (patternId, stopId) => (patternId === 'D2-DOWN' && stopId === 'gariahat' ? [1] : undefined),
  });
  const leg = busLegs(r.options[0])[0];
  assert.equal(leg.waitIsLive, false);
});

test('very short trips also offer walking', () => {
  const r = plan(net, stop('bbd-bag'), stop('esplanade'), at('10:00'));
  assert.ok(r.options.some((o) => o.id === 'walk'));
});

test('a diversion switches the normal direction off between its dates', () => {
  const n = demoNetwork();
  const d4 = n.routes.find((r) => r.id === 'd4');
  assert.ok(d4);
  d4.patterns.push({
    id: 'D4-UP-PUJA',
    direction: 'UP',
    headsign: 'Garia More',
    stopIds: ['shyambazar', 'sealdah', 'science-city', 'ruby', 'garia'],
    validFrom: '2026-10-10',
    validTo: '2026-10-20',
    replaces: 'D4-UP',
  });
  assert.deepEqual(validateNetwork(n), []);
  const p = prepareNetwork(n);
  const during = plan(p, stop('sealdah'), stop('moulali'), at('10:00', '2026-10-15'));
  assert.ok(during.options.every((o) => o.id === 'walk'), 'Moulali is skipped during the diversion');
  const after = plan(p, stop('sealdah'), stop('moulali'), at('10:00', '2026-10-27'));
  assert.ok(after.options.some((o) => busLegs(o)[0]?.choices.some((c) => c.patternId === 'D4-UP')));
});

test('validation explains problems in plain words', () => {
  assert.deepEqual(validateNetwork(demoNetwork()), []);
  const n = demoNetwork();
  n.routes[0].patterns[0].stopIds.push('nowhere');
  n.routes[1].firstBus = '25:00';
  n.stops.push({ ...n.stops[0] });
  n.landmarks?.push({ id: 'broken', name: 'Broken landmark', lat: Number.NaN, lng: 88.35 });
  const errors = validateNetwork(n);
  assert.ok(errors.some((e) => e.includes('unknown stop "nowhere"')));
  assert.ok(errors.some((e) => e.includes('first and last bus')));
  assert.ok(errors.some((e) => e.includes('used twice')));
  assert.ok(errors.some((e) => e.includes('Landmark "broken" has invalid coordinates')));
});
