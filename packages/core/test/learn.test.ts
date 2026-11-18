import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveEngine, createTravelTimes, plan, rideTimeFromTable, timeBucket } from '../src/index.ts';
import { demo, pointOn, T0 } from './helpers.ts';

const net = demo();
const pp = net.patterns.get('D2-UP')!;
const segLen = (seg: number) => pp.stopAlong[seg + 1] - pp.stopAlong[seg];

test('times are kept by hour and kind of day, in Indian time', () => {
  // T0 is 10:00 IST on Tuesday 27 October 2026.
  assert.equal(timeBucket(T0), 'wd10');
  assert.equal(timeBucket(Date.UTC(2026, 9, 31, 13, 0)), 'sat18'); // 18:30 IST, Saturday
  assert.equal(timeBucket(Date.UTC(2026, 10, 1, 18, 45)), 'mon0'.replace('mon', 'wd')); // 00:15 IST, Monday
});

test('a stretch is learned after three trips, then odd trips are refused', () => {
  const t = createTravelTimes();
  t.record('D2-UP', 2, T0, 200);
  t.record('D2-UP', 2, T0 + 60_000, 220);
  assert.equal(t.segmentSec('D2-UP', 2, T0), undefined, 'two trips are not enough');
  t.record('D2-UP', 2, T0 + 120_000, 240);
  const learned = t.segmentSec('D2-UP', 2, T0) as number;
  assert.ok(learned > 200 && learned < 240, String(learned));
  // The same hour on a Sunday uses the hour on any day, until Sundays have their own.
  assert.equal(t.segmentSec('D2-UP', 2, Date.UTC(2026, 10, 1, 4, 40)), learned);
  for (let i = 0; i < 3; i++) t.record('D2-UP', 2, T0 + i * 1000, 220);
  assert.equal(t.record('D2-UP', 2, T0, 5000), false, 'a bus stood still for over an hour');
  assert.equal(t.record('D2-UP', 2, T0, 20), false, 'far too fast');
  assert.equal(t.record('D2-UP', 2, T0, -5), false);
  const snap = t.snapshot();
  assert.equal(createTravelTimes(snap).segmentSec('D2-UP', 2, T0), t.segmentSec('D2-UP', 2, T0), 'kept across restarts');
});

test('ride times use learned stretches once half of them are known', () => {
  const t = createTravelTimes();
  const fallback = (seg: number) => segLen(seg) / (14 / 3.6) + 24;
  assert.equal(t.rideMin(pp, 2, 5, T0, fallback), undefined);
  for (let i = 0; i < 3; i++) {
    t.record('D2-UP', 2, T0, 600);
    t.record('D2-UP', 3, T0, 600);
  }
  const ride = t.rideMin(pp, 2, 5, T0, fallback) as number;
  assert.ok(Math.abs(ride - (1200 + fallback(4)) / 60) < 0.01, String(ride));
  // The apps plan with the same numbers, from the server's table: Jadavpur 8B to Garia, which only D2 serves.
  for (let i = 0; i < 3; i++) t.record('D2-UP', 8, T0, 1500);
  const hook = rideTimeFromTable(t.table(net, T0));
  const trip = (opts: Parameters<typeof plan>[3]) => {
    const leg = plan(net, { kind: 'stop', stopId: 'jadavpur-8b' }, { kind: 'stop', stopId: 'garia' }, { minuteOfDay: 600, dateISO: '2026-10-27', ...opts })
      .options[0].legs.find((l) => l.kind === 'bus');
    assert.ok(leg && leg.kind === 'bus');
    return leg.choices.find((c) => c.patternId === 'D2-UP')!.rideMin;
  };
  assert.equal(Math.round(trip({ rideTimeMin: hook })), 25, '1500 learned seconds');
  assert.ok(trip({}) < trip({ rideTimeMin: hook }) - 3, `the flat estimate, ${trip({}).toFixed(1)} min, is quicker`);
});

/** A conductor's bus driving D2-UP at a steady speed, reporting every 10 s, from `startM`. */
function driveConductor(hooks: Parameters<typeof createLiveEngine>[2], mps: number, startM: number, seconds: number) {
  const e = createLiveEngine(() => net, {}, hooks);
  const c = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
  for (let s = 0; s <= seconds; s += 10) {
    const ts = T0 + s * 1000;
    e.ingest(c, [{ ...pointOn(pp, startM + mps * s), accuracy: 10, ts }], ts);
    if (s % 30 === 0) e.notePredictions(ts);
  }
  return { e, c };
}

test('a tracked bus gives one time per stretch it drives', () => {
  const samples: { seg: number; seconds: number }[] = [];
  driveConductor({ onSegment: (_p, seg, _t, seconds) => samples.push({ seg, seconds }) }, 6, 0, 1500);
  assert.ok(samples.length >= 3, JSON.stringify(samples));
  for (const s of samples) assert.ok(Math.abs(s.seconds - segLen(s.seg) / 6) < 3, JSON.stringify(s));
  // Stretches come in order, each once.
  assert.deepEqual(samples.map((s) => s.seg), samples.map((_, i) => i));
});

test('learned stretches change arrival times; with times that match the bus, predictions come true', () => {
  const slow = (patternId: string, seg: number) => (patternId === 'D2-UP' ? segLen(seg) / 3 : undefined); // 3 m/s
  const usual = createLiveEngine(() => net);
  const learned = createLiveEngine(() => net, {}, { segmentSec: slow });
  for (const e of [usual, learned]) {
    const c = e.startSession({ patternId: 'D2-UP', role: 'conductor' }, T0).sessionId;
    e.ingest(c, [{ ...pointOn(pp, 500), accuracy: 10, ts: T0 }, { ...pointOn(pp, 540), accuracy: 10, ts: T0 + 10_000 }], T0 + 10_000);
  }
  const at = (e: ReturnType<typeof createLiveEngine>) => e.arrivals('park-street', T0 + 10_000).find((a) => a.live)!.etaMin;
  const parkStreet = pp.stopAlong[pp.pattern.stopIds.indexOf('park-street')];
  assert.ok(Math.abs(at(learned) - (parkStreet - 540) / 3 / 60) < 0.3, `${at(learned)} min: the learned 3 m/s`);
  assert.ok(at(learned) > at(usual), `${at(learned)} against ${at(usual)}`);

  // A bus that keeps exactly to its learned times: errors are close to nothing.
  const errors: { horizonMin: number; errorSec: number }[] = [];
  const steady = (patternId: string, seg: number) => (patternId === 'D2-UP' ? segLen(seg) / 6 : undefined);
  driveConductor({ segmentSec: steady, onPrediction: (r) => errors.push(r) }, 6, 0, 2400);
  assert.ok(errors.some((r) => r.horizonMin === 10) && errors.some((r) => r.horizonMin === 5), JSON.stringify(errors));
  for (const r of errors) assert.ok(Math.abs(r.errorSec) <= 60, JSON.stringify(r));
});
