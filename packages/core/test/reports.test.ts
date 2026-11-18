import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReportBook } from '../src/index.ts';
import { demo, T0 } from './helpers.ts';

const net = demo();
const book = () => createReportBook(() => net);
const pp = net.patterns.get('D2-UP')!;
const along = (id: string) => pp.stopAlong[pp.pattern.stopIds.indexOf(id)];

test('one report alone is not trusted; a second person’s report of the same bus is', () => {
  const b = book();
  assert.deepEqual(b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'a' }, T0), { agreed: false });
  assert.deepEqual(b.sightings('D2-UP', T0), []);
  assert.deepEqual(b.arrivals('park-street', T0), [], 'nothing to tell anyone yet');
  // The same phone again is a repeat, however often it says so.
  assert.equal(b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'a' }, T0 + 30_000), 'repeat');
  assert.deepEqual(b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'b' }, T0 + 60_000), { agreed: true });
  const [s] = b.sightings('D2-UP', T0 + 60_000);
  assert.equal(s.stopId, 'esplanade');
  assert.equal(s.reporters, 2);
});

test('reports far apart in time are two different buses, and neither counts alone', () => {
  const b = book();
  b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'a' }, T0);
  assert.deepEqual(b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'b' }, T0 + 10 * 60_000), { agreed: false });
  assert.deepEqual(b.sightings('D2-UP', T0 + 10 * 60_000), []);
});

test('a reported bus tells people further on roughly when it comes, never as Live', () => {
  const b = book();
  b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'a' }, T0);
  b.add({ patternId: 'D2-UP', stopId: 'esplanade', reporter: 'b' }, T0 + 20_000);
  const [a] = b.arrivals('park-street', T0 + 80_000);
  assert.equal(a.patternId, 'D2-UP');
  assert.equal(a.live, false);
  assert.equal(a.confidence, 'low');
  assert.deepEqual(a.reported, { stopId: 'esplanade', agoMin: 1, reporters: 2 });
  // Esplanade to Park Street at 14 km/h, less the minute since it was seen.
  const expected = Math.round(((along('park-street') - along('esplanade')) / (14 / 3.6) - 60) / 60);
  assert.equal(a.etaMin, expected);
  // Stops before the sighting, and the stop itself, learn nothing from it.
  assert.deepEqual(b.arrivals('esplanade', T0 + 80_000), []);
  assert.deepEqual(b.arrivals('bbd-bag', T0 + 80_000), []);
  // Long after, the bus has gone by.
  assert.deepEqual(b.arrivals('park-street', T0 + 40 * 60_000), []);
});

test('reports for a stop the route does not serve, or its last stop, are refused', () => {
  const b = book();
  assert.equal(b.add({ patternId: 'D2-UP', stopId: 'sector-v', reporter: 'a' }, T0), 'unknown');
  assert.equal(b.add({ patternId: 'D2-UP', stopId: 'garia', reporter: 'a' }, T0), 'unknown');
  assert.equal(b.add({ patternId: 'NOPE', stopId: 'esplanade', reporter: 'a' }, T0), 'unknown');
});
