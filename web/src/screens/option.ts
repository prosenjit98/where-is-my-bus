import { canConduct, rememberPlate, signedInNow, whoAmI } from '../account.ts';
import { askToNotify, unlockSound } from '../alarm.ts';
import { api } from '../api.ts';
import * as app from '../app.ts';
import {
  button,
  formatDistance,
  liveTag,
  MODE_NAME,
  note,
  notice,
  plateField,
  plural,
  routeBoard,
  shell,
  stopName as nameOfStop,
  switchRow,
  towards,
  type View,
} from '../components.ts';
import {
  isBusLeg,
  laterTrackedText,
  reportedText,
  sliceLine,
  waitText,
  type Arrival,
  type BusLeg,
  type PlanOption,
  type PreparedNetwork,
  type VehicleView,
  type WalkLeg,
} from '../core.ts';
import { fill, h, type Child } from '../dom.ts';
import { lang, nameOf, tr } from '../i18n.ts';
import { icon, type IconName } from '../icon.ts';
import { checkPreciseLocation } from '../location.ts';
import { busMarker, createMap, cssVar, stopDot } from '../map.ts';
import { deviceId } from '../storage.ts';
import { startTrip } from '../trip.ts';
import { OWNER_NOTE } from './conductor.ts';

const VEHICLES_REFRESH_MS = 10_000;

