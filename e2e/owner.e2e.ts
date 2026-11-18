import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { createOtpBook, type SmsSender } from '../backend/src/otp.ts';
import { pointAlong, prepareNetwork, type Network, type PreparedNetwork } from '../packages/core/src/index.ts';
import { ADMIN_TOKEN, call, cspViolations, getJson, launch, phone, positionOn, setPosition, shot, startApp } from './helpers.ts';

// The bus owners' dashboard and signing in on /signin. The admin adds an owner, who signs in with
// a temporary password and chooses their own, and adds a bus; their conductor signs up with the
// owner's number, the owner approves them, and the conductor, signed in, shares the bus by its
// number plate in the web app: it shows up on the owner's page, live and then as a trip.
// Route T1 is added first: three stops 600 m apart, so a whole trip takes a minute. Then the
// sign-ups: an owner, their manager and a syndicate create accounts and sign in once the admin has
// approved them; a contributor signs up, records a route in the phone app (here through its API)
// and the admin checks it; a forgotten password is set again by SMS (sent to the test here).

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
let net: PreparedNetwork;
const texts: { to: string; text: string }[] = [];
const sms: SmsSender = { describe: 'the test', send: async (to, text) => void texts.push({ to, text }) };
const lastCode = () => /\b(\d{6})\b/.exec(texts.at(-1)?.text ?? '')?.[1] ?? '';
const json = { 'content-type': 'application/json' };

