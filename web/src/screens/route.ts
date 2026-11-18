import { api } from '../api.ts';
import * as app from '../app.ts';
import { MODE_NAME, note, notice, plural, routeBoard, routeTitle, runningText, serviceKind, shell, stopName, towards, type View } from '../components.ts';
import { isPatternActive, isRouteRunning, istNow, parseClock, sliceLine, type LatLng, type PreparedNetwork, type PreparedPattern, type Route, type Stop, type VehicleView } from '../core.ts';
import { fill, h } from '../dom.ts';
import { digits, lang, nameOf, tr } from '../i18n.ts';
import { icon } from '../icon.ts';
import { busMarker, createMap, cssVar, stopDot } from '../map.ts';

// A route's own page: where it runs and when, each direction's stops, and the buses being
// tracked on it now, pushed by the server as they move. The Metro, trains and ferries are not
// tracked, so their page has the timetable only.

const VEHICLES_REFRESH_MS = 10_000;

/** The directions in use today: not a diversion outside its dates, nor one a diversion replaces. */
function todaysPatterns(route: Route, minute: number, dateISO: string) {
  return route.patterns.filter((p) => isPatternActive(route, p, p.activeWindows?.length ? parseClock(p.activeWindows[0].from) : minute, dateISO));
}

/** The other script's name: Bengali under English, English under Bengali. */
function otherName(s: Stop): HTMLElement | null {
  if (lang === 'bn') return s.nameBn ? h('span', { class: 'stop-other', lang: 'en' }, s.name) : null;
  return s.nameBn ? h('span', { class: 'stop-other', lang: 'bn' }, s.nameBn) : null;
}

const path = (pp: PreparedPattern): [number, number][] => sliceLine(pp.line, 0, pp.line.length).map((p: LatLng) => [p.lat, p.lng]);

