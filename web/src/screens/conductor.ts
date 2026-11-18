import { canConduct, rememberPlate, signedInNow, signOut, whoAmI } from '../account.ts';
import { askToNotify, unlockSound } from '../alarm.ts';
import type { Me } from '../api.ts';
import * as app from '../app.ts';
import { button, note, notice, plateField, routeBoard, shell, stopName, towards, type View } from '../components.ts';
import { isPatternActive, isRouteRunning, istNow, type Pattern, type PreparedNetwork, type Route } from '../core.ts';
import { fill, h } from '../dom.ts';
import { tr } from '../i18n.ts';
import { icon } from '../icon.ts';
import { checkPreciseLocation } from '../location.ts';
import { startTrip } from '../trip.ts';

// Conductors share their bus for the whole trip, so they start from the route, not from a
// journey. They sign in on /signin first, with the account their owner approved (account.ts), and
// at the start of each trip type the number plate of the owner's bus they are on. The owner then
// sees where the bus is and the trips it runs.

/** Shown before a conductor starts: who sees the trip. */
export const OWNER_NOTE = 'Shared as its conductor, the bus’s owner sees where it is and the trips it runs.';

/** Where conductors sign in, and sign up with their owner's mobile number. */
const SIGN_IN = '/signin';
const SIGN_UP = '/signin?as=conductor';

