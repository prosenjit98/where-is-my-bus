import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../packages/core/src/index.ts';
import { startServer, type ServerOptions } from '../backend/src/server.ts';

// A real server with a temporary copy of the demo network, and the Chrome installed on this
// computer (or CHROME_PATH) driven by playwright-core: nothing extra to download.

export const ADMIN_TOKEN = 'e2e-admin-token';
export const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

/** 10:00 in Kolkata on a quiet weekday, so route hours and busy-hour frequencies are known. */
export const TEN_AM_IST = new Date('2026-10-01T04:30:00Z');

export async function startApp(extra: Partial<ServerOptions> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wimb-e2e-'));
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: ADMIN_TOKEN, quiet: true, ...extra });
  const base = `http://127.0.0.1:${s.port}`;
  const demo = JSON.parse(readFileSync(fileURLToPath(new URL('../data/demo-network.json', import.meta.url)), 'utf8')) as Network;
  return { base, close: s.close, net: prepareNetwork(demo) };
}

export async function launch(): Promise<Browser> {
  return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
}

// A 1x1 transparent PNG: map tiles are not fetched from OpenStreetMap during tests.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A phone-sized page with location and notifications allowed, and spies on the alarm. */
export async function phone(browser: Browser, base: string, opts: { dark?: boolean; at?: { lat: number; lng: number } } = {}) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 860 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-IN',
    colorScheme: opts.dark ? 'dark' : 'light',
    geolocation: opts.at ? { latitude: opts.at.lat, longitude: opts.at.lng, accuracy: 10 } : undefined,
  });
  await context.grantPermissions(['geolocation', 'notifications'], { origin: base });
  await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.addInitScript(() => {
    const w = window as unknown as { __notes: string[]; __vibrations: unknown[]; __csp: string[] };
    w.__notes = [];
    w.__vibrations = [];
    w.__csp = [];
    const show = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title: string, options?: NotificationOptions) {
      w.__notes.push(title);
      return show.call(this, title, options).catch(() => undefined);
    };
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: (p: unknown) => (w.__vibrations.push(p), true) });
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|tile\.openstreetmap/.test(m.text())) errors.push(m.text());
  });
  return { context, page, errors };
}

export async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

export const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
export const notifications = (page: Page) => page.evaluate(() => (window as unknown as { __notes: string[] }).__notes);
export const vibrations = (page: Page) => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations.length);

/** Chooses a place through the search screen, the way a rider types it. */
export async function choosePlace(page: Page, field: 'From' | 'To', typed: string, pick: string) {
  await page.getByRole('button', { name: new RegExp(`^${field}:`) }).click();
  await page.getByRole('searchbox', { name: 'Search for a stop or landmark' }).fill(typed);
  await page.getByRole('list', { name: 'Matching places' }).getByRole('button').filter({ hasText: pick }).first().click();
}

export function positionOn(net: PreparedNetwork, patternId: string, along: number) {
  const pp = net.patterns.get(patternId);
  if (!pp) throw new Error(`No pattern ${patternId}`);
  return pointAlong(pp.line, along);
}

export function stopAlong(net: PreparedNetwork, patternId: string, stopId: string): number {
  const pp = net.patterns.get(patternId);
  if (!pp) throw new Error(`No pattern ${patternId}`);
  return pp.stopAlong[pp.pattern.stopIds.indexOf(stopId)];
}

export async function setPosition(context: BrowserContext, p: { lat: number; lng: number }, accuracy = 10) {
  await context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy });
}

export async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

/** A JSON API call, with a sign-in key or the admin token; a refusal fails the test with the server's words. */
export async function call<T = Record<string, unknown>>(base: string, method: string, p: string, body?: unknown, key?: string): Promise<T> {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${data.error ?? ''}`);
  return data;
}

/**
 * A conductor signed in, the way it happens on /signin: the admin adds their owner, who chooses a
 * password and adds the bus; the conductor signs up with the owner's number and the owner approves
 * them. The conductor's key shares that bus (tools/simulate.ts `conductor`).
 */
export async function conductorAccount(
  base: string,
  opts: { owner: string; ownerPhone: string; name: string; phone: string; plate: string },
): Promise<{ key: string; plate: string; ownerKey: string }> {
  const made = await call<{ password: string }>(base, 'POST', '/api/admin/owners', { name: opts.owner, phone: opts.ownerPhone }, ADMIN_TOKEN);
  const first = await call<{ changeToken: string }>(base, 'POST', '/api/accounts/sign-in', { phone: opts.ownerPhone, password: made.password });
  const { key: ownerKey } = await call<{ key: string }>(base, 'POST', '/api/accounts/password', { changeToken: first.changeToken, password: 'Owner-pass-2026' });
  await call(base, 'POST', '/api/owner/buses', { plate: opts.plate }, ownerKey);
  const conductor = await call<{ id: string }>(base, 'POST', '/api/accounts/sign-up', { kind: 'conductor', name: opts.name, phone: opts.phone, password: 'Conductor-2026', ownerPhone: opts.ownerPhone });
  await call(base, 'POST', `/api/owner/people/${conductor.id}/approve`, {}, ownerKey);
  const { key } = await call<{ key: string }>(base, 'POST', '/api/accounts/sign-in', { phone: opts.phone, password: 'Conductor-2026' });
  return { key, plate: opts.plate, ownerKey };
}