export function optionScreen(option: PlanOption): View {
  const net = app.state.net as PreparedNetwork; // A journey can only be opened once the network is loaded.
  const stopName = (id: string) => nameOfStop(net, id);
  const busLegs = option.legs.filter(isBusLeg);
  const lastLeg = option.legs[option.legs.length - 1];
  const destination = lastLeg.kind === 'walk' ? lastLeg.toLabel : stopName(lastLeg.alightStopId);

  const mapEl = busLegs.length ? h('div', { class: 'map', role: 'region', 'aria-label': tr('Map of the journey and tracked buses') }) : null;
  const liveLine = h('div', { class: 'pad', 'aria-live': 'polite' });
  const steps = h('div', { class: 'steps' });
  const el = shell({ title: tr('{min} min to {place}', { min: option.totalMin, place: destination }), onBack: app.pop, body: [mapEl, liveLine, steps], flush: true });

  // The legs on the map, with where to get on and off.
  const paths = busLegs.map((leg) => {
    const pp = net.patterns.get(leg.choices[0].patternId);
    if (!pp) return [];
    const b = pp.pattern.stopIds.indexOf(leg.boardStopId);
    const a = pp.pattern.stopIds.indexOf(leg.alightStopId, b + 1);
    return b < 0 || a < 0 ? [] : sliceLine(pp.line, pp.stopAlong[b], pp.stopAlong[a]);
  });
  const all = paths.flat().map((p) => [p.lat, p.lng] as [number, number]);
  const fit = (map: L.Map) => {
    if (all.length > 1) map.fitBounds(all, { padding: [30, 30], animate: false });
  };
  const handle = mapEl ? createMap(mapEl, paths.flat()[0] ?? net.center, 13, fit) : null;
  const vehicleLayer = handle ? L.layerGroup().addTo(handle.map) : null;
  if (handle) {
    paths.forEach((coords, i) => {
      if (coords.length > 1) {
        // A Metro or ferry leg in its line's colour; buses in blue, then ink.
        const ch = busLegs[i].choices[0];
        const color = ch.mode !== 'bus' ? cssVar(`--line-${ch.color ?? 'blue'}`) : i === 0 ? cssVar('--blue') : cssVar('--ink');
        L.polyline(coords.map((p) => [p.lat, p.lng] as [number, number]), { color, weight: 5, opacity: 0.85 }).addTo(handle.layer);
      }
    });
    for (const leg of busLegs) {
      const b = net.stops.get(leg.boardStopId);
      const a = net.stops.get(leg.alightStopId);
      if (b) stopDot(b, tr('Get on at {stop}', { stop: nameOf(b) }), cssVar('--blue')).addTo(handle.layer);
      if (a) stopDot(a, tr('Get off at {stop}', { stop: nameOf(a) }), cssVar('--surface')).addTo(handle.layer);
    }
  }

  // Buses being tracked right now on these routes (the Metro and ferries are not tracked), pushed
  // by the server as they move. Where a stream cannot stay open, the app asks every 10 seconds.
  const patternIds = [...new Set(busLegs.flatMap((l) => l.choices.filter((ch) => ch.mode === 'bus').map((ch) => ch.patternId)))].slice(0, 6);
  let vehicles: VehicleView[] = [];
  const drawVehicles = () => {
    vehicleLayer?.clearLayers();
    for (const v of vehicles) {
      const who = v.source === 'conductor' ? tr('shared by the conductor') : tr('{riders} sharing', { riders: plural(v.riders, 'rider', 'riders') });
      const label = tr('Bus {route} towards {place}, {who}, seen {sec} s ago', {
        route: v.routeNumber,
        place: towards(net, v.patternId, v.headsign),
        who,
        sec: v.lastSeenSec,
      });
      if (vehicleLayer) busMarker(v, routeBoard(v.routeNumber, v.operator, 'sm'), label).addTo(vehicleLayer);
    }
    fill(
      liveLine,
      patternIds.length
        ? notice(
            vehicles.length
              ? tr('{buses} on these routes tracked right now.', { buses: plural(vehicles.length, 'bus', 'buses') })
              : tr('No bus on these routes is being tracked right now.'),
            'radio-tower',
          )
        : null,
    );
  };
  const showVehicles = (list: VehicleView[]) => {
    vehicles = list;
    drawVehicles();
  };
  const loadVehicles = () =>
    Promise.all(patternIds.map((id) => api.vehicles(id))).then(
      (lists) => showVehicles(lists.flat()),
      () => fill(liveLine, notice(tr('Live bus positions are not available right now.'), 'wifi-off', 'warn')),
    );
  // What riders reported at earlier stops, for the stops where this journey gets on a bus.
  const boardStops = [...new Set(busLegs.map((l) => l.boardStopId))];
  let arrivals: Record<string, Arrival[]> = {};
  const loadArrivals = () =>
    api.arrivals(boardStops).then(
      (a) => {
        arrivals = a;
        renderSteps();
      },
      () => undefined,
    );
  let timer: ReturnType<typeof setInterval> | undefined;
  let stream: EventSource | null = null;
  if (patternIds.length) {
    stream = api.liveVehicles(patternIds, showVehicles);
    if (!stream) void loadVehicles();
    void loadArrivals();
    timer = setInterval(() => {
      if (!stream || stream.readyState !== EventSource.OPEN) void loadVehicles();
      void loadArrivals();
    }, VEHICLES_REFRESH_MS);
  }

  let openLeg: number | null = null;
  // "Did one just leave?": which leg's panel is open, and what each report got back.
  let reportLeg: number | null = null;
  const reported = new Map<number, string>();
  const report = (index: number, leg: BusLeg, patternId: string) =>
    api.report(patternId, leg.boardStopId, deviceId()).then(
      (r) => {
        reported.set(
          index,
          r.repeat
            ? tr('You already said so. Thank you.')
            : r.agreed
              ? tr('Thank you. Another rider saw it too, so people further along now see it.')
              : tr('Thank you. When another rider says the same, people further along will see it.'),
        );
        reportLeg = null;
        renderSteps();
      },
      (e: unknown) => {
        reported.set(index, e instanceof Error ? e.message : tr('The report could not be sent.'));
        renderSteps();
      },
    );

  function renderSteps() {
    let busIndex = -1;
    fill(
      steps,
      option.legs.map((leg) => {
        if (leg.kind === 'walk') return walkStep(leg);
        busIndex += 1;
        const index = busIndex;
        return busStep(leg, stopName, openLeg === index, () => {
          openLeg = openLeg === index ? null : index;
          renderSteps();
        }, net, {
          arrivals: arrivals[leg.boardStopId],
          open: reportLeg === index,
          result: reported.get(index) ?? null,
          toggle: () => {
            reportLeg = reportLeg === index ? null : index;
            renderSteps();
          },
          send: (patternId) => void report(index, leg, patternId),
        });
      }),
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => app.push({ name: 'suggest', routeIds: [...new Set(busLegs.flatMap((l) => l.choices.map((ch) => ch.routeId)))], stopId: busLegs[0]?.boardStopId }),
        },
        icon('message-square-warning', { size: 18 }),
        tr('Something wrong with this journey? Suggest a fix'),
      ),
    );
  }
  renderSteps();

  return {
    el,
    destroy: () => {
      clearInterval(timer);
      stream?.close();
      handle?.destroy();
    },
  };
}