export function conductorScreen(): View {
  const net = app.state.net as PreparedNetwork;
  let route: Route | null = null;
  let pattern: Pattern | null = null;
  let me = signedInNow();
  let destroyed = false;
  const filter = h('input', { class: 'input', type: 'search', placeholder: tr('Route number'), 'aria-label': tr('Find your route by number'), autocomplete: 'off' });
  const plate = plateField();
  const problem = h('div');
  const content = h('div', { class: 'panel' });
  const el = shell({ title: tr('Share your bus'), onBack: app.pop, body: content });

  // Only buses: the Metro, trains and ferries run to their timetables.
  const routes = net.network.routes
    .filter((r) => (r.mode ?? 'bus') === 'bus')
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  async function begin(btn: HTMLButtonElement) {
    if (!route || !pattern) return;
    unlockSound();
    fill(problem);
    if (!plate.value.trim()) {
      fill(problem, note(tr('Type the bus’s number plate, as painted on the bus.'), 'danger'));
      plate.focus();
      return;
    }
    btn.disabled = true;
    try {
      const wrong = await checkPreciseLocation();
      if (wrong) {
        fill(problem, note(wrong, 'danger'));
        return;
      }
      await askToNotify();
      const last = pattern.stopIds[pattern.stopIds.length - 1];
      await startTrip(net, {
        patternId: pattern.id,
        routeNumber: route.number,
        operator: route.operator,
        headsign: towards(net, pattern.id, pattern.headsign),
        destStopId: last,
        destName: net.stops.has(last) ? stopName(net, last) : null,
        alarm: false,
        share: true,
        role: 'conductor',
        plate: plate.value.trim(),
      });
      rememberPlate(plate.value);
      app.push({ name: 'trip' });
    } catch (e) {
      fill(problem, note(e instanceof Error ? e.message : tr('Sharing could not start.'), 'danger'));
    } finally {
      btn.disabled = false;
    }
  }

  const listBox = h('div');
  function renderList() {
    const q = filter.value.trim().toLowerCase();
    const shown = routes.filter((r) => !q || r.number.toLowerCase().includes(q));
    fill(
      listBox,
      shown.length
        ? h(
            'ul',
            { class: 'route-list' },
            shown.map((r) => {
              const ids = r.patterns[0]?.stopIds ?? [];
              const ends = `${ids.length ? stopName(net, ids[0]) : '?'} – ${ids.length ? stopName(net, ids[ids.length - 1]) : '?'}`;
              const pick = () => {
                route = r;
                pattern = null;
                render();
              };
              return h(
                'li',
                {},
                h(
                  'button',
                  { class: 'row', type: 'button', onclick: pick },
                  h('span', { class: 'leg-row' }, routeBoard(r.number, r.operator, 'sm'), h('span', { class: 'row-title grow' }, ends), icon('chevron-right', { class: 'chev' })),
                ),
              );
            }),
          )
        : note(tr('No route has that number.')),
    );
  }

  /** Not signed in, or signed in with an account that cannot share a bus as its conductor. */
  function signInView(who: Me | null) {
    fill(
      content,
      notice(tr('Conductors sign in to share their bus. Your bus owner approves your account; then you choose the route and type the bus’s number plate.'), 'radio-tower'),
      who
        ? h(
            'p',
            { class: 'note danger' },
            `${tr('You are signed in as {name}, whose account cannot share a bus as its conductor.', { name: who.name })} `,
            h('button', { class: 'link', type: 'button', onclick: () => void signOut().then(render) }, tr('Sign out')),
          )
        : null,
      h('a', { class: 'btn primary', href: SIGN_IN }, icon('log-in'), h('span', {}, tr('Sign in as a conductor'))),
      h('p', { class: 'small' }, tr('No account yet? Create one on the sign-in page with your bus owner’s mobile number.'), ' ', h('a', { href: SIGN_UP }, tr('Create a conductor account'))),
      h('p', { class: 'small' }, tr('Riding the bus? Riders share it from their journey, with “I’m on this bus”, and need no account.')),
    );
  }

  function whoLine(who: Me) {
    const text = who.owner && who.kind === 'conductor'
      ? tr('Signed in as {name}, conductor for {owner}.', { name: who.name, owner: who.owner })
      : tr('Signed in as {name}.', { name: who.name });
    return h(
      'p',
      { class: 'small' },
      `${text} `,
      h('button', { class: 'link', type: 'button', onclick: () => void signOut().then(render) }, tr('Sign out')),
    );
  }

  function render() {
    me = signedInNow();
    if (me === undefined) {
      fill(content, note(tr('Checking your sign-in…')));
      return;
    }
    if (!canConduct(me)) {
      signInView(me);
      return;
    }
    if (!route) {
      fill(
        content,
        whoLine(me),
        notice(tr('Your phone shows where your bus is to everyone waiting for it. Keep it on a charger with the screen on during the trip.'), 'radio-tower'),
        filter,
        listBox,
      );
      renderList();
      return;
    }
    const { minute, dateISO } = istNow();
    const r = route;
    const startBtn = button(tr('Start sharing as conductor'), () => void begin(startBtn), 'primary', 'radio-tower');
    startBtn.disabled = !pattern;
    fill(
      content,
      h('div', { class: 'trip-route' }, routeBoard(r.number, r.operator, 'lg'), h('button', { class: 'link', type: 'button', onclick: () => { route = null; render(); } }, tr('Another route'))),
      h('p', { class: 'strong', id: 'direction' }, tr('Which way is the bus going?')),
      h(
        'div',
        { class: 'panel', role: 'radiogroup', 'aria-labelledby': 'direction' },
        r.patterns.map((p) => {
          const running = isRouteRunning(r, minute) && isPatternActive(r, p, minute, dateISO);
          return h(
            'button',
            {
              class: 'choice',
              type: 'button',
              role: 'radio',
              'aria-checked': String(pattern?.id === p.id),
              onclick: () => {
                pattern = p;
                render();
              },
            },
            icon(pattern?.id === p.id ? 'circle-dot' : 'navigation'),
            h('span', {}, running ? tr('Towards {place}', { place: towards(net, p.id, p.headsign) }) : tr('Towards {place} (not running now)', { place: towards(net, p.id, p.headsign) })),
          );
        }),
      ),
      h('label', { class: 'strong', for: 'plate' }, tr('The bus’s number plate')),
      plate,
      notice(tr(OWNER_NOTE), 'eye'),
      problem,
      startBtn,
      whoLine(me),
    );
  }

  plate.id = 'plate';
  filter.addEventListener('input', renderList);
  render();
  // Who is signed in is asked once per visit; the screen shows the answer when it comes.
  void whoAmI().then(() => {
    if (!destroyed && signedInNow() !== me) render();
  });
  return {
    el,
    destroy: () => {
      destroyed = true;
    },
  };
}
