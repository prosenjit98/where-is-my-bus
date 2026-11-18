import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createOtpBook, type SmsSender } from '../src/otp.ts';
import { hashPassword, makeTempPassword, passwordProblem, verifyPassword } from '../src/passwords.ts';
import { addBus, addOwner, addTestRoute, boot, PASSWORD, TOKEN, type App } from './owner-helpers.ts';

// Signing in on /signin: bus owners, their staff and route syndicates sign up with a mobile number
// and a password, and sign in only once the admin has approved them. A temporary password from the
// admin only lets them choose their own; a forgotten one is set again by SMS where there is a gateway.

const signIn = (app: App, phone: string, password: string, ip?: string) => app.call('POST', '/api/accounts/sign-in', { phone, password }, { ip });
const signUp = (app: App, body: Record<string, unknown>) => app.call('POST', '/api/accounts/sign-up', body);
const overview = (app: App, key: string) => app.call('GET', '/api/owner/overview', undefined, { key });
const TEMP = /^[a-hjkmnp-z2-9]{10}$/;

function fakeSms() {
  const sent: { to: string; text: string }[] = [];
  const sender: SmsSender = { describe: 'the test', send: async (to, text) => void sent.push({ to, text }) };
  return { sender, sent, lastCode: () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '')?.[1] ?? '' };
}

