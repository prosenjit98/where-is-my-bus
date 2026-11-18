import * as app from './app.ts';
import type { Place } from './app.ts';
import {
  headwayAt,
  isBusLeg,
  isRouteRunning,
  istNow,
  laterTrackedText,
  routeEnds,
  waitText,
  type Endpoint,
  type LineColor,
  type OperatorType,
  type PlanOption,
  type PreparedNetwork,
  type Route,
  type TransitMode,
} from './core.ts';
import { lastPlate } from './account.ts';
import { fill, h, type Child } from './dom.ts';
import { count, digits, lang, nameOf, tr } from './i18n.ts';
import { icon, type IconName } from './icon.ts';

// Building blocks shared by the screens, matching the phone app's components.

export type View = { el: HTMLElement; update?: () => void; destroy?: () => void };

export function formatDistance(m: number): string {
  if (m < 950) return tr('{m} m', { m: Math.max(10, Math.round(m / 10) * 10) });
  return tr('{km} km', { km: digits((m / 1000).toFixed(1)) });
}

/** "3 stops", in the app's language. */
export function plural(n: number, one: string, many: string): string {
  return count(n, one, many);
}

/** A stop's name in the app's language; other places as the rider chose them. */
export function stopName(net: PreparedNetwork, id: string): string {
  const s = net.stops.get(id);
  return s ? nameOf(s) : id;
}

/** Where a direction is heading: in Bengali, its last stop's Bengali name when that is the headsign. */
export function towards(net: PreparedNetwork, patternId: string, headsign: string): string {
  if (lang !== 'bn') return headsign;
  const ids = net.patterns.get(patternId)?.pattern.stopIds ?? [];
  const last = net.stops.get(ids[ids.length - 1]);
  return last?.nameBn && last.name === headsign ? last.nameBn : headsign;
}

/** A chosen place's name in the app's language. */
export function placeName(p: Place): string {
  if (p.kind === 'stop') {
    const s = app.state.net?.stops.get(p.stopId);
    return s ? nameOf(s) : p.name;
  }
  return tr(p.name);
}

export function toEndpoint(p: Place): Endpoint {
  const label = placeName(p);
  return p.kind === 'stop' ? { kind: 'stop', stopId: p.stopId, label } : { kind: 'point', lat: p.lat, lng: p.lng, label };
}

/** A screen: header with Back and a title, the body, and an optional footer that stays at the bottom. */
export function shell(opts: { title?: string; onBack?: () => void; body: Child; footer?: Child; flush?: boolean }): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    opts.title || opts.onBack
      ? h(
          'header',
          { class: 'header' },
          opts.onBack
            ? h('button', { class: 'back', type: 'button', onclick: opts.onBack }, icon('arrow-left', { size: 22 }), h('span', { class: 'sr-only' }, tr('Back')))
            : null,
          opts.title ? h('h1', { tabindex: '-1' }, opts.title) : null,
        )
      : null,
    h('main', { class: opts.flush ? 'screen-body flush' : 'screen-body' }, opts.body),
    opts.footer ? h('footer', { class: 'footer' }, opts.footer) : null,
  );
}

const MODE_EN: Record<TransitMode, string> = { bus: 'Route', metro: 'Metro', train: 'Train', ferry: 'Ferry' };
export const MODE_NAME: Record<TransitMode, string> = {
  bus: tr(MODE_EN.bus),
  metro: tr(MODE_EN.metro),
  train: tr(MODE_EN.train),
  ferry: tr(MODE_EN.ferry),
};

/**
 * The route number as a painted board; the left stripe tells private, government and mini buses
 * apart. The Metro, trains and ferries have their line's own colour and an icon instead.
 */
export function routeBoard(number: string, operator: OperatorType, size: 'sm' | 'md' | 'lg' = 'md', mode: TransitMode = 'bus', color?: LineColor): HTMLElement {
  if (mode !== 'bus') {
    return h(
      'span',
      { class: `board board-${size} mode-line line-${color ?? 'blue'}`, role: 'img', 'aria-label': `${MODE_NAME[mode]} ${number}` },
      icon(mode === 'ferry' ? 'ship' : 'train-front', { size: size === 'lg' ? 24 : 15 }),
      number,
    );
  }
  return h('span', { class: `board board-${size} op-${operator}`, role: 'img', 'aria-label': tr('Route {route}', { route: number }) }, number);
}

/** What runs the route: a private, government or mini bus, or the Metro, a train or a ferry. */
export function serviceKind(route: Route): string {
  const mode = route.mode ?? 'bus';
  if (mode !== 'bus') return MODE_NAME[mode];
  if (route.operator === 'private') return tr('Private bus');
  if (route.operator === 'govt') return tr('Government bus');
  if (route.operator === 'mini') return tr('Minibus');
  return tr('Bus');
}

/** Where a route runs, from the first stop of its first direction to the last. */
export function routeTitle(net: PreparedNetwork, route: Route): string {
  const ends = routeEnds(net, route);
  return ends ? tr('{from} to {to}', { from: stopName(net, ends[0]), to: stopName(net, ends[1]) }) : (route.name ?? route.number);
}

/** About how often it runs now, or that it is not running. */
export function runningText(route: Route, minute = istNow().minute): string {
  return isRouteRunning(route, minute) ? tr('About every {min} min', { min: headwayAt(route, minute) }) : tr('Not running now');
}

