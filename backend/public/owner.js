// Where Is My Bus for bus owners: where each bus is now, and the trips it ran. Served as its own
// file so the page can refuse inline scripts. Everything shown is built with DOM methods, never
// HTML strings, so plates and names cannot inject scripts. The same page shows a route
// syndicate's read-only view. Signing in is on /signin (signin.js); without a key that works, the
// page goes there.
'use strict';

const KEY_STORE = 'wimb.owner.key';
const SEEN_STORE = 'wimb.owner.seenAlerts';
const NOTIFY_STORE = 'wimb.owner.notify';
const REFRESH_MS = 15_000;
/** With positions pushed as buses move (openLive), the rest is updated every minute. */
const LIVE_REFRESH_MS = 60_000;
/** While the page is hidden it still checks for alerts, if the owner asked to be told. */
const HIDDEN_REFRESH_MS = 60_000;
const TZ = 'Asia/Kolkata';

const state = {
  key: '',
  data: null,
  /** The day shown, YYYY-MM-DD; empty for today. */
  date: '',
  /** null, { kind: 'add' } or { kind: 'edit', busId } */
  form: null,
  /** Buses whose details are open. */
  open: new Set(),
  message: null,
  loading: false,
  /** Asked for again while loading, for example another day: load once more when done. */
  again: false,
  /** Alerts the owner marked as seen, and the ones already shown as notifications. */
  seen: new Set(),
  notified: null,
};

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

// ---------- language ----------

// English or Bengali: the choice made in the rider app on this device (the same setting), else the
// browser's language. The Bengali wording is in owner-bn.js, keyed by the English.
const LANG_KEY = 'wimb.lang.v1';
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
const BN_COUNT = window.OWNER_BN_COUNT || {};
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Numbers in the language's digits. Plates and route numbers are not passed through this. */
const digits = (s) => (lang === 'bn' ? String(s).replace(/[0-9]/g, (d) => BN_DIGITS[d]) : String(s));
/** The text in the page's language, with {name} filled in; numbers in Bengali digits for Bengali. */
function tr(en, vars = {}) {
  const template = lang === 'bn' ? BN[en] || en : en;
  return template.replace(/\{(\w+)\}/g, (whole, k) => {
    const v = vars[k];
    if (v === undefined) return whole;
    return typeof v === 'number' ? digits(v) : String(v);
  });
}

const locale = lang === 'bn' ? 'bn-IN' : 'en-GB';
const clockFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const clock = (ts) => clockFormat.format(new Date(ts));
const dayLabel = (iso) => dayFormat.format(new Date(`${iso}T12:00:00+05:30`));
const plural = (n, one, many) =>
  lang === 'bn' && BN_COUNT[many] ? BN_COUNT[many].replace('{n}', digits(n)) : `${n} ${n === 1 ? one : many}`;
const km = (x) => tr('{km} km', { km: digits(x >= 100 ? Math.round(x) : x.toFixed(1)) });
const ago = (sec) => (sec < 60 ? tr('{sec} s ago', { sec }) : tr('{min} min ago', { min: Math.round(sec / 60) }));
const plateDigits = (plate) => plate.replace(/\D/g, '').slice(-4);
const isSyndicate = (d) => d && d.kind === 'syndicate';
const isMainOwner = (d) => d && d.kind === 'owner' && d.me.role === 'owner';

function board(number, operator, size) {
  return h('span', { class: `board ${operator}${size ? ` ${size}` : ''}`, role: 'img', 'aria-label': tr('Route {route}', { route: number }) }, number);
}

function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', { for: control.id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

function setMessage(kind, text) {
  state.message = kind ? { kind, text } : null;
}

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
    // Storage switched off: the owner signs in again next time.
  }
}

const storeKey = (key) => store(KEY_STORE, key);

// ---------- API ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(state.key ? { authorization: `Bearer ${state.key}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (opts.raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    // The server's own words, in Bengali too where the table has them.
    const err = new Error(data && data.error ? tr(data.error) : tr('The server answered {status}.', { status: String(res.status) }));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refresh() {
  if (!state.key) return;
  if (state.loading) {
    state.again = true;
    return;
  }
  state.loading = true;
  state.again = false;
  lastFullAt = Date.now();
  try {
    state.data = await api(`/api/owner/overview${state.date ? `?date=${state.date}` : ''}`);
    if (state.message && state.message.offline) setMessage(null);
    if (document.visibilityState === 'visible') void openLive();
  } catch (e) {
    if (e.status === 403) {
      // A conductor's account, which only shares buses: the sign-in page sends them to the rider app.
      closeLive();
      location.replace('/signin');
      return;
    }
    if (e.status === 401) {
      // Signed out on this device: by a new password, or the admin.
      toSignIn(true);
      return;
    }
    state.message = { kind: 'error', text: tr('Could not reach the server. Trying again in a few seconds.'), offline: true };
  } finally {
    state.loading = false;
  }
  render();
  notifyNewAlerts();
  if (state.again) void refresh();
}

