import { unlockSound } from '../alarm.ts';
import * as app from '../app.ts';
import { button, note, plural, routeBoard, shell, statusItem, stopName, towards, type View } from '../components.ts';
import { haversine, isPatternActive, isRouteRunning, istNow, type PreparedNetwork, type PreparedPattern } from '../core.ts';
import { fill, h } from '../dom.ts';
import { tr } from '../i18n.ts';
import { icon } from '../icon.ts';
import { dismissAlarm, endTrip, followLink, getTripSnapshot, startTrip, type EndReason, type TripConfig } from '../trip.ts';

const ENDED: Record<EndReason, string> = {
  user: 'You ended the trip.',
  left_route: 'It looks like you got off, so the trip ended by itself.',
  passed_destination: 'You went past your stop, so the trip ended by itself.',
  location_denied: 'Location was turned off for this site, so the trip ended.',
  too_old: 'The trip was more than 6 hours old, so it ended.',
};

/** The direction a conductor's bus takes next from the end of this one, if it runs now. */
export function returnPattern(net: PreparedNetwork, patternId: string): PreparedPattern | null {
  const pp = net.patterns.get(patternId);
  if (!pp) return null;
  const end = net.stops.get(pp.pattern.stopIds[pp.pattern.stopIds.length - 1]);
  const { minute, dateISO } = istNow();
  let best: PreparedPattern | null = null;
  for (const p of pp.route.patterns) {
    const q = net.patterns.get(p.id);
    const start = q ? net.stops.get(q.pattern.stopIds[0]) : undefined;
    if (!q || !start || !end || q.id === pp.id || q.pattern.direction === pp.pattern.direction) continue;
    if (haversine(start, end) > 300) continue;
    if (!isRouteRunning(q.route, minute) || !isPatternActive(q.route, q.pattern, minute, dateISO)) continue;
    best = best ?? q;
  }
  return best;
}

