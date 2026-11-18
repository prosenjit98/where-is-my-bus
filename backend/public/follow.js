// Where Is My Bus: following a rider's bus from a link they sent. Shows the bus on a map, its next
// stop and when it should reach the rider's stop, until the trip ends. Built with DOM methods only,
// never HTML strings; the page's policy refuses inline scripts and styles. Styles are the web app's.
// In English or Bengali: the choice made in the app on this phone, else the browser's language.
'use strict';

const REFRESH_MS = 10_000;
const token = decodeURIComponent(location.pathname.split('/').pop() || '');

// ---------- language ----------

const LANG_KEY = 'wimb.lang.v1';
const BN = {
  'Following a bus': 'একটি বাস দেখছেন',
  'Following bus {route}': 'বাস {route} দেখছেন',
  'Towards {place}': '{place}-এর দিকে',
  'Route {route}': 'রুট {route}',
  'Bus {route}': 'বাস {route}',
  'Map of the bus': 'বাসের ম্যাপ',
  'Loading…': 'লোড হচ্ছে…',
  'Only the bus is shown, and only while the trip is on. This page updates by itself.': 'শুধু বাসটি দেখানো হয়, আর শুধু যাত্রা চলাকালীন। এই পেজ নিজে থেকেই আপডেট হয়।',
  'The map could not load. Everything else works without it.': 'ম্যাপ লোড হয়নি। বাকি সবকিছু ম্যাপ ছাড়াই কাজ করবে।',
  'The trip has ended': 'যাত্রা শেষ হয়েছে',
  'The rider has stopped sharing this bus.': 'যাত্রী এই বাসটি শেয়ার করা বন্ধ করেছেন।',
  'The bus is not on its route yet, or has not been heard from for a while.': 'বাসটি এখনও রুটে আসেনি, বা কিছুক্ষণ ধরে কোনো খবর নেই।',
  'This page updates by itself.': 'এই পেজ নিজে থেকেই আপডেট হয়।',
  'Next stop': 'পরের স্টপ',
  'At the end of the route': 'রুটের শেষে',
  'Reaching {stop} now': 'এখন {stop}-এ পৌঁছচ্ছে',
  'About {min} min to {stop}': '{stop} পর্যন্ত প্রায় {min} মিনিট',
  'The bus has passed {stop}.': 'বাসটি {stop} পেরিয়ে গেছে।',
  'Updated {sec} s ago.': '{sec} সেকেন্ড আগে আপডেট হয়েছে।',
  'Updated {min} min ago.': '{min} মিনিট আগে আপডেট হয়েছে।',
  'This link has expired': 'এই লিঙ্কের মেয়াদ শেষ',
  'Links work only while the trip is on, and for an hour after it ends.': 'লিঙ্ক শুধু যাত্রা চলাকালীন কাজ করে, আর শেষ হওয়ার পরে এক ঘণ্টা।',
  'Could not reach the server. Trying again in a few seconds.': 'সার্ভারের সঙ্গে যোগাযোগ করা গেল না। কয়েক সেকেন্ড পরে আবার চেষ্টা করা হবে।',
};

function savedLang() {
  try {
    const v = JSON.parse(localStorage.getItem(LANG_KEY) || 'null');
    if (v === 'en' || v === 'bn') return v;
  } catch {
    // No saved choice.
  }
  return (navigator.languages || [navigator.language]).some((l) => /^bn\b/i.test(l)) ? 'bn' : 'en';
}

const lang = savedLang();
document.documentElement.lang = lang;
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** The text in the page's language, with {name} filled in; numbers in Bengali digits for Bengali. */
function tr(en, vars = {}) {
  const template = lang === 'bn' ? BN[en] || en : en;
  return template.replace(/\{(\w+)\}/g, (whole, k) => {
    const v = vars[k];
    if (v === undefined) return whole;
    return typeof v === 'number' && lang === 'bn' ? String(v).replace(/[0-9]/g, (d) => BN_DIGITS[d]) : String(v);
  });
}
/** A name from the server, in Bengali script when the page is in Bengali and the network has it. */
const local = (en, bn) => (lang === 'bn' && bn ? bn : en);

// ---------- page ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const board = (number, operator) =>
  h('span', { class: `board board-md op-${operator}`, role: 'img', 'aria-label': tr('Route {route}', { route: number }) }, number);
const ago = (sec) => (sec < 60 ? tr('Updated {sec} s ago.', { sec }) : tr('Updated {min} min ago.', { min: Math.round(sec / 60) }));