// ---------- live updates ----------

/** The full update: every 15 seconds, or every minute while positions are pushed between them. */
let lastFullAt = 0;
/** The open stream of pushed positions (/api/owner/live), as its AbortController. */
let liveStream = null;

/** A fetch stream rather than EventSource, because it carries the sign-in key in its header. */
async function openLive() {
  if (liveStream || !state.key || !window.ReadableStream || !window.TextDecoder) return;
  const ctrl = new AbortController();
  liveStream = ctrl;
  try {
    const res = await fetch('/api/owner/live', { headers: { authorization: `Bearer ${state.key}` }, signal: ctrl.signal });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = /^data: (.*)$/m.exec(block);
        if (/^event: buses$/m.test(block) && data) applyLive(JSON.parse(data[1]));
      }
    }
  } catch {
    // Offline, signed out or the page hidden: the full updates carry on, and the stream opens again.
  } finally {
    if (liveStream === ctrl) liveStream = null;
  }
}

function closeLive() {
  if (liveStream) liveStream.abort();
  liveStream = null;
}

/** Positions pushed between full updates. A bus that starts or stops sharing brings a full update. */
function applyLive(msg) {
  const d = state.data;
  if (!d || d.date !== d.today || !Array.isArray(msg.buses)) return;
  const pushed = new Map(msg.buses.map((b) => [b.id, b.now]));
  let started = false;
  for (const b of d.buses) {
    if (!pushed.has(b.id)) continue;
    const now = pushed.get(b.id);
    if (Boolean(now) !== Boolean(b.now) || (now && b.now && now.state !== b.now.state)) started = true;
    b.now = now;
  }
  render();
  if (started) void refresh();
}

/** To the sign-in page; `ended`: this device's key stopped working. */
function toSignIn(ended) {
  closeLive();
  storeKey('');
  location.replace(ended ? '/signin?ended=1' : '/signin');
}

async function signOut() {
  try {
    await api('/api/accounts/sign-out', { method: 'POST' });
  } catch {
    // Offline: the key is forgotten here anyway, and stops working with the next new password.
  }
  toSignIn(false);
}

// ---------- map ----------

let map = null;
let busLayer = null;
let mapNote = null;
let shownOnMap = '';

function initMap(el) {
  if (!window.L) {
    el.append(h('p', { class: 'map-missing' }, tr('The map could not load. Everything else works without it.')));
    return;
  }
  map = L.map(el).setView([22.55, 88.37], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  busLayer = L.layerGroup().addTo(map);
  mapNote = h('p', { class: 'map-note', role: 'status' });
  el.append(mapNote);
  // The page is laid out after the map is made, so it learns its real size a frame later.
  requestAnimationFrame(() => map && map.invalidateSize());
}

const onRoad = (d) => d.buses.filter((b) => b.now && b.now.state === 'on_route');

function drawMap(d) {
  if (!map) return;
  busLayer.clearLayers();
  const live = onRoad(d);
  for (const b of live) {
    const label = tr('{plate}, route {route} towards {place}', { plate: b.plate, route: b.now.routeNumber, place: b.now.headsign });
    const pin = h('span', { class: 'bus-pin' }, board(b.now.routeNumber, b.now.operator, 'sm'), h('span', { class: 'pin-plate' }, plateDigits(b.plate)));
    const marker = L.marker([b.now.lat, b.now.lng], {
      icon: L.divIcon({ html: pin, className: 'bus-icon', iconSize: null }),
      title: label,
      alt: label,
      keyboard: false,
    });
    marker.on('click', () => showCard(b.id));
    busLayer.addLayer(marker);
  }
  mapNote.textContent = isSyndicate(d) ? tr('None of the syndicate’s buses is on its routes now.') : tr('None of your buses is on the road now.');
  mapNote.hidden = live.length > 0;
  // Fit the map to the buses when the set of buses on the road changes, not on every update.
  const ids = live.map((b) => b.id).sort().join();
  if (ids && ids !== shownOnMap) map.fitBounds(live.map((b) => [b.now.lat, b.now.lng]), { padding: [50, 50], maxZoom: 15 });
  shownOnMap = ids;
}

function showOnMap(bus) {
  if (!map || !bus.now || bus.now.state !== 'on_route') return;
  map.setView([bus.now.lat, bus.now.lng], 16);
  if (window.matchMedia('(max-width: 900px)').matches) ui.mapEl.scrollIntoView({ block: 'start' });
}

function showCard(busId) {
  const head = document.getElementById(`bus-${busId}`);
  if (!head) return;
  head.scrollIntoView({ block: 'center' });
  head.focus();
}

// ---------- views ----------

function messageView() {
  const m = state.message;
  return m ? h('div', { class: `msg ${m.kind}`, role: m.kind === 'error' ? 'alert' : 'status' }, m.text) : null;
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('p', { class: 'tile-label' }, label), h('p', { class: 'tile-value' }, value), sub ? h('p', { class: 'tile-sub' }, sub) : null);
}