export function tripScreen(): View {
  const body = h('div', { class: 'panel' });
  const footer = h('div');
  const el = shell({ title: tr('Trip'), onBack: app.pop, body, footer });
  const title = el.querySelector('h1');
  // The family link, once made: shown so it can be copied when the phone has no share sheet.
  let link: { url: string; note: string } | null = null;
  let linkProblem: string | null = null;
  /** The return trip could not start, in the server's words. The trip before it has ended by then. */
  let returnProblem: string | null = null;

  async function shareLink() {
    linkProblem = null;
    try {
      const url = link?.url ?? (await followLink());
      if (navigator.share) {
        try {
          await navigator.share({ title: tr('Follow my bus'), text: tr('See where my bus is, and when it reaches my stop.'), url });
          link = { url, note: tr('Anyone with this link sees the bus until your trip ends.') };
          update();
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false);
      link = {
        url,
        note: copied ? tr('Link copied. Anyone with it sees the bus until your trip ends.') : tr('Copy this link. Anyone with it sees the bus until your trip ends.'),
      };
    } catch (e) {
      linkProblem = e instanceof Error ? tr(e.message) : tr('The link could not be made.');
    }
    update();
  }

  function update() {
    const t = getTripSnapshot();
    if (!t.active || !t.config) {
      if (title) title.textContent = tr('Trip');
      fill(
        body,
        h(
          'div',
          { class: 'trip-card' },
          h('span', { class: 'step-dot' }, icon('check', { size: 20 })),
          h('p', { class: 'headline' }, tr('Trip ended')),
          t.ended ? note(tr(ENDED[t.ended.reason])) : null,
        ),
        returnProblem ? note(tr('The return trip did not start: {reason}', { reason: returnProblem }), 'danger') : null,
      );
      fill(footer, button(tr('Plan a journey'), app.reset, 'primary', 'search'));
      return;
    }
    const cfg = t.config;
    const s = t.state;
    const net = app.state.net;
    // Stop names in the app's language: the trip knows the stops by id.
    const nameAt = (id: string | null, fallback: string | null) => (id && net ? stopName(net, id) : fallback);
    if (title) title.textContent = tr('Bus {route}', { route: cfg.routeNumber });

    let label: string | null = null;
    let headline: string;
    let detail: string | null = null;
    if (!s || s.status === 'waiting_for_fix') {
      headline = tr('Finding your position…');
    } else if (s.status === 'off_route') {
      headline =
        s.alongM === null ? tr('Waiting for route {route}', { route: cfg.routeNumber }) : tr('You seem to be off route {route}', { route: cfg.routeNumber });
      detail =
        s.alongM === null
          ? tr('The trip starts once you are on the bus.')
          : tr('If you have got off, the trip ends by itself in about a minute.');
    } else if (s.status === 'arrived') {
      const dest = nameAt(s.destStopId, s.destName);
      headline = dest ? tr('This is {stop}', { stop: dest }) : tr('This is your stop');
      detail = cfg.role === 'conductor' ? tr('End of the route.') : tr('Get off here.');
    } else {
      label = tr('Next stop');
      headline = nameAt(s.nextStopId, s.nextStopName) ?? tr('Last stop');
    }

    const toGo =
      cfg.destName && s && s.stopsToGo !== null && s.status === 'on_route'
        ? tr('{stop}: {stops} to go, about {min} min', { stop: cfg.destName, stops: plural(s.stopsToGo, 'stop', 'stops'), min: s.etaMin ?? 0 })
        : null;
    const alarmText = !cfg.alarm
      ? null
      : s?.alarm === 'done'
        ? tr('The stop alarm has rung.')
        : tr('The alarm rings about 800 m before {stop}.', { stop: cfg.destName ?? '' });
    const updates = plural(t.sent, 'update', 'updates');
    const sharing = !cfg.share
      ? tr('Not sharing. Only the stop alarm is on.')
      : t.online === false || !t.sharing
        ? tr('No internet right now. The bus position is kept and sent when you are back online.')
        : t.bus
          ? tr('Sharing bus {plate} as the conductor. {updates} sent.', { plate: t.bus.plate, updates })
          : t.role === 'conductor'
            ? tr('Sharing this bus’s position as the conductor. {updates} sent.', { updates })
            : tr('Sharing this bus’s position. {updates} sent.', { updates });
    // A conductor shares one of their owner's buses, so the owner sees this trip: the conductor is told so.
    const owner =
      cfg.share && t.bus
        ? t.bus.owner
          ? tr('{owner}, its owner, sees where the bus is and the trips it runs.', { owner: t.bus.owner })
          : tr('Its owner sees where the bus is and the trips it runs.')
        : null;

    const back = cfg.role === 'conductor' && s?.status === 'arrived' && net ? returnPattern(net, cfg.patternId) : null;
    const nextUp = s ? nameAt(s.destStopId, s.destName) : null;

    fill(
      body,
      t.alarmRinging && s
        ? h(
            'div',
            { class: 'alarm', role: 'alert' },
            h('p', { class: 'headline' }, nextUp ? tr('{stop} is next', { stop: nextUp }) : tr('Your stop is next')),
            h('p', { class: 'strong' }, tr('Get ready to get off.')),
            button(tr('OK'), dismissAlarm, 'secondary'),
          )
        : null,
      h(
        'div',
        { class: 'trip-card' },
        h('div', { class: 'trip-route' }, routeBoard(cfg.routeNumber, cfg.operator, 'lg'), h('span', { class: 'note' }, tr('Towards {place}', { place: cfg.headsign }))),
        h(
          'div',
          { class: 'now', 'aria-live': 'polite' },
          label ? h('span', { class: 'note' }, label) : null,
          h('p', { class: 'headline' }, headline),
          detail ? note(detail) : null,
        ),
        toGo ? h('p', { class: 'togo' }, icon('clock', { size: 18 }), h('span', {}, toGo)) : null,
      ),
      h(
        'div',
        { class: 'status-list' },
        alarmText ? statusItem(alarmText, 'bell-ring') : null,
        statusItem(sharing, cfg.share ? 'radio-tower' : 'bell'),
        owner ? statusItem(owner, 'eye') : null,
        t.refused ? statusItem(tr('Sharing stopped: {reason}', { reason: t.refused }), 'triangle-alert', true) : null,
        t.locationProblem ? statusItem(tr('Waiting for the phone’s location. It often comes back after a flyover or in the open.'), 'locate') : null,
        statusItem(
          t.screenOn ? tr('The screen stays on during the trip, so the alarm can ring.') : tr('Keep this screen on: browsers stop location when the screen is off.'),
          'smartphone',
        ),
      ),
      back && net
        ? button(tr('Start the return trip towards {place}', { place: towards(net, back.id, back.pattern.headsign) }), () => void startReturn(back, cfg), 'primary', 'repeat')
        : null,
      // Family can follow the bus only while it is shared.
      cfg.share && cfg.role === 'rider' && t.sharing ? button(tr('Share a link to follow this bus'), () => void shareLink(), 'secondary', 'share-2') : null,
      link
        ? h(
            'div',
            { class: 'card' },
            h('input', { class: 'input small-input', readonly: true, value: link.url, 'aria-label': tr('Link to follow this bus'), onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
            note(link.note),
          )
        : null,
      linkProblem ? note(linkProblem, 'danger') : null,
    );
    fill(footer, button(tr('End trip'), () => void endTrip('user'), 'danger', 'x'));
  }

  async function startReturn(back: PreparedPattern, cfg: TripConfig) {
    const net = app.state.net;
    if (!net) return;
    unlockSound();
    returnProblem = null;
    const last = back.pattern.stopIds[back.pattern.stopIds.length - 1];
    try {
      await startTrip(net, {
        ...cfg,
        patternId: back.id,
        headsign: towards(net, back.id, back.pattern.headsign),
        destStopId: last,
        destName: net.stops.has(last) ? stopName(net, last) : null,
      });
    } catch (e) {
      returnProblem = e instanceof Error ? e.message : tr('Sharing could not start.');
      update();
    }
  }

  update();
  return { el, update };
}
