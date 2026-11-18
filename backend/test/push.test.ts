import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../../packages/core/src/index.ts';
import { addBus, addOwner, boot, TOKEN, type App } from './owner-helpers.ts';

// Live buses pushed to open pages as server-sent events: a journey map's route directions, and
// an owner's buses.

type Event = { event: string; data: Record<string, unknown> };

/** Reads a server-sent event stream; `next` waits for an event that matches. */
async function openStream(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers, signal: ctrl.signal });
  const events: Event[] = [];
  let ended = false;
  let wake: () => void = () => undefined;
  if (res.ok && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event && data) events.push({ event, data: JSON.parse(data) });
            wake();
          }
        }
      } catch {
        // Aborted by the test.
      }
      ended = true;
      wake();
    })();
  }
  let seen = 0;
  async function next(match: (e: Event) => boolean, timeoutMs = 6_000): Promise<Event> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      while (seen < events.length) {
        const e = events[seen++];
        if (match(e)) return e;
      }
      if (ended) throw new Error('The stream ended.');
      const left = until - Date.now();
      if (left <= 0) throw new Error(`No matching event in ${timeoutMs} ms; got ${JSON.stringify(events)}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  }
  const endedSoon = async (timeoutMs = 6_000) => {
    const until = Date.now() + timeoutMs;
    while (!ended && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    return ended;
  };
  return { res, events, next, endedSoon, close: () => ctrl.abort() };
}

/** Positions 50 m and 10 s apart along a direction, the last one taken at `endAt`. */
function positions(net: PreparedNetwork, patternId: string, fromM: number, count = 7, endAt = Date.now()) {
  const line = net.patterns.get(patternId)!.line;
  return Array.from({ length: count }, (_, i) => ({ ...pointAlong(line, fromM + 50 * i), accuracy: 10, ts: endAt - (count - 1 - i) * 10_000 }));
}

async function network(app: App) {
  return prepareNetwork((await app.call('GET', '/api/network')).body as Network);
}

const vehicles = (e: Event) => e.data.vehicles as { patternId: string; routeNumber: string }[];

test('a journey map gets the buses on its routes pushed as they move', async () => {
  const app = await boot();
  const net = await network(app);
  const stream = await openStream(`${app.base}/api/live?patterns=D2-UP,D2-DOWN`);
  assert.equal(stream.res.status, 200);
  assert.match(stream.res.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.deepEqual(vehicles(await stream.next((e) => e.event === 'vehicles')), [], 'at once, the buses there are now');

  const started = Date.now();
  const { sessionId } = (await app.call('POST', '/api/trips', { patternId: 'D2-UP' })).body;
  assert.equal((await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: positions(net, 'D2-UP', 800) })).body.accepted, 7);
  const moved = await stream.next((e) => vehicles(e).length > 0);
  assert.deepEqual(vehicles(moved).map((v) => [v.patternId, v.routeNumber]), [['D2-UP', 'D2']]);
  assert.ok(Date.now() - started < 4_000, 'within a second or two, not at the next poll');

  // A bus on another route is not sent to this page.
  const other = (await app.call('POST', '/api/trips', { patternId: 'D6-UP' })).body.sessionId;
  await app.call('POST', `/api/trips/${other}/pings`, { pings: positions(net, 'D6-UP', 800) });
  await new Promise((r) => setTimeout(r, 1_500));
  assert.ok(stream.events.every((e) => vehicles(e).every((v) => v.patternId.startsWith('D2-'))));
  stream.close();

  assert.equal((await app.call('GET', '/api/live')).status, 400);
  assert.equal((await app.call('GET', '/api/live?patterns=NOPE')).status, 404);
  assert.equal((await app.call('GET', `/api/live?patterns=${Array.from({ length: 13 }, (_, i) => `P${i}`).join(',')}`)).status, 400);
});

test('one network can keep only so many live connections open', async () => {
  const app = await boot();
  const open = [];
  for (let i = 0; i < 12; i++) {
    const s = await openStream(`${app.base}/api/live?patterns=D2-UP`, { 'x-forwarded-for': '10.9.9.9' });
    assert.equal(s.res.status, 200);
    await s.next((e) => e.event === 'vehicles');
    open.push(s);
  }
  const refused = await openStream(`${app.base}/api/live?patterns=D2-UP`, { 'x-forwarded-for': '10.9.9.9' });
  assert.equal(refused.res.status, 429);
  const elsewhere = await openStream(`${app.base}/api/live?patterns=D2-UP`, { 'x-forwarded-for': '10.8.8.8' });
  assert.equal(elsewhere.res.status, 200);
  elsewhere.close();
  // A closed one makes room.
  open.pop()!.close();
  await new Promise((r) => setTimeout(r, 300));
  const again = await openStream(`${app.base}/api/live?patterns=D2-UP`, { 'x-forwarded-for': '10.9.9.9' });
  assert.equal(again.res.status, 200);
  again.close();
  for (const s of open) s.close();
});

test('an owner’s page gets its buses pushed; a replaced sign-in key ends the stream', async () => {
  const app = await boot();
  const net = await network(app);
  const sen = await addOwner(app, 'Sen Transport');
  const bus = await addBus(app, sen.key, 'WB 19 A 1234');
  assert.equal((await openStream(`${app.base}/api/owner/live`)).res.status, 401);

  const stream = await openStream(`${app.base}/api/owner/live`, { authorization: `Bearer ${sen.key}` });
  assert.equal(stream.res.status, 200);
  const first = await stream.next((e) => e.event === 'buses');
  assert.deepEqual(first.data.buses, [{ id: bus.id, now: null }]);

  const { sessionId } = (await app.call('POST', '/api/trips', { patternId: 'D2-UP', role: 'conductor', plate: bus.plate }, { key: sen.key })).body;
  await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: positions(net, 'D2-UP', 800, 7, Date.now() - 30_000) });
  const moving = await stream.next((e) => (e.data.buses as { now: { state: string } | null }[])[0]?.now?.state === 'on_route');
  assert.equal((moving.data.buses as { now: { routeNumber: string } }[])[0].now.routeNumber, 'D2');

  // The admin sets a new password: the old key's stream ends at its next update.
  const [listed] = (await app.call('GET', '/api/admin/owners', undefined, { key: TOKEN })).body.owners;
  await app.call('POST', `/api/admin/owners/${sen.id}/people/${listed.people[0].id}/password`, {}, { key: TOKEN });
  const later = await app.call('POST', `/api/trips/${sessionId}/pings`, { pings: positions(net, 'D2-UP', 1150, 2) });
  assert.equal(later.body.accepted, 2);
  assert.equal(await stream.endedSoon(), true);
});