function kpis(d) {
  const isToday = d.date === d.today;
  const whole = d.trips.filter((t) => t.wholeRoute).length;
  const distance = d.trips.reduce((sum, t) => sum + t.km, 0);
  const ran = new Set(d.trips.map((t) => t.busId)).size;
  return [
    isToday
      ? tile(tr('On the road'), digits(onRoad(d).length), tr('of {buses}', { buses: plural(d.buses.length, 'bus', 'buses') }))
      : tile(tr('Buses that ran'), digits(ran), tr('of {buses}', { buses: plural(d.buses.length, 'bus', 'buses') })),
    tile(tr('Trips'), digits(d.trips.length), tr('{n} end to end', { n: whole })),
    tile(tr('Distance'), km(distance), isToday ? tr('today') : dayLabel(d.date)),
  ];
}

function statusView(b, d) {
  const n = b.now;
  let dot = 'idle';
  let title;
  let detail;
  if (n && n.state === 'on_route') {
    const quiet = n.lastSeenSec > 120;
    dot = quiet ? 'warn' : 'ok';
    title = quiet ? tr('On the road, no update for {min} min', { min: Math.round(n.lastSeenSec / 60) }) : tr('On the road');
    detail = [
      board(n.routeNumber, n.operator, 'sm'),
      ' ',
      n.nextStop
        ? tr('towards {place}, next stop {stop}.', { place: n.headsign, stop: n.nextStop })
        : tr('towards {place}, at the end of the route.', { place: n.headsign }),
      quiet ? '' : ` ${tr('Updated {ago}.', { ago: ago(n.lastSeenSec) })}`,
    ];
  } else if (n) {
    dot = 'warn';
    title = n.lastSeenAt ? tr('Sharing, but no position since {time}', { time: clock(n.lastSeenAt) }) : tr('Sharing, waiting for the bus to reach its route');
    detail = [board(n.routeNumber, n.operator, 'sm'), ' ', tr('towards {place}. Started at {time}.', { place: n.headsign, time: clock(n.since) })];
  } else {
    title = isSyndicate(d) ? tr('Not on these routes now') : tr('Not sharing now');
    const lastDay = b.lastTrip ? dayOfTs(b.lastTrip.movedAt) : null;
    detail = b.lastTrip
      ? lastDay !== d.today
        ? tr('Last trip ended at {time} on {day}, at {stop}.', { time: clock(b.lastTrip.movedAt), day: dayLabel(lastDay), stop: b.lastTrip.toStop })
        : tr('Last trip ended at {time}, at {stop}.', { time: clock(b.lastTrip.movedAt), stop: b.lastTrip.toStop })
      : isSyndicate(d) ? tr('No trips on these routes in the last 7 days.') : tr('No trips in the last 7 days.');
  }
  return h('div', { class: 'status' },
    h('span', { class: `dot ${dot}`, 'aria-hidden': 'true' }),
    h('div', {},
      h('p', { class: 'status-title' }, title),
      h('p', { class: 'status-detail' }, detail),
      n && n.state === 'on_route' && map
        ? h('button', { class: 'link', type: 'button', 'data-focus': `${b.id}:map`, onclick: () => showOnMap(b) }, tr('Show on map'))
        : null));
}

function dayOfTs(ts) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(new Date(ts));
}

function dayLine(day, d) {
  const when = d.date === d.today ? tr('Today') : dayLabel(d.date);
  if (!day.trips) return tr('{when}: no trips.', { when });
  return [
    `${tr('{when}: {trips}, {whole} end to end', { when, trips: plural(day.trips, 'trip', 'trips'), whole: day.wholeRoute })} · ${km(day.km)} · `,
    h('span', { class: 'nowrap' }, `${clock(day.firstAt)}–${clock(day.lastAt)}`),
  ];
}