const admin = (method: string, p: string, body: unknown) =>
  fetch(app.base + p, { method, headers: { ...json, authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(body) });

async function signIn(page: Page, phoneNumber: string, password: string) {
  await page.getByLabel('Mobile number', { exact: true }).fill(phoneNumber);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function createAccount(page: Page, fields: Record<string, string>, password: string) {
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Choose a password').fill(password);
  await page.getByLabel('Type the password again').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function adminDesk() {
  const desk = await phone(browser, app.base);
  await desk.page.setViewportSize({ width: 1280, height: 800 });
  await desk.page.goto(`${app.base}/admin`);
  await desk.page.getByLabel('Admin token').fill(ADMIN_TOKEN);
  await desk.page.getByRole('button', { name: 'Sign in' }).click();
  await desk.page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  return desk;
}

before(async () => {
  app = await startApp({ sms, otp: createOtpBook({ ttlMs: 600_000, maxTries: 5, resendMs: 0, perHour: 100 }) });
  browser = await launch();
  for (const [id, name, lat] of [['own-a', 'Own A', 22.564], ['own-b', 'Own B', 22.5586], ['own-c', 'Own C', 22.5532]] as const) {
    assert.equal((await admin('PUT', `/api/admin/stops/${id}`, { name, lat, lng: 88.351 })).status, 200);
  }
  const route = {
    number: 'T1',
    operator: 'private',
    firstBus: '00:00',
    lastBus: '23:59',
    defaultHeadwayMin: 10,
    patterns: [
      { id: 'T1-UP', direction: 'UP', headsign: 'Own C', stopIds: ['own-a', 'own-b', 'own-c'] },
      { id: 'T1-DOWN', direction: 'DOWN', headsign: 'Own A', stopIds: ['own-c', 'own-b', 'own-a'] },
    ],
  };
  assert.equal((await admin('PUT', '/api/admin/routes/t1', route)).status, 200);
  net = prepareNetwork(await getJson<Network>(`${app.base}/api/network`));
});

after(async () => {
  await browser?.close();
  await app?.close();
});

test('the rider app’s offline copy never stands in for the owner page', async () => {
  // Owners may ride buses too: the rider app's service worker is then installed for the whole site.
  const { page, context } = await phone(browser, app.base);
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Where Is My Bus' }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  const offline = await page.goto(`${app.base}/owner`).then(() => page.title(), (e: Error) => e.message);
  assert.match(offline, /ERR_INTERNET_DISCONNECTED/, `offline, /owner must not open the rider app (got "${offline}")`);
  const signin = await page.goto(`${app.base}/signin`).then(() => page.title(), (e: Error) => e.message);
  assert.match(signin, /ERR_INTERNET_DISCONNECTED/, `offline, /signin must not open the rider app (got "${signin}")`);
  await context.setOffline(false);
  // Online and not signed in, the owner page sends them to sign in.
  await page.goto(`${app.base}/owner`);
  await page.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/signin');
  await context.close();
});

test('an owner the admin adds signs in with a temporary password, adds a bus, approves their conductor, and sees the conductor’s trip live and then in the day’s trips', { timeout: 300_000 }, async () => {
  // The admin adds the owner with their mobile number, and gets a temporary password to give them.
  const desk = await adminDesk();
  await desk.page.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: /^Bus owners/ }).click();
  await desk.page.getByText('No bus owners yet.').waitFor();
  await desk.page.getByLabel('Owner’s name').fill('Sen Transport');
  await desk.page.getByLabel('Owner’s mobile number').fill('98300 12345');
  await desk.page.getByRole('button', { name: 'Add owner' }).click();
  await desk.page.getByText('Temporary password for Sen Transport').waitFor();
  const temp = await desk.page.getByLabel('Temporary password').inputValue();
  assert.match(temp, /^[a-hjkmnp-z2-9]{10}$/);
  await desk.page.getByRole('heading', { name: '1 bus owner' }).waitFor();
  await desk.page.getByText('+91 98300 12345 · temporary password, not used yet').waitFor();
  await shot(desk.page, 'admin-owners');
  assert.deepEqual(await cspViolations(desk.page), []);
  assert.deepEqual(desk.errors.filter((e) => !/net::/i.test(e)), []);
  await desk.context.close();

  // The owner opens their page on their phone: it sends them to sign in; the temporary password
  // only lets them choose their own.
  const owner = await phone(browser, app.base);
  const op = owner.page;
  await op.goto(`${app.base}/owner`);
  await op.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  await signIn(op, '98300 12345', temp);
  await op.getByRole('heading', { name: 'Choose your own password' }).waitFor();
  await op.getByLabel('New password').fill('Sen-transport-1');
  await op.getByLabel('Type the password again').fill('Sen-transport-1');
  await op.getByRole('button', { name: 'Save and go on' }).click();
  await op.getByRole('heading', { name: 'Your buses' }).waitFor();
  await op.getByText('Sen Transport', { exact: true }).waitFor();
  await op.getByText('Signed in as Sen Transport, with the mobile number ending 2345.').waitFor();
  const key = (await op.evaluate(() => localStorage.getItem('wimb.owner.key'))) ?? '';
  await op.getByRole('heading', { name: 'Add your first bus' }).waitFor();
  await op.getByRole('button', { name: 'Add a bus' }).click();
  await op.getByLabel('Number plate').fill('wb 19 a 1234');
  await op.getByLabel('Your name for it (optional)').fill('Morning T1');
  await op.getByRole('button', { name: 'Add bus' }).click();
  await op.getByText('Added WB 19 A 1234. Your conductors type this plate when they share the bus.').waitFor();
  await op.getByText('Your conductors type this number plate when they start sharing the bus.').waitFor();
  assert.equal(await op.getByText(/conductor code/i).count(), 0, 'no conductor codes any more');
  await shot(op, 'owner-added');
  // Still signed in after a reload.
  await op.reload();
  await op.getByText('WB 19 A 1234', { exact: true }).waitFor();
  await op.getByText('Not sharing now').waitFor();

  // Their conductor creates an account from the web app's "Share your bus", with the owner's number.
  const length = net.patterns.get('T1-UP')!.line.length;
  const conductor = await phone(browser, app.base, { at: positionOn(net, 'T1-UP', 0) });
  const cp = conductor.page;
  await cp.goto(app.base);
  await cp.getByRole('button', { name: 'Conductor? Share your bus' }).click();
  await cp.getByRole('link', { name: 'Create a conductor account' }).click();
  assert.equal(await cp.getByRole('radio', { name: /^A conductor/ }).isChecked(), true);
  await createAccount(cp, { 'Your name': 'Bikash Mondal', 'Your bus owner’s mobile number': '98300 12345', 'Your mobile number': '98300 13579' }, 'Bikash-bus-26');
  await cp.getByText('Sen Transport approves your account on their page. Ask them to, if they have not yet.').waitFor();
  await shot(cp, 'conductor-signed-up');
  // Until the owner approves, the right password is told the account waits.
  await cp.getByRole('button', { name: 'Back to sign in' }).click();
  await signIn(cp, '98300 13579', 'Bikash-bus-26');
  await cp.getByText(/^Your account is waiting/).waitFor();

  // The owner sees them waiting, and approves them.
  await op.reload();
  const person = op.locator('.person').filter({ hasText: 'Bikash Mondal' });
  await person.getByText('Waiting for approval').waitFor();
  await person.getByText(/^Conductor · signs in with the number ending 3579$/).waitFor();
  await shot(op, 'owner-conductor-waiting');
  await person.getByRole('button', { name: 'Approve' }).click();
  await op.getByText('Approved Bikash Mondal. They can sign in now and share your buses.').waitFor();
  assert.equal(await person.getByText('Waiting for approval').count(), 0);

  // Signed in, the conductor lands on "Share your bus", shares bus T1 by its plate, and is told who sees it.
  await cp.getByRole('button', { name: 'Sign in', exact: true }).click();
  await cp.getByText('Signed in as Bikash Mondal, conductor for Sen Transport.').waitFor();
  await cp.getByRole('searchbox', { name: 'Find your route by number' }).fill('T1');
  await cp.getByRole('button', { name: /Own A – Own C/ }).click();
  await cp.getByRole('radio', { name: /Towards Own C/ }).click();
  await cp.getByText('Shared as its conductor, the bus’s owner sees where it is and the trips it runs.').waitFor();
  await cp.getByRole('textbox', { name: 'The bus’s number plate' }).fill('WB 19 A 1234');
  await cp.getByRole('button', { name: 'Start sharing as conductor' }).click();
  await cp.getByRole('heading', { name: 'Bus T1' }).waitFor();
  await cp.getByText(/^Sharing bus WB 19 A 1234 as the conductor\./).waitFor();
  await cp.getByText('Sen Transport, its owner, sees where the bus is and the trips it runs.').waitFor();
  await shot(cp, 'conductor-owned-bus');

  // Drive the route at 20 m/s. The owner's page updates by itself every 15 seconds.
  const t0 = Date.now();
  let sawLive = false;
  for (;;) {
    const along = Math.min(length, ((Date.now() - t0) / 1000) * 20);
    await setPosition(conductor.context, positionOn(net, 'T1-UP', along));
    await cp.waitForTimeout(700);
    if (!sawLive && (await op.locator('.status-title').filter({ hasText: /^On the road$/ }).count())) {
      sawLive = true;
      assert.match(await op.locator('.status-detail').innerText(), /^T1 towards Own C, next stop Own [BC]\. Updated \d+ s ago\.$/);
      assert.equal(await op.locator('.tile').filter({ hasText: 'On the road' }).locator('.tile-value').innerText(), '1');
      assert.equal(await op.getByText('None of your buses is on the road now.').isVisible(), false);
      await op.locator('.bus-icon').getByRole('img', { name: 'Route T1' }).waitFor();
      await shot(op, 'owner-live');
    }
    if (along >= length) break;
  }
  assert.ok(sawLive, 'the owner saw the bus on the road');
  await cp.getByText('This is Own C').waitFor();
  // Keep reporting from the end of the route until the server has a batch from there.
  const overview = async () =>
    (await (await fetch(`${app.base}/api/owner/overview`, { headers: { authorization: `Bearer ${key}` } })).json()) as {
      trips: { toStop: string }[];
      buses: { now: unknown }[];
    };
  for (let i = 0; i < 40 && (await overview()).trips[0]?.toStop !== 'Own C'; i++) {
    await setPosition(conductor.context, positionOn(net, 'T1-UP', length - (i % 2) * 3));
    await cp.waitForTimeout(700);
  }
  assert.equal((await overview()).trips[0]?.toStop, 'Own C');
  await cp.getByRole('button', { name: 'End trip' }).click();
  await cp.getByText('You ended the trip.').waitFor();
  // The app tells the server in the background; closing the browser waits for the server to know.
  for (let i = 0; i < 40 && (await overview()).buses[0]?.now !== null; i++) await cp.waitForTimeout(250);
  assert.equal((await overview()).buses[0]?.now, null, 'the server ended the trip');
  assert.deepEqual(await cspViolations(cp), []);
  // The 403 is the sign-in tried before the owner approved.
  assert.deepEqual(conductor.errors.filter((e) => !/status of 403/.test(e)), []);
  await conductor.context.close();

  // On the owner's page: not sharing any more, and one trip today, the whole route.
  await op.getByText('Not sharing now').waitFor();
  await op.getByText(/^Today: 1 trip, 1 end to end · 1\.2 km · \d\d:\d\d–\d\d:\d\d$/).waitFor();
  await op.getByText('None of your buses is on the road now.').waitFor();
  assert.equal(await op.locator('.tile').filter({ hasText: 'Trips' }).locator('.tile-value').innerText(), '1');
  await op.locator('summary', { hasText: 'Trips' }).click();
  const trip = op.locator('.trip');
  assert.equal(await trip.count(), 1);
  assert.match(await trip.innerText(), /\d\d:\d\d–\d\d:\d\d\s+T1\s*towards Own C\s*End to end\s+Own A to Own C · 3 of 3 stops · 1\.2 km/);
  assert.deepEqual(await op.locator('table.week tbody tr').first().locator('td').allInnerTexts(), ['1', '1', '1.2']);
  await shot(op, 'owner-trips');
  await op.setViewportSize({ width: 1280, height: 800 });
  await shot(op, 'owner-desktop');
  await op.setViewportSize({ width: 412, height: 860 });

  // The month's trips as a spreadsheet.
  const [download] = await Promise.all([op.waitForEvent('download'), op.getByRole('button', { name: 'Download' }).click()]);
  const csv = readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(csv.length, 2);
  assert.match(csv[1], /^\d{4}-\d\d-\d\d,WB 19 A 1234,Morning T1,T1,Own C,\d\d:\d\d,\d\d:\d\d,\d+,Own A,Own C,3 of 3,1\.2,yes,sharing stopped$/);

  // Signing out ends the key on the server as well as on this phone; a wrong password is refused in plain words.
  await op.getByRole('button', { name: 'Sign out' }).click();
  await op.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  assert.equal(await op.evaluate(() => localStorage.getItem('wimb.owner.key')), null);
  assert.equal((await fetch(`${app.base}/api/owner/overview`, { headers: { authorization: `Bearer ${key}` } })).status, 401);
  await signIn(op, '98300 12345', 'not-the-password');
  await op.getByText('The mobile number or the password is not right.').waitFor();
  assert.equal(await op.getByLabel('Mobile number', { exact: true }).inputValue(), '98300 12345', 'what was typed stays');
  assert.deepEqual(await cspViolations(op), []);
  assert.deepEqual(owner.errors.filter((e) => !/status of 401/.test(e)), []);
  await owner.context.close();
});

test('an owner, their staff and a syndicate sign up on /signin, and sign in only once the admin approves them', { timeout: 300_000 }, async () => {
  // A new owner creates an account with their mobile number and a password.
  const owner = await phone(browser, app.base);
  const op = owner.page;
  await op.goto(`${app.base}/signin`);
  await op.getByRole('tab', { name: 'Create an account' }).click();
  assert.equal(await op.getByRole('radio', { name: /^A bus owner You add/ }).isChecked(), true);
  await createAccount(op, { 'Your name or your company’s name': 'Paul Bus Service', 'Your mobile number': '98300 55555' }, 'Paul-bus-2026');
  await op.getByRole('heading', { name: 'Thank you. Your account is waiting for approval' }).waitFor();
  await op.getByText('The Where Is My Bus team checks every new account, and may call you on the number ending 5555.').waitFor();
  await shot(op, 'signup-done');
  // Until the admin approves it, the right password is told the account waits.
  await op.getByRole('button', { name: 'Back to sign in' }).click();
  await signIn(op, '98300 55555', 'Paul-bus-2026');
  await op.getByText('Your account is waiting for the Where Is My Bus team to approve it. You can sign in once they have.').waitFor();

  // The admin sees the number in full, to call and check, and approves; the nav says how many wait.
  const desk = await adminDesk();
  const dp = desk.page;
  const owners = () => dp.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: /^Bus owners/ });
  await dp.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: 'Bus owners, 1 waiting', exact: true }).waitFor();
  await owners().click();
  const waiting = dp.getByRole('list', { name: 'Waiting for approval' });
  await waiting.getByText(/^\+91 98300 55555 · password set · signed up /).waitFor();
  await shot(dp, 'admin-waiting');
  await waiting.getByRole('button', { name: 'Approve Paul Bus Service' }).click();
  await dp.getByText('Approved Paul Bus Service. They can sign in now, and add their buses.').waitFor();

  await op.getByRole('button', { name: 'Sign in', exact: true }).click();
  await op.getByRole('heading', { name: 'Your buses' }).waitFor();
  await op.getByRole('button', { name: 'Add a bus' }).click();
  await op.getByLabel('Number plate').fill('WB 19 B 5555');
  await op.getByRole('button', { name: 'Add bus' }).click();
  await op.getByText('Added WB 19 B 5555. Your conductors type this plate when they share the bus.').waitFor();

  // Their manager signs up with the owner's number; the owner sees them waiting, for the admin to approve.
  const manager = await phone(browser, app.base);
  const mp = manager.page;
  await mp.goto(`${app.base}/signin`);
  await mp.getByRole('tab', { name: 'Create an account' }).click();
  await mp.getByRole('radio', { name: /^A bus owner’s manager/ }).check();
  await createAccount(mp, { 'Your name': 'Ramesh Ghosh', 'Your bus owner’s mobile number': '98300 55555', 'Your mobile number': '98300 66666' }, 'Ramesh-pass-26');
  await mp.getByText('They also check with Paul Bus Service that you work for them.').waitFor();
  await op.reload();
  const managerRow = op.locator('.person').filter({ hasText: 'Ramesh Ghosh' });
  await managerRow.getByText('Waiting for approval').waitFor();
  await managerRow.getByText(/^Manager · .* · the Where Is My Bus team approves managers$/).waitFor();
  assert.equal(await managerRow.getByRole('button', { name: 'Approve' }).count(), 0, 'the admin approves managers');

  // The admin approves them; they sign in and see the buses, but not the people.
  await dp.reload();
  await owners().click();
  await dp.getByRole('list', { name: 'Waiting for approval' }).getByRole('button', { name: 'Approve Ramesh Ghosh' }).click();
  await dp.getByText('Approved Ramesh Ghosh. They can sign in for Paul Bus Service now.').waitFor();
  await mp.getByRole('button', { name: 'Back to sign in' }).click();
  await signIn(mp, '98300 66666', 'Ramesh-pass-26');
  await mp.getByText('Paul Bus Service · Ramesh Ghosh').waitFor();
  await mp.getByText('WB 19 B 5555', { exact: true }).waitFor();
  assert.equal(await mp.getByRole('heading', { name: 'People' }).isVisible(), false);
  assert.deepEqual(await cspViolations(mp), []);
  await manager.context.close();

  // Their conductor, signed up and approved, stops sharing halfway along the route: the owner sees an alert.
  const ownerKey = (await op.evaluate(() => localStorage.getItem('wimb.owner.key'))) ?? '';
  const made = await call<{ id: string }>(app.base, 'POST', '/api/accounts/sign-up', { kind: 'conductor', name: 'Gopal Das', phone: '98300 44444', password: 'Gopal-bus-26', ownerPhone: '98300 55555' });
  await call(app.base, 'POST', `/api/owner/people/${made.id}/approve`, {}, ownerKey);
  const { key: conductorKey } = await call<{ key: string }>(app.base, 'POST', '/api/accounts/sign-in', { phone: '98300 44444', password: 'Gopal-bus-26' });
  // Without a sign-in, or with a plate that is not the owner's, nobody shares as a conductor.
  const trip = (body: unknown, key?: string) =>
    fetch(`${app.base}/api/trips`, { method: 'POST', headers: { ...json, ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await trip({ patternId: 'T1-UP', role: 'conductor', plate: 'WB 19 B 5555' })).status, 401);
  assert.equal((await trip({ patternId: 'T1-UP', role: 'conductor', plate: 'WB 19 A 1234' }, conductorKey)).status, 400);
  const start = (await (await trip({ patternId: 'T1-UP', role: 'conductor', plate: 'wb19b5555' }, conductorKey)).json()) as { sessionId: string; role: string };
  assert.equal(start.role, 'conductor');
  const line = net.patterns.get('T1-UP')!.line;
  const pings = Array.from({ length: 11 }, (_, i) => ({ ...pointAlong(line, 70 * i), accuracy: 10, speed: 14, ts: Date.now() - (11 - i) * 5_000 }));
  await fetch(`${app.base}/api/trips/${start.sessionId}/pings`, { method: 'POST', headers: json, body: JSON.stringify({ pings }) });
  await fetch(`${app.base}/api/trips/${start.sessionId}/end`, { method: 'POST' });
  await op.reload();
  await op.getByRole('heading', { name: '1 thing to check' }).waitFor();
  await op.getByText('WB 19 B 5555 stopped sharing mid-trip').waitFor();
  assert.match(await op.locator('.alert .status-detail').innerText(), /^Route T1 towards Own C\. Stopped at \d\d:\d\d, after Own B: 2 of 3 stops\.$/);
  await op.getByRole('button', { name: 'Tell me about alerts on this device' }).waitFor();
  await shot(op, 'owner-alert');
  await op.getByRole('button', { name: 'Seen' }).click();
  await op.reload();
  await op.getByText('WB 19 B 5555', { exact: true }).waitFor();
  assert.equal(await op.locator('.alerts').count(), 0, 'an alert marked as seen stays seen');
  assert.deepEqual(await cspViolations(op), []);
  assert.deepEqual(owner.errors.filter((e) => !/status of 403/.test(e)), []);
  await owner.context.close();

  // A route syndicate signs up; the admin chooses its routes and members as they approve it.
  const syndicate = await phone(browser, app.base);
  const sp = syndicate.page;
  await sp.goto(`${app.base}/signin?as=syndicate`);
  assert.equal(await sp.getByRole('radio', { name: /^A route syndicate/ }).isChecked(), true);
  await createAccount(sp, { 'The syndicate’s name': 'T1 syndicate', 'Your name': 'Bijoy Saha', 'Your mobile number': '98300 77777' }, 'Syndicate-26');
  await sp.getByText('They also choose the routes and member owners your syndicate sees.').waitFor();
  await dp.reload();
  await owners().click();
  await dp.getByRole('button', { name: 'Choose routes and approve T1 syndicate' }).click();
  await dp.getByRole('group', { name: 'Its routes' }).getByLabel('T1', { exact: true }).check();
  await dp.getByRole('group', { name: 'Its members' }).getByLabel('Paul Bus Service', { exact: true }).check();
  await dp.getByRole('button', { name: 'Approve', exact: true }).click();
  await dp.getByText('Approved T1 syndicate. It can sign in now.').waitFor();
  await dp.getByText('Members: Paul Bus Service').waitFor();
  await shot(dp, 'admin-syndicates');
  // Nobody waits now.
  await dp.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: 'Bus owners', exact: true }).waitFor();
  assert.deepEqual(await cspViolations(dp), []);
  assert.deepEqual(desk.errors.filter((e) => !/net::/i.test(e)), []);
  await desk.context.close();

  // The syndicate signs in: the buses, read-only and without codes.
  await sp.getByRole('button', { name: 'Back to sign in' }).click();
  await signIn(sp, '98300 77777', 'Syndicate-26');
  await sp.getByRole('heading', { name: 'Syndicate buses' }).waitFor();
  await sp.getByText('T1 syndicate · T1').waitFor();
  await sp.locator('.bus-head').getByText('Paul Bus Service').waitFor();
  assert.equal(await sp.getByRole('button', { name: 'Add a bus' }).isVisible(), false);
  await sp.locator('summary').click();
  assert.equal(await sp.getByRole('button', { name: 'Remove bus' }).count(), 0, 'read-only');
  await shot(sp, 'syndicate');
  assert.deepEqual(await cspViolations(sp), []);
  assert.deepEqual(syndicate.errors, []);
  await syndicate.context.close();

  // A conductor's account only shares buses: signed in on /signin, they land on "Share your bus",
  // and the owner page sends them back there.
  assert.equal((await fetch(`${app.base}/api/owner/overview`, { headers: { authorization: `Bearer ${conductorKey}` } })).status, 403);
  const conductor = await phone(browser, app.base);
  const cp = conductor.page;
  await cp.goto(`${app.base}/signin`);
  await signIn(cp, '98300 44444', 'Gopal-bus-26');
  await cp.getByText('Signed in as Gopal Das, conductor for Paul Bus Service.').waitFor();
  await cp.goto(`${app.base}/owner`);
  await cp.getByText('Signed in as Gopal Das, conductor for Paul Bus Service.').waitFor();
  assert.equal(new URL(cp.url()).pathname, '/');
  assert.deepEqual(await cspViolations(cp), []);
  assert.deepEqual(conductor.errors.filter((e) => !/status of 403/.test(e)), []);
  await conductor.context.close();
});

