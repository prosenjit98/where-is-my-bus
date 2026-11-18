import { api } from '../api.ts';
import * as app from '../app.ts';
import type { Field, Place } from '../app.ts';
import { button, note, notice, optionRow, placeName, routeBoard, toEndpoint, type View } from '../components.ts';
import { coverageFrom, liveEtasFrom, plan, rideTimeFromTable, type Arrival, type PlanResult } from '../core.ts';
import { fill, h } from '../dom.ts';
import { digits, lang, setLang, tr } from '../i18n.ts';
import { icon } from '../icon.ts';
import { menuButton } from '../nav.ts';
import { getTripSnapshot } from '../trip.ts';

const ARRIVALS_REFRESH_MS = 20_000;

export function planScreen(): View {
  let arrivals: Record<string, Arrival[]> | null = null;
  let liveDown = false;
  let originKey = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  const status = h('div');
  const banner = h('div');
  const ticketBox = h('div');
  const results = h('section', { 'aria-label': tr('Journeys') });
  const extras = h('div', { class: 'hint-box' });
  // The other language, named in its own script, so whoever reads only that one finds it.
  const other = lang === 'bn' ? 'en' : 'bn';
  const switchLang = h(
    'button',
    { class: 'lang-switch', type: 'button', lang: other, onclick: () => setLang(other) },
    icon('languages', { size: 16 }),
    other === 'bn' ? 'বাংলা' : 'English',
  );
  // The home screen opens with the brand on blue; the From and To card rests on its edge.
  const hero = h(
    'header',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero-top' },
      menuButton(),
      h('img', { class: 'hero-mark', src: '/web/icons/logo-mark.svg', alt: '' }),
      h('div', { class: 'grow' }, h('h1', { class: 'brand', tabindex: '-1' }, 'Where Is My Bus'), h('p', { class: 'hero-sub' }, tr('Which bus to take in Kolkata, and when it comes'))),
      switchLang,
    ),
  );
  // Riders who know the bus they want go to its route instead.
  const findRoute = h(
    'button',
    { class: 'quick', type: 'button', onclick: () => app.push({ name: 'routes' }) },
    h('span', { class: 'row-icon' }, icon('bus')),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, tr('Find a route')), h('span', { class: 'row-sub' }, tr('By its number, like D2, or a place it goes to'))),
    icon('chevron-right', { class: 'chev' }),
  );
  const el = h('div', { class: 'screen' }, hero, h('main', { class: 'screen-body home-body' }, ticketBox, findRoute, banner, status, results, extras));

  // Planned on the phone first, so results appear at once and work offline.
  function planNow(withLive: boolean): PlanResult | null {
    const { net, from, to } = app.state;
    if (!net || !from || !to) return null;
    const live = withLive ? arrivals : null;
    // Learned travel times where there are enough trips; the usual speed elsewhere.
    const rideTimeMin = rideTimeFromTable(app.state.travel);
    return plan(
      net,
      toEndpoint(from),
      toEndpoint(to),
      live ? { liveEtas: liveEtasFrom((id) => live[id]), coverage: coverageFrom(live), rideTimeMin } : { rideTimeMin },
    );
  }

  // Then re-ranked with tracked buses, when the server has any.
  function watchArrivals(stopIds: string[]) {
    const key = stopIds.slice(0, 20).join(',');
    if (key === originKey) return;
    originKey = key;
    arrivals = null;
    clearInterval(timer);
    if (!key) return;
    const load = () =>
      api.arrivals(key.split(',')).then(
        (a) => {
          if (originKey !== key) return;
          arrivals = a;
          liveDown = false;
          update();
        },
        () => {
          if (originKey !== key) return;
          liveDown = true;
          update();
        },
      );
    void load();
    timer = setInterval(load, ARRIVALS_REFRESH_MS);
  }

  function update() {
    const { net, netInfo, from, to, loadError } = app.state;
    fill(
      status,
      loadError
        ? notice(tr(loadError), 'triangle-alert', 'danger')
        : !netInfo
          ? note(tr('Loading routes…'))
          : netInfo.offline
            ? notice(tr('Offline. Using the routes saved on this phone.'), 'wifi-off', 'warn')
            : null,
    );

    const trip = getTripSnapshot();
    fill(
      banner,
      trip.active && trip.config
        ? h(
            'button',
            { class: 'trip-banner', type: 'button', onclick: () => app.push({ name: 'trip' }) },
            routeBoard(trip.config.routeNumber, trip.config.operator, 'sm'),
            h('span', { class: 'grow' }, trip.state?.nextStopName ? tr('Next stop {stop}', { stop: trip.state.nextStopName }) : tr('Trip in progress')),
            h('span', { class: 'sr-only' }, tr('Open')),
            icon('chevron-right'),
          )
        : null,
    );

    fill(ticketBox, ticket(from, to));

    const base = planNow(false);
    watchArrivals(base?.originStopIds ?? []);
    const result = arrivals ? planNow(true) : base;
    if (!net) fill(results);
    else if (!from || !to) fill(results, h('div', { class: 'hint-box' }, note(!from ? tr('Choose where you are starting from.') : tr('Choose where you are going.'))));
    else if (result && result.options.length === 0) fill(results, noOptions(result));
    else if (result) {
      fill(
        results,
        h('ul', { class: 'options' }, result.options.map((o) => optionRow(o, net, () => app.push({ name: 'option', option: o })))),
        h(
          'div',
          { class: 'hint-box' },
          note(
            liveDown
              ? tr('Live bus positions are not available right now, so times are based on how often buses usually run.')
              : arrivals
                ? tr('Live times refresh every 20 seconds.')
                : tr('Checking for live buses…'),
          ),
        ),
      );
    }

    fill(
      extras,
      net?.network.notice ? notice(tr(net.network.notice)) : null,
      net ? button(tr('Conductor? Share your bus'), () => app.push({ name: 'conductor' }), 'secondary', 'bus-front') : null,
      net?.network.attribution?.length ? credits(net.network.attribution) : null,
    );
  }

  update();
  return { el, update, destroy: () => clearInterval(timer) };
}

