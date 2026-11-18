import * as app from './app.ts';
import type { Screen } from './app.ts';
import { fill, h } from './dom.ts';
import { tr } from './i18n.ts';
import { icon, type IconName } from './icon.ts';
import { readJson, writeJson } from './storage.ts';

// The side nav: what riders do, and, set apart, where the people who run the buses sign in.
// Riders never sign in. On a wide screen the nav stays beside the app and folds to its icons; on a
// phone it slides in from the menu button on the home screen.

const KEY = 'wimb.nav.v1';
const WIDE = '(min-width: 900px)';

type ItemId = 'plan' | 'routes' | 'conductor' | 'suggest';

const ITEMS: { id: ItemId; label: string; icon: IconName; screen: Screen }[] = [
  { id: 'plan', label: tr('Plan a journey'), icon: 'route', screen: { name: 'plan' } },
  { id: 'routes', label: tr('Find a route'), icon: 'bus', screen: { name: 'routes' } },
  { id: 'conductor', label: tr('Share your bus'), icon: 'bus-front', screen: { name: 'conductor' } },
  { id: 'suggest', label: tr('Suggest a fix'), icon: 'message-square-warning', screen: { name: 'suggest' } },
];

/** Separate pages: one sign-in, with a mobile number and a password, for bus owners, their staff (conductors too) and route syndicates; the admin's own. */
const SIGN_IN: { label: string; icon: IconName; href: string }[] = [
  { label: tr('Owners, staff and syndicates'), icon: 'log-in', href: '/signin' },
  { label: tr('Admin'), icon: 'shield-check', href: '/admin' },
];

/** The nav item for the screens open now: the topmost screen that has one. */
function currentItem(): ItemId {
  for (const s of [...app.state.stack].reverse()) {
    if (s.name === 'routes' || s.name === 'route') return 'routes';
    if (s.name === 'conductor' || s.name === 'suggest') return s.name;
  }
  return 'plan';
}

const wide = matchMedia(WIDE);
let collapsed = readJson<boolean>(KEY) === true;
let open = false;
let layout: HTMLElement | null = null;
let page: HTMLElement | null = null;
/** The home screen's menu button, which opens the nav on a phone and gets the focus back. */
let menuBtn: HTMLButtonElement | null = null;

const toggle = h('button', { class: 'side-toggle', type: 'button', 'aria-controls': 'side' });
const items = ITEMS.map((it) => ({
  it,
  el: h('button', { class: 'side-item', type: 'button', onclick: () => go(it.screen) }, icon(it.icon), h('span', { class: 'side-label' }, it.label)),
}));
const links = SIGN_IN.map((s) => ({ s, el: h('a', { class: 'side-item', href: s.href }, icon(s.icon), h('span', { class: 'side-label' }, s.label)) }));
const side = h(
  'nav',
  { class: 'side', id: 'side', 'aria-label': tr('Menu') },
  h('div', { class: 'side-top' }, h('img', { class: 'side-mark', src: '/web/icons/logo-mark.svg', alt: '' }), h('span', { class: 'side-name' }, 'Where Is My Bus'), toggle),
  h('ul', { class: 'side-list' }, items.map(({ el }) => h('li', {}, el))),
  h(
    'div',
    { class: 'side-group' },
    h('h2', { class: 'side-heading', id: 'side-sign-in' }, tr('Sign in')),
    h('p', { class: 'side-note' }, tr('For the people who run the buses. Riders need no account.')),
    h('ul', { class: 'side-list', 'aria-labelledby': 'side-sign-in' }, links.map(({ el }) => h('li', {}, el))),
  ),
);
const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => setOpen(false) });

function go(s: Screen) {
  setOpen(false, false);
  app.goTo(s);
}

/** Phones: the nav slides out over the app, which cannot be reached until it closes. */
function setOpen(next: boolean, moveFocus = true) {
  if (open === next) return;
  open = next;
  layout?.classList.toggle('nav-open', open);
  if (page) page.inert = open;
  scrim.hidden = !open;
  menuBtn?.setAttribute('aria-expanded', String(open));
  if (!moveFocus) return;
  if (open) (items.find((i) => i.it.id === currentItem())?.el ?? items[0].el).focus();
  else menuBtn?.focus();
}

function sync() {
  if (wide.matches) setOpen(false, false);
  const folded = wide.matches && collapsed;
  layout?.classList.toggle('nav-collapsed', folded);
  fill(toggle, icon(!wide.matches ? 'x' : folded ? 'panel-left-open' : 'panel-left-close', { size: 18 }));
  toggle.setAttribute('aria-label', !wide.matches ? tr('Close the menu') : folded ? tr('Show the menu') : tr('Hide the menu'));
  toggle.setAttribute('aria-expanded', String(wide.matches ? !folded : open));
  // Folded, the names stay for screen readers and show as tooltips.
  for (const { el, label } of [...items.map((i) => ({ el: i.el, label: i.it.label })), ...links.map((l) => ({ el: l.el, label: l.s.label }))]) {
    if (folded) el.title = label;
    else el.removeAttribute('title');
  }
}

toggle.addEventListener('click', () => {
  if (!wide.matches) return setOpen(false);
  collapsed = !collapsed;
  writeJson(KEY, collapsed);
  sync();
});
wide.addEventListener('change', sync);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open) setOpen(false);
});

/** Puts the nav beside `app` inside `into`. */
export function mountNav(into: HTMLElement, appEl: HTMLElement) {
  layout = into;
  page = appEl;
  into.prepend(side, scrim);
  sync();
  updateNav();
}

/** Marks the item for the screen open now. */
export function updateNav() {
  const current = currentItem();
  for (const { it, el } of items) {
    if (it.id === current) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    // The conductor screen starts from the list of routes, so it waits for them, as on the home screen.
    el.disabled = it.id === 'conductor' && !app.state.net;
  }
}

/** For the home screen on a phone: opens the nav. Hidden on a wide screen, where the nav is always there. */
export function menuButton(): HTMLButtonElement {
  menuBtn = h(
    'button',
    { class: 'menu-btn', type: 'button', 'aria-label': tr('Menu'), 'aria-controls': 'side', 'aria-expanded': String(open), onclick: () => setOpen(true) },
    icon('menu', { size: 22 }),
  );
  return menuBtn;
}