/** A route in a list: its board, where it runs, what runs it and how often, now. `via`: the stop it was found by. */
export function routeRow(net: PreparedNetwork, route: Route, onOpen: () => void, via?: { name: string; nameBn?: string }): HTMLElement {
  const sub = [via ? tr('Stops at {stop}', { stop: nameOf(via) }) : null, serviceKind(route), route.name, runningText(route)].filter(Boolean).join(' · ');
  return h(
    'li',
    {},
    h(
      'button',
      { class: 'row route-row', type: 'button', onclick: onOpen },
      routeBoard(route.number, route.operator, 'md', route.mode, route.color),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, routeTitle(net, route)), h('span', { class: 'row-sub' }, sub)),
      icon('chevron-right', { class: 'chev' }),
    ),
  );
}

/** Live = a tracked bus. Usual = how often the route usually runs. */
export function liveTag(live: boolean): HTMLElement {
  return h('span', { class: live ? 'tag tag-live' : 'tag' }, h('span', { class: 'tag-dot', 'aria-hidden': 'true' }), live ? tr('Live') : tr('Usual'));
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'secondary' | 'danger' = 'primary', iconName?: IconName): HTMLButtonElement {
  return h('button', { class: kind === 'secondary' ? 'btn' : `btn ${kind}`, type: 'button', onclick: onClick }, iconName ? icon(iconName) : null, label);
}

export function note(text: Child, tone: 'soft' | 'danger' = 'soft'): HTMLElement {
  return h('p', { class: tone === 'danger' ? 'note danger' : 'note', role: tone === 'danger' ? 'alert' : null }, text);
}

/** A note that stands out: offline, a problem, something to do. Its icon is decoration; the text says it all. */
export function notice(text: Child, iconName: IconName = 'info', tone: 'info' | 'warn' | 'danger' = 'info'): HTMLElement {
  return h('div', { class: tone === 'info' ? 'notice' : `notice ${tone}`, role: tone === 'danger' ? 'alert' : null }, icon(iconName), h('span', {}, text));
}

/** One line of a status list, as on the trip screen. */
export function statusItem(text: Child, iconName: IconName, danger = false): HTMLElement {
  return h('p', { class: danger ? 'status-item danger' : 'status-item', role: danger ? 'alert' : null }, icon(iconName, { size: 18 }), h('span', {}, text));
}

export function switchRow(label: string, hint: string | null, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return h(
    'label',
    { class: 'switch-row' },
    h('span', { class: 'switch-text' }, h('span', { class: 'switch-label' }, label), hint ? h('span', { class: 'small' }, hint) : null),
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
  );
}

/** A conductor's box for the bus's whole number plate, filled in with the plate they typed last. */
export function plateField(): HTMLInputElement {
  return h('input', {
    class: 'input small-input',
    value: lastPlate(),
    placeholder: 'WB 19 A 1234',
    'aria-label': tr('The bus’s number plate'),
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    maxlength: '20',
  });
}

export function optionRow(option: PlanOption, net: PreparedNetwork, onOpen: () => void): HTMLElement {
  const name = (id: string) => stopName(net, id);
  const legs = option.legs.filter(isBusLeg);
  const kind = option.id === 'walk' ? tr('Walk') : option.transfers === 0 ? tr('Direct') : plural(option.transfers, 'change', 'changes');
  const first = legs[0];
  const tracked = first ? laterTrackedText(first, lang) : null;
  return h(
    'li',
    {},
    h(
      'button',
      { class: 'option', type: 'button', onclick: onOpen, 'aria-description': tr('Shows the journey on the map') },
      h(
        'span',
        { class: 'option-top' },
        h('span', { class: 'option-total' }, tr('{min} min', { min: option.totalMin })),
        h('span', { class: 'option-kind' }, icon(option.id === 'walk' ? 'footprints' : option.transfers === 0 ? 'route' : 'repeat', { size: 16 }), kind, icon('chevron-right', { size: 18 })),
      ),
      legs.map((leg) =>
        h(
          'span',
          { class: 'leg-row' },
          h(
            'span',
            { class: 'boards' },
            leg.choices.slice(0, 4).map((ch) => routeBoard(ch.routeNumber, ch.operator, 'sm', ch.mode, ch.color)),
            leg.choices.length > 4 ? h('span', { class: 'small' }, `+${leg.choices.length - 4}`) : null,
          ),
          h('span', { class: 'grow' }, tr('{from} to {to}', { from: name(leg.boardStopId), to: name(leg.alightStopId) })),
        ),
      ),
      option.id === 'walk' ? h('span', { class: 'leg-row' }, tr('Walk {distance}', { distance: formatDistance(option.legs[0].kind === 'walk' ? option.legs[0].meters : 0) })) : null,
      option.walkMin > 0 && option.id !== 'walk' ? h('span', { class: 'walk-row' }, icon('footprints', { size: 16 }), tr('{min} min walking in total', { min: option.walkMin })) : null,
      first ? h('span', { class: 'wait-row' }, liveTag(first.waitIsLive), h('span', { class: 'grow' }, waitText(first, name, lang))) : null,
      tracked ? h('span', { class: 'tracked' }, tracked) : null,
    ),
  );
}
