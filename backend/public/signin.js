// Signing in for the people who run the buses: bus owners, their staff (managers and conductors),
// route syndicates, and contributors who record routes, with a mobile number and a password. New
// accounts wait for approval: conductors by their owner, everyone else by the Where Is My Bus team.
// Riders never sign in. Built with DOM methods only, never HTML strings, like the owner page. Once
// signed in, the key is kept on this device: owners, managers and syndicates go to the owner page,
// and conductors to the rider app's "Share your bus" screen (web/src/account.ts reads the same key).
// Contributors record routes in the phone app, so this page only tells them so.
'use strict';

const KEY_STORE = 'wimb.owner.key';
const LANG_KEY = 'wimb.lang.v1';
const KINDS = ['owner', 'manager', 'conductor', 'syndicate', 'contributor'];
/** The rider app, opened on its "Share your bus" screen (web/src/main.ts). */
const CONDUCTOR_PAGE = '/#conductor';

// ---------- helpers ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));

function stored(name) {
  try {
    return localStorage.getItem(name) || '';
  } catch {
    return '';
  }
}

function store(name, value) {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    // Storage switched off: they sign in again next time.
  }
}

// English or Bengali: the same choice as in the rider app and on the owner page (owner-bn.js).
const lang = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(LANG_KEY) || 'null');
    if (v === 'en' || v === 'bn') return v;
  } catch {
    // No saved choice.
  }
  return (navigator.languages || [navigator.language]).some((l) => /^bn\b/i.test(l)) ? 'bn' : 'en';
})();
document.documentElement.lang = lang;
const BN = window.OWNER_BN || {};
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const digits = (s) => (lang === 'bn' ? String(s).replace(/[0-9]/g, (d) => BN_DIGITS[d]) : String(s));
function tr(en, vars = {}) {
  const template = lang === 'bn' ? BN[en] || en : en;
  return template.replace(/\{(\w+)\}/g, (whole, k) => (vars[k] === undefined ? whole : digits(vars[k])));
}

async function post(path, body, key) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    // The server's own words, in Bengali too where the table has them.
    const err = new Error(data && data.error ? tr(data.error) : tr('The server answered {status}.', { status: String(res.status) }));
    err.status = res.status;
    throw err;
  }
  return data;
}

