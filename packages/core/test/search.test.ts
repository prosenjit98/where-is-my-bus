import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phoneticKey, search, normalizeText } from '../src/index.ts';
import { demo } from './helpers.ts';

const net = demo();
const top = (q: string) => search(net.searchIndex, q)[0]?.place.id;

test('local names and aliases find the stop', () => {
  assert.equal(top('dharmatala'), 'esplanade');
  assert.equal(top('8B'), 'jadavpur-8b');
  assert.equal(top('sector 5'), 'sector-v');
  assert.equal(top('college more'), 'sector-v');
});

test('Banglish spelling variants match', () => {
  assert.equal(phoneticKey('shyambazar'), phoneticKey('shyambajar'));
  assert.equal(phoneticKey('dhakuria'), phoneticKey('dhakuriya'));
  assert.equal(top('jadabpur'), 'jadavpur-8b');
  assert.equal(top('shealdah'), 'sealdah');
});

test('typos still find the place', () => {
  assert.equal(top('garihat'), 'gariahat');
  assert.equal(top('esplanad'), 'esplanade');
});

test('Bengali script search works, including partial input', () => {
  assert.equal(top('হাওড়া'), 'howrah-stn');
  assert.equal(top('শ্যাম'), 'shyambazar');
  assert.ok(normalizeText('গড়িয়াহাট মোড়').includes(' '));
});

test('exact stop beats a longer name that starts the same way', () => {
  assert.equal(top('garia'), 'garia');
});

test('landmarks are searchable', () => {
  const hit = search(net.searchIndex, 'victoria')[0];
  assert.equal(hit?.place.kind, 'landmark');
  assert.equal(hit?.place.id, 'victoria-memorial');
});

test('nonsense finds nothing', () => {
  assert.equal(search(net.searchIndex, 'zzqxw').length, 0);
});
