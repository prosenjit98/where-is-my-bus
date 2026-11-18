import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeEnds, routeKey, searchRoutes } from '../src/index.ts';
import { demo } from './helpers.ts';

// Riders find a bus by its route: the number as they type it, its name, or a place it goes to.

const net = demo();
const numbers = (q: string) => searchRoutes(net, q).map((h) => h.route.number);

test('route numbers however they are typed', () => {
  assert.equal(numbers('D2')[0], 'D2');
  assert.equal(numbers('d 2')[0], 'D2');
  assert.equal(numbers('acd7')[0], 'AC-D7');
  assert.equal(numbers('AC-D7')[0], 'AC-D7');
  assert.equal(numbers('d7')[0], 'AC-D7', 'part of the number');
  assert.deepEqual(numbers('D').slice(0, 6), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], 'a start lists the routes in order');
  assert.equal(routeKey('১২সি/২'), '122', 'Bengali digits as digits');
  assert.equal(routeKey(' 12C / 2 '), '12c2');
});

test('a route by its name, and the routes serving a place', () => {
  assert.equal(numbers('AC express')[0], 'AC-D7');
  // Garia More is the end of D2, D4 and AC-D7.
  const garia = searchRoutes(net, 'garia');
  assert.deepEqual(garia.filter((h) => h.via?.stopId === 'garia').map((h) => h.route.number).sort(), ['AC-D7', 'D2', 'D4']);
  // The same in Bengali.
  const bengali = searchRoutes(net, 'গড়িয়া মোড়');
  assert.ok(bengali.some((h) => h.route.number === 'D2' && h.via?.nameBn === 'গড়িয়া মোড়'));
  // A landmark: the routes stopping near it.
  const museum = searchRoutes(net, 'Indian Museum');
  assert.ok(museum.length > 0 && museum.every((h) => h.via), museum.map((h) => h.route.number).join());
  assert.deepEqual(searchRoutes(net, ''), []);
  assert.deepEqual(searchRoutes(net, 'zzzz'), []);
});

test('a route’s ends, for a one-line description', () => {
  assert.deepEqual(routeEnds(net, net.routes.get('d2')!), ['howrah-stn', 'garia']);
});