test('a contributor signs up, the admin approves them, and uses the route they recorded, with the stops they marked and named', { timeout: 180_000 }, async () => {
  // They create an account on /signin; recording is done in the phone app.
  const { page, context, errors } = await phone(browser, app.base);
  await page.goto(`${app.base}/signin?as=contributor`);
  assert.equal(await page.getByRole('radio', { name: /^A contributor/ }).isChecked(), true);
  await createAccount(page, { 'Your name': 'Anita Roy', 'Your mobile number': '98300 31313' }, 'Anita-maps-26');
  await page.getByText('Once they have approved it, sign in with your mobile number and password in the Where Is My Bus phone app, and record routes there.').waitFor();

  // The admin approves them among the accounts that wait, and sees them under Contributors.
  const desk = await adminDesk();
  const dp = desk.page;
  dp.on('dialog', (d) => void d.accept());
  const nav = dp.getByRole('navigation', { name: 'Admin' });
  await nav.getByRole('button', { name: /^Bus owners/ }).click();
  await dp.getByRole('list', { name: 'Waiting for approval' }).getByRole('button', { name: 'Approve Anita Roy' }).click();
  await dp.getByText('Approved Anita Roy. They can sign in on the phone app now and record routes.').waitFor();
  const row = dp.getByRole('list', { name: 'Contributors' }).getByRole('listitem').filter({ hasText: 'Anita Roy' });
  await row.getByText(/^\+91 98300 31313 · password set · no recordings yet · signed up /).waitFor();
  assert.equal(await row.getByText('Waiting', { exact: true }).count(), 0);
  await shot(dp, 'admin-contributors');

  // Signed in on /signin, the page says recording is done in the phone app, and keeps no key.
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await signIn(page, '98300 31313', 'Anita-maps-26');
  await page.getByRole('heading', { name: 'Record routes in the phone app' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('wimb.owner.key')), null);
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await context.close();

  // In the phone app (its API here) they ride T1 towards Own C and mark two stops: a new one
  // halfway to Own B, which they name, and one at Own B.
  const { key } = await call<{ key: string }>(app.base, 'POST', '/api/accounts/sign-in', { phone: '98300 31313', password: 'Anita-maps-26' });
  const line = net.patterns.get('T1-UP')!.line;
  const t0 = Date.now() - 10 * 60_000;
  const { recording } = await call<{ recording: { id: string } }>(app.base, 'POST', '/api/contributor/recordings', { name: 'T1 towards Own C' }, key);
  const points = Array.from({ length: 24 }, (_, i) => ({ ...pointAlong(line, 50 * i), accuracy: 8, ts: t0 + i * 5_000 }));
  await call(app.base, 'POST', `/api/contributor/recordings/${recording.id}/points`, { points }, key);
  await call(app.base, 'POST', `/api/contributor/recordings/${recording.id}/marks`, { ...pointAlong(line, 300), ts: t0 + 30_000, name: 'Tea stall' }, key);
  await call(app.base, 'POST', `/api/contributor/recordings/${recording.id}/marks`, { ...pointAlong(line, 600), ts: t0 + 60_000 }, key);
  await call(app.base, 'POST', `/api/contributor/recordings/${recording.id}/finish`, {}, key);

  // The admin sees who recorded it and its marked stops, on the map and listed.
  await nav.getByRole('button', { name: 'Record a route' }).click();
  const rec = dp.getByRole('list', { name: 'Recordings' }).getByRole('listitem').filter({ hasText: 'T1 towards Own C' });
  await rec.getByText('by Anita Roy').waitFor();
  await rec.getByText(/ · 2 marked stops$/).waitFor();
  await rec.getByRole('button', { name: 'Show on map' }).click();
  const marked = dp.getByRole('list', { name: 'Marked stops' });
  await dp.getByText(/^Recorded by Anita Roy · 2 halts · 2 marked stops$/).waitFor();
  const tea = marked.getByRole('listitem').filter({ hasText: 'Tea stall' });
  await tea.getByText('No stop here yet: a new stop gets this name').waitFor();
  const atB = marked.getByRole('listitem').filter({ hasText: 'No name typed' });
  await atB.getByText(/^The stop Own B is \d+ m away$/).waitFor();
  await shot(dp, 'admin-recording-marks');

  // Used for T1 towards Own C with its stops: the new stop keeps the name the contributor typed.
  await rec.getByRole('button', { name: 'Use for a route' }).click();
  await rec.getByLabel('Route', { exact: true }).selectOption({ label: 'Route T1' });
  await rec.getByRole('checkbox').check();
  await rec.getByRole('button', { name: 'Use for this direction' }).click();
  await dp.getByText(/^Saved: the road path and stops come from T1 towards Own C\. 1 new stops need names in the Stops tab\./).waitFor();
  const after = await getJson<Network>(`${app.base}/api/network`);
  const t1 = after.routes.find((r) => r.number === 'T1')!.patterns.find((p) => p.id === 'T1-UP')!;
  assert.deepEqual(t1.stopIds.map((id) => after.stops.find((x) => x.id === id)?.name), ['Tea stall', 'Own B']);

  // A temporary password for them, and then they are removed: the recording stays.
  await nav.getByRole('button', { name: /^Bus owners/ }).click();
  await row.getByRole('button', { name: 'New password' }).click();
  await dp.getByText('Temporary password for Anita Roy').waitFor();
  await row.getByText(/^\+91 98300 31313 · temporary password, not used yet · 1 recording · signed up /).waitFor();
  await row.getByRole('button', { name: 'Remove' }).click();
  await dp.getByText('Removed Anita Roy.').waitFor();
  await dp.getByText('No contributors yet.').waitFor();
  assert.equal((await fetch(`${app.base}/api/contributor/recordings`, { headers: { authorization: `Bearer ${key}` } })).status, 401);
  assert.equal((await call<{ recordings: unknown[] }>(app.base, 'GET', '/api/admin/recordings', undefined, ADMIN_TOKEN)).recordings.length, 1);
  assert.deepEqual(await cspViolations(dp), []);
  assert.deepEqual(desk.errors.filter((e) => !/net::/i.test(e)), []);
  await desk.context.close();
});