function tripItem(t, withPlate) {
  const meta = [tr('{from} to {to}', { from: t.fromStop, to: t.toStop }), tr('{n} of {stops}', { n: t.stops, stops: plural(t.stopCount, 'stop', 'stops') }), km(t.km)];
  if (t.ended === 'no_signal') meta.push(tr('signal lost'));
  if (t.ended === 'bus_removed') meta.push(tr('bus removed'));
  return h('li', { class: 'trip' },
    h('span', { class: 'trip-time' }, `${clock(t.departedAt)}–${t.running ? tr('now') : clock(t.movedAt)}`),
    h('div', {},
      h('div', { class: 'trip-route' },
        withPlate ? h('span', { class: 'plate' }, t.plate) : null,
        board(t.routeNumber, t.operator, 'sm'),
        h('span', {}, tr('towards {place}', { place: t.headsign })),
        t.running ? h('span', { class: 'chip ok' }, tr('Running')) : t.wholeRoute ? h('span', { class: 'chip' }, tr('End to end')) : null),
      h('p', { class: 'meta' }, meta.join(' · '))));
}

function tripList(trips, withPlate) {
  return trips.length
    ? h('ol', { class: 'trips' }, trips.map((t) => tripItem(t, withPlate)))
    : h('p', { class: 'soft' }, tr('No trips on this day.'));
}

function weekTable(b, d) {
  return h('table', { class: 'week' },
    h('caption', {}, tr('Last 7 days')),
    h('thead', {}, h('tr', {}, ['Day', 'Trips', 'End to end', 'Km'].map((c) => h('th', { scope: 'col' }, tr(c))))),
    h('tbody', {}, [...b.week].reverse().map((w) => h('tr', { class: w.date === d.date ? 'current' : null },
      h('th', { scope: 'row' }, h('button', {
        class: 'link', type: 'button', 'data-focus': `${b.id}:day:${w.date}`,
        'aria-label': tr('Show {day}', { day: dayLabel(w.date) }),
        onclick: () => showDay(w.date),
      }, w.date === d.today ? tr('Today') : dayLabel(w.date))),
      h('td', {}, digits(w.trips)),
      h('td', {}, digits(w.wholeRoute)),
      h('td', {}, digits(w.km.toFixed(1)))))));
}

/** The changes an owner or manager makes to a bus; a syndicate sees its buses read-only. */
function busTools(b) {
  return [
    h('p', { class: 'hint' }, tr('Your conductors type this number plate when they start sharing the bus.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', 'data-focus': `${b.id}:edit`, onclick: () => openForm({ kind: 'edit', busId: b.id }) }, tr('Change plate or name')),
      h('button', { class: 'btn small danger', type: 'button', 'data-focus': `${b.id}:remove`, onclick: () => void removeBus(b) }, tr('Remove bus'))),
  ];
}

function busCard(b, d) {
  const trips = d.trips.filter((t) => t.busId === b.id);
  const details = h('details', { open: state.open.has(b.id) },
    h('summary', { 'data-focus': `${b.id}:summary` }, tr('Trips')),
    h('h3', {}, d.date === d.today ? tr('Trips today') : tr('Trips on {day}', { day: dayLabel(d.date) })),
    tripList(trips, false),
    weekTable(b, d),
    isSyndicate(d) ? null : busTools(b));
  details.addEventListener('toggle', () => {
    if (details.open) state.open.add(b.id);
    else state.open.delete(b.id);
  });
  return h('li', { class: 'card' },
    h('div', { class: 'bus-head', id: `bus-${b.id}`, tabindex: '-1' },
      h('span', { class: 'plate' }, b.plate),
      b.label ? h('span', { class: 'bus-name' }, b.label) : null,
      isSyndicate(d) ? h('span', { class: 'soft' }, b.owner) : null),
    statusView(b, d),
    h('p', { class: 'day-line' }, dayLine(b.day, d)),
    details);
}

function busesView(d) {
  if (!d.buses.length) {
    if (isSyndicate(d)) return h('div', { class: 'card' }, h('h2', {}, tr('No buses yet')), h('p', {}, tr('The syndicate’s members have not added buses yet.')));
    return h('div', { class: 'card' },
      h('h2', {}, d.owner.pending ? tr('Your buses') : tr('Add your first bus')),
      h('p', {}, tr('Add each bus with its number plate. When one of your conductors shares it in the Where Is My Bus app, you see here where the bus is and every trip it runs.')));
  }
  return h('ul', { class: 'bus-list', 'aria-label': isSyndicate(d) ? tr('The syndicate’s buses') : tr('Your buses') }, d.buses.map((b) => busCard(b, d)));
}

function removedView(d) {
  const ids = new Set(d.buses.map((b) => b.id));
  const trips = d.trips.filter((t) => !ids.has(t.busId));
  return trips.length ? h('section', { class: 'card' }, h('h2', {}, isSyndicate(d) ? tr('Buses since removed') : tr('Buses you removed')), tripList(trips, true)) : null;
}

