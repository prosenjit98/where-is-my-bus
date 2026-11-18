import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBusLeg, plan, prepareNetwork, validateNetwork } from '../../packages/core/src/index.ts';
import { fromOverpass, overpassQuery, simplify, stitch, type OverpassJson } from '../import-osm.ts';

// A small piece of OpenStreetMap as Overpass returns it: one route both ways, with each
// stop mapped on both sides of the road, one way drawn backwards, and two things to skip.
const node = (id: number, lat: number, lon: number, tags: Record<string, string> = {}) => ({ type: 'node' as const, id, lat, lon, tags });
const fixture: OverpassJson = {
  elements: [
    {
      type: 'relation',
      id: 1,
      tags: { type: 'route', route: 'bus', ref: 'T1', network: 'Kolkata Private Bus', from: 'Alpha', to: 'Gamma', 'public_transport:version': '2' },
      members: [
        { type: 'node', ref: 11, role: 'stop', lat: 22.5, lon: 88.3 },
        { type: 'node', ref: 19, role: 'stop', lat: 22.5, lon: 88.305 },
        { type: 'node', ref: 12, role: 'stop', lat: 22.5, lon: 88.31 },
        { type: 'node', ref: 13, role: 'stop', lat: 22.5, lon: 88.32 },
        { type: 'way', ref: 101, role: '', geometry: [{ lat: 22.5, lon: 88.3 }, { lat: 22.5, lon: 88.305 }, { lat: 22.5, lon: 88.31 }] },
        // Drawn from the far end: the importer has to turn it round.
        { type: 'way', ref: 102, role: '', geometry: [{ lat: 22.5, lon: 88.32 }, { lat: 22.5, lon: 88.315 }, { lat: 22.5, lon: 88.31 }] },
      ],
    },
    {
      type: 'relation',
      id: 2,
      tags: { type: 'route', route: 'bus', ref: 'T1', network: 'Kolkata Private Bus', from: 'Gamma', to: 'Alpha', 'public_transport:version': '2', interval: '00:12' },
      members: [
        { type: 'node', ref: 23, role: 'stop', lat: 22.5002, lon: 88.32 },
        { type: 'node', ref: 22, role: 'stop', lat: 22.5002, lon: 88.31 },
        { type: 'node', ref: 21, role: 'stop', lat: 22.5002, lon: 88.3 },
        { type: 'way', ref: 201, role: '', geometry: [{ lat: 22.5002, lon: 88.32 }, { lat: 22.5002, lon: 88.3 }] },
      ],
    },
    { type: 'relation', id: 3, tags: { type: 'route', route: 'bus', network: 'Kolkata Private Bus' }, members: [] },
    node(11, 22.5, 88.3, { name: 'Alpha', 'name:bn': 'আলফা', alt_name: 'Alpha More' }),
    node(12, 22.5, 88.31, { name: 'Beta' }),
    node(13, 22.5, 88.32, { name: 'Gamma' }),
    node(19, 22.5, 88.305), // no name: riders could not pick it, so it is left out
    node(21, 22.5002, 88.3, { name: 'Alpha' }),
    node(22, 22.5002, 88.31, { name: 'Beta' }),
    node(23, 22.5002, 88.32, { name: 'Gamma' }),
  ],
};

test('OpenStreetMap routes become a valid network: one stop per place, paths in the direction of travel', () => {
  const { network, report } = fromOverpass(fixture, { region: 'Test', today: '2026-10-27' });
  assert.deepEqual(validateNetwork(network), []);
  assert.equal(report.routes, 1);
  assert.equal(report.patterns, 2);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0], /no route number/);

  // Both sides of the road are one stop, placed between them.
  assert.deepEqual(network.stops.map((s) => s.id).sort(), ['alpha', 'beta', 'gamma']);
  const alpha = network.stops.find((s) => s.id === 'alpha');
  assert.equal(alpha?.nameBn, 'আলফা');
  assert.deepEqual(alpha?.aliases, ['Alpha More']);
  assert.equal(alpha?.lat, 22.5001);

  const route = network.routes[0];
  assert.equal(route.number, 'T1');
  assert.equal(route.operator, 'private');
  assert.equal(route.defaultHeadwayMin, 12, 'from the interval tag');
  const [up, down] = route.patterns;
  assert.deepEqual(up.stopIds, ['alpha', 'beta', 'gamma']);
  assert.equal(up.headsign, 'Gamma');
  assert.deepEqual(up.shape?.[0], [22.5, 88.3]);
  assert.deepEqual(up.shape?.at(-1), [22.5, 88.32]);
  assert.equal(down.direction, 'DOWN');
  assert.deepEqual(down.stopIds, ['gamma', 'beta', 'alpha']);
  assert.match(network.notice ?? '', /OpenStreetMap contributors.*ODbL.*placeholders/);

  const r = plan(prepareNetwork(network), { kind: 'stop', stopId: 'alpha' }, { kind: 'stop', stopId: 'gamma' }, { minuteOfDay: 600, dateISO: '2026-10-27' });
  const leg = r.options[0].legs.find(isBusLeg);
  assert.equal(leg?.choices[0].routeNumber, 'T1');
});

