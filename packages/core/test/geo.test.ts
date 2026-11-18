import assert from 'node:assert/strict';
import { test } from 'node:test';
import { haversine, locateOnLine, makeLine, pointAlong, sliceLine } from '../src/index.ts';

const line = makeLine([
  { lat: 22.56, lng: 88.35 },
  { lat: 22.57, lng: 88.35 },
  { lat: 22.57, lng: 88.36 },
]);

test('haversine matches known distance (0.01 deg of latitude is about 1.11 km)', () => {
  const d = haversine({ lat: 22.56, lng: 88.35 }, { lat: 22.57, lng: 88.35 });
  assert.ok(Math.abs(d - 1112) < 3, `got ${d}`);
});

test('a point beside the line snaps to it with the right distance along', () => {
  const hit = locateOnLine(line, { lat: 22.565, lng: 88.3502 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.along - 556) < 5, `along ${hit.along}`);
  assert.ok(Math.abs(hit.offset - 20.5) < 2, `offset ${hit.offset}`);
});

test('search window keeps a point on the requested stretch', () => {
  // Corner point is equally close to both segments; restricting the window picks the second.
  const hit = locateOnLine(line, { lat: 22.5701, lng: 88.3502 }, 1200);
  assert.ok(hit && hit.along >= 1200);
  assert.equal(locateOnLine(line, { lat: 22.565, lng: 88.35 }, 500, 400), null);
});

test('pointAlong and sliceLine walk the line', () => {
  const mid = pointAlong(line, line.length / 2);
  const back = locateOnLine(line, mid);
  assert.ok(back && Math.abs(back.along - line.length / 2) < 0.5);
  const slice = sliceLine(line, 500, 1500);
  assert.equal(slice.length, 3); // start, the corner vertex, end
});
