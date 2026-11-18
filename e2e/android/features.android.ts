import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { serveForPhone } from './serve.ts';
import { startSimulation } from '../../tools/simulate.ts';
import { pointAlong, prepareNetwork, type Arrival, type Network, type VehicleView } from '../../packages/core/src/index.ts';
import { apiAt, brightnessAt, fetchRetry, PASSWORD } from './accounts.ts';
import { adb, adbBuffer, canMoveLocation, find, gps, hideKeyboard, isEmulator, key, realGps, screen, screenshot, scrollTo, shell, sleep, tap, tapAt, type, waitFor, waitGone } from './adb.ts';

// The rest of the Android app end to end, beside app.android.ts: working offline, Bengali,
// "Use my location", recent places, picking on the map, telling others a bus just left,
// suggesting a fix, the stop alarm without sharing, the link to follow a bus, and the conductor
// code the phone remembers. Same setup as app.android.ts (an emulator or a real phone on USB, the
// debug app installed, Metro running, port 8080 free); on a real phone the test moves its location.
// Run: node --test e2e/android/features.android.ts   (E2E_SCREENSHOTS=<folder> keeps screenshots)

const PKG = 'com.whereismybus';
const ADMIN = 'x';
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';
const base = 'http://127.0.0.1:8080';
const demo = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/demo-network.json', import.meta.url)), 'utf8')) as Network;
const net = prepareNetwork(demo);
const d2 = net.patterns.get('D2-UP')!;
const esplanade = pointAlong(d2.line, d2.stopAlong[d2.pattern.stopIds.indexOf('esplanade')]);
let close: () => Promise<void>;

const getJson = async <T>(p: string, auth = '') =>
  (await (await fetchRetry(base + p, { headers: auth ? { authorization: `Bearer ${auth}` } : {} })).json()) as T;
const vehicles = async () => (await getJson<{ vehicles: VehicleView[] }>('/api/patterns/D2-UP/vehicles')).vehicles;

