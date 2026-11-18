import { nearbyStops, type PreparedNetwork } from './network.ts';
import { normalizeText, phoneticKey, search } from './search.ts';
import type { Route } from './types.ts';

// Finding a bus by its route rather than by a journey: by the number painted on it ("12C/2",
// typed "12c2" or "12 c 2", or with Bengali digits), by its name, or by a place it goes to:
// "Garia" finds every route that stops there, and a landmark finds the routes stopping near it.

export type RouteHit = {
  route: Route;
  score: number;
  /** The stop it was found by, when it was found by a place it serves. */
  via?: { stopId: string; name: string; nameBn?: string };
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** A route number as typed: Bengali digits as ASCII digits, letters in lower case, the rest dropped. */
export function routeKey(s: string): string {
  return s
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A stop this close to a landmark serves it: as far as the journey planner lets people walk to a stop. */
const NEAR_LANDMARK_M = 700;

export function searchRoutes(net: PreparedNetwork, query: string, limit = 12): RouteHit[] {
  const q = query.trim();
  if (!q) return [];
  const key = routeKey(q);
  const name = normalizeText(q);
  const best = new Map<string, RouteHit>();
  const offer = (hit: RouteHit) => {
    const prev = best.get(hit.route.id);
    if (!prev || hit.score > prev.score) best.set(hit.route.id, hit);
  };

  for (const route of net.network.routes) {
    const num = routeKey(route.number);
    if (key && num === key) offer({ route, score: 1 });
    else if (key && num.startsWith(key)) offer({ route, score: 0.9 - Math.min(0.1, (num.length - key.length) / 50) });
    else if (key.length >= 2 && num.includes(key)) offer({ route, score: 0.8 });
    if (route.name && name.length >= 2 && normalizeText(route.name).includes(name)) offer({ route, score: 0.85 });
  }

  // A place the bus goes to: every route that stops there, best-matching places first.
  const serving = (stopId: string, score: number) => {
    const stop = net.stops.get(stopId);
    if (!stop) return;
    for (const v of net.visits.get(stopId) ?? []) {
      const pp = net.patterns.get(v.patternId);
      if (pp) offer({ route: pp.route, score, via: { stopId, name: stop.name, nameBn: stop.nameBn } });
    }
  };
  // Only for 3 letters or more, as spoken: a short query is a route number being typed.
  if (phoneticKey(name).replace(/ /g, '').length < 3) return sorted(best, limit);
  for (const hit of search(net.searchIndex, q, 6)) {
    if (hit.score < 0.6) continue;
    if (hit.place.kind === 'stop') serving(hit.place.id, 0.7 * hit.score);
    else for (const n of nearbyStops(net, hit.place, NEAR_LANDMARK_M)) serving(n.stop.id, 0.6 * hit.score);
  }

  return sorted(best, limit);
}

function sorted(best: Map<string, RouteHit>, limit: number): RouteHit[] {
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.route.number.localeCompare(b.route.number, undefined, { numeric: true }))
    .slice(0, limit);
}

/** The first and last stops of a route's first direction, for a one-line description. */
export function routeEnds(net: PreparedNetwork, route: Route): [string, string] | null {
  const ids = route.patterns[0]?.stopIds ?? [];
  const first = net.stops.get(ids[0]);
  const last = net.stops.get(ids[ids.length - 1]);
  return first && last ? [first.id, last.id] : null;
}