function field(label, control, hint, forId) {
  return h('div', { class: 'field' }, h('label', { for: forId || control.id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

/** A password box with a button that shows what was typed. */
function passwordBox(id, autocomplete) {
  const input = h('input', { id, type: 'password', autocomplete, required: true, maxlength: '128', spellcheck: 'false', autocapitalize: 'none' });
  const show = h('button', {
    class: 'btn small show', type: 'button', 'aria-controls': id, 'aria-pressed': 'false',
    onclick: () => {
      const on = input.type === 'password';
      input.type = on ? 'text' : 'password';
      show.setAttribute('aria-pressed', String(on));
      show.textContent = on ? tr('Hide') : tr('Show');
    },
  }, tr('Show'));
  return { input, box: h('div', { class: 'password-box' }, input, show) };
}

const phoneInput = (id, autocomplete) =>
  h('input', { id, type: 'tel', inputmode: 'tel', autocomplete, placeholder: '98300 12345', required: true, maxlength: '20' });

// ---------- state ----------

const params = new URLSearchParams(location.search);
const state = {
  /** signin, signup, done (signed up), change (after a temporary password), forgot, contributor (signed in as one) */
  view: KINDS.includes(params.get('as')) ? 'signup' : 'signin',
  kind: KINDS.includes(params.get('as')) ? params.get('as') : 'owner',
  message: params.has('ended') ? { kind: 'warn', text: tr('You were signed out on this device. Sign in again.') } : null,
  /** Whether a forgotten password can be set again by SMS here. */
  sms: false,
  changeToken: '',
  /** After signing up: what the server said about the new account. */
  made: null,
  /** Forgotten password: the number the code went to. */
  forgotPhone: '',
};

function say(kind, text) {
  state.message = kind ? { kind, text } : null;
}

function go(view) {
  state.view = view;
  say(null);
  render();
  const first = document.querySelector('#main form input:not([type="radio"]), #main form input');
  if (first) first.focus();
}

/** Where each kind of account goes once signed in. */
function signedIn(key, kind) {
  if (kind === 'contributor') {
    // Nothing to do here: routes are recorded in the phone app. This device does not stay signed in.
    void post('/api/accounts/sign-out', {}, key).catch(() => undefined);
    go('contributor');
    return;
  }
  store(KEY_STORE, key);
  location.assign(kind === 'conductor' ? CONDUCTOR_PAGE : '/owner');
}

// ---------- views ----------

function tabs() {
  const tab = (id, label) =>
    h('button', {
      class: 'tab', type: 'button', role: 'tab', id: `tab-${id}`,
      'aria-selected': String(state.view === id), 'aria-controls': 'panel', tabindex: state.view === id ? '0' : '-1',
      onclick: () => go(id),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        go(id === 'signin' ? 'signup' : 'signin');
        document.getElementById(`tab-${state.view}`).focus();
      },
    }, label);
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': tr('Sign in or create an account') }, tab('signin', tr('Sign in')), tab('signup', tr('Create an account')));
}

function messageView() {
  const m = state.message;
  return m ? h('div', { class: `msg ${m.kind}`, role: m.kind === 'error' ? 'alert' : 'status' }, m.text) : null;
}

function signInView() {
  const phone = phoneInput('phone', 'username');
  const password = passwordBox('password', 'current-password');
  return h('form', {
    class: 'card', role: 'tabpanel', id: 'panel', 'aria-labelledby': 'tab-signin',
    onsubmit: (e) => {
      e.preventDefault();
      void signIn(phone.value, password.input.value);
    },
  },
  h('h2', {}, tr('Sign in with your mobile number')),
  field(tr('Mobile number'), phone),
  field(tr('Password'), password.box, null, 'password'),
  h('button', { class: 'btn primary wide', type: 'submit' }, tr('Sign in')),
  h('p', { class: 'hint center' }, h('button', { class: 'link', type: 'button', onclick: () => go('forgot') }, tr('Forgot your password?'))));
}

async function signIn(phone, password) {
  try {
    const r = await post('/api/accounts/sign-in', { phone, password });
    if (r.mustChange) {
      state.changeToken = r.changeToken;
      go('change');
      return;
    }
    signedIn(r.key, r.kind);
  } catch (e) {
    // 403: the right password, for an account still waiting for approval. What was typed stays.
    say(e.status === 403 ? 'warn' : 'error', e.message);
    renderMessage();
    if (e.status !== 403) document.getElementById('password').select();
  }
}

const CHOICES = [
  ['owner', 'A bus owner', 'You add your buses, approve your conductors and see every trip.'],
  ['manager', 'A bus owner’s manager', 'You run a bus owner’s buses for them: you see them, add them and see their trips.'],
  ['conductor', 'A conductor', 'You share your owner’s bus from your phone as you work on it. Your owner approves you.'],
  ['syndicate', 'A route syndicate', 'You see your members’ buses on your routes.'],
  ['contributor', 'A contributor', 'You record bus routes and their stops with the phone app. The Where Is My Bus team approves you.'],
];

const isStaff = (kind) => kind === 'manager' || kind === 'conductor';

function signUpView() {
  const name = h('input', { id: 'name', required: true, maxlength: '80', autocomplete: 'name' });
  const org = h('input', { id: 'org', maxlength: '80', autocomplete: 'organization', placeholder: tr('For example Route 12C/2 syndicate') });
  const ownerPhone = phoneInput('owner-phone', 'off');
  const phone = phoneInput('new-phone', 'username');
  const p1 = passwordBox('new-password', 'new-password');
  const p2 = passwordBox('new-password-2', 'new-password');
  const nameField = field('', name);
  const orgField = field(tr('The syndicate’s name'), org);
  const ownerField = field(tr('Your bus owner’s mobile number'), ownerPhone, ' ');
  const approval = h('p', { class: 'hint' });

  // Only the fields for the kind of account chosen; what is typed stays when the choice changes.
  const showFor = () => {
    const k = state.kind;
    nameField.querySelector('label').textContent = k === 'owner' ? tr('Your name or your company’s name') : tr('Your name');
    name.placeholder = k === 'owner' ? tr('For example Sen Transport') : tr('For example Ramesh Ghosh');
    name.autocomplete = k === 'owner' ? 'organization' : 'name';
    orgField.hidden = k !== 'syndicate';
    org.required = k === 'syndicate';
    ownerField.hidden = !isStaff(k);
    ownerPhone.required = isStaff(k);
    ownerField.querySelector('.hint').textContent = k === 'conductor'
      ? tr('The number they sign in with. They approve your account on their page.')
      : tr('The number they sign in with. The team checks with them too.');
    approval.textContent = k === 'conductor'
      ? tr('Your bus owner checks your account before you can sign in.')
      : tr('The Where Is My Bus team checks every account before it can sign in.');
  };
  const kinds = h('fieldset', { class: 'kinds' },
    h('legend', {}, tr('Who are you?')),
    CHOICES.map(([value, label, hint]) => h('label', { class: 'kind' },
      h('input', { type: 'radio', name: 'kind', value, checked: state.kind === value, onchange: () => { state.kind = value; showFor(); } }),
      h('span', { class: 'kind-text' }, h('span', { class: 'kind-label' }, tr(label)), h('span', { class: 'kind-hint' }, tr(hint))))));
  showFor();

  return h('form', {
    class: 'card', role: 'tabpanel', id: 'panel', 'aria-labelledby': 'tab-signup',
    onsubmit: (e) => {
      e.preventDefault();
      if (p1.input.value !== p2.input.value) {
        say('error', tr('The two passwords are not the same. Type them again.'));
        renderMessage();
        p2.input.focus();
        return;
      }
      void signUp({ kind: state.kind, name: name.value, orgName: org.value, ownerPhone: ownerPhone.value, phone: phone.value, password: p1.input.value });
    },
  },
  h('h2', {}, tr('Create an account')),
  h('p', { class: 'soft' }, tr('For the people who run the buses. Riders do not need an account.')),
  kinds,
  orgField,
  nameField,
  ownerField,
  field(tr('Your mobile number'), phone, tr('You sign in with it. The Where Is My Bus team may call you on it to check who you are.')),
  field(tr('Choose a password'), p1.box, tr('At least 8 characters. Not your mobile number.'), 'new-password'),
  field(tr('Type the password again'), p2.box, null, 'new-password-2'),
  h('button', { class: 'btn primary wide', type: 'submit' }, tr('Create account')),
  approval);
}

async function signUp(body) {
  try {
    state.made = await post('/api/accounts/sign-up', body);
    go('done');
  } catch (e) {
    say('error', e.message);
    renderMessage();
  }
}

function doneView() {
  const m = state.made;
  const back = h('button', { class: 'btn primary', type: 'button', onclick: () => go('signin') }, tr('Back to sign in'));
  if (m.kind === 'conductor') {
    return h('div', { class: 'card' },
      h('h2', {}, tr('Thank you. Your account is waiting for approval')),
      h('p', {}, tr('{owner} approves your account on their page. Ask them to, if they have not yet.', { owner: m.ownerName })),
      h('p', {}, tr('Once they have, sign in here with your mobile number and password. To share a bus, you then choose its route and type its number plate.')),
      back);
  }
  return h('div', { class: 'card' },
    h('h2', {}, tr('Thank you. Your account is waiting for approval')),
    h('p', {}, tr('The Where Is My Bus team checks every new account, and may call you on the number ending {end}.', { end: m.phoneEnd })),
    m.kind === 'manager' ? h('p', {}, tr('They also check with {owner} that you work for them.', { owner: m.ownerName })) : null,
    m.kind === 'syndicate' ? h('p', {}, tr('They also choose the routes and member owners your syndicate sees.')) : null,
    m.kind === 'contributor'
      ? h('p', {}, tr('Once they have approved it, sign in with your mobile number and password in the Where Is My Bus phone app, and record routes there.'))
      : h('p', {}, tr('Once they have approved it, sign in here with your mobile number and password.')),
    back);
}

/** A contributor signed in: recording routes is done in the phone app, not on this page. */
function contributorView() {
  return h('div', { class: 'card' },
    h('h2', {}, tr('Record routes in the phone app')),
    h('p', {}, tr('Your contributor account is ready. Recording a route, and marking its stops as the bus reaches them, is done in the Where Is My Bus phone app.')),
    h('p', {}, tr('Open the app, and sign in there with the same mobile number and password. The Where Is My Bus team checks each recording before it changes a route.')),
    h('button', { class: 'btn primary', type: 'button', onclick: () => go('signin') }, tr('Back to sign in')));
}

function changeView() {
  const p1 = passwordBox('change-password', 'new-password');
  const p2 = passwordBox('change-password-2', 'new-password');
  return h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      if (p1.input.value !== p2.input.value) {
        say('error', tr('The two passwords are not the same. Type them again.'));
        renderMessage();
        p2.input.focus();
        return;
      }
      try {
        const r = await post('/api/accounts/password', { changeToken: state.changeToken, password: p1.input.value });
        signedIn(r.key, r.kind);
      } catch (err) {
        say('error', err.message);
        renderMessage();
      }
    },
  },
  h('h2', {}, tr('Choose your own password')),
  h('p', { class: 'soft' }, tr('You signed in with a temporary password from the Where Is My Bus team. Choose your own to go on; the temporary one then stops working.')),
  field(tr('New password'), p1.box, tr('At least 8 characters. Not your mobile number.'), 'change-password'),
  field(tr('Type the password again'), p2.box, null, 'change-password-2'),
  h('button', { class: 'btn primary wide', type: 'submit' }, tr('Save and go on')));
}