// ---------- alerts ----------

function alertTitle(a) {
  if (a.kind === 'quiet') return tr('{plate}: no position for {min} min', { plate: a.plate, min: Math.max(5, Math.round((Date.now() - a.at) / 60_000)) });
  return a.ended === 'no_signal' ? tr('{plate} lost its signal mid-trip', { plate: a.plate }) : tr('{plate} stopped sharing mid-trip', { plate: a.plate });
}

function alertText(a) {
  const vars = { route: a.routeNumber, place: a.headsign, time: clock(a.at), stop: a.afterStop, n: a.stops, stops: plural(a.stopCount, 'stop', 'stops') };
  return a.kind === 'quiet'
    ? tr('Route {route} towards {place}. Last heard from at {time}, after {stop}: {n} of {stops}.', vars)
    : tr('Route {route} towards {place}. Stopped at {time}, after {stop}: {n} of {stops}.', vars);
}

function alertsView(d) {
  const shown = d.date === d.today ? d.alerts.filter((a) => !state.seen.has(a.id)) : [];
  if (!shown.length) return null;
  return h('section', { class: 'card alerts', 'aria-labelledby': 'alerts-title' },
    h('h2', { id: 'alerts-title' }, shown.length === 1 ? tr('1 thing to check') : tr('{n} things to check', { n: shown.length })),
    h('ul', { class: 'alert-list' }, shown.map((a) => h('li', { class: 'alert' },
      h('span', { class: 'dot warn', 'aria-hidden': 'true' }),
      h('div', { class: 'grow' },
        h('p', { class: 'status-title' }, alertTitle(a)),
        h('p', { class: 'status-detail' }, alertText(a))),
      h('button', { class: 'btn small', type: 'button', 'data-focus': `alert:${a.id}`, onclick: () => markSeen(a.id) }, tr('Seen'))))));
}

function markSeen(id) {
  state.seen.add(id);
  store(SEEN_STORE, JSON.stringify([...state.seen].slice(-300)));
  render();
}

/** "Tell me on this phone": alerts as notifications, while this page is open, even in the background. */
function notifyView() {
  if (!('Notification' in window)) return null;
  if (Notification.permission === 'denied') return h('p', { class: 'hint' }, tr('Notifications are blocked for this page in the browser’s settings.'));
  if (Notification.permission === 'granted' && stored(NOTIFY_STORE)) {
    return h('p', { class: 'hint' }, tr('You are told about new alerts on this device while this page is open. '),
      h('button', { class: 'link', type: 'button', onclick: () => { store(NOTIFY_STORE, ''); renderStatic(); } }, tr('Stop')));
  }
  return h('button', { class: 'btn small', type: 'button', onclick: () => void askToNotify() }, tr('Tell me about alerts on this device'));
}

async function askToNotify() {
  if ((await Notification.requestPermission()) === 'granted') {
    store(NOTIFY_STORE, '1');
    await notifier();
  }
  renderStatic();
}

let notifierReady = null;

/** Phones show notifications only through a service worker; this one does nothing else (owner-sw.js). */
function notifier() {
  if (!notifierReady) notifierReady = 'serviceWorker' in navigator ? registerNotifier().catch(() => null) : Promise.resolve(null);
  return notifierReady;
}

async function registerNotifier() {
  const reg = await navigator.serviceWorker.register('/owner/sw.js', { scope: '/owner/' });
  const worker = reg.installing || reg.waiting;
  if (worker && !reg.active) {
    await new Promise((resolve) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'redundant') resolve();
      });
      setTimeout(resolve, 10_000);
    });
  }
  return reg.active ? reg : null;
}

async function notifyNewAlerts() {
  const d = state.data;
  if (!d || !d.alerts) return;
  // Alerts there when the page opened are on the page; only later ones become notifications.
  if (!state.notified) {
    state.notified = new Set(d.alerts.map((a) => a.id));
    return;
  }
  const fresh = d.alerts.filter((a) => !state.notified.has(a.id) && !state.seen.has(a.id));
  for (const a of fresh) state.notified.add(a.id);
  if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted' || !stored(NOTIFY_STORE)) return;
  const reg = await notifier();
  for (const a of fresh) {
    const opts = { body: alertText(a), tag: a.id, icon: '/web/icons/icon-192.png' };
    try {
      if (reg) await reg.showNotification(alertTitle(a), opts);
      else new Notification(alertTitle(a), opts);
    } catch {
      // Some browsers show notifications only from a service worker; the alert is on the page anyway.
    }
  }
}

// ---------- people and the account ----------