// The other language, named in its own script, as in the app.
const other = lang === 'bn' ? 'en' : 'bn';
const switchLang = h('button', {
  class: 'lang-switch', type: 'button', lang: other,
  onclick: () => {
    try { localStorage.setItem(LANG_KEY, JSON.stringify(other)); } catch { /* Storage off: the choice lasts for this page only. */ }
    location.reload();
  },
}, other === 'bn' ? 'বাংলা' : 'English');

const title = h('h1', { class: 'brand', tabindex: '-1' }, tr('Following a bus'));
const sub = h('p', { class: 'hero-sub' }, 'Where Is My Bus');
const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': tr('Map of the bus') });
const card = h('div', { class: 'trip-card', 'aria-live': 'polite' }, h('p', { class: 'note' }, tr('Loading…')));
const foot = h('p', { class: 'note' }, tr('Only the bus is shown, and only while the trip is on. This page updates by itself.'));
document.getElementById('app').replaceChildren(
  h('div', { class: 'screen' },
    h('header', { class: 'hero' },
      h('div', { class: 'hero-top' }, h('img', { class: 'hero-mark', src: '/web/icons/logo-mark.svg', alt: '' }), h('div', { class: 'grow' }, title, sub), switchLang)),
    h('main', { class: 'screen-body home-body' }, card, mapEl, foot)));

let map = null;
let marker = null;
let fitted = false;
if (window.L) {
  map = L.map(mapEl).setView([22.55, 88.37], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  requestAnimationFrame(() => map.invalidateSize());
} else {
  mapEl.append(h('p', { class: 'map-missing' }, tr('The map could not load. Everything else works without it.')));
}

function show(d) {
  const bn = d.bn || {};
  const towards = tr('Towards {place}', { place: local(d.headsign, bn.headsign) });
  const dest = d.dest ? local(d.dest.name, bn.dest) : null;
  title.textContent = tr('Following bus {route}', { route: d.routeNumber });
  sub.textContent = towards;
  document.title = `${tr('Bus {route}', { route: d.routeNumber })} · Where Is My Bus`;
  const top = h('div', { class: 'trip-route' }, board(d.routeNumber, d.operator), h('span', { class: 'note' }, towards));
  if (d.ended) {
    card.replaceChildren(top, h('p', { class: 'headline' }, tr('The trip has ended')), h('p', { class: 'note' }, tr('The rider has stopped sharing this bus.')));
    if (marker) marker.remove();
    return;
  }
  if (!d.bus) {
    card.replaceChildren(top, h('p', { class: 'strong' }, tr('The bus is not on its route yet, or has not been heard from for a while.')), h('p', { class: 'note' }, tr('This page updates by itself.')));
    return;
  }
  const b = d.bus;
  card.replaceChildren(
    top,
    h('div', { class: 'now' },
      h('span', { class: 'note' }, b.nextStop ? tr('Next stop') : tr('At the end of the route')),
      h('p', { class: 'headline' }, b.nextStop ? local(b.nextStop, bn.nextStop) : local(d.headsign, bn.headsign))),
    dest && b.etaMin !== null
      ? h('p', { class: 'togo' }, b.etaMin < 1 ? tr('Reaching {stop} now', { stop: dest }) : tr('About {min} min to {stop}', { min: b.etaMin, stop: dest }))
      : dest
        ? h('p', { class: 'note' }, tr('The bus has passed {stop}.', { stop: dest }))
        : null,
    h('p', { class: 'note' }, ago(b.lastSeenSec)),
  );
  if (map) {
    const icon = L.divIcon({ html: board(d.routeNumber, d.operator), className: 'bus-icon', iconSize: null });
    const label = tr('Bus {route}', { route: d.routeNumber });
    if (marker) marker.setLatLng([b.lat, b.lng]);
    else marker = L.marker([b.lat, b.lng], { icon, title: label, alt: label, keyboard: false }).addTo(map);
    if (!fitted) map.setView([b.lat, b.lng], 15);
    fitted = true;
  }
}

async function load() {
  try {
    const res = await fetch(`/api/follow/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => null);
    if (res.status === 404) {
      card.replaceChildren(h('p', { class: 'headline' }, tr('This link has expired')), h('p', { class: 'note' }, tr('Links work only while the trip is on, and for an hour after it ends.')));
      return false;
    }
    if (!res.ok || !data) throw new Error('bad answer');
    show(data);
    return !data.ended;
  } catch {
    card.replaceChildren(h('p', { class: 'note' }, tr('Could not reach the server. Trying again in a few seconds.')));
    return true;
  }
}

async function loop() {
  if (await load()) setTimeout(loop, REFRESH_MS);
}
void loop();