/** One step of the journey on the timeline: its dot and line, and its card. */
function step(kind: 'walk' | 'bus', iconName: IconName, ...card: Child[]): HTMLElement {
  return h(
    'section',
    { class: `step ${kind}` },
    h('div', { class: 'step-rail', 'aria-hidden': 'true' }, h('span', { class: 'step-dot' }, icon(iconName, { size: 18 })), h('span', { class: 'step-line' })),
    h('div', { class: 'step-card' }, card),
  );
}

function walkStep(leg: WalkLeg): HTMLElement {
  return step('walk', 'footprints', h('p', { class: 'strong' }, tr('Walk {min} min to {place}', { min: leg.minutes, place: leg.toLabel })), note(formatDistance(leg.meters)));
}

type ReportUi = {
  arrivals: Arrival[] | undefined;
  open: boolean;
  result: string | null;
  toggle: () => void;
  send: (patternId: string) => void;
};

function busStep(leg: BusLeg, stopName: (id: string) => string, open: boolean, onToggle: () => void, net: PreparedNetwork, r: ReportUi): HTMLElement {
  const main = leg.choices[0];
  const tracked = laterTrackedText(leg, lang);
  const seen = reportedText(leg, r.arrivals, stopName, lang);
  const board = stopName(leg.boardStopId);
  // For people waiting without location: a bus that just left is worth telling the stops further on.
  const reportUi = r.open
    ? h(
        'div',
        { class: 'panel' },
        h('p', { class: 'strong', id: `left-${leg.boardStopId}` }, tr('Which bus just left {stop}?', { stop: board })),
        h(
          'div',
          { class: 'boards' },
          leg.choices.map((ch) =>
            h(
              'button',
              { class: 'pick', type: 'button', 'aria-label': tr('{route} just left {stop}', { route: ch.routeNumber, stop: board }), onclick: () => r.send(ch.patternId) },
              routeBoard(ch.routeNumber, ch.operator),
            ),
          ),
        ),
        h('button', { class: 'link', type: 'button', onclick: r.toggle }, tr('Cancel')),
      )
    : h('button', { class: 'link', type: 'button', onclick: r.toggle }, icon('megaphone', { size: 18 }), tr('Did one just leave {stop}? Tell others', { stop: board }));
  // Only buses are tracked and shared; the Metro, trains and ferries come at their usual frequency.
  const isBus = main.mode === 'bus';
  return step(
    'bus',
    isBus ? 'bus' : main.mode === 'ferry' ? 'ship' : 'train-front',
    h('div', { class: 'boards' }, leg.choices.map((ch) => routeBoard(ch.routeNumber, ch.operator, 'md', ch.mode, ch.color))),
    h(
      'p',
      { class: 'strong' },
      leg.choices.length > 1
        ? tr('Take whichever comes first')
        : tr('{mode} {route} towards {place}', { mode: isBus ? tr('Bus') : MODE_NAME[main.mode], route: main.routeNumber, place: towards(net, main.patternId, main.headsign) }),
    ),
    h('p', { class: 'note' }, tr('From {from} to {to}', { from: stopName(leg.boardStopId), to: stopName(leg.alightStopId) })),
    note(tr('{stops}, about {min} min', { stops: plural(main.stopsCount, 'stop', 'stops'), min: Math.max(1, Math.round(leg.rideMin)) })),
    h('div', { class: 'wait-row' }, liveTag(leg.waitIsLive), h('span', { class: 'grow' }, waitText(leg, stopName, lang))),
    tracked ? h('p', { class: 'tracked' }, tracked) : null,
    seen ? h('p', { class: 'status-item' }, icon('megaphone', { size: 18 }), h('span', {}, seen)) : null,
    !isBus ? null : open ? startPanel(leg, stopName, net) : button(tr('I’m on this bus'), onToggle, 'secondary', 'bus-front'),
    isBus ? reportUi : null,
    isBus && r.result ? note(r.result) : null,
  );
}