export function routeScreen(routeId: string): View {
  const net = app.state.net as PreparedNetwork; // Opened from the route list or search, once the network is loaded.
  const route = net?.routes.get(routeId);
  if (!route) return { el: shell({ title: tr('Find a route'), onBack: app.pop, body: note(tr('This route is no longer in the network.')) }) };

  const mode = route.mode ?? 'bus';
  const tracked = mode === 'bus';
  const { minute, dateISO } = istNow();
  const running = isRouteRunning(route, minute);
  const patterns = todaysPatterns(route, minute, dateISO);
  const runsNow = (p: PreparedPattern['pattern']) => running && isPatternActive(route, p, minute, dateISO);
  let patternId = (patterns.find(runsNow) ?? patterns[0] ?? route.patterns[0]).id;
  const current = () => net.patterns.get(patternId);

  const head = h(
    'section',
    { class: 'card route-card' },
    h(
      'div',
      { class: 'route-head' },
      routeBoard(route.number, route.operator, 'lg', route.mode, route.color),
      h('div', { class: 'grow' }, h('p', { class: 'route-title' }, routeTitle(net, route)), h('p', { class: 'route-meta' }, [serviceKind(route), route.name].filter(Boolean).join(' · '))),
    ),
    h(
      'div',
      { class: 'route-facts' },
      h('span', { class: running ? 'run-state on' : 'run-state' }, h('span', { class: 'tag-dot', 'aria-hidden': 'true' }), runningText(route, minute)),
      h('span', { class: 'fact' }, icon('clock', { size: 16 }), tr('Runs from {first} to {last}', { first: digits(route.firstBus), last: digits(route.lastBus) })),
    ),
  );
  const dirs = h('div', { class: 'panel', role: 'radiogroup', 'aria-labelledby': 'route-dirs' });
  const mapEl = h('div', { class: 'map rounded', role: 'region', 'aria-label': tr('Map of the route and tracked buses') });
  const liveLine = h('div', { 'aria-live': 'polite' });
  const stopsBox = h('section', { class: 'card' });
  const el = shell({
    title: mode === 'bus' ? tr('Route {route}', { route: route.number }) : `${MODE_NAME[mode]} ${route.number}`,
    onBack: app.pop,
    body: [
      head,
      patterns.length > 1 ? [h('h2', { class: 'section-title', id: 'route-dirs' }, tr('Which way?')), dirs] : null,
      mapEl,
      liveLine,
      stopsBox,
      h(
        'button',
        { class: 'link', type: 'button', onclick: () => app.push({ name: 'suggest', kind: 'route', routeIds: [route.id] }) },
        icon('message-square-warning', { size: 18 }),
        tr('Something wrong with this route? Tell us'),
      ),
    ],
  });

  // The direction on the map, its stops, and its buses.
  const fit = (map: L.Map) => {
    const pp = current();
    if (pp) map.fitBounds(path(pp), { paddingTopLeft: [24, 24], paddingBottomRight: [24, 40], animate: false });
  };
  const handle = createMap(mapEl, net.center, 13, fit);
  const vehicleLayer = handle ? L.layerGroup().addTo(handle.map) : null;
  // Buses in blue; the Metro and ferries in their line's colour.
  const color = mode === 'bus' ? cssVar('--blue') : cssVar(`--line-${route.color ?? 'blue'}`);
  function drawLine() {
    const pp = current();
    if (!handle || !pp) return;
    handle.layer.clearLayers();
    L.polyline(path(pp), { color, weight: 5, opacity: 0.85 }).addTo(handle.layer);
    const ids = pp.pattern.stopIds;
    ids.forEach((id, i) => {
      const s = net.stops.get(id);
      if (s) stopDot(s, nameOf(s), i === 0 || i === ids.length - 1 ? color : cssVar('--surface')).addTo(handle.layer);
    });
  }

  let vehicles: VehicleView[] = [];
  let loaded = false;
  let liveDown = false;
  let stream: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  function drawVehicles() {
    vehicleLayer?.clearLayers();
    for (const v of vehicles) {
      const who = v.source === 'conductor' ? tr('shared by the conductor') : tr('{riders} sharing', { riders: plural(v.riders, 'rider', 'riders') });
      const label = tr('Bus {route} towards {place}, {who}, seen {sec} s ago', { route: v.routeNumber, place: towards(net, v.patternId, v.headsign), who, sec: v.lastSeenSec });
      if (vehicleLayer) busMarker(v, routeBoard(v.routeNumber, v.operator, 'sm'), label).addTo(vehicleLayer);
    }
  }

  function renderLive() {
    fill(
      liveLine,
      !tracked
        ? notice(tr('The Metro, trains and ferries are not tracked live. Times come from how often they run.'))
        : liveDown
          ? notice(tr('Live bus positions are not available right now.'), 'wifi-off', 'warn')
          : !loaded
            ? notice(tr('Checking for live buses…'), 'radio-tower')
            : notice(
                vehicles.length
                  ? tr('{buses} tracked on this direction right now.', { buses: plural(vehicles.length, 'bus', 'buses') })
                  : tr('No bus on this direction is being tracked right now.'),
                'radio-tower',
              ),
    );
  }

  function renderDirs() {
    fill(
      dirs,
      patterns.map((p) => {
        const on = p.id === patternId;
        const place = towards(net, p.id, p.headsign);
        return h(
          'button',
          { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => choose(p.id) },
          icon(on ? 'circle-dot' : 'navigation'),
          h(
            'span',
            { class: 'grow' },
            runsNow(p) ? tr('Towards {place}', { place }) : tr('Towards {place} (not running now)', { place }),
            p.activeWindows?.length ? h('span', { class: 'small' }, digits(p.activeWindows.map((w) => `${w.from}–${w.to}`).join(', '))) : null,
          ),
        );
      }),
    );
  }

  /** Where each bus is on the list: after the last stop it passed. */
  function busesAfter(pp: PreparedPattern, i: number): VehicleView[] {
    const next = i + 1 < pp.stopAlong.length ? pp.stopAlong[i + 1] : Number.POSITIVE_INFINITY;
    return vehicles.filter((v) => v.alongM < next && (i === 0 || v.alongM >= pp.stopAlong[i]));
  }

  function renderStops() {
    const pp = current();
    if (!pp) return fill(stopsBox);
    const ids = pp.pattern.stopIds;
    fill(
      stopsBox,
      h('h2', { class: 'card-title' }, tr('Stops'), h('span', { class: 'small' }, plural(ids.length, 'stop', 'stops'))),
      h(
        'ol',
        { class: 'stop-line' },
        ids.map((id, i) => {
          const s = net.stops.get(id);
          const last = i === ids.length - 1;
          return h(
            'li',
            { class: i === 0 || last ? 'end' : null },
            h('span', { class: 'stop-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'stop-name' }, s ? nameOf(s) : id),
            s ? otherName(s) : null,
            tracked
              ? busesAfter(pp, i).map((v) =>
                  h(
                    'span',
                    { class: 'bus-here' },
                    routeBoard(v.routeNumber, v.operator, 'sm'),
                    h(
                      'span',
                      {},
                      last
                        ? tr('Near {stop}, seen {sec} s ago', { stop: stopName(net, id), sec: v.lastSeenSec })
                        : tr('Between {from} and {to}, seen {sec} s ago', { from: stopName(net, id), to: stopName(net, ids[i + 1]), sec: v.lastSeenSec }),
                    ),
                  ),
                )
              : null,
          );
        }),
      ),
    );
  }

  const show = (list: VehicleView[]) => {
    vehicles = list.filter((v) => v.patternId === patternId);
    loaded = true;
    liveDown = false;
    drawVehicles();
    renderStops();
    renderLive();
  };
  const poll = () =>
    api.vehicles(patternId).then(show, () => {
      liveDown = true;
      renderLive();
    });
  function watch() {
    stream?.close();
    clearInterval(timer);
    vehicles = [];
    loaded = false;
    if (!tracked) return;
    stream = api.liveVehicles([patternId], show);
    if (!stream) void poll();
    // Where the stream cannot stay open, the page asks every 10 seconds.
    timer = setInterval(() => {
      if (!stream || stream.readyState !== EventSource.OPEN) void poll();
    }, VEHICLES_REFRESH_MS);
  }

  function choose(id: string) {
    if (id === patternId) return;
    patternId = id;
    renderDirs();
    drawLine();
    if (handle) fit(handle.map);
    watch();
    drawVehicles();
    renderStops();
    renderLive();
  }

  renderDirs();
  drawLine();
  watch();
  renderStops();
  renderLive();
  return {
    el,
    destroy: () => {
      stream?.close();
      clearInterval(timer);
      handle?.destroy();
    },
  };
}
