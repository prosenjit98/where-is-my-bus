import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Browser } from 'playwright-core';
import type { VehicleView } from '../packages/core/src/index.ts';
import { startSimulation } from '../tools/simulate.ts';
import {
  choosePlace,
  conductorAccount,
  cspViolations,
  getJson,
  launch,
  notifications,
  phone,
  positionOn,
  setPosition,
  shot,
  startApp,
  stopAlong,
  TEN_AM_IST,
  vibrations,
} from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
/** Ramesh Ghosh, a conductor for Sen Transport, signed in: their phone shares the owner's bus WB 19 A 5678. */
let conductor: Awaited<ReturnType<typeof conductorAccount>>;
const CONDUCTOR_PHONE = '98300 20002';

before(async () => {
  app = await startApp();
  browser = await launch();
  conductor = await conductorAccount(app.base, { owner: 'Sen Transport', ownerPhone: '98300 20001', name: 'Ramesh Ghosh', phone: CONDUCTOR_PHONE, plate: 'WB 19 A 5678' });
});

after(async () => {
  await browser?.close();
  await app?.close();
});

const vehiclesOn = async (patternId: string) =>
  (await getJson<{ vehicles: VehicleView[] }>(`${app.base}/api/patterns/${patternId}/vehicles`)).vehicles;

test('a conductor’s bus coming to the stop becomes the live wait, and shows on the journey map', async () => {
  // A conductor's phone on D2 towards Garia, 450 m before Esplanade.
  const esplanade = stopAlong(app.net, 'D2-UP', 'esplanade');
  const sim = await startSimulation({ url: app.base, patterns: ['D2-UP'], busesPerPattern: 1, startAlongM: esplanade - 450, speedMps: 4, conductor, tickS: 5, sendEveryS: 5 });
  try {
    const [bus] = await vehiclesOn('D2-UP');
    assert.equal(bus.source, 'conductor');
    assert.equal(bus.confidence, 'high');

    const { page, errors } = await phone(browser, app.base);
    await page.clock.setFixedTime(TEN_AM_IST);
    await page.goto(app.base);
    await choosePlace(page, 'From', 'esplanade', 'Esplanade');
    await choosePlace(page, 'To', 'jadavpur', 'Jadavpur 8B');
    const first = page.locator('.option').first();
    // The tracked D2 comes sooner than the usual wait, so it sets the wait, labelled Live.
    await first.getByText(/^D2 reaches Esplanade in \d+ min$/).waitFor();
    assert.match(await first.innerText(), /Live\s+D2 reaches Esplanade/);
    await shot(page, 'plan-live');

    await first.click();
    await page.getByText('1 bus on these routes tracked right now.').waitFor();
    await page.locator('.bus-icon').getByRole('img', { name: 'Route D2' }).waitFor();
    await shot(page, 'journey-live');
    assert.deepEqual(await cspViolations(page), []);
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await sim.stop();
  }
  assert.equal((await vehiclesOn('D2-UP')).length, 0, 'the bus goes when its phone stops sharing');
});