function startPanel(leg: BusLeg, stopName: (id: string) => string, net: PreparedNetwork): HTMLElement {
  let patternId = leg.choices[0].patternId;
  let share = true;
  // A rider is not asked for anything about the bus: the server puts them on the bus they are
  // sharing with by where they are, next to its conductor or other riders on it (core live.ts).
  // Someone signed in on /signin as a conductor (or as the owner, or a manager) can share as the
  // bus's conductor, with its whole plate; conductors start that way.
  const fullPlate = plateField();
  const knownAtStart = signedInNow() !== undefined;
  let conductor = signedInNow()?.kind === 'conductor';
  const problem = h('div');
  const start = button(tr('Start trip and share'), () => void begin());
  const extra = h('div', { class: 'panel' });
  const panel = h('div', { class: 'panel' });

  function renderExtra() {
    start.textContent = share ? tr('Start trip and share') : tr('Start stop alarm');
    const me = signedInNow();
    if (!canConduct(me)) conductor = false;
    fill(
      extra,
      share
        ? [
            canConduct(me)
              ? switchRow(tr('I’m the conductor'), tr('Signed in as {name}', { name: me.name }), conductor, (v) => {
                  conductor = v;
                  renderExtra();
                })
              : null,
            conductor ? [fullPlate, note(tr(OWNER_NOTE))] : null,
          ]
        : null,
    );
  }

  async function begin() {
    unlockSound();
    fill(problem);
    const asConductor = share && conductor;
    if (asConductor && !fullPlate.value.trim()) {
      fill(problem, note(tr('Type the bus’s number plate, as painted on the bus.'), 'danger'));
      fullPlate.focus();
      return;
    }
    start.disabled = true;
    try {
      const wrong = await checkPreciseLocation();
      if (wrong) {
        fill(problem, note(wrong, 'danger'));
        return;
      }
      await askToNotify();
      const choice = leg.choices.find((ch) => ch.patternId === patternId) ?? leg.choices[0];
      await startTrip(net, {
        patternId: choice.patternId,
        routeNumber: choice.routeNumber,
        operator: choice.operator,
        headsign: towards(net, choice.patternId, choice.headsign),
        destStopId: leg.alightStopId,
        destName: stopName(leg.alightStopId),
        alarm: true,
        share,
        role: asConductor ? 'conductor' : 'rider',
        plate: asConductor ? fullPlate.value.trim() : undefined,
      });
      if (asConductor) rememberPlate(fullPlate.value);
      app.push({ name: 'trip' });
    } catch (e) {
      fill(problem, note(e instanceof Error ? e.message : tr('The trip could not start.'), 'danger'));
    } finally {
      start.disabled = false;
    }
  }

  const picks =
    leg.choices.length > 1
      ? h(
          'div',
          { class: 'panel' },
          h('p', { class: 'strong', id: 'which-bus' }, tr('Which bus did you get on?')),
          h(
            'div',
            { class: 'boards', role: 'radiogroup', 'aria-labelledby': 'which-bus' },
            leg.choices.map((ch) => {
              const b = h(
                'button',
                { class: 'pick', type: 'button', role: 'radio', 'aria-checked': String(ch.patternId === patternId), 'aria-label': tr('Route {route}', { route: ch.routeNumber }) },
                routeBoard(ch.routeNumber, ch.operator),
              );
              b.addEventListener('click', () => {
                patternId = ch.patternId;
                b.parentElement?.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', String(r === b)));
              });
              return b;
            }),
          ),
        )
      : null;

  fill(
    panel,
    picks,
    switchRow(
      tr('Share where this bus is'),
      tr('People waiting at stops see the bus coming. Only the bus position is sent, not who you are, and it stops when you get off.'),
      share,
      (v) => {
        share = v;
        renderExtra();
      },
    ),
    extra,
    notice(tr('Keep this screen on during the trip: browsers stop location when the screen is off.'), 'smartphone'),
    problem,
    start,
  );
  renderExtra();
  // Who is signed in on this phone, asked once per visit.
  void whoAmI().then((me) => {
    if (!knownAtStart && me?.kind === 'conductor') conductor = true;
    renderExtra();
  });
  return panel;
}
