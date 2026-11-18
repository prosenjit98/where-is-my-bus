import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createLiveEngine,
  createReportBook,
  LINE_HEX,
  LiveError,
  MODE_DWELL_MIN,
  MODE_SPEED_KMH,
  plan,
  prepareNetwork,
  validateNetwork,
  type Network,
} from '../src/index.ts';

// The Metro and ferries alongside buses: planned from their frequencies at their own speeds, and
// combined with buses in one journey (data/demo-multimodal.json: the Blue Line and a Howrah ferry).

const file = fileURLToPath(new URL('../../../data/demo-multimodal.json', import.meta.url));
const network = (): Network => JSON.parse(readFileSync(file, 'utf8'));
const net = prepareNetwork(network());
const at10 = { minuteOfDay: 600, dateISO: '2026-10-28' };
const stop = (stopId: string) => ({ kind: 'stop' as const, stopId });

/** Minutes the planner should give for a whole direction of a line at its mode's speed. */
function wholeLineMin(patternId: string): number {
  const pp = net.patterns.get(patternId)!;
  const mode = pp.route.mode ?? 'bus';
  const metres = pp.stopAlong.at(-1)! - pp.stopAlong[0];
  return metres / ((MODE_SPEED_KMH[mode] * 1000) / 60) + MODE_DWELL_MIN[mode] * (pp.stopAlong.length - 2);
}

test('the demo with the Metro and a ferry is a valid network', () => {
  assert.deepEqual(validateNetwork(network()), []);
});

test('the Metro is planned like a route, at its own speed and frequency', () => {
  const leg = plan(net, stop('metro-shyambazar'), stop('metro-tollygunge'), at10).options[0].legs[0];
  assert.ok(leg.kind === 'bus');
  assert.deepEqual([leg.choices[0].mode, leg.choices[0].color, leg.choices[0].routeNumber], ['metro', 'blue', 'Blue']);
  assert.ok(Math.abs(leg.rideMin - wholeLineMin('METRO-BLUE-UP')) < 0.1, String(leg.rideMin));
  assert.equal(leg.waitMin, 2.5, 'every 5 minutes in the morning busy hours');
});

test('a journey takes a bus to the Metro when that is quicker', () => {
  const r = plan(net, stop('howrah-stn'), stop('metro-tollygunge'), at10);
  const best = r.options[0];
  // A bus to Esplanade, a short walk to the Metro station, then the Metro.
  assert.deepEqual(best.legs.map((l) => (l.kind === 'bus' ? l.choices[0].mode : 'walk')), ['bus', 'walk', 'metro']);
  const [bus, , metro] = best.legs;
  assert.ok(bus.kind === 'bus' && bus.alightStopId === 'esplanade');
  assert.ok(metro.kind === 'bus' && metro.boardStopId === 'metro-esplanade');
  const busOnly = r.options.find((o) => o.legs.every((l) => l.kind === 'walk' || l.choices.every((c) => c.mode === 'bus')));
  assert.ok(busOnly && busOnly.totalMin > best.totalMin, 'the bus all the way is slower');
});

test('the ferry crosses the river at a ferry’s speed', () => {
  const leg = plan(net, stop('ferry-howrah'), stop('ferry-fairlie'), at10).options[0].legs[0];
  assert.ok(leg.kind === 'bus');
  assert.equal(leg.choices[0].mode, 'ferry');
  assert.ok(Math.abs(leg.rideMin - wholeLineMin('FERRY-HOWRAH-UP')) < 0.1, String(leg.rideMin));
  assert.equal(leg.waitMin, 7.5, 'every 15 minutes');
});

test('outside its hours the Metro is not offered, and riders are told', () => {
  const r = plan(net, stop('metro-shyambazar'), stop('metro-tollygunge'), { ...at10, minuteOfDay: 23 * 60 });
  assert.equal(r.options.length, 0);
  assert.deepEqual(r.notRunning.map((n) => n.routeNumber), ['Blue']);
});

test('only buses are shared and reported; the other lines keep their timetables', () => {
  const live = createLiveEngine(() => net);
  assert.throws(() => live.startSession({ patternId: 'METRO-BLUE-UP' }), (e) => e instanceof LiveError && e.code === 'not_a_bus');
  assert.ok(live.startSession({ patternId: 'D2-UP' }).sessionId);
  const book = createReportBook(() => net);
  assert.equal(book.add({ patternId: 'FERRY-HOWRAH-UP', stopId: 'ferry-howrah', reporter: 'a' }), 'unknown');
  assert.deepEqual(book.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'a' }), { agreed: false });
});

test('a mode or colour the apps do not know is refused', () => {
  const n = network();
  n.routes.find((r) => r.id === 'metro-blue')!.mode = 'tram' as never;
  n.routes.find((r) => r.id === 'ferry-howrah')!.color = 'violet' as never;
  const errors = validateNetwork(n);
  assert.ok(errors.some((e) => e === 'Route Blue: mode must be bus, metro, train or ferry.'), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('Route F1: colour must be one of blue, green,')), errors.join('\n'));
});

test('text on every line colour is readable (4.5:1 or more)', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const [name, hex] of Object.entries(LINE_HEX)) {
    const text = name === 'yellow' ? '#1E2833' : '#FFFFFF';
    assert.ok(contrast(hex, text) >= 4.5, `${name} ${contrast(hex, text).toFixed(2)}`);
  }
});
