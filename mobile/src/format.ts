import { headwayAt, isRouteRunning, istNow, routeEnds, type PreparedNetwork, type Route } from './core';
import type { Place } from './state/AppState';
import { count, digits, getLang, nameOf, tr } from './i18n';

export function formatDistance(m: number): string {
  if (m < 950) return tr('{m} m', { m: Math.max(10, Math.round(m / 10) * 10) });
  return tr('{km} km', { km: digits((m / 1000).toFixed(1)) });
}

/** "3 stops", in the app's language. */
export function plural(n: number, one: string, many: string): string {
  return count(n, one, many);
}

/** A stop's name in the app's language. */
export function stopName(net: PreparedNetwork | null | undefined, id: string): string {
  const s = net?.stops.get(id);
  return s ? nameOf(s) : id;
}

/** Where a direction is heading: in Bengali, its last stop's Bengali name when that is the headsign. */
export function towards(net: PreparedNetwork | null | undefined, patternId: string, headsign: string): string {
  if (getLang() !== 'bn' || !net) return headsign;
  const ids = net.patterns.get(patternId)?.pattern.stopIds ?? [];
  const last = net.stops.get(ids[ids.length - 1]);
  return last?.nameBn && last.name === headsign ? last.nameBn : headsign;
}

/** A chosen place's name in the app's language. */
export function placeName(net: PreparedNetwork | null | undefined, p: Place): string {
  if (p.kind === 'stop') {
    const s = net?.stops.get(p.stopId);
    return s ? nameOf(s) : p.name;
  }
  return tr(p.name);
}

// ---- Routes, worded as in the web app (web/src/components.ts) ----

/** What runs it: a private, government or mini bus, or the Metro, a train or a ferry. */
export function serviceKind(route: Route): string {
  const mode = route.mode ?? 'bus';
  if (mode === 'metro') return tr('Metro');
  if (mode === 'train') return tr('Train');
  if (mode === 'ferry') return tr('Ferry');
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
