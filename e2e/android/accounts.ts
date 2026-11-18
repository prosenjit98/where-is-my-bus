import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Accounts for the Android tests, made through the server's API as the admin, an owner and the
// people who sign up would: an owner with a bus, and a conductor their owner approved.

export const PASSWORD = 'Bus-owner-2026';

/**
 * fetch, tried again on a network error: Node can reuse a kept-alive connection the test server has
 * just closed (ECONNRESET), which is the test's connection, not the app or the server failing.
 */
export async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export function apiAt(base: string, adminToken: string) {
  async function call<T = Record<string, unknown>>(method: string, p: string, body?: unknown, key?: string): Promise<{ status: number; body: T }> {
    const res = await fetchRetry(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  /** An owner the admin adds, who signs in once and chooses their password; with one bus. */
  async function ownerWithBus(name: string, phone: string, plate: string) {
    const made = await call<{ owner: { id: string }; password: string }>('POST', '/api/admin/owners', { name, phone }, adminToken);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const first = await call<{ changeToken: string }>('POST', '/api/accounts/sign-in', { phone, password: made.body.password });
    const set = await call<{ key: string }>('POST', '/api/accounts/password', { changeToken: first.body.changeToken, password: PASSWORD });
    const key = set.body.key;
    const bus = await call<{ bus: { id: string; plate: string } }>('POST', '/api/owner/buses', { plate }, key);
    assert.equal(bus.status, 200, JSON.stringify(bus.body));
    return { id: made.body.owner.id, key, phone, plate: bus.body.bus.plate };
  }

  /** A conductor who signs up with the owner's number, is approved by the owner, and signs in. */
  async function conductor(owner: { key: string; phone: string }, name: string, phone: string) {
    const up = await call<{ id: string }>('POST', '/api/accounts/sign-up', { kind: 'conductor', name, phone, password: PASSWORD, ownerPhone: owner.phone });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    await approveConductor(owner.key, up.body.id);
    const signIn = await call<{ key: string }>('POST', '/api/accounts/sign-in', { phone, password: PASSWORD });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
    return { id: up.body.id, key: signIn.body.key, phone };
  }

  async function approveConductor(ownerKey: string, personId: string) {
    const ok = await call('POST', `/api/owner/people/${personId}/approve`, undefined, ownerKey);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  }

  /** The person waiting for approval who signed up with this name: their id. */
  async function waitingPerson(ownerKey: string, name: string): Promise<string> {
    const o = await call<{ people: { id: string; name: string; pending: boolean }[] }>('GET', '/api/owner/overview', undefined, ownerKey);
    const p = o.body.people.find((x) => x.name === name && x.pending);
    assert.ok(p, `${name} is waiting for the owner`);
    return p.id;
  }

  return { call, ownerWithBus, conductor, approveConductor, waitingPerson };
}

/**
 * How bright the screen is at a point, 0 to 255, from `adb exec-out screencap -p`: to tell the
 * dark theme from the light one, which the screen's text cannot.
 */
export function brightnessAt(png: Buffer, x: number, y: number): number {
  const width = png.readUInt32BE(16);
  const colourType = png[25];
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  assert.ok(png[24] === 8 && channels, 'an 8-bit RGB or RGBA screenshot');
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  // Each row starts with its filter; undo them row by row down to the one wanted.
  let prev = Buffer.alloc(stride);
  let row = Buffer.alloc(stride);
  for (let r = 0; r <= y; r++) {
    const filter = raw[r * (stride + 1)];
    const line = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      row[i] = (line[i] + predictor) & 0xff;
    }
    prev = row;
  }
  const i = x * channels;
  return Math.round(0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2]);
}
