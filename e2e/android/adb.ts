import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// A thin driver for an Android emulator or phone over adb: read the screen with uiautomator,
// tap, type, move the GPS, and look at notifications and services. No Appium, nothing to install
// beyond the Android SDK's platform-tools.

const SDK = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '';
const ADB = SDK ? path.join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';

export function adb(...args: string[]): string {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function adbBuffer(...args: string[]): Buffer {
  return execFileSync(ADB, args, { maxBuffer: 64 * 1024 * 1024 });
}

export const shell = (cmd: string) => adb('shell', cmd);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type UiNode = { text: string; desc: string; id: string; cls: string; pkg: string; checked: boolean; x: number; y: number; bounds: number[] };

const attr = (s: string, name: string) => {
  const m = new RegExp(` ${name}="([^"]*)"`).exec(s);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
};

/** Everything on screen, from a uiautomator dump. */
export function screen(): UiNode[] {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      shell('uiautomator dump /sdcard/wimb-ui.xml >/dev/null 2>&1');
      const xml = adb('exec-out', 'cat', '/sdcard/wimb-ui.xml');
      return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
        const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(n);
        const bounds = b ? b.slice(1).map(Number) : [0, 0, 0, 0];
        return {
          text: attr(n, 'text'),
          desc: attr(n, 'content-desc'),
          id: attr(n, 'resource-id'),
          cls: attr(n, 'class'),
          pkg: attr(n, 'package'),
          checked: attr(n, 'checked') === 'true',
          bounds,
          x: Math.round((bounds[0] + bounds[2]) / 2),
          y: Math.round((bounds[1] + bounds[3]) / 2),
        };
      });
    } catch {
      // The screen was changing while it was dumped; try again.
    }
  }
  return [];
}

export type Match = string | RegExp | ((n: UiNode) => boolean);

function matches(n: UiNode, m: Match): boolean {
  if (typeof m === 'function') return m(n);
  if (typeof m === 'string') return n.text === m || n.desc === m;
  return m.test(n.text) || m.test(n.desc);
}

export const find = (m: Match, nodes = screen()) => nodes.find((n) => matches(n, m) && n.bounds[2] > n.bounds[0]);

/**
 * A slow emulator often shows "Google Play services isn't responding" while it settles. That is
 * the system, not the app under test: answer "Wait" and carry on.
 */
function dismissSystemDialogs(nodes: UiNode[]): boolean {
  if (!nodes.some((n) => /isn.t responding/.test(n.text))) return false;
  const wait = nodes.find((n) => n.text === 'Wait');
  if (wait) tapAt(wait.x, wait.y);
  return true;
}

export async function waitFor(m: Match, timeoutMs = 20_000, what = String(m)): Promise<UiNode> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const nodes = screen();
    if (dismissSystemDialogs(nodes)) {
      await sleep(800);
      continue;
    }
    const n = find(m, nodes);
    if (n) return n;
    if (Date.now() > end) {
      const seen = screen().map((x) => x.text || x.desc).filter(Boolean).slice(0, 40).join(' | ');
      throw new Error(`Timed out waiting for ${what}. On screen: ${seen}`);
    }
    await sleep(700);
  }
}

/** Waits until nothing on screen matches any more. */
export async function waitGone(m: Match, timeoutMs = 20_000, what = String(m)) {
  const end = Date.now() + timeoutMs;
  while (find(m)) {
    if (Date.now() > end) throw new Error(`Still on screen after ${timeoutMs / 1000} s: ${what}`);
    await sleep(700);
  }
}

export const tapAt = (x: number, y: number) => shell(`input tap ${x} ${y}`);

export async function tap(m: Match, timeoutMs = 20_000): Promise<UiNode> {
  const n = await waitFor(m, timeoutMs);
  tapAt(n.x, n.y);
  await sleep(600);
  return n;
}

