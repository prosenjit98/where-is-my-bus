import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { serveForPhone } from './serve.ts';
import { istNow, pointAlong, prepareNetwork, type Network, type VehicleView } from '../../packages/core/src/index.ts';
import { startSimulation } from '../../tools/simulate.ts';
import { apiAt, fetchRetry } from './accounts.ts';
import { adb, canMoveLocation, find, gps, hideKeyboard, isEmulator, key, notifications, realGps, screen, screenshot, scrollTo, services, shell, sleep, tap, tapAt, type, waitFor } from './adb.ts';

// The Android app end to end, on an emulator or a real phone on USB: its native location module,
// foreground service and notifications, against a real server. Before running:
//   - one emulator or phone is connected: `adb devices` (a phone: USB debugging on, Android 12+)
//   - the debug app is installed (see mobile/README.md), and Metro runs: `cd mobile && npm start`
//   - nothing else listens on port 8080: the debug app looks for the server at localhost:8080,
//     which this test forwards to this computer (adb reverse)
// On a real phone the test moves its location with Android's test location providers (adb.ts),
// and the phone's own location comes back at the end.
// Run: node --test e2e/android/app.android.ts   (E2E_SCREENSHOTS=<folder> keeps screenshots)

const PKG = 'com.whereismybus';
const ADMIN = 'x';
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';
const base = 'http://127.0.0.1:8080';
const demo = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/demo-network.json', import.meta.url)), 'utf8')) as Network;
const net = prepareNetwork(demo);
const d2 = net.patterns.get('D2-UP')!;
const alongOf = (stopId: string) => d2.stopAlong[d2.pattern.stopIds.indexOf(stopId)];
let close: () => Promise<void>;
/** Whether the test can move the device's location (adb.ts canMoveLocation). */
let movable = false;
const CANNOT_MOVE = 'this phone does not let adb set test locations: turn on "Disable permission monitoring" in Developer options (Realme, Oppo), or use an emulator';

/**
 * The app as just installed. Some phones (Realme and Oppo, unless "Disable permission monitoring"
 * is on in Developer options) refuse `pm clear` from adb: there the debug app is installed again,
 * from WIMB_APK or the debug build, which clears its data and permissions just the same.
 */