test('passwords are kept as salted scrypt hashes, and easy ones are refused', async () => {
  const a = await hashPassword('Morning-T1-bus');
  assert.match(a, /^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(a, await hashPassword('Morning-T1-bus'), 'each has its own salt');
  assert.equal(await verifyPassword('Morning-T1-bus', a), true);
  assert.equal(await verifyPassword('morning-t1-bus', a), false);
  assert.equal(await verifyPassword('Morning-T1-bus', undefined), false);
  assert.equal(await verifyPassword('anything', 'not a hash'), false);
  assert.equal(passwordProblem(undefined), 'Choose a password.');
  assert.equal(passwordProblem('short'), 'Choose a password of at least 8 characters.');
  for (const easy of ['12345678', 'Password1', 'aaaaaaaaaa']) assert.equal(passwordProblem(easy), 'That password is too easy to guess. Choose another.', easy);
  for (const own of ['9830012345', '+91 98300-12345']) assert.equal(passwordProblem(own, '+919830012345'), 'Do not use your mobile number as the password.', own);
  assert.equal(passwordProblem('Sen Transport 12', '+919830012345'), null);
  assert.match(makeTempPassword(), TEMP);
});

test('an owner signs up with a mobile number and a password, and signs in only once the admin approves', async () => {
  const app = await boot();
  assert.equal((await signUp(app, { kind: 'owner', name: 'Paul Bus Service', phone: '12345', password: PASSWORD })).status, 400);
  assert.equal((await signUp(app, { kind: 'owner', name: 'Paul Bus Service', phone: '98300 55555', password: 'short' })).status, 400);
  assert.equal((await signUp(app, { kind: 'rider', name: 'Paul', phone: '98300 55555', password: PASSWORD })).status, 400);
  const up = await signUp(app, { kind: 'owner', name: 'Paul Bus Service', phone: '098300 55555', password: PASSWORD });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual([up.body.pending, up.body.kind, up.body.phoneEnd], [true, 'owner', '5555']);
  assert.equal((await signUp(app, { kind: 'owner', name: 'Again', phone: '9830055555', password: PASSWORD })).status, 409, 'one account for each number');

  // Waiting: only the right password is told so; anything else just hears it is not right.
  const waiting = await signIn(app, '9830055555', PASSWORD);
  assert.equal(waiting.status, 403);
  assert.match(waiting.body.error, /waiting for the Where Is My Bus team to approve it/);
  const notRight = 'The mobile number or the password is not right.';
  assert.deepEqual([(await signIn(app, '9830055555', 'not-the-password')).body.error, (await signIn(app, '9830099999', PASSWORD)).body.error], [notRight, notRight]);

  // The admin sees the whole number, to call and check, and approves.
  const [listed] = (await app.call('GET', '/api/admin/owners', undefined, { key: TOKEN })).body.owners;
  assert.deepEqual([listed.name, listed.pending, listed.people[0].phone, listed.people[0].password], ['Paul Bus Service', true, '+919830055555', 'set']);
  assert.deepEqual((await app.call('GET', '/api/admin/dashboard', undefined, { key: TOKEN })).body.owners.waiting, [{ kind: 'owner', id: listed.id, name: 'Paul Bus Service' }]);
  await app.call('POST', `/api/admin/owners/${listed.id}/approve`, undefined, { key: TOKEN });

  const ok = await signIn(app, '+91 98300 55555', PASSWORD);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.kind, 'owner');
  const mine = (await overview(app, ok.body.key)).body;
  assert.deepEqual([mine.owner.name, mine.owner.pending, mine.me.phoneEnd], ['Paul Bus Service', false, '5555']);
  await addBus(app, ok.body.key, 'WB 19 B 5555');
  // Only a hash of the password is kept.
  const file = readFileSync(path.join(app.dir, 'owners.json'), 'utf8');
  assert.ok(!file.includes(PASSWORD));
  assert.match(file, /"passwordHash": "scrypt\$/);
});

test('staff sign up with their owner’s number; once approved they run the buses, and only the owner sees and removes people', async () => {
  const app = await boot();
  const sen = await addOwner(app, 'Sen Transport');
  const staffUp = { kind: 'manager', name: 'Ramesh Ghosh', phone: '9830066666', ownerPhone: sen.phone, password: PASSWORD };
  assert.equal((await signUp(app, { ...staffUp, ownerPhone: '9830000999' })).status, 400, 'no owner has that number');
  const up = await signUp(app, staffUp);
  assert.deepEqual([up.status, up.body.kind, up.body.ownerName], [200, 'manager', 'Sen Transport']);
  assert.equal((await signIn(app, '9830066666', PASSWORD)).status, 403, 'not before the admin approves');

  // The owner sees them waiting; the admin approves.
  const people = (await overview(app, sen.key)).body.people as { id: string; name: string; role: string; pending: boolean }[];
  assert.deepEqual(people.map((p) => [p.name, p.role, p.pending]), [['Sen Transport', 'owner', false], ['Ramesh Ghosh', 'manager', true]]);
  assert.deepEqual((await app.call('GET', '/api/admin/dashboard', undefined, { key: TOKEN })).body.owners.waiting, [{ kind: 'manager', id: people[1].id, name: 'Ramesh Ghosh', of: 'Sen Transport' }]);
  assert.equal((await app.call('POST', `/api/admin/owners/${sen.id}/people/${people[1].id}/approve`, undefined, { key: TOKEN })).status, 200);
  const signed = await signIn(app, '9830066666', PASSWORD);
  assert.equal(signed.body.kind, 'manager');
  const staff = signed.body.key as string;

  // They run the buses: they add one, but do not see or manage people.
  const bus = await addBus(app, staff, 'WB 19 A 5555');
  const seen = (await overview(app, staff)).body;
  assert.deepEqual([seen.me.name, seen.me.role, seen.owner.name], ['Ramesh Ghosh', 'manager', 'Sen Transport']);
  assert.deepEqual(seen.people, []);
  assert.equal(seen.buses[0].plate, bus.plate);
  assert.equal((await app.call('DELETE', `/api/owner/people/${people[1].id}`, undefined, { key: staff })).status, 403);
  assert.equal((await app.call('DELETE', `/api/owner/people/${people[0].id}`, undefined, { key: sen.key })).status, 400, 'the owner is not removed here');

  // The owner removes them, and their key stops working; the admin can turn a request down too.
  assert.equal((await app.call('DELETE', `/api/owner/people/${people[1].id}`, undefined, { key: sen.key })).status, 200);
  assert.equal((await overview(app, staff)).status, 401);
  const again = await signUp(app, staffUp);
  assert.equal(again.status, 200, 'the number is free again');
  assert.equal((await app.call('DELETE', `/api/admin/owners/${sen.id}/people/${again.body.id}`, undefined, { key: TOKEN })).status, 200);
  assert.equal((await signIn(app, '9830066666', PASSWORD)).status, 401);
});

test('a syndicate signs up; the admin chooses its routes and members as they approve it', async () => {
  const app = await boot();
  await addTestRoute(app);
  const sen = await addOwner(app, 'Sen Transport');
  const up = await signUp(app, { kind: 'syndicate', orgName: 'T1 syndicate', name: 'Bijoy Saha', phone: '9830077777', password: PASSWORD });
  assert.deepEqual([up.status, up.body.kind, up.body.name], [200, 'syndicate', 'T1 syndicate']);
  assert.equal((await signIn(app, '9830077777', PASSWORD)).status, 403);
  const [listed] = (await app.call('GET', '/api/admin/syndicates', undefined, { key: TOKEN })).body.syndicates;
  assert.deepEqual([listed.name, listed.contactName, listed.phone, listed.pending, listed.routeIds], ['T1 syndicate', 'Bijoy Saha', '+919830077777', true, []]);
  const approve = (routeIds: string[]) => app.call('POST', `/api/admin/syndicates/${listed.id}/approve`, { name: 'T1 syndicate', routeIds, ownerIds: [sen.id] }, { key: TOKEN });
  assert.equal((await approve([])).status, 400, 'its routes first');
  assert.equal((await approve(['t1'])).status, 200);

  const signed = await signIn(app, '9830077777', PASSWORD);
  assert.equal(signed.body.kind, 'syndicate');
  const view = (await overview(app, signed.body.key)).body;
  assert.deepEqual(
    [view.kind, view.syndicate.routes.map((r: { number: string }) => r.number), view.syndicate.members.map((m: { name: string }) => m.name)],
    ['syndicate', ['T1'], ['Sen Transport']],
  );
  assert.equal((await app.call('POST', '/api/owner/buses', { plate: 'WB 19 A 3003' }, { key: signed.body.key })).status, 403);
});

test('a temporary password from the admin only lets them choose their own; a new password signs the other devices out', async () => {
  const app = await boot();
  assert.equal((await app.call('POST', '/api/admin/owners', { name: 'Das Travels', phone: 'none' }, { key: TOKEN })).status, 400);
  const made = await app.call('POST', '/api/admin/owners', { name: 'Das Travels', phone: '9830088888' }, { key: TOKEN });
  assert.match(made.body.password, TEMP);
  assert.equal(made.body.owner.people[0].password, 'temporary');
  const first = await signIn(app, '9830088888', made.body.password);
  assert.deepEqual([first.body.mustChange, first.body.key], [true, undefined], 'no key with a temporary password');
  const choose = (body: Record<string, unknown>, key?: string) => app.call('POST', '/api/accounts/password', body, { key });
  assert.equal((await choose({ changeToken: first.body.changeToken, password: 'short' })).status, 400);
  assert.equal((await choose({ changeToken: 'made-up', password: PASSWORD })).status, 401);
  const chosen = await choose({ changeToken: first.body.changeToken, password: PASSWORD });
  assert.equal(chosen.status, 200);
  const phoneKey = chosen.body.key as string;
  assert.equal((await choose({ changeToken: first.body.changeToken, password: 'Another-pass-1' })).status, 401, 'a change token works once');
  assert.equal((await signIn(app, '9830088888', made.body.password)).status, 401, 'the temporary password is gone');

  // A second device; then a change of password on it, which needs the present one.
  const laptop = (await signIn(app, '9830088888', PASSWORD)).body.key as string;
  assert.equal((await overview(app, phoneKey)).body.people[0].devices, 2);
  assert.equal((await choose({ current: 'not-it', password: 'New-pass-2026' }, laptop)).status, 400);
  const changed = await choose({ current: PASSWORD, password: 'New-pass-2026' }, laptop);
  assert.equal(changed.status, 200);
  assert.deepEqual([(await overview(app, phoneKey)).status, (await overview(app, laptop)).status], [401, 401], 'every device is signed out; the answer has a new key');
  assert.equal((await overview(app, changed.body.key)).status, 200);

  // Signing out ends that key.
  assert.equal((await app.call('POST', '/api/accounts/sign-out', undefined, { key: changed.body.key })).status, 200);
  assert.equal((await overview(app, changed.body.key)).status, 401);

  // Forgotten: the admin gives a new temporary password, and every device is signed out.
  const again = (await signIn(app, '9830088888', 'New-pass-2026')).body.key as string;
  const reset = await app.call('POST', `/api/admin/owners/${made.body.owner.id}/people/${made.body.owner.people[0].id}/password`, {}, { key: TOKEN });
  assert.match(reset.body.password, TEMP);
  assert.equal((await overview(app, again)).status, 401);
  assert.equal((await signIn(app, '9830088888', 'New-pass-2026')).status, 401);
  assert.equal((await signIn(app, '9830088888', reset.body.password)).body.mustChange, true);
});

test('ten wrong passwords for one number stop it for 15 minutes, from any network', async () => {
  const app = await boot();
  const sen = await addOwner(app, 'Sen Transport');
  const das = await addOwner(app, 'Das Travels');
  for (let i = 0; i < 10; i++) assert.equal((await signIn(app, sen.phone, `wrong-${i}-pass`, `10.0.0.${i + 1}`)).status, 401);
  assert.equal((await signIn(app, sen.phone, PASSWORD, '10.0.1.1')).status, 429, 'even the right password waits');
  assert.equal((await signIn(app, das.phone, PASSWORD, '10.0.0.1')).status, 200, 'another number from those networks does not');
});

test('a forgotten password is set again with a code by SMS, where there is a gateway', async () => {
  const sms = fakeSms();
  const app = await boot(undefined, { sms: sms.sender, otp: createOtpBook({ ttlMs: 600_000, maxTries: 5, resendMs: 0, perHour: 100 }) });
  assert.deepEqual((await app.call('GET', '/api/accounts/options')).body, { sms: true });
  const sen = await addOwner(app, 'Sen Transport');
  // A number without an account gets the same answer, and no SMS.
  assert.deepEqual((await app.call('POST', '/api/accounts/forgot/code', { phone: '9830012121' })).body, { sent: true, phoneEnd: '2121' });
  assert.equal(sms.sent.length, 0);
  assert.equal((await app.call('POST', '/api/accounts/forgot/code', { phone: sen.phone })).body.sent, true);
  assert.equal(sms.sent[0].to, `+91${sen.phone}`);
  assert.match(sms.sent[0].text, /^\d{6} is your Where Is My Bus code to set a new password/);
  const code = sms.lastCode();
  const reset = (body: Record<string, unknown>) => app.call('POST', '/api/accounts/forgot/reset', { phone: sen.phone, ...body });
  assert.equal((await reset({ code: code === '000000' ? '111111' : '000000', password: 'Fresh-pass-9' })).status, 400);
  const done = await reset({ code, password: 'Fresh-pass-9' });
  assert.equal(done.status, 200);
  assert.equal((await overview(app, sen.key)).status, 401, 'other devices are signed out');
  assert.equal((await overview(app, done.body.key)).status, 200);
  assert.equal((await reset({ code, password: 'Again-pass-9' })).status, 400, 'a code works once');
  assert.equal((await signIn(app, sen.phone, 'Fresh-pass-9')).status, 200);

  // Five wrong guesses use a code up.
  await app.call('POST', '/api/accounts/forgot/code', { phone: sen.phone });
  const right = sms.lastCode();
  for (let i = 0; i < 5; i++) assert.equal((await reset({ code: right === '000000' ? '111111' : '000000', password: 'Late-pass-99' })).status, 400);
  const late = await reset({ code: right, password: 'Late-pass-99' });
  assert.equal(late.status, 400);
  assert.match(late.body.error, /run out/);
});

test('without an SMS gateway, the admin sets a forgotten password', async () => {
  const app = await boot();
  assert.deepEqual((await app.call('GET', '/api/accounts/options')).body, { sms: false });
  assert.equal((await app.call('POST', '/api/accounts/forgot/code', { phone: '9830012345' })).status, 404);
});
