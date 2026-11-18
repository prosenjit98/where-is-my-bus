import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Browser } from 'playwright-core';
import { choosePlace, cspViolations, launch, phone, positionOn, shot, startApp, TEN_AM_IST } from './helpers.ts';

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

test('a rider finds a bus by local name and Bengali, and sees routes grouped as "whichever comes first"', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Where Is My Bus' }).waitFor();
  await page.getByText('Choose where you are starting from.').waitFor();

  // Dharmatala is what many people call Esplanade.
  await choosePlace(page, 'From', 'dharmatala', 'Esplanade');
  // Banglish spelling: Jadabpur for Jadavpur.
  await choosePlace(page, 'To', 'jadabpur', 'Jadavpur 8B');
  const first = page.locator('.option').first();
  await first.waitFor();
  assert.match(await first.innerText(), /Direct/);
  assert.deepEqual(await first.getByRole('img', { name: /^Route / }).allInnerTexts(), ['D2', 'D3']);
  // D2 every 9 minutes and D3 every 10 together come about every 5 minutes, labelled as usual.
  assert.match(await first.innerText(), /Usual\s+One of these about every 5 min/);
  await shot(page, 'plan-light');

  // The journey: one step with both route boards.
  await first.click();
  await page.getByRole('heading', { name: /min to Jadavpur 8B/ }).waitFor();
  await page.getByText('Take whichever comes first').waitFor();
  await page.getByText('From Esplanade to Jadavpur 8B').waitFor();
  await page.getByText('No bus on these routes is being tracked right now.').waitFor();
  await shot(page, 'journey');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('heading', { name: 'Where Is My Bus' }).waitFor();

  // Bengali script: হাওড়া is Howrah.
  await choosePlace(page, 'From', 'হাওড়া', 'Howrah Station');
  await page.getByRole('button', { name: 'From: Howrah Station' }).waitFor();

  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('short trips offer walking, and late at night the app says when buses start', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await choosePlace(page, 'From', 'BBD Bag', 'BBD Bag');
  await choosePlace(page, 'To', 'esplanade', 'Esplanade');
  await page.locator('.option').filter({ hasText: 'Walk' }).first().waitFor();
  // Swap: the stack and the saved places survive a reload.
  await page.getByRole('button', { name: 'Swap start and destination' }).click();
  await page.getByRole('button', { name: 'From: Esplanade' }).waitFor();
  await page.context().close();

  const night = await phone(browser, app.base);
  await night.page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z')); // 23:30 in Kolkata
  await night.page.goto(app.base);
  await choosePlace(night.page, 'From', 'esplanade', 'Esplanade');
  await choosePlace(night.page, 'To', 'jadavpur', 'Jadavpur 8B');
  await night.page.getByText('No bus runs between these places right now.').waitFor();
  await night.page.getByText('D2 runs from 05:45 to 22:00.').waitFor();
  await night.page.getByText('D3 runs from 06:30 to 21:00.').waitFor();
  assert.deepEqual([...errors, ...night.errors], []);
  await night.page.context().close();
});

test('someone who keeps location off picks the place on the map', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await page.getByRole('button', { name: /^From:/ }).click();
  await page.getByRole('button', { name: /Pick on the map/ }).click();
  await page.getByText('Tap the map where you are or where you are going.').waitFor();
  const map = page.locator('.map');
  const box = await map.boundingBox();
  assert.ok(box);
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('Nearest stops').waitFor();
  assert.equal(await page.locator('.chip').count(), 3);
  await shot(page, 'map-pick');
  await page.getByRole('button', { name: 'Use this spot' }).click();
  await page.getByRole('button', { name: 'From: Pinned place' }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('"Use my location" finds the rider, and approximate location asks which stop', async () => {
  const precise = await phone(browser, app.base, { at: { lat: 22.5196, lng: 88.3655 } }); // near Gariahat
  await precise.page.clock.setFixedTime(TEN_AM_IST);
  await precise.page.goto(app.base);
  await precise.page.getByRole('button', { name: /^From:/ }).click();
  await precise.page.getByRole('button', { name: /Use my location/ }).click();
  await precise.page.getByRole('button', { name: 'From: Your location' }).waitFor();
  await choosePlace(precise.page, 'To', 'esplanade', 'Esplanade');
  const first = precise.page.locator('.option').first();
  await first.waitFor();
  assert.match(await first.innerText(), /Gariahat More to Esplanade/);
  assert.match(await first.innerText(), /min walking in total/);
  await precise.page.context().close();

  const rough = await phone(browser, app.base);
  await rough.context.setGeolocation({ latitude: 22.5196, longitude: 88.3655, accuracy: 2500 });
  await rough.page.goto(app.base);
  await rough.page.getByRole('button', { name: /^From:/ }).click();
  await rough.page.getByRole('button', { name: /Use my location/ }).click();
  await rough.page.getByText('Your phone shares only an approximate location. Which stop are you near?').waitFor();
  await rough.page.getByRole('button', { name: /Gariahat More/ }).first().click();
  await rough.page.getByRole('button', { name: 'From: Gariahat More' }).waitFor();
  await rough.page.context().close();
});

test('after one visit the app opens and plans journeys with no internet', async () => {
  const { page, context, errors } = await phone(browser, app.base);
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Where Is My Bus' }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // The network copy is saved after it downloads.
    for (let i = 0; i < 50 && !(await (await caches.open('wimb-data')).match('/saved/network.json')); i++) await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload(); // now the service worker controls the page
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);

  await context.setOffline(true);
  await page.reload();
  await page.getByText('Offline. Using the routes saved on this phone.').waitFor();
  await choosePlace(page, 'From', 'garia', 'Garia More');
  await choosePlace(page, 'To', 'sector 5', 'Sector V');
  const first = page.locator('.option').first();
  await first.waitFor();
  assert.match(await first.innerText(), /AC-D7/);
  await page.getByText('Live bus positions are not available right now').waitFor();
  await shot(page, 'offline');
  await context.setOffline(false);
  assert.deepEqual(errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(e)), []);
  await context.close();
});