test('a forgotten password is set again with a code by SMS, and the owner page changes it', async () => {
  // An owner the admin added, who has chosen their password already.
  const made = await (await admin('POST', '/api/admin/owners', { name: 'Das Travels', phone: '98300 88888' })).json();
  const first = await (await fetch(`${app.base}/api/accounts/sign-in`, { method: 'POST', headers: json, body: JSON.stringify({ phone: '9830088888', password: made.password }) })).json();
  await fetch(`${app.base}/api/accounts/password`, { method: 'POST', headers: json, body: JSON.stringify({ changeToken: first.changeToken, password: 'Das-travels-1' }) });

  const { page, context, errors } = await phone(browser, app.base);
  await page.goto(`${app.base}/signin`);
  // For anyone here by mistake, and the team's own sign-in.
  assert.equal(await page.getByRole('link', { name: 'Looking for your bus? Riders do not need to sign in.' }).getAttribute('href'), '/');
  assert.equal(await page.getByRole('link', { name: 'Where Is My Bus team: admin sign-in' }).getAttribute('href'), '/admin');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Mobile number', { exact: true }).fill('98300 88888');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByText('If this number has an account, a code is on its way to the number ending 8888.').waitFor();
  assert.equal(texts.at(-1)?.to, '+919830088888');
  await page.getByLabel('Code from the SMS').fill(lastCode());
  await page.getByLabel('New password').fill('Das-travels-2');
  await page.getByLabel('Type the password again').fill('Das-travels-2');
  await page.getByRole('button', { name: 'Save and sign in' }).click();
  await page.getByRole('heading', { name: 'Your buses' }).waitFor();
  await page.getByText('Das Travels', { exact: true }).waitFor();

  // On the owner page: a new password, with the present one.
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByLabel('Present password').fill('Das-travels-2');
  await page.getByLabel('New password').fill('Das-travels-3');
  await page.getByLabel('Type the password again').fill('Das-travels-3');
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.getByText('Your password is changed. Your other devices are signed out.').waitFor();
  await page.reload();
  await page.getByText('Das Travels', { exact: true }).waitFor();
  const signedIn = await fetch(`${app.base}/api/accounts/sign-in`, { method: 'POST', headers: json, body: JSON.stringify({ phone: '9830088888', password: 'Das-travels-3' }) });
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the sign-in page in Bengali, with the choice made in the rider app', async () => {
  const { page, context, errors } = await phone(browser, app.base);
  await page.goto(app.base);
  await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByText('কলকাতায় কোন বাস ধরবেন, আর সেটা কখন আসবে').waitFor();
  await page.goto(`${app.base}/owner`);
  await page.getByRole('heading', { name: 'মোবাইল নম্বর দিয়ে সাইন ইন করুন' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'bn');
  await page.getByLabel('মোবাইল নম্বর', { exact: true }).fill('98300 99999');
  await page.getByLabel('পাসওয়ার্ড', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'সাইন ইন', exact: true }).click();
  // The server's answer, in Bengali.
  await page.getByText('মোবাইল নম্বর বা পাসওয়ার্ড ঠিক নয়।').waitFor();
  await page.getByRole('tab', { name: 'অ্যাকাউন্ট খুলুন' }).click();
  await page.getByRole('radio', { name: /^বাস মালিকের ম্যানেজার/ }).check();
  await page.getByLabel('আপনার বাস মালিকের মোবাইল নম্বর').waitFor();
  await shot(page, 'signin-bengali');
  // Back to English from the sign-in page.
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors.filter((e) => !/status of 401/.test(e)), []);
  await context.close();
});
