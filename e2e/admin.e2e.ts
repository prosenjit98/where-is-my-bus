import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Browser } from 'playwright-core';
import { startSimulation } from '../tools/simulate.ts';
import { ADMIN_TOKEN, choosePlace, conductorAccount, cspViolations, getJson, launch, phone, shot, startApp, stopAlong, TEN_AM_IST } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;

before(async () => {
  app = await startApp();
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await app?.close();
});

test('an admin adds a local name to a stop, and riders find the stop by it after their next update', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app.base}/admin`);

  // A wrong token is refused in plain words.
  await page.getByLabel('Admin token').fill('not-the-token');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('That token is not right. Copy it again from the server console.').waitFor();
  await page.getByLabel('Admin token').fill(ADMIN_TOKEN);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('button', { name: 'Stops', exact: true }).click();
  await page.getByRole('heading', { name: '22 stops' }).waitFor();

  // Admins search their own list in English or Bengali, by other names too.
  await page.getByRole('searchbox', { name: 'Find a stop' }).fill('dharma');
  await page.getByRole('button', { name: /^Esplanade/ }).click();
  const names = page.getByLabel('Other names people use');
  await names.fill(`${await names.inputValue()}, Metro Cinema`);
  await page.getByRole('button', { name: 'Save stop' }).click();
  await page.getByText('Saved Esplanade. The network is now version 2.').waitFor();
  await shot(page, 'admin');
  assert.equal((await getJson<{ networkVersion: number }>(`${app.base}/api/health`)).networkVersion, 2);
  // Everything, the map library and fonts too, comes from this server.
  assert.deepEqual(await cspViolations(page), []);
  // The 401 is the wrong token tried above.
  assert.deepEqual(errors.filter((e) => !/net::|status of 401/i.test(e)), []);
  await page.context().close();

  // A rider's phone: downloads version 2 and finds Esplanade by its new name, on the phone.
  const rider = await phone(browser, app.base);
  await rider.page.clock.setFixedTime(TEN_AM_IST);
  await rider.page.goto(app.base);
  await choosePlace(rider.page, 'From', 'metro cinema', 'Esplanade');
  await rider.page.getByRole('button', { name: 'From: Esplanade' }).waitFor();
  assert.deepEqual(rider.errors, []);
  await rider.page.context().close();
});

test('a broken change is refused with every problem listed, and nothing is saved', async () => {
  const res = await fetch(`${app.base}/api/admin/routes/x9`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({
      number: 'X9',
      operator: 'private',
      firstBus: '06:00',
      lastBus: '25:00',
      defaultHeadwayMin: 0,
      patterns: [{ id: 'X9-UP', direction: 'UP', headsign: 'Nowhere', stopIds: ['esplanade', 'nowhere'] }],
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { details: string[] };
  assert.ok(body.details.some((d) => d.includes('first and last bus')));
  assert.ok(body.details.some((d) => d.includes('more than 0 minutes')));
  assert.ok(body.details.some((d) => d.includes('unknown stop "nowhere"')));
  assert.equal((await getJson<{ networkVersion: number }>(`${app.base}/api/health`)).networkVersion, 2);
});

test('the dashboard and the folding side nav; a direction built by clicking the road, which riders then find by its number', { timeout: 180_000 }, async () => {
  // A conductor's phone on D2, so there is a bus on the road.
  const conductor = await conductorAccount(app.base, { owner: 'Sen Transport', ownerPhone: '98300 10001', name: 'Ramesh Ghosh', phone: '98300 10002', plate: 'WB 19 A 1234' });
  const sim = await startSimulation({ url: app.base, patterns: ['D2-UP'], busesPerPattern: 1, startAlongM: stopAlong(app.net, 'D2-UP', 'esplanade') + 150, speedMps: 4, conductor, tickS: 5, sendEveryS: 5 });
  try {
    const { page, errors } = await phone(browser, app.base);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/admin`);
    await page.getByLabel('Admin token').fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Signed in, the admin lands on the dashboard: what is on the road now, and what needs a look.
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
    assert.equal(await page.locator('.tile', { hasText: 'Buses on the road' }).locator('.tile-value').innerText(), '1');
    await page.locator('.route-row', { hasText: '1 bus' }).getByLabel('Route D2').waitFor();
    await page.getByRole('region', { name: 'Map of the buses on the road now' }).getByTitle(/^D2 towards Garia More, shared by the conductor/).waitFor();
    await page.getByText(/15 directions have no road path yet/).waitFor();
    await shot(page, 'admin-dashboard');

    // The nav folds to its icons and stays folded; the token is kept for this tab, so a reload stays signed in.
    const nav = page.getByRole('navigation', { name: 'Admin' });
    await nav.getByRole('button', { name: 'Hide the menu' }).click();
    assert.match((await page.locator('#app').getAttribute('class')) ?? '', /nav-collapsed/);
    await page.reload();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
    assert.match((await page.locator('#app').getAttribute('class')) ?? '', /nav-collapsed/);
    await nav.getByRole('button', { name: 'Show the menu' }).click();
    assert.doesNotMatch((await page.locator('#app').getAttribute('class')) ?? '', /nav-collapsed/);

    // A new route where there are no stops yet: a click on the road adds a stop there...
    await nav.getByRole('button', { name: 'Routes', exact: true }).click();
    await page.getByRole('button', { name: 'Add route' }).click();
    await page.getByLabel('Route number').fill('X12');
    await page.evaluate('map.setView([22.75, 88.38], 15, { animate: false })');
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByText('A new stop where you clicked').waitFor();
    await page.getByLabel('Stop name').fill('Sodepur More');
    await page.getByRole('button', { name: 'Add this stop' }).click();
    await page.getByText(/Added the stop Sodepur More \(network version \d+\)/).waitFor();
    // ...and a click next to a stop, not exactly on it, picks that stop.
    const esplanade = app.net.stops.get('esplanade')!;
    await page.evaluate(`map.setView([${esplanade.lat}, ${esplanade.lng}], 16, { animate: false })`);
    const at = (await page.evaluate(`map.latLngToContainerPoint([${esplanade.lat}, ${esplanade.lng}])`)) as { x: number; y: number };
    await page.mouse.click(box.x + at.x + 9, box.y + at.y + 7);
    const order = page.getByRole('list', { name: 'Stops in order' });
    await order.getByText('Esplanade').waitFor();
    assert.equal(await order.locator('li').count(), 2);
    await shot(page, 'admin-new-stop');
    await page.getByRole('button', { name: 'Save route' }).click();
    await page.getByText(/Saved route X12\. The network is now version \d+\./).waitFor();
    assert.deepEqual(await cspViolations(page), []);
    assert.deepEqual(errors, []);
    await page.context().close();

    // Riders find the new route by its number, with its stops in order.
    const rider = await phone(browser, app.base);
    await rider.page.goto(app.base);
    await rider.page.getByRole('button', { name: /^Find a route/ }).click();
    await rider.page.getByLabel('Search for a route').fill('x 12');
    await rider.page.getByRole('list', { name: 'Matching routes' }).getByRole('button', { name: /Sodepur More to Esplanade/ }).click();
    await rider.page.getByRole('heading', { name: 'Route X12' }).waitFor();
    assert.deepEqual(await rider.page.locator('.stop-line .stop-name').allInnerTexts(), ['Sodepur More', 'Esplanade']);
    assert.deepEqual(rider.errors, []);
    await rider.page.context().close();
  } finally {
    await sim.stop();
  }
});