test('every button has a name for screen readers, in light and dark mode', async () => {
  for (const dark of [false, true]) {
    const { page } = await phone(browser, app.base, { dark });
    await page.clock.setFixedTime(TEN_AM_IST);
    await page.goto(app.base);
    await choosePlace(page, 'From', 'tollygunge', 'Tollygunge Phari');
    await choosePlace(page, 'To', 'sector v', 'Sector V');
    await page.locator('.option').first().waitFor();
    // One change: D1 to Esplanade, then D5.
    assert.match(await page.locator('.option').first().innerText(), /1 change/);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"], input')]
        .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim() || (el as HTMLInputElement).placeholder))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    assert.deepEqual(unnamed, []);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The page follows the phone's light or dark setting (--bg in app.css).
    assert.equal(bg, dark ? 'rgb(12, 18, 24)' : 'rgb(241, 244, 248)');
    await shot(page, dark ? 'plan-dark' : 'plan-change');
    await page.context().close();
  }
});

test('the app in Bengali: Bengali names and digits, route numbers as painted, and back to English', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.clock.setFixedTime(TEN_AM_IST);
  await page.goto(app.base);
  await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByText('কলকাতায় কোন বাস ধরবেন, আর সেটা কখন আসবে').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'bn');
  await page.getByText('কোথা থেকে যাত্রা শুরু করবেন বেছে নিন।').waitFor();

  // Searched in English, chosen and shown in Bengali.
  for (const [field, typed, pick] of [['কোথা থেকে', 'esplanade', 'এসপ্ল্যানেড'], ['কোথায়', 'jadavpur', 'যাদবপুর ৮বি']]) {
    await page.getByRole('button', { name: new RegExp(`^${field}:`) }).click();
    await page.getByRole('searchbox', { name: 'স্টপ বা পরিচিত জায়গা খুঁজুন' }).fill(typed);
    await page.getByRole('list', { name: 'মিলে যাওয়া জায়গা' }).getByRole('button').filter({ hasText: pick }).first().click();
  }
  const first = page.locator('.option').first();
  await first.waitFor();
  const text = await first.innerText();
  assert.match(text, /সরাসরি/);
  assert.match(text, /এসপ্ল্যানেড থেকে যাদবপুর ৮বি/);
  assert.match(text, /সাধারণত\s+এগুলোর একটি প্রায় প্রতি ৫ মিনিটে/, 'minutes in Bengali digits');
  assert.match(text, /^[০-৯]+ মিনিট/);
  assert.deepEqual(await first.getByRole('img', { name: /^রুট / }).allInnerTexts(), ['D2', 'D3'], 'route boards as painted');
  await shot(page, 'plan-bengali');

  await first.click();
  await page.getByRole('heading', { name: /^যাদবপুর ৮বি পর্যন্ত [০-৯]+ মিনিট$/ }).waitFor();
  await page.getByText('যেটি আগে আসবে সেটিতে উঠুন').waitFor();
  await page.getByRole('button', { name: 'আমি এই বাসে আছি' }).first().waitFor();
  await shot(page, 'journey-bengali');
  await page.getByRole('button', { name: 'ফিরে যান' }).click();

  await page.getByRole('button', { name: 'English' }).click();
  await page.getByText('Which bus to take in Kolkata, and when it comes').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.getByRole('button', { name: 'From: Esplanade' }).waitFor();
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('family follow the bus from a shared link, in English or Bengali', async () => {
  const json = { 'content-type': 'application/json' };
  // A rider on D2 a few hundred metres before Esplanade shares a link, with Park Street as their stop.
  const pp = app.net.patterns.get('D2-UP')!;
  const esplanade = pp.stopAlong[pp.pattern.stopIds.indexOf('esplanade')];
  const { sessionId } = await (await fetch(`${app.base}/api/trips`, { method: 'POST', headers: json, body: JSON.stringify({ patternId: 'D2-UP' }) })).json();
  const t0 = Date.now() - 60_000;
  const pings = Array.from({ length: 7 }, (_, i) => ({ ...positionOn(app.net, 'D2-UP', esplanade - 400 + 50 * i), accuracy: 10, ts: t0 + i * 10_000 }));
  await fetch(`${app.base}/api/trips/${sessionId}/pings`, { method: 'POST', headers: json, body: JSON.stringify({ pings }) });
  const { path: link } = await (await fetch(`${app.base}/api/trips/${sessionId}/share`, { method: 'POST', headers: json, body: JSON.stringify({ destStopId: 'park-street' }) })).json();

  const { page, errors } = await phone(browser, app.base);
  await page.goto(app.base + link);
  await page.getByRole('heading', { name: 'Following bus D2' }).waitFor();
  await page.getByText('Esplanade', { exact: true }).waitFor();
  await page.getByText(/^About \d+ min to Park Street$/).waitFor();
  await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByRole('heading', { name: 'বাস D2 দেখছেন' }).waitFor();
  await page.getByText('এসপ্ল্যানেড', { exact: true }).waitFor();
  await page.getByText(/^পার্ক স্ট্রিট পর্যন্ত প্রায় [০-৯]+ মিনিট$/).waitFor();
  await shot(page, 'follow-bengali');
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('riders never sign in: the side nav has the sign-in pages for the people who run the buses, on a phone and on a wide screen', async () => {
  const { page, errors } = await phone(browser, app.base);
  await page.goto(app.base);
  // On a phone the nav slides out from the menu button.
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const nav = page.getByRole('navigation', { name: 'Menu' });
  await menu.click();
  assert.equal(await nav.getByRole('button', { name: 'Plan a journey' }).getAttribute('aria-current'), 'page');
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await nav.getByText('For the people who run the buses. Riders need no account.').waitFor();
  assert.deepEqual(
    await nav.getByRole('list', { name: 'Sign in' }).getByRole('link').evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute('href')])),
    [
      ['Owners, staff and syndicates', '/signin'],
      ['Admin', '/admin'],
    ],
  );
  await shot(page, 'nav-phone');
  // Escape closes it, and the focus goes back to the menu button.
  await page.keyboard.press('Escape');
  await nav.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Menu');

  // From the nav to finding a route: with nothing typed, every route; by a place, the routes that stop there.
  await menu.click();
  await nav.getByRole('button', { name: 'Find a route' }).click();
  await page.getByRole('heading', { name: 'Find a route' }).waitFor();
  await nav.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'All bus routes' }).waitFor();
  await page.getByLabel('Search for a route').fill('garia');
  const found = page.getByRole('list', { name: 'Matching routes' }).getByRole('button');
  await found.first().waitFor();
  assert.equal(await found.filter({ hasText: 'Stops at Garia More' }).count(), 3);
  await page.getByLabel('Search for a route').fill('zz9');
  await page.getByText('No route matches “zz9”. Try the number painted on the bus, like D2, or a place it goes to.').waitFor();
  // Back returns to the plan screen.
  await page.goBack();
  await page.getByRole('heading', { name: 'Where Is My Bus', level: 1 }).waitFor();

  // Owners, their staff and syndicates sign in on one page, with a mobile number and a password (owner.e2e.ts has the rest).
  await menu.click();
  await nav.getByRole('link', { name: 'Owners, staff and syndicates' }).click();
  await page.getByRole('heading', { name: 'Sign in with your mobile number' }).waitFor();
  await page.getByRole('tab', { name: 'Create an account' }).waitFor();
  assert.deepEqual(await cspViolations(page), []);
  assert.deepEqual(errors, []);
  await page.context().close();

  // On a wide screen the nav stays beside the app and folds to its icons, and stays folded.
  const wide = await phone(browser, app.base);
  await wide.page.setViewportSize({ width: 1280, height: 800 });
  await wide.page.goto(app.base);
  const side = wide.page.getByRole('navigation', { name: 'Menu' });
  const width = () => wide.page.evaluate(() => Math.round(document.getElementById('side')!.getBoundingClientRect().width));
  await side.getByRole('button', { name: 'Find a route' }).waitFor();
  assert.equal(await wide.page.getByRole('button', { name: 'Menu', exact: true }).count(), 0);
  assert.equal(await width(), 260);
  await side.getByRole('button', { name: 'Hide the menu' }).click();
  await wide.page.waitForFunction(() => document.getElementById('side')!.getBoundingClientRect().width === 76);
  // Folded, the names stay for screen readers and show as tooltips.
  assert.equal(await side.getByRole('button', { name: 'Find a route' }).getAttribute('title'), 'Find a route');
  await wide.page.reload();
  await wide.page.waitForFunction(() => document.getElementById('side')!.getBoundingClientRect().width === 76);
  await side.getByRole('button', { name: 'Show the menu' }).click();
  await wide.page.waitForFunction(() => document.getElementById('side')!.getBoundingClientRect().width === 260);
  await shot(wide.page, 'nav-wide');
  assert.deepEqual(wide.errors, []);
  await wide.page.context().close();
});