/** Types ASCII text into the focused field (adb cannot type other scripts). */
export function type(text: string) {
  shell(`input text '${text.replace(/ /g, '%s').replace(/'/g, '')}'`);
}

export const key = (name: string) => shell(`input keyevent ${name}`);

/** Closes the on-screen keyboard if it is open; Back would otherwise leave the screen. */
export async function hideKeyboard() {
  if (/mInputShown=true|isInputViewShown=true/.test(shell('dumpsys input_method'))) {
    key('KEYCODE_BACK');
    await sleep(500);
  }
}

/** Scrolls the screen up until something is visible. */
export async function scrollTo(m: Match, tries = 6): Promise<UiNode> {
  for (let i = 0; i < tries; i++) {
    const n = find(m);
    if (n) return n;
    shell('input swipe 540 1700 540 900 300');
    await sleep(800);
  }
  return waitFor(m, 5_000);
}

let emulator: boolean | undefined;
/** Whether the device is an emulator rather than a real phone. */
export function isEmulator(): boolean {
  emulator ??= shell('getprop ro.kernel.qemu').trim() === '1' || /ranchu|goldfish|emulator|sdk_gphone/i.test(shell('getprop ro.hardware') + shell('getprop ro.product.model'));
  return emulator;
}

const TEST_PROVIDERS = ['gps', 'network'];
let testProviders = false;

/**
 * Moves the device's location. An emulator's GPS moves with adb emu (longitude first). A real
 * phone's cannot: there the shell becomes a mock location app and feeds Android's GPS and network
 * providers test positions instead (Android 12 or later). Those come marked as simulated, so the
 * test's server must take them (acceptMockLocations).
 */
export function gps(p: { lat: number; lng: number }) {
  if (isEmulator()) {
    adb('emu', 'geo', 'fix', String(p.lng), String(p.lat));
    return;
  }
  if (!testProviders) {
    shell('appops set com.android.shell android:mock_location allow');
    for (const name of TEST_PROVIDERS) {
      shell(`cmd location providers add-test-provider ${name} --supportsSpeed --supportsBearing`);
      shell(`cmd location providers set-test-provider-enabled ${name} true`);
    }
    testProviders = true;
  }
  setTestLocation(p);
  // A test position that is not sent again goes stale, and the phone falls back to where it really
  // is (an emulator's stays put): it is sent again every second until the next one.
  lastFix = p;
  keepAlive ??= setInterval(() => {
    if (lastFix) setTestLocation(lastFix);
  }, 1000);
  keepAlive.unref();
}

let lastFix: { lat: number; lng: number } | null = null;
let keepAlive: ReturnType<typeof setInterval> | null = null;

function setTestLocation(p: { lat: number; lng: number }) {
  for (const name of TEST_PROVIDERS) shell(`cmd location providers set-test-provider-location ${name} --location ${p.lat},${p.lng} --accuracy 5`);
}

/**
 * Whether this test can move the device's location: always on an emulator; on a real phone only
 * if it lets the shell feed test locations (some, such as Realme and Oppo, refuse unless
 * "Disable permission monitoring" is on in Developer options).
 */
export function canMoveLocation(): boolean {
  if (isEmulator()) return true;
  try {
    shell('appops set com.android.shell android:mock_location allow');
    return true;
  } catch {
    return false;
  }
}

/** Gives a real phone its own location back. */
export function realGps() {
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
  lastFix = null;
  if (!testProviders) return;
  for (const name of TEST_PROVIDERS) {
    try {
      shell(`cmd location providers remove-test-provider ${name}`);
    } catch {
      // Already gone.
    }
  }
  shell('appops set com.android.shell android:mock_location deny');
  testProviders = false;
}

export function screenshot(dir: string, name: string) {
  if (dir) writeFileSync(path.join(dir, `${name}.png`), adbBuffer('exec-out', 'screencap', '-p'));
}

export const notifications = () => shell('dumpsys notification --noredact');
export const services = (pkg: string) => shell(`dumpsys activity services ${pkg}`);