const ROLE_WORDS = { owner: 'Owner', manager: 'Manager', conductor: 'Conductor' };

function peopleList(d) {
  return d.people.map((p) => h('li', { class: 'person' },
    h('div', { class: 'grow' },
      h('p', { class: 'status-title' }, p.id === d.me.id ? tr('{name} (you)', { name: p.name }) : p.name,
        p.pending ? h('span', { class: 'chip warn' }, tr('Waiting for approval')) : null),
      h('p', { class: 'meta' }, [
        tr(ROLE_WORDS[p.role] || 'Staff'),
        p.phoneEnd ? tr('signs in with the number ending {end}', { end: p.phoneEnd }) : null,
        p.pending && p.role === 'manager' ? tr('the Where Is My Bus team approves managers') : null,
      ].filter(Boolean).join(' · '))),
    p.role === 'owner'
      ? null
      : h('div', { class: 'row' },
          p.pending && p.role === 'conductor'
            ? h('button', { class: 'btn small primary', type: 'button', 'data-focus': `person:${p.id}:approve`, onclick: () => void approvePerson(p) }, tr('Approve'))
            : null,
          h('button', { class: 'btn small danger', type: 'button', 'data-focus': `person:${p.id}:remove`, onclick: () => void removePerson(p) }, tr('Remove')))));
}

function peopleSection() {
  ui.peopleList = h('ul', { class: 'people', 'aria-label': tr('People who sign in for you') });
  return h('section', { class: 'card', hidden: true },
    h('h2', {}, tr('People')),
    h('p', { class: 'soft' }, tr('Your staff sign in with their own mobile number and password. Managers see your buses and add them. Conductors only share your buses from their phone. Only you see, approve and remove people.')),
    ui.peopleList,
    h('p', { class: 'hint' }, tr('To add a conductor, they create an account on the sign-in page: they choose “A conductor” and type your mobile number. You then approve them here. When they start sharing a bus, they only choose its route and type its number plate.')),
    h('p', { class: 'hint' }, tr('A manager chooses “A bus owner’s manager” instead, and the Where Is My Bus team approves them.')));
}

/** Who is signed in, and a new password: the other devices are signed out, this one stays. */
function accountSection() {
  const current = h('input', { id: 'current-password', type: 'password', autocomplete: 'current-password', required: true, maxlength: '128' });
  const next = h('input', { id: 'next-password', type: 'password', autocomplete: 'new-password', required: true, maxlength: '128' });
  const again = h('input', { id: 'next-password-2', type: 'password', autocomplete: 'new-password', required: true, maxlength: '128' });
  const toggle = h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'password-form' }, tr('Change password'));
  const form = h('form', {
    id: 'password-form', class: 'password-form', hidden: true,
    onsubmit: (e) => {
      e.preventDefault();
      void changePassword(current, next, again, () => show(false));
    },
  },
  field(tr('Present password'), current),
  field(tr('New password'), next, tr('At least 8 characters. Not your mobile number.')),
  field(tr('Type the password again'), again),
  h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'submit' }, tr('Save password')),
    h('button', { class: 'btn', type: 'button', onclick: () => show(false) }, tr('Cancel'))));
  const show = (on) => {
    form.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (on) current.focus();
    else form.reset();
  };
  toggle.addEventListener('click', () => show(form.hidden));
  ui.accountText = h('p', { class: 'soft' });
  return h('section', { class: 'card' }, h('h2', {}, tr('Your account')), ui.accountText, h('div', { class: 'row' }, toggle), form);
}