function freshApp() {
  try {
    shell(`pm clear ${PKG}`);
    return;
  } catch {
    // Refused by the phone: reinstall instead.
  }
  const apk = process.env.WIMB_APK ?? fileURLToPath(new URL('../../mobile/android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url));
  assert.ok(existsSync(apk), `This phone does not let adb clear the app's data, so the test installs it again, but there is no ${apk}. Build it (mobile/README.md) or set WIMB_APK.`);
  adb('uninstall', PKG);
  adb('install', apk);
}

const vehicles = async (patternId: string) =>
  ((await (await fetchRetry(`${base}/api/patterns/${patternId}/vehicles`)).json()) as { vehicles: VehicleView[] }).vehicles;

before(async () => {
  assert.match(adb('devices'), /\tdevice/, 'an emulator or phone must be connected');
  // A real phone's test positions come marked as simulated: this server takes them.
  const s = await serveForPhone({
    port: 8080,
    host: '127.0.0.1',
    dataFile: path.join(mkdtempSync(path.join(tmpdir(), 'wimb-android-')), 'network.json'),
    adminToken: ADMIN,
    quiet: true,
    acceptMockLocations: !isEmulator(),
  });
  close = s.close;
  adb('reverse', 'tcp:8080', 'tcp:8080');
  // A fresh start: no saved places, no permissions granted.
  freshApp();
  shell('logcat -c');
  movable = canMoveLocation();
  if (movable) gps(pointAlong(d2.line, alongOf('esplanade')));
  shell(`am start -n ${PKG}/.MainActivity`);
});

after(async () => {
  shell(`am force-stop ${PKG}`);
  realGps();
  await close?.();
});

async function choose(field: 'From' | 'To', typed: string, pick: string) {
  await tap(new RegExp(`^${field}: `));
  const box = await waitFor('Search for a stop or landmark');
  // A keyboard that is still opening can drop what adb types: check the box, and type again if so.
  for (let attempt = 0; attempt < 3; attempt++) {
    tapAt(box.x, box.y);
    await sleep(800);
    type(typed);
    if (await waitFor((n) => n.text === typed, 4_000).then(() => true, () => false)) break;
  }
  await tap((n) => n.text === pick && n.y > 300, 15_000);
}

let secure: boolean | undefined;
/** Whether the phone has a password, PIN or pattern: then the screen is never switched off by the test. */
function secureLock(): boolean {
  secure ??= /CredentialType:\s*(Password|Pin|Pattern)/i.test(shell('dumpsys lock_settings'));
  return secure;
}

/**
 * Wakes the screen the test switched off. A phone with a PIN, pattern or fingerprint lock locks
 * properly once the screen has been off for a while, and adb cannot unlock that: the test says so.
 */
async function wakeUnlocked() {
  key('KEYCODE_WAKEUP');
  shell('wm dismiss-keyguard');
  await sleep(1500);
  if (/isKeyguardShowing=true/.test(shell('dumpsys window'))) {
    assert.fail('The phone locked with its PIN, pattern or fingerprint while the screen was off, and adb cannot unlock it. Unlock the phone, set Screen lock to None or Swipe while testing (or a longer "Lock after screen off"), and run again.');
  }
}

test('the app starts and plans with the network built into it, then from the server', async () => {
  await waitFor('Where Is My Bus', 90_000);
  await waitFor('Choose where you are starting from.');
  screenshot(SHOTS, 'android-start');
});

test('refusing location keeps search and the map working', async () => {
  await tap(/^From: /);
  await tap('Use my location');
  await tap(/^Don.t allow$/, 15_000);
  await waitFor('Without location, search for your stop or pick it on the map.');
  await waitFor('Pick on the map');
  screenshot(SHOTS, 'android-location-refused');
  // The app's own Back: the system key would first only close the keyboard.
  await tap('Back');
  await waitFor('Where Is My Bus');
});

test('local names find stops, and parallel routes are one option', async () => {
  await choose('From', 'dharmatala', 'Esplanade');
  await choose('To', 'park', 'Park Street');
  await waitFor('Route D2', 20_000);
  const nodes = screen();
  // The app plans by the phone's clock: D1 serves Park Street only from 05:00 to 13:00.
  const { minute } = istNow();
  const offered = minute >= 5 * 60 && minute < 13 * 60 ? ['Route D1', 'Route D2', 'Route D3'] : ['Route D2', 'Route D3'];
  for (const r of offered) assert.ok(find(r, nodes), `${r} offered`);
  assert.ok(find(/^One of these about every \d+ min$/, nodes), 'combined usual wait');
  screenshot(SHOTS, 'android-plan');
});

test('a conductor’s bus coming to the stop becomes the live wait', async () => {
  // D1, D2 and D3 together come about every 3 minutes now, so the bus must be nearer than that to set the wait.
  // Its conductor is signed in, sharing one of their owner's buses.
  const api = apiAt(base, ADMIN);
  const owner = await api.ownerWithBus('Mitra Bus Service', '9830055661', 'WB 19 D 7777');
  const conductor = await api.conductor(owner, 'Kalu Mitra', '9830055662');
  const sim = await startSimulation({ url: base, patterns: ['D2-UP'], busesPerPattern: 1, startAlongM: alongOf('esplanade') - 300, speedMps: 4, conductor: { key: conductor.key, plate: owner.plate }, tickS: 5, sendEveryS: 5 });
  try {
    await waitFor(/^D2 reaches Esplanade in \d+ min$/, 45_000, 'the live D2 wait');
    await waitFor('Live');
    screenshot(SHOTS, 'android-plan-live');
  } finally {
    await sim.stop();
  }
});

test('a trip: foreground service, next stop, alarm, tracking in the background, and the trip ends by itself', { timeout: 420_000 }, async (t) => {
  if (!movable) return t.skip(CANNOT_MOVE);
  await tap(/^\d+ min$/); // the first journey option
  await tap("I'm on this bus", 30_000);
  // The route boards also head the step; the ones to choose from are under the question.
  const which = await waitFor('Which bus did you get on?');
  await tap((n) => n.desc === 'Route D2' && n.y > which.y);
  // Nothing to type about the bus: the server puts the rider on it by where they are.
  assert.equal(find((n) => /number plate/i.test(n.desc) || /number plate/i.test(n.text)), undefined, 'a rider is not asked for the plate');
  const startButton = await scrollTo('Start trip and share');
  tapAt(startButton.x, startButton.y);
  // Location again, now allowed while the app is in use, then notifications for the alarm.
  await tap(/^While using the app$/, 20_000);
  if (await waitFor(/^Allow$/, 8_000).then(() => true, () => false)) await tap(/^Allow$/);
  await waitFor('Bus D2', 30_000);
  await waitFor('Next stop');
  screenshot(SHOTS, 'android-trip');
  assert.match(services(PKG), /TripLocationService/, 'the foreground service runs');
  assert.match(notifications(), /Sharing bus D2/, 'the ongoing trip notification');

  const start = alongOf('esplanade');
  const park = alongOf('park-street');
  const t0 = Date.now();
  let at = start;
  let backgrounded = false;
  let sawShared = false;
  let alongBeforeBackground = 0;
  let movedInBackground = false;
  for (;;) {
    at = start + ((Date.now() - t0) / 1000) * 12; // 12 m/s, timed by the clock
    gps(pointAlong(d2.line, at));
    await sleep(1000);
    const buses = await vehicles('D2-UP');
    if (buses.length === 1 && buses[0].riders === 1) sawShared = true;
    // Halfway to the alarm, put the app in the background and switch the screen off. A phone with
    // a password, PIN or pattern would lock for good with the screen off (adb cannot unlock it), so
    // there the screen stays on and only the app goes to the background.
    if (!backgrounded && at > start + 250) {
      backgrounded = true;
      alongBeforeBackground = buses[0]?.alongM ?? 0;
      key('KEYCODE_HOME');
      if (!secureLock()) key('KEYCODE_SLEEP');
    }
    if (backgrounded && !movedInBackground && buses[0] && buses[0].alongM > alongBeforeBackground + 150) movedInBackground = true;
    if (/Park Street is next/.test(notifications()) && at < park) {
      // The alarm rang; wake the screen to see the trip.
      await wakeUnlocked();
      shell(`am start -n ${PKG}/.MainActivity`);
    }
    if (/Stopped sharing bus D2: you passed Park Street/.test(notifications())) break;
    assert.ok(at < park + 900, 'the trip should have ended after passing Park Street');
  }
  await wakeUnlocked();
  shell(`am start -n ${PKG}/.MainActivity`);
  await waitFor('Trip ended', 20_000);
  await waitFor('You went past your stop, so the trip ended by itself.');
  screenshot(SHOTS, 'android-trip-ended');

  assert.ok(sawShared, 'the server saw the shared bus');
  assert.ok(movedInBackground, 'positions kept coming with the app in the background and the screen off');
  assert.match(notifications(), /Park Street is next/, 'the stop alarm rang');
  await sleep(2000);
  assert.doesNotMatch(services(PKG), /TripLocationService/, 'the foreground service stopped');
  assert.equal((await vehicles('D2-UP')).length, 0, 'sharing stopped with the trip');
});

test('a conductor signs in on the phone and shares their owner’s bus by its plate; the owner sees the trip', { timeout: 300_000 }, async () => {
  // The owner added the bus; their conductor has an account the owner approved.
  const api = apiAt(base, ADMIN);
  const owner = await api.ownerWithBus('Sen Transport', '9830011223', 'WB 19 A 1234');
  const ratan = await api.conductor(owner, 'Ratan Das', '9830011224');
  const overview = async () =>
    (await api.call<{ buses: { now: { state: string } | null }[]; trips: { fromStop: string; running: boolean }[] }>('GET', '/api/owner/overview', undefined, owner.key)).body;

  // Signing in on the phone, from the home screen's menu (the app opened, if a test before left it).
  if (!screen().some((n) => n.pkg === PKG)) {
    await wakeUnlocked();
    shell(`am start -n ${PKG}/.MainActivity`);
    await waitFor('Where Is My Bus', 60_000);
  }
  for (let i = 0; i < 5 && !find('Where Is My Bus'); i++) {
    const back = find('Back');
    if (back) tapAt(back.x, back.y);
    else key('KEYCODE_BACK');
    await sleep(900);
  }
  await tap((n) => n.desc === 'Settings and account', 20_000);
  await tap((n) => n.text === 'Sign in' && n.y > 300);
  const phone = await waitFor((n) => n.desc === 'Mobile number');
  tapAt(phone.x, phone.y);
  await sleep(500);
  type(ratan.phone);
  const pw = await waitFor((n) => n.desc === 'Password');
  tapAt(pw.x, pw.y);
  await sleep(500);
  type('Bus-owner-2026');
  await hideKeyboard();
  // The form's button: below the field, where the "Sign in" tab is above it.
  await tap((n) => n.text === 'Sign in' && n.y > pw.y);
  await waitFor('Ratan Das', 20_000);
  await waitFor('Conductor for Sen Transport');
  screenshot(SHOTS, 'android-conductor-signed-in');
  await tap('Back');

  // On the bus at Esplanade: the journey, "I'm on this bus", and just the number plate.
  const start = alongOf('esplanade');
  gps(pointAlong(d2.line, start));
  await waitFor('Route D2', 20_000);
  await tap(/^\d+ min$/);
  await tap("I'm on this bus", 30_000);
  const which = await waitFor('Which bus did you get on?');
  await tap((n) => n.desc === 'Route D2' && n.y > which.y);
  await scrollTo('Signed in as Ratan Das, for Sen Transport');
  const plate = await scrollTo((n) => n.desc === 'Number plate of the bus');
  tapAt(plate.x, plate.y);
  await sleep(500);
  type('wb19a1234');
  await hideKeyboard();
  const startButton = await scrollTo('Start trip and share');
  tapAt(startButton.x, startButton.y);
  await waitFor('Bus D2', 30_000);
  await waitFor(/^Sharing bus WB 19 A 1234 as the conductor\./, 20_000);
  await waitFor('Sen Transport, its owner, sees where the bus is and the trips it runs.');
  screenshot(SHOTS, 'android-conductor-owned-bus');

  // 420 m at 12 m/s, short of the alarm 800 m before Park Street: the owner sees the bus, then its trip.
  const t0 = Date.now();
  let onRoad = false;
  let trip = false;
  const seen: string[] = [];
  while (Date.now() - t0 < 120_000 && !(onRoad && trip)) {
    const at = start + Math.min(420, ((Date.now() - t0) / 1000) * 12);
    gps(pointAlong(d2.line, at));
    await sleep(1000);
    const o = await overview();
    if (o.buses[0]?.now?.state === 'on_route') onRoad = true;
    if (o.trips.length === 1) trip = true;
    const [v] = await vehicles('D2-UP');
    seen.push(`phone at ${Math.round(at - start)} m, server's bus at ${v ? `${Math.round(v.alongM - start)} m` : 'none'}, ${o.trips.length} trips`);
  }
  assert.ok(onRoad, 'the owner saw the bus on the road');
  assert.ok(trip, `the owner saw its trip; last: ${seen.slice(-6).join('; ')}`);
  await tap('End trip');
  await waitFor('You ended the trip.', 20_000);
  const o = await overview();
  assert.equal(o.buses[0].now, null, 'not sharing any more');
  assert.deepEqual(o.trips.map((t) => [t.fromStop, t.running]), [['Esplanade', false]]);
});

test('no crash and no JavaScript error in the log', () => {
  const log = adb('logcat', '-d', '-v', 'brief', 'AndroidRuntime:E', 'ReactNativeJS:E', '*:S');
  assert.doesNotMatch(log, /FATAL EXCEPTION|ReactNativeJS.*Error/, log.slice(0, 2000));
});