function forgotView() {
  const back = h('button', { class: 'link', type: 'button', onclick: () => { state.forgotPhone = ''; go('signin'); } }, tr('Back to sign in'));
  if (!state.sms) {
    return h('div', { class: 'card' },
      h('h2', {}, tr('Forgot your password?')),
      h('p', {}, tr('Ask the Where Is My Bus team to set a temporary password for you. Sign in with it, and then choose your own.')),
      h('p', { class: 'hint' }, back));
  }
  if (!state.forgotPhone) {
    const phone = phoneInput('forgot-phone', 'username');
    return h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await post('/api/accounts/forgot/code', { phone: phone.value });
          state.forgotPhone = phone.value;
          go('forgot');
          say('ok', tr('If this number has an account, a code is on its way to the number ending {end}.', { end: r.phoneEnd }));
          renderMessage();
        } catch (err) {
          say('error', err.message);
          renderMessage();
        }
      },
    },
    h('h2', {}, tr('Forgot your password?')),
    h('p', { class: 'soft' }, tr('We send a 6-digit code to your mobile by SMS. With it you choose a new password.')),
    field(tr('Mobile number'), phone),
    h('button', { class: 'btn primary wide', type: 'submit' }, tr('Send code')),
    h('p', { class: 'hint' }, back));
  }
  const code = h('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', required: true });
  const p1 = passwordBox('reset-password', 'new-password');
  const p2 = passwordBox('reset-password-2', 'new-password');
  return h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      if (p1.input.value !== p2.input.value) {
        say('error', tr('The two passwords are not the same. Type them again.'));
        renderMessage();
        return;
      }
      try {
        const r = await post('/api/accounts/forgot/reset', { phone: state.forgotPhone, code: code.value, password: p1.input.value });
        if (r.key) {
          signedIn(r.key, r.kind);
          return;
        }
        state.forgotPhone = '';
        go('signin');
        say('warn', tr('Your new password is saved. Your account is still waiting for the Where Is My Bus team to approve it.'));
        renderMessage();
      } catch (err) {
        say('error', err.message);
        renderMessage();
      }
    },
  },
  h('h2', {}, tr('Choose a new password')),
  field(tr('Code from the SMS'), code),
  field(tr('New password'), p1.box, tr('At least 8 characters. Not your mobile number.'), 'reset-password'),
  field(tr('Type the password again'), p2.box, null, 'reset-password-2'),
  h('button', { class: 'btn primary wide', type: 'submit' }, tr('Save and sign in')),
  h('p', { class: 'hint' }, back));
}