test('a rider’s trip: next stop, the stop alarm, "this is your stop", and the trip ends by itself', { timeout: 240_000 }, async () => {
  const esplanade = stopAlong(app.net, 'D2-UP', 'esplanade');
  const parkStreet = stopAlong(app.net, 'D2-UP', 'park-street');
  const { page, context, errors } = await phone(browser, app.base, { at: positionOn(app.net, 'D2-UP', esplanade) });
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await choosePlace(page, 'From', 'esplanade', 'Esplanade');
  await choosePlace(page, 'To', 'park street', 'Park Street');
  await page.locator('.option').first().click();
  await page.getByRole('button', { name: 'I’m on this bus' }).click();
  // D1, D2 and D3 all go to Park Street before 1 pm; this rider got on a D2.
  await page.getByRole('radio', { name: 'Route D2' }).click();
  // Nothing to type about the bus: the server puts the rider on it by where they are.
  assert.equal(await page.getByRole('textbox', { name: /number plate/ }).count(), 0, 'a rider is not asked for the plate');
  await page.getByRole('button', { name: 'Start trip and share' }).click();
  await page.getByRole('heading', { name: 'Bus D2' }).waitFor();
  await page.getByText('Park Street', { exact: true }).waitFor();

  // Ride: 20 m/s along the route, timed by the clock so the speed is real to the server. At most
  // 30 m a step, so a slow moment on the computer cannot jump the bus past "This is Park Street".
  let along = esplanade;
  let last = Date.now();
  let sawAlarm = false;
  let sawArrival = false;
  let sawSharedBus = false;
  for (;;) {
    const now = Date.now();
    along += Math.min(30, ((now - last) / 1000) * 20);
    last = now;
    await setPosition(context, positionOn(app.net, 'D2-UP', along));
    await page.waitForTimeout(700);
    if (!sawAlarm && (await page.getByRole('alert').filter({ hasText: 'Park Street is next' }).count())) {
      sawAlarm = true;
      assert.ok(along > parkStreet - 820 && along < parkStreet - 500, `the alarm rang ${Math.round(parkStreet - along)} m before the stop`);
      await shot(page, 'trip-alarm');
      await page.getByRole('button', { name: 'OK' }).click();
    }
    if (!sawSharedBus) {
      const buses = await vehiclesOn('D2-UP');
      if (buses.length === 1 && buses[0].riders === 1) sawSharedBus = true;
    }
    if (!sawArrival && (await page.getByText('This is Park Street').count())) {
      sawArrival = true;
      await shot(page, 'trip-arrived');
    }
    if (await page.getByText('Trip ended', { exact: true }).count()) break;
    assert.ok(along < parkStreet + 700, 'the trip should have ended after passing Park Street');
  }
  await page.getByText('You went past your stop, so the trip ended by itself.').waitFor();
  assert.ok(sawAlarm, 'the stop alarm rang');
  assert.ok(sawArrival, '"This is Park Street" was shown');
  assert.ok(sawSharedBus, 'the server saw the shared bus');
  assert.ok((await vibrations(page)) >= 1, 'the phone vibrated');
  const notes = await notifications(page);
  assert.ok(notes.includes('Park Street is next'), `alarm notification, got ${JSON.stringify(notes)}`);
  assert.ok(notes.includes('Trip ended'));
  assert.equal((await vehiclesOn('D2-UP')).length, 0, 'sharing stopped with the trip');
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a conductor signs in, and shares their owner’s bus by its number plate; a plate that is not the owner’s is refused', async () => {
  const howrah = positionOn(app.net, 'D5-UP', 0);
  const { page, errors } = await phone(browser, app.base, { at: howrah });
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);

  // Not signed in: the screen says how conductors share a bus, and where to sign in.
  await page.getByRole('button', { name: 'Conductor? Share your bus' }).click();
  await page.getByText('Conductors sign in to share their bus. Your bus owner approves your account; then you choose the route and type the bus’s number plate.').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Create a conductor account' }).getAttribute('href'), '/signin?as=conductor');
  await page.getByRole('link', { name: 'Sign in as a conductor' }).click();
  await page.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  await page.getByLabel('Mobile number', { exact: true }).fill(CONDUCTOR_PHONE);
  await page.getByLabel('Password', { exact: true }).fill('Conductor-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Signed in, the rider app opens on "Share your bus".
  await page.getByText('Signed in as Ramesh Ghosh, conductor for Sen Transport.').waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  await page.getByRole('searchbox', { name: 'Find your route by number' }).fill('D5');
  await page.getByRole('button', { name: /Howrah Station – Sector V/ }).click();
  await page.getByRole('radio', { name: /Towards Sector V/ }).click();
  await page.getByText('Shared as its conductor, the bus’s owner sees where it is and the trips it runs.').waitFor();
  const plate = page.getByRole('textbox', { name: 'The bus’s number plate' });
  await plate.fill('WB 99 Z 9999');
  await page.getByRole('button', { name: 'Start sharing as conductor' }).click();
  await page.getByText('None of Sen Transport’s buses has the number plate “WB 99 Z 9999”. Check the plate, or ask your owner to add the bus.').waitFor();
  await shot(page, 'conductor-wrong-plate');
  // Spaces, dashes and small letters do not matter.
  await plate.fill('wb-19-a-5678');
  await page.getByRole('button', { name: 'Start sharing as conductor' }).click();
  await page.getByRole('heading', { name: 'Bus D5' }).waitFor();
  await page.getByText(/^Sharing bus WB 19 A 5678 as the conductor./).waitFor();
  await page.getByText('Sen Transport, its owner, sees where the bus is and the trips it runs.').waitFor();
  await shot(page, 'conductor-sharing');
  await setPosition(page.context(), positionOn(app.net, 'D5-UP', 40));
  await page.waitForTimeout(300);
  await setPosition(page.context(), positionOn(app.net, 'D5-UP', 80));
  await page.getByRole('button', { name: 'End trip' }).click();
  await page.getByText('You ended the trip.').waitFor();

  // On a journey, "I’m on this bus" offers to share as the conductor, with the plate typed last.
  await page.getByRole('button', { name: 'Plan a journey' }).click();
  await page.getByRole('heading', { name: 'Where Is My Bus' }).waitFor();
  await setPosition(page.context(), positionOn(app.net, 'D2-UP', stopAlong(app.net, 'D2-UP', 'esplanade')));
  await choosePlace(page, 'From', 'esplanade', 'Esplanade');
  await choosePlace(page, 'To', 'park street', 'Park Street');
  await page.locator('.option').first().click();
  await page.getByRole('button', { name: 'I’m on this bus' }).click();
  await page.getByRole('radio', { name: 'Route D2' }).click();
  assert.equal(await page.getByRole('switch', { name: /I’m the conductor/ }).isChecked(), true);
  assert.equal(await page.getByRole('textbox', { name: 'The bus’s number plate' }).inputValue(), 'wb-19-a-5678');
  assert.equal(await page.getByRole('textbox', { name: 'Last 4 digits of the number plate' }).count(), 0, 'the rider’s plate box gives way to the whole plate');
  await page.getByRole('button', { name: 'Start trip and share' }).click();
  await page.getByText(/^Sharing bus WB 19 A 5678 as the conductor./).waitFor();
  await page.getByRole('button', { name: 'End trip' }).click();
  await page.getByText('You ended the trip.').waitFor();

  // Signing out on the conductor screen: the key stops working on the server too.
  const key = (await page.evaluate(() => localStorage.getItem('wimb.owner.key'))) ?? '';
  await page.getByRole('button', { name: 'Plan a journey' }).click();
  await page.getByRole('button', { name: 'Conductor? Share your bus' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('link', { name: 'Sign in as a conductor' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('wimb.owner.key')), null);
  assert.equal((await fetch(`${app.base}/api/accounts/me`, { headers: { authorization: `Bearer ${key}` } })).status, 401);
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors.filter((e) => !/status of 400/.test(e)), []);
  await page.context().close();
});

test('a rider finds a bus by its route number, and its page shows where the bus is between stops', async () => {
  // A conductor's phone on D2 towards Garia, just past Esplanade.
  const esplanade = stopAlong(app.net, 'D2-UP', 'esplanade');
  const sim = await startSimulation({ url: app.base, patterns: ['D2-UP'], busesPerPattern: 1, startAlongM: esplanade + 150, speedMps: 4, conductor, tickS: 5, sendEveryS: 5 });
  try {
    const { page, errors } = await phone(browser, app.base);
    await page.clock.setFixedTime(TEN_AM_IST);
    await page.goto(app.base);
    // A route number typed in the place search offers the route itself.
    await page.getByRole('button', { name: /^From/ }).click();
    await page.getByLabel('Search for a stop or landmark').fill('d2');
    await page.getByRole('list', { name: 'Matching routes' }).getByRole('button', { name: /Howrah Station to Garia More/ }).click();
    await page.getByRole('heading', { name: 'Route D2' }).waitFor();
    await page.getByText('About every 9 min').waitFor();
    await page.getByText('Runs from 05:45 to 22:00').waitFor();
    await page.getByText('1 bus tracked on this direction right now.').waitFor();
    await page.locator('.bus-here').getByText(/^Between Esplanade and Park Street, seen \d+ s ago$/).waitFor();
    await page.locator('.bus-icon').getByRole('img', { name: 'Route D2' }).waitFor();
    assert.equal(await page.locator('.stop-line li').count(), app.net.patterns.get('D2-UP')!.pattern.stopIds.length);
    await shot(page, 'route-live');
    // The other way has no bus being tracked.
    await page.getByRole('radio', { name: 'Towards Howrah Station' }).click();
    await page.getByText('No bus on this direction is being tracked right now.').waitFor();
    assert.equal(await page.locator('.bus-here').count(), 0);
    assert.deepEqual(await cspViolations(page), []);
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    await sim.stop();
  }
});