async function changePassword(current, next, again, done) {
  if (next.value !== again.value) {
    setMessage('error', tr('The two passwords are not the same. Type them again.'));
    renderMessage();
    again.focus();
    return;
  }
  try {
    const r = await api('/api/accounts/password', { method: 'POST', body: { current: current.value, password: next.value } });
    // The old key's live stream ends; the next update opens one with the new key.
    closeLive();
    state.key = r.key;
    storeKey(r.key);
    done();
    setMessage('ok', tr('Your password is changed. Your other devices are signed out.'));
    renderMessage();
    void refresh();
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

async function approvePerson(p) {
  try {
    await api(`/api/owner/people/${encodeURIComponent(p.id)}/approve`, { method: 'POST' });
    setMessage('ok', tr('Approved {name}. They can sign in now and share your buses.', { name: p.name }));
    await refresh();
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

async function removePerson(p) {
  if (!confirm(tr('Remove {name}? They can no longer sign in for you.', { name: p.name }))) return;
  try {
    await api(`/api/owner/people/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    setMessage('ok', tr('Removed {name}.', { name: p.name }));
    await refresh();
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

// ---------- tools ----------

function toolsView() {
  const day = h('input', { id: 'day', type: 'date' });
  day.addEventListener('change', () => showDay(day.value));
  const today = h('button', { class: 'btn small', type: 'button', onclick: () => showDay('') }, tr('Today'));
  const add = h('button', { class: 'btn primary', type: 'button', onclick: () => openForm({ kind: 'add' }) }, tr('Add a bus'));
  ui.day = day;
  ui.todayBtn = today;
  ui.addBtn = add;
  return [h('label', { for: 'day' }, tr('Day')), day, today, h('span', { class: 'grow' }), add];
}

function exportView() {
  const from = h('input', { id: 'csv-from', type: 'date' });
  const to = h('input', { id: 'csv-to', type: 'date' });
  ui.csvFrom = from;
  ui.csvTo = to;
  return h('section', { class: 'card' },
    h('h2', {}, tr('Download trips')),
    h('p', { class: 'soft' }, tr('One row per trip, for a spreadsheet: up to 62 days at a time.')),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'csv-from' }, tr('From')), from),
      h('div', { class: 'field' }, h('label', { for: 'csv-to' }, tr('To')), to)),
    h('button', { class: 'btn', type: 'button', onclick: () => void download(from.value, to.value) }, tr('Download')));
}

function formView() {
  const f = state.form;
  if (!f || !state.data) return null;
  const bus = f.kind === 'edit' ? state.data.buses.find((b) => b.id === f.busId) : null;
  if (f.kind === 'edit' && !bus) return null;
  const plate = h('input', { id: 'plate', value: bus ? bus.plate : '', required: true, placeholder: 'WB 19 A 1234', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const label = h('input', { id: 'bus-name', value: bus && bus.label ? bus.label : '', placeholder: tr('For example Morning D2'), autocomplete: 'off', maxlength: '40' });
  return h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); void saveBus(f, plate.value, label.value); } },
    h('h2', {}, bus ? tr('Change {plate}', { plate: bus.plate }) : tr('Add a bus')),
    field(tr('Number plate'), plate, tr('As painted on the bus.')),
    field(tr('Your name for it (optional)'), label),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, bus ? tr('Save') : tr('Add bus')),
      h('button', { class: 'btn', type: 'button', onclick: () => openForm(null) }, tr('Cancel'))));
}

// ---------- actions ----------

function showDay(date) {
  state.date = date && state.data && date !== state.data.today ? date : '';
  void refresh();
}

function openForm(form) {
  state.form = form;
  fill(ui.form, formView());
  const first = ui.form.querySelector('input');
  if (first) {
    ui.form.scrollIntoView({ block: 'nearest' });
    first.focus();
  }
}

async function saveBus(f, plate, label) {
  try {
    if (f.kind === 'edit') {
      const r = await api(`/api/owner/buses/${encodeURIComponent(f.busId)}`, { method: 'PUT', body: { plate, label } });
      setMessage('ok', tr('Saved {plate}.', { plate: r.bus.plate }));
    } else {
      const r = await api('/api/owner/buses', { method: 'POST', body: { plate, label } });
      state.open.add(r.bus.id);
      setMessage('ok', tr('Added {plate}. Your conductors type this plate when they share the bus.', { plate: r.bus.plate }));
    }
    state.form = null;
    fill(ui.form);
    await refresh();
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

async function removeBus(b) {
  if (!confirm(tr('Remove {plate}? Your conductors can no longer share it. Its trips so far stay in the list.', { plate: b.plate }))) return;
  try {
    await api(`/api/owner/buses/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
    state.open.delete(b.id);
    setMessage('ok', tr('Removed {plate}.', { plate: b.plate }));
    await refresh();
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

async function download(from, to) {
  try {
    if (!from || !to) throw new Error(tr('Choose the first and the last day.'));
    const res = await api(`/api/owner/trips.csv?from=${from}&to=${to}`, { raw: true });
    const a = h('a', { href: URL.createObjectURL(await res.blob()), download: `bus-trips-${from}-to-${to}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    setMessage('error', e.message);
    renderMessage();
  }
}

// ---------- shell ----------

/** The signed-in page's parts. Forms live outside the parts that update every 15 seconds. */
let ui = null;

function buildShell() {
  ui = {};
  ui.msg = h('div');
  ui.alerts = h('div');
  ui.notify = h('div', { class: 'notify' });
  ui.tools = h('div', { class: 'tools' });
  ui.kpis = h('div', { class: 'kpis' });
  ui.form = h('div');
  ui.buses = h('div');
  ui.removed = h('div');
  ui.note = h('p', { class: 'hint' });
  ui.mapEl = h('div', { class: 'map', role: 'region', 'aria-label': tr('Map of the buses on the road now') });
  fill(ui.tools, toolsView());
  ui.people = peopleSection();
  ui.account = accountSection();
  const exportBox = exportView();
  fill(document.getElementById('main'),
    h('div', { class: 'layout' },
      h('div', { class: 'side' }, ui.msg, ui.alerts, ui.notify, ui.tools, ui.kpis, ui.form, ui.buses, ui.removed, exportBox, ui.people, ui.account, ui.note),
      ui.mapEl));
  initMap(ui.mapEl);
}

function renderMessage() {
  if (ui) fill(ui.msg, messageView());
}

/** The parts that change on the owner's own action, not every 15 seconds. */
function renderStatic() {
  if (!ui) return;
  const d = state.data;
  fill(ui.notify, d && d.alerts ? notifyView() : null);
  renderMessage();
}

function renderAccount() {
  // The other language, named in its own script; the same choice as in the rider app.
  const other = lang === 'bn' ? 'en' : 'bn';
  const switchLang = h('button', {
    class: 'btn small', type: 'button', lang: other,
    onclick: () => {
      store(LANG_KEY, JSON.stringify(other));
      location.reload();
    },
  }, other === 'bn' ? 'বাংলা' : 'English');
  fill(document.getElementById('account'),
    h('div', { class: 'row' }, switchLang, state.key ? h('button', { class: 'btn small', type: 'button', onclick: () => void signOut() }, tr('Sign out')) : null));
}

function subtitle(d) {
  if (!d) return tr('Where Is My Bus for bus owners');
  if (isSyndicate(d)) return `${d.syndicate.name} · ${d.syndicate.routes.map((r) => r.number).join(', ')}`;
  return d.me.role === 'manager' ? `${d.owner.name} · ${d.me.name}` : d.owner.name;
}

function render() {
  renderAccount();
  const d = state.data;
  document.getElementById('subtitle').textContent = subtitle(d);
  document.querySelector('.top h1').textContent = isSyndicate(d) ? tr('Syndicate buses') : tr('Your buses');
  if (!state.key) return;
  if (!ui) buildShell();
  renderStatic();
  if (!d) return;
  ui.day.value = d.date;
  ui.day.max = d.today;
  ui.todayBtn.hidden = d.date === d.today;
  ui.addBtn.hidden = isSyndicate(d);
  if (!ui.csvFrom.value) ui.csvFrom.value = `${d.today.slice(0, 8)}01`;
  if (!ui.csvTo.value) ui.csvTo.value = d.today;
  // The cards are rebuilt on each update; keep the keyboard focus where it was.
  const active = document.activeElement;
  const main = document.getElementById('main');
  const focusKey = active && main.contains(active) ? active.getAttribute('data-focus') : null;
  fill(ui.alerts, alertsView(d));
  fill(ui.kpis, kpis(d));
  fill(ui.buses, busesView(d));
  fill(ui.removed, removedView(d));
  ui.people.hidden = !isMainOwner(d);
  if (isMainOwner(d)) fill(ui.peopleList, peopleList(d));
  ui.accountText.textContent = d.me.phoneEnd
    ? tr('Signed in as {name}, with the mobile number ending {end}.', { name: d.me.name, end: d.me.phoneEnd })
    : tr('Signed in as {name}.', { name: d.me.name });
  if (focusKey) {
    const again = [...main.querySelectorAll('[data-focus]')].find((el) => el.getAttribute('data-focus') === focusKey);
    if (again) again.focus();
  }
  ui.note.textContent = isSyndicate(d)
    ? tr('Buses of the syndicate’s members on its routes, from their conductors’ phones. Only a summary of each trip is kept, for {days} days.', { days: d.keepDays })
    : tr('Positions come from your conductors’ phones while they share the bus. Only a summary of each trip is kept, for {days} days.', { days: d.keepDays });
  drawMap(d);
}

// ---------- start ----------

try {
  state.seen = new Set(JSON.parse(stored(SEEN_STORE) || '[]'));
} catch {
  state.seen = new Set();
}
state.key = stored(KEY_STORE);
if (state.key) {
  render();
  void refresh();
} else {
  // Not signed in on this device.
  location.replace('/signin');
}
setInterval(() => {
  const visible = document.visibilityState === 'visible';
  // While positions are pushed, the full update (trips, alerts) is needed less often.
  const every = !visible ? HIDDEN_REFRESH_MS : liveStream ? LIVE_REFRESH_MS : REFRESH_MS;
  if ((visible || stored(NOTIFY_STORE)) && Date.now() - lastFullAt >= every) void refresh();
}, 5_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
  // A hidden page keeps no stream open, to spare the phone's battery and data.
  else closeLive();
});