/** For anyone here by mistake, and the team's own sign-in. */
function otherLinks() {
  return h('nav', { class: 'card other-sign-ins', 'aria-label': tr('Other pages') },
    h('a', { href: '/' }, tr('Looking for your bus? Riders do not need to sign in.')),
    h('a', { href: '/admin' }, tr('Where Is My Bus team: admin sign-in')));
}

// ---------- page ----------

let messageBox = null;

function renderMessage() {
  if (messageBox) fill(messageBox, messageView());
}

function renderAccount() {
  const other = lang === 'bn' ? 'en' : 'bn';
  fill(document.getElementById('account'),
    h('button', {
      class: 'btn small', type: 'button', lang: other,
      onclick: () => {
        store(LANG_KEY, JSON.stringify(other));
        location.reload();
      },
    }, other === 'bn' ? 'বাংলা' : 'English'));
}

function render() {
  document.getElementById('title').textContent = state.view === 'signup' || state.view === 'done' ? tr('Create an account') : tr('Sign in');
  document.getElementById('subtitle').textContent = tr('For bus owners and their staff, syndicates and contributors');
  document.title = `${document.getElementById('title').textContent} · Where Is My Bus`;
  renderAccount();
  messageBox = h('div', { class: 'messages' }, messageView());
  const views = { signin: signInView, signup: signUpView, done: doneView, change: changeView, forgot: forgotView, contributor: contributorView };
  fill(document.getElementById('main'),
    h('div', { class: 'signin' },
      state.view === 'signin' || state.view === 'signup' ? tabs() : null,
      messageBox,
      views[state.view](),
      otherLinks()));
}

function start() {
  render();
  fetch('/api/accounts/options')
    .then((r) => (r.ok ? r.json() : null))
    .then((o) => {
      state.sms = Boolean(o && o.sms);
      if (state.view === 'forgot') render();
    }, () => undefined);
}

// Already signed in on this device: straight to their page. A conductor's is the rider app's "Share
// your bus" screen; the owner page sends anyone else back here if the key no longer works.
const savedKey = stored(KEY_STORE);
if (savedKey && !params.has('ended')) {
  fetch('/api/accounts/me', { headers: { authorization: `Bearer ${savedKey}` } })
    .then(async (r) => {
      if (r.status === 401) {
        store(KEY_STORE, '');
        start();
        return;
      }
      const me = r.ok ? await r.json() : null;
      if (me && me.kind === 'contributor') {
        store(KEY_STORE, '');
        state.view = 'contributor';
        start();
        return;
      }
      location.replace(me && me.kind === 'conductor' ? CONDUCTOR_PAGE : '/owner');
    }, () => location.replace('/owner'));
} else {
  if (params.has('ended')) store(KEY_STORE, '');
  start();
}
