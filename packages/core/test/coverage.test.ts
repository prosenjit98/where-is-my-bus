import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverageFrom, createLiveEngine, plan, waitText } from '../src/index.ts';
import { demo, drive, T0 } from './helpers.ts';

// Trusting a late tracked bus where conductors cover nearly every bus of a route. D6 runs every
// 12 minutes and takes about 31 minutes end to end, so about 2.6 of its buses are on the road
// towards Sector V at a time.

const net = demo();
const pp = net.patterns.get('D6-UP')!;
const shyambazarToKarunamoyee = (opts: Parameters<typeof plan>[3]) =>
  plan(net, { kind: 'stop', stopId: 'shyambazar' }, { kind: 'stop', stopId: 'karunamoyee' }, { minuteOfDay: 600, dateISO: '2026-10-27', ...opts });

test('coverage is the share of a direction’s running buses that are tracked', () => {
  const e = createLiveEngine(() => net);
  assert.equal(e.coverage('D6-UP', T0), 0);
  const starts = [500, 2500, 4500];
  for (const startM of starts) {
    const c = e.startSession({ patternId: 'D6-UP', role: 'conductor' }, T0).sessionId;
    e.ingest(c, drive(pp, { startM, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  }
  assert.equal(e.coverage('D6-UP', T0 + 30_000), 1);
  const one = createLiveEngine(() => net);
  const c = one.startSession({ patternId: 'D6-UP', role: 'conductor' }, T0).sessionId;
  one.ingest(c, drive(pp, { startM: 500, mps: 5, count: 3, everyS: 10, t0: T0 }), T0 + 30_000);
  const share = one.coverage('D6-UP', T0 + 30_000) as number;
  assert.ok(share > 0.3 && share < 0.45, String(share));
  // The arrivals carry it, so the apps can plan with it.
  const at = one.arrivals('karunamoyee', T0 + 30_000).find((a) => a.patternId === 'D6-UP');
  assert.equal(at?.coverage, share);
  assert.equal(coverageFrom({ karunamoyee: one.arrivals('karunamoyee', T0 + 30_000) })('D6-UP'), share);
  // At 23:00, D6 does not run.
  assert.equal(one.coverage('D6-UP', T0 + 13 * 3600_000), undefined);
});

test('a tracked bus later than the usual wait sets the wait only where coverage is high', () => {
  const late = () => [10]; // the usual wait is 6 min (every 12)
  const low = shyambazarToKarunamoyee({ liveEtas: late, coverage: () => 0.4 }).options[0].legs.find((l) => l.kind === 'bus');
  assert.ok(low && low.kind === 'bus');
  assert.equal(low.waitIsLive, false, 'other buses may well come first');
  assert.equal(low.waitMin, 6);

  const high = shyambazarToKarunamoyee({ liveEtas: late, coverage: () => 0.9 }).options[0].legs.find((l) => l.kind === 'bus');
  assert.ok(high && high.kind === 'bus');
  assert.equal(high.waitIsLive, true, 'nearly every bus is tracked, so this one is the next');
  assert.equal(high.waitMin, 10);
  assert.equal(waitText(high, (id) => net.stops.get(id)?.name ?? id), 'D6 reaches Shyambazar in 10 min');

  // Without coverage known, the old rule stands.
  const unknown = shyambazarToKarunamoyee({ liveEtas: late }).options[0].legs.find((l) => l.kind === 'bus');
  assert.ok(unknown && unknown.kind === 'bus');
  assert.equal(unknown.waitIsLive, false);
});