/** The credits the route data's licences require, each linked to its licence or source. */
function credits(list: { text: string; url?: string }[]): HTMLElement {
  return h(
    'p',
    { class: 'small credits' },
    tr('Data sources:'),
    ' ',
    list.flatMap((a, i) => [
      i ? ' · ' : '',
      a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.text) : a.text,
    ]),
  );
}

function ticket(from: Place | null, to: Place | null): HTMLElement {
  const field = (label: string, place: Place | null, placeholder: string, f: Field) =>
    h(
      'button',
      {
        class: 'field-btn',
        type: 'button',
        'aria-label': tr('{field}: {place}', { field: label, place: place ? placeName(place) : tr('not chosen') }),
        onclick: () => app.push({ name: 'search', field: f }),
      },
      h('span', { class: 'field-label' }, label),
      h('span', { class: place ? 'field-value set' : 'field-value empty' }, place ? placeName(place) : placeholder),
    );
  return h(
    'div',
    { class: 'ticket' },
    h('div', { class: 'rail', 'aria-hidden': 'true' }, h('span', { class: 'dot' }), h('span', { class: 'rail-line' }), h('span', { class: 'dot hollow' })),
    h('div', { class: 'fields' }, field(tr('From'), from, tr('Where are you starting?'), 'from'), field(tr('To'), to, tr('Where are you going?'), 'to')),
    h('button', { class: 'swap', type: 'button', 'aria-label': tr('Swap start and destination'), onclick: app.swap }, icon('arrow-up-down')),
  );
}

function noOptions(result: PlanResult): HTMLElement {
  if (result.notRunning.length) {
    return h(
      'div',
      { class: 'hint-box' },
      h('p', { class: 'strong' }, tr('No bus runs between these places right now.')),
      result.notRunning.map((r) => note(tr('{route} runs from {first} to {last}.', { route: r.routeNumber, first: digits(r.firstBus), last: digits(r.lastBus) }))),
    );
  }
  return h(
    'div',
    { class: 'hint-box' },
    h('p', { class: 'strong' }, tr('No bus connects these places with one change or less.')),
    note(tr('Try a stop nearby, or pick the exact place on the map.')),
  );
}
