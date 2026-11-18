import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Network } from '../../packages/core/src/index.ts';
import { boot, TOKEN } from './owner-helpers.ts';

// A network imported with the credits its data's licences require keeps them: riders' apps show
// them from /api/network, and a credit that is not one is refused with the rest of the import.

test('an imported network keeps its credits, and a credit without text or with a bad address is refused', async () => {
  const app = await boot();
  const net = (await app.call('GET', '/api/network')).body as Network;
  const credits = [{ text: 'Bus stops and routes © OpenStreetMap contributors, ODbL', url: 'https://www.openstreetmap.org/copyright' }];
  const ok = await app.call('PUT', '/api/admin/network', { ...net, attribution: credits }, { key: TOKEN });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(((await app.call('GET', '/api/network')).body as Network).attribution, credits);
  const bad = await app.call('PUT', '/api/admin/network', { ...net, attribution: [{ text: 'OSM', url: 'javascript:alert(1)' }] }, { key: TOKEN });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.body.details), /web address that is not one/);
  assert.equal((await app.call('PUT', '/api/admin/network', { ...net, attribution: [{ text: '' }] }, { key: TOKEN })).status, 400);
  assert.deepEqual(((await app.call('GET', '/api/network')).body as Network).attribution, credits, 'nothing changed by a refused import');
});