function freshApp() {
  try {
    shell(`pm clear ${PKG}`);
    return;
  } catch {
    // Refused by the phone (see app.android.ts): reinstall instead.
  }
  const apk = process.env.WIMB_APK ?? fileURLToPath(new URL('../../mobile/android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url));
  assert.ok(existsSync(apk), `No ${apk} to install again. Build it (mobile/README.md) or set WIMB_APK.`);
  adb('uninstall', PKG);
  adb('install', apk);
}

const launch = () => {
  shell(`am force-stop ${PKG}`);
  shell(`am start -n ${PKG}/.MainActivity`);
};

before(async () => {
  assert.match(adb('devices'), /\tdevice/, 'an emulator or phone must be connected');
  assert.ok(canMoveLocation(), 'these tests move the location: on Realme and Oppo phones turn on "Disable permission monitoring" in Developer options');
  const s = await serveForPhone({
    port: 8080,
    host: '127.0.0.1',
    dataFile: path.join(mkdtempSync(path.join(tmpdir(), 'wimb-android-')), 'network.json'),
    adminToken: 'x',
    quiet: true,
    acceptMockLocations: !isEmulator(),
  });
  close = s.close;
  // The app finds the server at localhost:8080 on the phone (the offline test takes this away for a while).
  adb('reverse', 'tcp:8080', 'tcp:8080');
  freshApp();
  shell('logcat -c');
  gps(esplanade);
});

after(async () => {
  shell(`am force-stop ${PKG}`);
  realGps();
  adb('reverse', 'tcp:8080', 'tcp:8080');
  await close?.();
});

async function choose(field: 'From' | 'To', typed: string, pick: string) {
  await tap(new RegExp(`^${field}: `));
  const box = await waitFor('Search for a stop or landmark');
  for (let attempt = 0; attempt < 3; attempt++) {
    tapAt(box.x, box.y);
    await sleep(800);
    type(typed);
    if (await waitFor((n) => n.text === typed, 4_000).then(() => true, () => false)) break;
  }
  await tap((n) => n.text === pick && n.y > 300, 15_000);
}

/** Back on the plan screen, whatever screen a test before ended on; the app started if it is not open. */
async function home() {
  if (!screen().some((n) => n.pkg === PKG)) {
    shell(`am start -n ${PKG}/.MainActivity`);
    await waitFor('Where Is My Bus', 90_000);
  }
  for (let i = 0; i < 6 && !find('Where Is My Bus'); i++) {
    const back = find('Back');
    if (back) tapAt(back.x, back.y);
    else key('KEYCODE_BACK');
    await sleep(900);
  }
  await waitFor('Where Is My Bus', 15_000);
}

/** The journey Esplanade to Park Street, opened, from wherever the app is. */
async function openJourney() {
  await home();
  if (!find('From: Esplanade')) await choose('From', 'dharmatala', 'Esplanade');
  if (!find('To: Park Street')) await choose('To', 'park', 'Park Street');
  await waitFor('Route D2', 20_000);
  await tap(/^\d+ min$/);
  await waitFor(/^Take whichever comes first$|^Bus D2 towards /, 20_000);
}

/** On the journey's screen, opening it if a test before ended elsewhere. */
async function onJourney() {
  if (!find(/Did one just leave Esplanade|Which bus did you get on\?|^I'm on this bus$/)) await openJourney();
}

/** From the journey: "I'm on this bus", D2. */
async function startPanel() {
  await tap("I'm on this bus", 20_000);
  const which = await waitFor('Which bus did you get on?');
  await tap((n) => n.desc === 'Route D2' && n.y > which.y);
}

/** Scrolls to something below and taps it. */
async function tapOn(m: Parameters<typeof scrollTo>[0]) {
  const n = await scrollTo(m);
  tapAt(n.x, n.y);
  await sleep(600);
}

async function endTripAndGoBack() {
  await tap('End trip');
  await waitFor('You ended the trip.', 20_000);
  await tap('Back');
}

test('without the server, the app plans with the routes built into it; with it, it is online again', async () => {
  // The server cannot be reached: no forwarding of port 8080 yet.
  try {
    adb('reverse', '--remove', 'tcp:8080');
  } catch {
    // Not forwarded.
  }
  launch();
  await waitFor('Where Is My Bus', 90_000);
  await waitFor('Offline. Using the routes built into the app.', 30_000);
  await choose('From', 'dharmatala', 'Esplanade');
  await choose('To', 'park', 'Park Street');
  await waitFor('Route D2', 20_000);
  screenshot(SHOTS, 'features-offline');
  adb('reverse', 'tcp:8080', 'tcp:8080');
  launch();
  await waitFor('Where Is My Bus', 60_000);
  await waitFor('Route D2', 30_000);
  await waitGone(/^Offline\./, 30_000, 'the offline notice');
  await waitFor('Live times refresh every 20 seconds.', 30_000);
});

test('the app switches to Bengali and back, from the settings', async () => {
  await home();
  await tap((n) => n.desc === 'Settings and account', 15_000);
  await tap('বাংলা', 15_000);
  try {
    await waitGone('Theme', 15_000, 'the English heading');
    await waitFor('থিম', 15_000);
    // The phone's own Back: the app's button now says "ফিরে যান".
    key('KEYCODE_BACK');
    await waitFor('কলকাতায় কোন বাস ধরবেন, আর সেটা কখন আসবে', 15_000);
    assert.equal(find('Which bus to take in Kolkata, and when it comes'), undefined, 'the English subtitle is gone');
    screenshot(SHOTS, 'features-bengali');
    await tap((n) => n.desc === 'সেটিংস ও অ্যাকাউন্ট', 15_000);
  } finally {
    // Back to English whatever happened, so the tests after this one read the screens they expect.
    await tap('English', 15_000);
  }
  await waitFor('Theme', 15_000);
  key('KEYCODE_BACK');
  await waitFor('Which bus to take in Kolkata, and when it comes', 15_000);
});

test('"Use my location" with precise location allowed starts from where the phone is', async () => {
  await tap(/^From: /);
  await tap('Use my location');
  await tap(/^While using the app$/, 15_000);
  await waitFor('From: Your location', 30_000);
  screenshot(SHOTS, 'features-my-location');
});

test('recent places come back to choose again', async () => {
  await tap(/^From: /);
  await waitFor('Recent places');
  await tap((n) => n.text === 'Esplanade' && n.y > 300);
  await waitFor('From: Esplanade', 15_000);
});

test('a place picked on the map, with the stops nearest to it', async () => {
  await tap(/^To: /);
  await tap('Pick on the map');
  // (uiautomator gives the hint under the map no size, so the map itself is waited for.)
  const map = await waitFor((n) => n.desc === 'Google Map', 15_000, 'the map');
  await sleep(1500);
  tapAt(map.x, map.y);
  await waitFor('Nearest stops', 15_000);
  // A stop to choose from, with how far it is. (Without a Maps API key in the build the map stays
  // blank and need not be over Kolkata, so the distances can be large; the choosing still works.)
  assert.ok(find(/^\d+(\.\d+)? k?m$/), 'nearest stops show their distance');
  screenshot(SHOTS, 'features-map-pick');
  await tap('Use this spot');
  await waitFor('To: Pinned place', 15_000);
  // Back to Park Street, from the recent places.
  await tap(/^To: /);
  await waitFor('Recent places');
  await tap((n) => n.text === 'Park Street' && n.y > 300);
  await waitFor('To: Park Street', 15_000);
});

test('telling others a bus just left: agreed with another rider, then shown further along', async () => {
  // Another rider already said D2 left Esplanade.
  const other = await fetch(`${base}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patternId: 'D2-UP', stopId: 'esplanade', device: 'another-phone' }),
  });
  assert.equal(other.status, 200);
  await openJourney();
  await tapOn('Did one just leave Esplanade? Tell others');
  await tap((n) => n.desc === 'D2 just left Esplanade');
  await waitFor('Thank you. Another rider saw it too, so people further along now see it.', 15_000);
  screenshot(SHOTS, 'features-report');
  await tapOn('Did one just leave Esplanade? Tell others');
  await tap((n) => n.desc === 'D2 just left Esplanade');
  await waitFor('You already said so. Thank you.', 15_000);
  const at = await getJson<{ arrivals: Record<string, Arrival[]> }>('/api/arrivals?stops=park-street');
  assert.ok(at.arrivals['park-street'].some((a) => a.patternId === 'D2-UP' && a.reported), 'the server shows the bus riders saw at Park Street');
});

test('a suggested fix reaches the admins', async () => {
  await onJourney();
  await tapOn('Something wrong with this journey? Suggest a fix');
  await waitFor('What is it about?', 15_000);
  await tap('Times');
  const box = await waitFor((n) => n.desc === 'What should we fix?' || /For example: the last D2/.test(n.text));
  tapAt(box.x, box.y);
  await sleep(600);
  type('The last D2 is later now');
  await hideKeyboard();
  await tap('Send');
  await waitFor('Thank you. The people who keep the routes right will look at it.', 15_000);
  screenshot(SHOTS, 'features-suggest');
  const { corrections } = await getJson<{ corrections: { kind: string; text: string; routeId?: string; stopId?: string }[] }>('/api/admin/corrections', 'x');
  const sent = corrections.find((c) => c.text === 'The last D2 is later now');
  assert.ok(sent, 'the admins see the suggestion');
  assert.equal(sent.kind, 'times');
  assert.equal(sent.stopId, 'esplanade');
  await tap('Back');
  await waitFor(/Did one just leave Esplanade/, 15_000);
});

test('the stop alarm alone: a trip that shares nothing', { timeout: 120_000 }, async () => {
  await onJourney();
  await startPanel();
  const toggle = await scrollTo((n) => n.desc === 'Share where this bus is' && /Switch/.test(n.cls));
  tapAt(toggle.x, toggle.y);
  await sleep(500);
  await tapOn('Start stop alarm');
  await waitFor('Bus D2', 30_000);
  await waitFor('Not sharing. Only the stop alarm is on.', 15_000);
  await waitFor(/^The alarm rings about 800 m before Park Street\.$/, 15_000);
  screenshot(SHOTS, 'features-alarm-only');
  for (let i = 0; i < 3; i++) {
    gps(esplanade);
    await sleep(2000);
  }
  assert.equal((await vehicles()).length, 0, 'the server sees no bus');
  await endTripAndGoBack();
});

test('a rider shares a link to follow the bus, and the link shows the bus', { timeout: 180_000 }, async () => {
  const start = d2.stopAlong[d2.pattern.stopIds.indexOf('esplanade')];
  gps(esplanade);
  await onJourney();
  const panel = await waitFor((n) => n.text === "I'm on this bus" || n.text === 'Which bus did you get on?', 20_000);
  if (panel.text === "I'm on this bus") await startPanel();
  else await tap((n) => n.desc === 'Route D2' && n.y > panel.y);
  // Sharing is on again for a new trip.
  if (await waitFor('Start stop alarm', 3_000).then(() => true, () => false)) {
    const toggle = await scrollTo((n) => n.desc === 'Share where this bus is' && /Switch/.test(n.cls));
    tapAt(toggle.x, toggle.y);
    await sleep(500);
  }
  await tapOn('Start trip and share');
  await waitFor('Bus D2', 30_000);
  // The server takes the trip once the bus moves along the route.
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !(await vehicles()).length) {
    gps(pointAlong(d2.line, start + ((Date.now() - t0) / 1000) * 5));
    await sleep(1500);
  }
  assert.equal((await vehicles()).length, 1, 'the server sees the shared bus');
  await tap('Share a link to follow this bus', 30_000);
  // The share sheet shows the message with the link.
  const shown = await waitFor((n) => /\/follow\/[\w-]{10,}/.test(n.text) || n.pkg !== PKG, 15_000, 'the share sheet');
  screenshot(SHOTS, 'features-follow-share');
  const token = screen().map((n) => /\/follow\/([\w-]{10,})/.exec(n.text)?.[1]).find(Boolean);
  key('KEYCODE_BACK');
  await sleep(800);
  if (token) {
    const view = await getJson<{ routeNumber: string; ended: boolean; bus: unknown }>(`/api/follow/${token}`);
    assert.equal(view.routeNumber, 'D2');
    assert.equal(view.ended, false);
  } else {
    assert.ok(shown.pkg !== PKG, 'a share sheet opened (its preview did not show the link to check it on the server)');
  }
  await endTripAndGoBack();
});

/** Taps the lowest of the things on screen with this text: the form's button, below a tab of the same name. */
async function tapLast(text: string) {
  await waitFor(text, 15_000);
  const all = screen().filter((n) => n.text === text && n.bounds[2] > n.bounds[0]);
  const last = all.reduce((a, b) => (b.y > a.y ? b : a));
  tapAt(last.x, last.y);
  await sleep(600);
}

/** Types into the field labelled `label` on screen, after tapping it and clearing what was there. */
async function fill(label: string, text: string) {
  const f = await scrollTo((n) => n.desc === label);
  tapAt(f.x, f.y);
  await sleep(500);
  shell(`input keyevent KEYCODE_MOVE_END ${Array(40).fill('KEYCODE_DEL').join(' ')}`);
  type(text);
  await hideKeyboard();
}

/** The settings and account screen, from the home screen's menu. */
async function openSettings() {
  await home();
  await tap((n) => n.desc === 'Settings and account', 15_000);
  await waitFor('Theme', 15_000);
}

test('a rider who gets on a conductor’s bus is put on it by where they are, and told so', { timeout: 240_000 }, async () => {
  // A conductor signed in shares their owner's bus on D2 from Esplanade; the rider is next to it.
  const api = apiAt(base, ADMIN);
  const owner = await api.ownerWithBus('Proximity Buses', '9830099001', 'WB 19 F 4321');
  const conductor = await api.conductor(owner, 'Hari Das', '9830099002');
  const started = await api.call<{ sessionId: string; role: string }>('POST', '/api/trips', { patternId: 'D2-UP', role: 'conductor', plate: owner.plate }, conductor.key);
  assert.equal(started.body.role, 'conductor');
  const from = d2.stopAlong[d2.pattern.stopIds.indexOf('esplanade')];
  let along = from;
  const t0 = Date.now();
  let conductorSentAt = 0;
  /** Both phones move along together: the conductor's through the API, the rider's GPS. */
  const step = async () => {
    along = from + ((Date.now() - t0) / 1000) * 3;
    gps(pointAlong(d2.line, along));
    if (Date.now() - conductorSentAt >= 5_000) {
      conductorSentAt = Date.now();
      await api.call('POST', `/api/trips/${started.body.sessionId}/pings`, { pings: [{ ...pointAlong(d2.line, along + 8), accuracy: 6, ts: Date.now() }] }, conductor.key);
    }
  };
  await step();

  // The rider starts sharing: nothing to type about the bus.
  await openJourney();
  await startPanel();
  await tapOn('Start trip and share');
  await waitFor('Bus D2', 30_000);
  let told = false;
  while (Date.now() - t0 < 150_000) {
    await step();
    if (find(/^You are on the bus its conductor is sharing/)) {
      told = true;
      break;
    }
    await sleep(1000);
  }
  assert.ok(told, 'the rider is told they are on the conductor’s bus');
  await waitFor('You are on the bus its conductor is sharing (number plate ending 4321).');
  screenshot(SHOTS, 'features-rider-on-conductor-bus');
  const buses = await vehicles();
  assert.deepEqual(buses.map((v) => [v.source, v.riders]), [['conductor', 2]], 'one bus: the conductor and the rider together');
  await endTripAndGoBack();
  await api.call('POST', `/api/trips/${started.body.sessionId}/end`, undefined, conductor.key);
});

test('the theme: dark, light, or as the phone is set, kept by the app', { timeout: 120_000 }, async () => {
  await openSettings();
  const shade = () => brightnessAt(adbBuffer('exec-out', 'screencap', '-p'), 540, 2200);
  // The theme is under the language: further down the screen.
  await tapOn('Dark');
  await sleep(1200);
  const dark = shade();
  screenshot(SHOTS, 'features-theme-dark');
  await tapOn('Light');
  await sleep(1200);
  const light = shade();
  screenshot(SHOTS, 'features-theme-light');
  assert.ok(dark < 80 && light > 170, `dark ${dark}, light ${light}`);
  // Kept when the app starts again.
  shell(`am force-stop ${PKG}`);
  shell(`am start -n ${PKG}/.MainActivity`);
  await waitFor('Where Is My Bus', 60_000);
  await sleep(1500);
  assert.ok(shade() > 170, 'still light after a restart');
  await openSettings();
  await tapOn('Same as the phone');
  await tap('Back');
});

test('a conductor signs up in the app, their owner approves, and they share the bus by its plate', { timeout: 480_000 }, async () => {
  const api = apiAt(base, ADMIN);
  const owner = await api.ownerWithBus('Sen Transport', '9830077881', 'WB 19 A 1234');
  await openSettings();
  await tap('Sign up as a conductor');
  await waitFor('Your bus owner’s mobile number', 15_000);
  await fill('Your name', 'Ratan Das');
  await fill('Mobile number', '9830077882');
  await fill('Your bus owner’s mobile number', owner.phone);
  await fill('Password', PASSWORD);
  await tapOn((n) => n.text === 'Sign up');
  await waitFor(/^Done\. Sen Transport approves you in their dashboard/, 20_000);
  screenshot(SHOTS, 'features-conductor-signed-up');
  // Not before the owner approves.
  await tapLast('Sign in');
  await fill('Mobile number', '9830077882');
  await fill('Password', PASSWORD);
  await tapLast('Sign in');
  await waitFor(/^Your account is waiting for your bus owner to approve it/, 15_000);
  await api.approveConductor(owner.key, await api.waitingPerson(owner.key, 'Ratan Das'));
  await tapLast('Sign in');
  await waitFor('Conductor for Sen Transport', 20_000);
  screenshot(SHOTS, 'features-conductor-account');
  await tap('Back');

  // The journey from Esplanade: only the plate to type, as the conductor.
  gps(esplanade);
  await openJourney();
  await startPanel();
  await scrollTo('Signed in as Ratan Das, for Sen Transport');
  await fill('Number plate of the bus', 'WB 19 A 1234');
  await tapOn('Start trip and share');
  await waitFor('Bus D2', 30_000);
  await waitFor(/^Sharing bus WB 19 A 1234 as the conductor\./, 30_000);
  screenshot(SHOTS, 'features-conductor-trip');
  await endTripAndGoBack();

  // A plate that is not the owner's is refused, and said so.
  const panel = await waitFor((n) => n.text === "I'm on this bus" || n.text === 'Which bus did you get on?', 20_000);
  if (panel.text === "I'm on this bus") await startPanel();
  await fill('Number plate of the bus', 'WB 99 Z 9999');
  await tapOn('Start trip and share');
  await waitFor(/^None of Sen Transport’s buses has the number plate/, 20_000);

  // Signing out: a rider again.
  await openSettings();
  await tap('Sign out');
  await waitFor('Sign up as a conductor', 15_000);
  await tap('Back');
});

test('a contributor the team approved records a route with named stops, and the team gets it', { timeout: 480_000 }, async () => {
  const api = apiAt(base, ADMIN);
  await openSettings();
  await tap('Become a contributor');
  await waitFor('Your name', 15_000);
  await fill('Your name', 'Asha Roy');
  await fill('Mobile number', '9830088991');
  await fill('Password', PASSWORD);
  await tapOn((n) => n.text === 'Sign up');
  await waitFor(/^Done\. The Where Is My Bus team checks new contributors/, 20_000);
  const list = await api.call<{ contributors: { id: string; name: string }[] }>('GET', '/api/admin/contributors', undefined, ADMIN);
  const asha = list.body.contributors.find((x) => x.name === 'Asha Roy');
  assert.ok(asha, 'the admins see the contributor waiting');
  assert.equal((await api.call('POST', `/api/admin/contributors/${asha.id}/approve`, undefined, ADMIN)).status, 200);
  await tapLast('Sign in');
  await fill('Mobile number', '9830088991');
  await fill('Password', PASSWORD);
  await tapLast('Sign in');
  await waitFor('Asha Roy', 20_000);
  await tap('Record a route');

  // On D2 from Esplanade: start, ride, "Stop here" at Park Street with its name, then one more stop.
  const d2Start = d2.stopAlong[d2.pattern.stopIds.indexOf('esplanade')];
  const parkStreet = d2.stopAlong[d2.pattern.stopIds.indexOf('park-street')];
  gps(esplanade);
  await fill('Which route and direction?', 'D2 towards Garia');
  await tapOn('Start recording');
  // Location, if no test before asked for it.
  if (await waitFor(/^While using the app$/, 6_000).then(() => true, () => false)) await tap(/^While using the app$/);
  await waitFor('Recording a route', 20_000);
  await waitFor(/^\d+ positions sent\.$|^Waiting for your position…$/, 20_000);
  screenshot(SHOTS, 'features-recording');
  const rideTo = async (fromM: number, toM: number) => {
    for (let m = fromM; m <= toM; m += 40) {
      gps(pointAlong(d2.line, m));
      await sleep(1000);
    }
  };
  await rideTo(d2Start, parkStreet);
  await fill('Name of this stop (optional)', 'Park Street crossing');
  await tapOn('Stop here');
  await waitFor('Park Street crossing', 15_000);
  await rideTo(parkStreet, parkStreet + 600);
  await tapOn('Stop here');
  await waitFor('Stop 2', 15_000);
  screenshot(SHOTS, 'features-recording-stops');
  await tapOn('Finish and send to the team');
  await waitFor('Sent to the team', 30_000);
  screenshot(SHOTS, 'features-recording-sent');

  // The team sees who recorded it and the two marked stops, one with its name.
  const recs = await api.call<{ recordings: { id: string; by?: { name: string }; marks: number }[] }>('GET', '/api/admin/recordings', undefined, ADMIN);
  const mine = recs.body.recordings.find((r) => r.by?.name === 'Asha Roy');
  assert.ok(mine, 'the recording is in the admin panel');
  assert.equal(mine.marks, 2);
  const detail = await api.call<{ recording: { halts: { marked?: boolean; name?: string }[]; pointCount: number } }>('GET', `/api/admin/recordings/${mine.id}`, undefined, ADMIN);
  assert.ok(detail.body.recording.pointCount > 10, `positions recorded: ${detail.body.recording.pointCount}`);
  assert.deepEqual(detail.body.recording.halts.filter((h) => h.marked).map((h) => h.name ?? null), ['Park Street crossing', null]);
  await openSettings();
  await tap('Sign out');
  await tap('Back');
});

test('a route found by its number: where it runs, its stops in order, its buses, both ways', { timeout: 180_000 }, async () => {
  await home();
  await tap('Find a route');
  const box = await waitFor((n) => n.desc === 'Search for a route', 15_000, 'the route search');
  for (let attempt = 0; attempt < 3; attempt++) {
    tapAt(box.x, box.y);
    await sleep(800);
    type('d2');
    if (await waitFor((n) => n.text.toLowerCase() === 'd2', 4_000).then(() => true, () => false)) break;
  }
  // The row for D2, found by its board.
  await tap((n) => n.desc === 'Route D2' && n.y > box.y, 15_000);
  await waitFor((n) => n.text === 'Route D2' && n.y < 300, 15_000, 'the page of route D2');
  await waitFor(/^Runs from .+ to .+$/);
  await waitFor('Which way?');
  screenshot(SHOTS, 'features-route');

  // A conductor's bus on the way it shows: counted, and placed between two stops.
  const api = apiAt(base, ADMIN);
  const owner = await api.ownerWithBus('Route Test Buses', '9830066771', 'WB 19 E 8888');
  const conductor = await api.conductor(owner, 'Gopal Pal', '9830066772');
  const sim = await startSimulation({ url: base, patterns: ['D2-UP'], busesPerPattern: 1, startAlongM: 200, speedMps: 4, conductor: { key: conductor.key, plate: owner.plate }, tickS: 5, sendEveryS: 5 });
  try {
    const up = find((n) => n.text.startsWith('Towards ') && n.text.includes(d2.pattern.headsign));
    if (up) tapAt(up.x, up.y);
    await scrollTo(/^1 bus tracked on this direction right now\.$/, 12);
    await scrollTo(/^Between .+ and .+, seen \d+ s ago$/, 12);
    screenshot(SHOTS, 'features-route-live');
    // Its stops in order, from the first.
    const stops = d2.pattern.stopIds.map((id) => net.stops.get(id)!.name);
    await scrollTo(stops[0]);
    await scrollTo(stops[stops.length - 1], 12);
    // The other way: no bus tracked there.
    shell('input swipe 540 900 540 1900 300');
    shell('input swipe 540 900 540 1900 300');
    await sleep(800);
    const down = await waitFor((n) => n.text.startsWith('Towards ') && !n.text.includes(d2.pattern.headsign), 10_000, 'the other direction');
    tapAt(down.x, down.y);
    await scrollTo('No bus on this direction is being tracked right now.', 12);
  } finally {
    await sim.stop();
  }
  await tap('Back');
  await tap('Back');
  await waitFor('Where Is My Bus');
});

test('a route number typed in the stop search offers the route, and a missing one can be reported', { timeout: 120_000 }, async () => {
  await home();
  await tap(/^From: /);
  const box = await waitFor('Search for a stop or landmark');
  for (let attempt = 0; attempt < 3; attempt++) {
    tapAt(box.x, box.y);
    await sleep(800);
    type('D2');
    if (await waitFor((n) => n.text === 'D2' && n.y < 500, 4_000).then(() => true, () => false)) break;
  }
  await tap((n) => n.desc === 'Route D2' && n.y > box.y, 15_000);
  await waitFor((n) => n.text === 'Route D2' && n.y < 300, 15_000, 'the page of route D2');
  await tap('Back');
  await tap('Back');
  // A route the network does not have.
  await home();
  await tap('Find a route');
  const rbox = await waitFor((n) => n.desc === 'Search for a route', 15_000);
  tapAt(rbox.x, rbox.y);
  await sleep(800);
  type('zz99');
  await waitFor(/^No route matches “zz99”/i, 15_000);
  await tap('Is a route missing? Tell us');
  await waitFor('What is it about?', 15_000);
  await waitFor((n) => /^Missing route: zz99$/i.test(n.text), 10_000, 'the suggestion filled in');
  screenshot(SHOTS, 'features-route-missing');
  await tap('Back');
  await tap('Back');
  await waitFor('Where Is My Bus');
});

test('no crash and no JavaScript error in the log', () => {
  const log = adb('logcat', '-d', '-v', 'brief', 'AndroidRuntime:E', 'ReactNativeJS:E', '*:S');
  assert.doesNotMatch(log, /FATAL EXCEPTION|ReactNativeJS.*Error/, log.slice(0, 2000));
});
