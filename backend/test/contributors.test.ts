import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointAlong, prepareNetwork, type Network } from '../../packages/core/src/index.ts';
import { addOwner, addTestRoute, boot, nextPhone, PASSWORD, TOKEN } from './owner-helpers.ts';

// Contributors: people who sign up, are approved by the admin, and record routes from inside a
// bus in the phone app, marking each stop as the bus reaches it. Their recordings go to the
// admins, who check them and apply them to a route direction (recordings.ts).

async function addContributor(app: Awaited<ReturnType<typeof boot>>, name: string) {
  const phone = nextPhone();
  const up = await app.call('POST', '/api/accounts/sign-up', { kind: 'contributor', name, phone, password: PASSWORD });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual([up.body.kind, up.body.pending], ['contributor', true]);
  return { id: up.body.id as string, phone };
}

const signIn = async (app: Awaited<ReturnType<typeof boot>>, phone: string) => app.call('POST', '/api/accounts/sign-in', { phone, password: PASSWORD });

test('a contributor approved by the admin records a route with marked stops, which the admin applies', async () => {
  const app = await boot();
  const net = prepareNetwork(((await addTestRoute(app)).network) as Network);
  const line = net.patterns.get('T1-UP')!.line;
  const asha = await addContributor(app, 'Asha Roy');

  assert.equal((await signIn(app, asha.phone)).status, 403, 'not before the admin approves');
  const listed = (await app.call('GET', '/api/admin/contributors', undefined, { key: TOKEN })).body.contributors;
  assert.deepEqual(listed.map((x: { name: string; pending: boolean; recordings: number }) => [x.name, x.pending, x.recordings]), [['Asha Roy', true, 0]]);
  assert.equal((await app.call('GET', '/api/admin/contributors')).status, 401);
  assert.equal((await app.call('POST', `/api/admin/contributors/${asha.id}/approve`, undefined, { key: TOKEN })).status, 200);

  const signed = await signIn(app, asha.phone);
  assert.deepEqual([signed.status, signed.body.kind], [200, 'contributor']);
  const key = signed.body.key as string;
  assert.deepEqual((await app.call('GET', '/api/accounts/me', undefined, { key })).body, { kind: 'contributor', name: 'Asha Roy', phoneEnd: asha.phone.slice(-4), owner: null });

  // On the bus: positions every 5 s along T1, standing 30 s at the middle stop, which they mark and
  // name; a little before the end they mark a stop the network does not have yet.
  const made = await app.call('POST', '/api/contributor/recordings', { name: 'T1 morning' }, { key });
  assert.equal(made.status, 200);
  const id = made.body.recording.id as string;
  const t0 = Date.now() - 10 * 60_000;
  const middle = net.patterns.get('T1-UP')!.stopAlong[1];
  const points = [];
  let ts = t0;
  for (let m = 0; m <= line.length; m += 50) {
    points.push({ ...pointAlong(line, m), accuracy: 6, ts });
    ts += 5_000;
    if (Math.abs(m - middle) < 25) for (let i = 0; i < 6; i++) points.push({ ...pointAlong(line, m), accuracy: 6, ts: (ts += 5_000) });
  }
  assert.deepEqual((await app.call('POST', `/api/contributor/recordings/${id}/points`, { points }, { key })).body, { points: points.length });
  const atMiddle = pointAlong(line, middle);
  assert.deepEqual((await app.call('POST', `/api/contributor/recordings/${id}/marks`, { ...atMiddle, ts: t0 + 60_000, name: 'Own B' }, { key })).body, { marks: 1 });
  const nearEnd = pointAlong(line, line.length - 250);
  assert.deepEqual((await app.call('POST', `/api/contributor/recordings/${id}/marks`, { ...nearEnd, ts: t0 + 120_000, name: 'Lake Market gate' }, { key })).body, { marks: 2 });
  assert.equal((await app.call('POST', `/api/contributor/recordings/${id}/marks`, { lat: 'x' }, { key })).status, 400);

  // Nobody else touches it: another contributor, an owner, or nobody signed in.
  const other = await addContributor(app, 'Bimal Dey');
  await app.call('POST', `/api/admin/contributors/${other.id}/approve`, undefined, { key: TOKEN });
  const otherKey = (await signIn(app, other.phone)).body.key as string;
  assert.equal((await app.call('POST', `/api/contributor/recordings/${id}/points`, { points }, { key: otherKey })).status, 404);
  assert.deepEqual((await app.call('GET', '/api/contributor/recordings', undefined, { key: otherKey })).body.recordings, []);
  const sen = await addOwner(app, 'Sen Transport');
  assert.equal((await app.call('GET', '/api/contributor/recordings', undefined, { key: sen.key })).status, 403);
  assert.equal((await app.call('POST', '/api/contributor/recordings', { name: 'x' })).status, 401);

  const done = await app.call('POST', `/api/contributor/recordings/${id}/finish`, undefined, { key });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const halts = done.body.recording.halts as { marked?: boolean; name?: string; stop: { id: string } | null }[];
  const marked = halts.filter((h) => h.marked);
  assert.deepEqual(marked.map((h) => [h.name, h.stop?.id ?? null]), [['Own B', 'own-b'], ['Lake Market gate', null]], 'the marked stops, matched to the network where it has one');
  assert.ok(!halts.some((h) => !h.marked && h.stop?.id === 'own-b'), 'the halt at a marked stop is not counted twice');
  assert.equal((await app.call('DELETE', `/api/contributor/recordings/${id}`, undefined, { key })).status, 409, 'a finished recording waits for the team');

  // The admins see who recorded it, and apply it: the stop the contributor named is added with that name.
  const mine = (await app.call('GET', '/api/admin/recordings', undefined, { key: TOKEN })).body.recordings[0];
  assert.deepEqual([mine.by.name, mine.marks], ['Asha Roy', 2]);
  assert.equal((await app.call('GET', '/api/admin/contributors', undefined, { key: TOKEN })).body.contributors[0].recordings, 1);
  const applied = await app.call('POST', `/api/admin/recordings/${id}/apply`, { routeId: 't1', patternId: 'T1-UP', stops: true }, { key: TOKEN });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const after = (await app.call('GET', '/api/network')).body as Network;
  const stopIds = after.routes.find((r) => r.id === 't1')!.patterns.find((p) => p.id === 'T1-UP')!.stopIds;
  assert.ok(stopIds.includes('own-b'));
  assert.ok(after.stops.some((s) => s.name === 'Lake Market gate' && stopIds.includes(s.id)), 'the named new stop is on the direction');

  // An unfinished recording can be deleted by its contributor; a removed contributor is signed out.
  const spare = (await app.call('POST', '/api/contributor/recordings', { name: 'Spare' }, { key })).body.recording.id;
  assert.equal((await app.call('DELETE', `/api/contributor/recordings/${spare}`, undefined, { key })).status, 200);
  assert.equal((await app.call('DELETE', `/api/admin/contributors/${asha.id}`, undefined, { key: TOKEN })).status, 200);
  assert.equal((await app.call('GET', '/api/contributor/recordings', undefined, { key })).status, 401);
});
