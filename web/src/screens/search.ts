import * as app from '../app.ts';
import type { Field, Place } from '../app.ts';
import { formatDistance, note, placeName, routeRow, shell, type View } from '../components.ts';
import { nearbyStops, search, searchRoutes, type SearchHit } from '../core.ts';
import { bn, fill, h } from '../dom.ts';
import { lang, nameOf, tr } from '../i18n.ts';
import { icon, type IconName } from '../icon.ts';
import { APPROXIMATE_M, currentFix, permissionState } from '../location.ts';

type LocUi =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'approx'; stops: { id: string; name: string; label: string; distM: number }[] }
  | { kind: 'message'; text: string };

const BLOCKED =
  'Location is blocked for this site. You can still search for your stop or pick it on the map. To allow it, open this site’s settings in your browser.';

/** The other script's name under a place's name: Bengali under English, English under Bengali. */
function otherName(place: SearchHit['place']): HTMLElement | null {
  if (lang === 'bn') return place.nameBn ? h('span', { lang: 'en' }, place.name) : null;
  return bn(place.nameBn);
}

export function searchScreen(field: Field): View {
  let loc: LocUi = { kind: 'idle' };
  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder: tr('Stop, area or landmark, in English or বাংলা'),
    'aria-label': tr('Search for a stop or landmark'),
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  const content = h('div');
  const el = shell({
    title: field === 'from' ? tr('Starting from') : tr('Going to'),
    onBack: app.pop,
    body: [h('div', { class: 'search-box', role: 'search' }, h('div', { class: 'input-wrap' }, icon('search'), input)), content],
    flush: true,
  });

  const choose = (p: Place) => {
    app.setPlace(field, p);
    app.pop();
  };
  const chooseHit = (hit: SearchHit) =>
    choose(
      hit.place.kind === 'stop'
        ? { kind: 'stop', stopId: hit.place.id, name: hit.place.name }
        : { kind: 'point', lat: hit.place.lat, lng: hit.place.lng, name: nameOf(hit.place) },
    );

  // Precise location picks the spot; approximate narrows it to the area; none falls back to search and the map.
  async function useMyLocation() {
    const net = app.state.net;
    if (!net) return;
    loc = { kind: 'busy' };
    render();
    const permission = await permissionState();
    if (permission === 'unsupported') {
      loc = { kind: 'message', text: tr('This browser cannot share your location on this page. Search for your stop, or pick it on the map.') };
    } else if (permission === 'denied') {
      loc = { kind: 'message', text: tr(BLOCKED) };
    } else {
      const r = await currentFix();
      if ('error' in r) {
        loc = {
          kind: 'message',
          text:
            r.error === 'denied'
              ? tr(BLOCKED)
              : r.error === 'timeout'
                ? tr('Your location could not be found in time. Search for your stop, or try again near a window.')
                : tr('Your phone’s location seems to be switched off. Turn it on, or search for your stop.'),
        };
      } else if ((r.fix.accuracy ?? 0) > APPROXIMATE_M) {
        const stops = nearbyStops(net, r.fix, 2500)
          .slice(0, 8)
          .map((n) => ({ id: n.stop.id, name: n.stop.name, label: nameOf(n.stop), distM: n.distM }));
        loc = stops.length
          ? { kind: 'approx', stops }
          : { kind: 'message', text: tr('There are no stops near your approximate location. Search for your stop instead.') };
      } else {
        loc = { kind: 'idle' };
        choose({ kind: 'point', lat: r.fix.lat, lng: r.fix.lng, name: 'Your location' });
        return;
      }
    }
    render();
  }

  const row = (iconName: IconName, title: string, sub: string | HTMLElement | null, onClick: () => void, strong = false) =>
    h(
      'li',
      {},
      h(
        'button',
        { class: strong ? 'row strong' : 'row', type: 'button', onclick: onClick },
        h('span', { class: 'row-icon' }, icon(iconName)),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
      ),
    );

  function render() {
    const net = app.state.net;
    const query = input.value.trim();
    if (query) {
      const hits = net ? search(net.searchIndex, query, 15) : [];
      // People also type the number of the bus they take: those routes open their own page.
      const routeHits = net ? searchRoutes(net, query, 5).filter((r) => !r.via) : [];
      const routes =
        net && routeHits.length
          ? [
              h('h2', { class: 'section' }, tr('Routes')),
              h('ul', { class: 'rows', 'aria-label': tr('Matching routes') }, routeHits.map((r) => routeRow(net, r.route, () => app.push({ name: 'route', routeId: r.route.id })))),
            ]
          : null;
      const places = hits.length
        ? [
            routes ? h('h2', { class: 'section' }, tr('Places')) : null,
            h(
              'ul',
              { class: 'rows', 'aria-label': tr('Matching places') },
              hits.map((hit) => {
                const other = otherName(hit.place);
                const isLandmark = hit.place.kind === 'landmark';
                return row(
                  isLandmark ? 'map-pinned' : 'bus',
                  nameOf(hit.place),
                  isLandmark || other ? h('span', {}, isLandmark ? tr('Landmark') : null, isLandmark && other ? ', ' : null, other) : null,
                  () => chooseHit(hit),
                );
              }),
            ),
          ]
        : null;
      fill(
        content,
        places || routes
          ? // A route number typed exactly: the route first.
            routeHits[0]?.score === 1
            ? [routes, places]
            : [places, routes]
          : h(
              'div',
              { class: 'pad' },
              note(tr('Nothing matches “{query}”. Try another spelling, or pick the place on the map.', { query })),
              h(
                'button',
                { class: 'link', type: 'button', onclick: () => app.push({ name: 'suggest', kind: 'stop', text: `${tr('Missing stop or place:')} ${query}` }) },
                icon('message-square-warning', { size: 18 }),
                tr('Is a stop missing? Tell us'),
              ),
            ),
      );
      return;
    }
    const recent = app.recents();
    fill(
      content,
      h(
        'ul',
        { class: 'rows' },
        field === 'from' ? row('locate-fixed', tr('Use my location'), tr('Find the stops near you'), () => void useMyLocation(), true) : null,
        row('map', tr('Pick on the map'), tr('Tap the exact place'), () => app.push({ name: 'map', field }), true),
      ),
      loc.kind === 'busy' ? h('div', { class: 'pad' }, note(tr('Finding your location…'))) : null,
      loc.kind === 'message' ? h('div', { class: 'pad' }, note(loc.text)) : null,
      loc.kind === 'approx'
        ? [
            h('div', { class: 'pad' }, note(tr('Your phone shares only an approximate location. Which stop are you near?'))),
            h(
              'ul',
              { class: 'rows' },
              loc.stops.map((s) =>
                row('bus', s.label, tr('About {distance} away', { distance: formatDistance(s.distM) }), () => choose({ kind: 'stop', stopId: s.id, name: s.name })),
              ),
            ),
          ]
        : null,
      recent.length
        ? [
            h('h2', { class: 'section' }, tr('Recent places')),
            h('ul', { class: 'rows' }, recent.map((p) => row('history', placeName(p), p.kind === 'stop' ? tr('Stop') : tr('Place on the map'), () => choose(p)))),
          ]
        : null,
    );
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !app.state.net) return;
    const first = search(app.state.net.searchIndex, input.value, 1)[0];
    const route = first ? null : searchRoutes(app.state.net, input.value, 1).find((r) => !r.via);
    if (first) chooseHit(first);
    else if (route) app.push({ name: 'route', routeId: route.route.id });
  });
  render();
  requestAnimationFrame(() => input.focus());
  return { el, update: render };
}