test('stitching turns the first way round when the next one meets its start', () => {
  const { path, worstGapM } = stitch([
    [[22.5, 88.31], [22.5, 88.3]],
    [[22.5, 88.31], [22.5, 88.32]],
  ]);
  assert.deepEqual(path, [[22.5, 88.3], [22.5, 88.31], [22.5, 88.32]]);
  assert.equal(worstGapM, 0);
});

test('a road path with a big gap is replaced by straight lines between stops', () => {
  const gappy: OverpassJson = structuredClone(fixture);
  const rel = gappy.elements[0];
  rel.members = rel.members?.filter((m) => m.ref !== 102);
  rel.members?.push({ type: 'way', ref: 103, role: '', geometry: [{ lat: 22.51, lon: 88.32 }, { lat: 22.511, lon: 88.33 }] });
  const { network, report } = fromOverpass(gappy, { region: 'Test' });
  assert.equal(report.straightLines, 1);
  assert.equal(network.routes[0].patterns[0].shape, undefined);
  assert.deepEqual(validateNetwork(network), []);
});

test('a relation that lists only the road gets the named stops along it, in order', () => {
  // As most of Kolkata's route relations are: ways, no stops. The ways are also out of order.
  const roadOnly: OverpassJson = {
    elements: [
      {
        type: 'relation',
        id: 7,
        tags: { type: 'route', route: 'bus', ref: 'R7', network: 'Kolkata Private Bus', to: 'Gamma' },
        members: [
          { type: 'way', ref: 1, role: '', geometry: [{ lat: 22.5, lon: 88.3 }, { lat: 22.5, lon: 88.31 }] },
          { type: 'way', ref: 3, role: '', geometry: [{ lat: 22.5, lon: 88.32 }, { lat: 22.5, lon: 88.33 }] },
          { type: 'way', ref: 2, role: '', geometry: [{ lat: 22.5, lon: 88.31 }, { lat: 22.5, lon: 88.32 }] },
        ],
      },
      node(31, 22.5001, 88.3005, { highway: 'bus_stop', name: 'Alpha' }),
      node(33, 22.5001, 88.3295, { highway: 'bus_stop', name: 'Gamma' }),
      node(32, 22.4999, 88.315, { highway: 'bus_stop', name: 'Beta' }),
      node(34, 22.51, 88.315, { highway: 'bus_stop', name: 'Far away' }),
      node(35, 22.5, 88.32, { highway: 'traffic_signals' }),
    ],
  };
  const { network, report } = fromOverpass(roadOnly, { region: 'Test' });
  assert.equal(report.stopsMatched, 1);
  assert.deepEqual(network.routes[0].patterns[0].stopIds, ['alpha', 'beta', 'gamma']);
  assert.deepEqual(network.routes[0].patterns[0].shape?.at(-1), [22.5, 88.33], 'the ways were put in order');
  assert.deepEqual(validateNetwork(network), []);
});

test('simplifying keeps the corners and drops points on a straight road', () => {
  const path: [number, number][] = [[22.5, 88.3], [22.5, 88.301], [22.5, 88.302], [22.501, 88.302]];
  assert.deepEqual(simplify(path), [[22.5, 88.3], [22.5, 88.302], [22.501, 88.302]]);
});

test('the Overpass query filters by network and route numbers', () => {
  const q = overpassQuery({ network: 'Kolkata', refs: ['1A', '12C/2'] });
  assert.match(q, /\["network"~"Kolkata",i\]/);
  assert.match(q, /\["ref"~"\^\(1A\|12C\\\/2\)\$"\]/);
  assert.match(q, /node\(r\.r\);/);
});
