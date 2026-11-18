import { translate, type Lang } from './i18n.ts';
import type { Arrival } from './live.ts';
import type { BusLeg } from './planner.ts';

// Rider-facing wording shared by the phone app and the web app, so both say the same thing, in
// English or Bengali (i18n.ts). "Live" and "Usual" must never be confused: one confident wrong
// time costs more trust than none.

/** The wait for a leg: a tracked bus when one sets it, otherwise how often these buses usually come. */
export function waitText(leg: BusLeg, stopName: (id: string) => string, lang: Lang = 'en'): string {
  const liveChoice = leg.choices.find((ch) => ch.patternId === leg.livePatternId);
  if (leg.waitIsLive && liveChoice) {
    const eta = Math.round(liveChoice.liveEtasMin?.[0] ?? leg.waitMin);
    const vars = { route: liveChoice.routeNumber, stop: stopName(leg.boardStopId), min: eta };
    return eta < 1 ? translate(lang, '{route} is reaching {stop} now', vars) : translate(lang, '{route} reaches {stop} in {min} min', vars);
  }
  // waitMin is half the time between buses, so double it back.
  const every = Math.max(1, Math.round(leg.waitMin * 2));
  return translate(lang, leg.choices.length > 1 ? 'One of these about every {min} min' : 'About every {min} min', { min: every });
}

/**
 * A tracked bus that comes later than the usual wait. Most buses are not tracked yet, so
 * another may well come first; it is worth a mention, not the headline.
 */
export function laterTrackedText(leg: BusLeg, lang: Lang = 'en'): string | null {
  if (leg.waitIsLive) return null;
  let best: { routeNumber: string; eta: number } | null = null;
  for (const ch of leg.choices) {
    const eta = ch.liveEtasMin?.[0];
    if (eta !== undefined && (!best || eta < best.eta)) best = { routeNumber: ch.routeNumber, eta };
  }
  return best ? translate(lang, 'A tracked {route} is {min} min away', { route: best.routeNumber, min: Math.max(1, Math.round(best.eta)) }) : null;
}

/**
 * What riders reported about these buses at an earlier stop, for people waiting at `arrivals`'s
 * stop (reports.ts). Said as what riders saw, never as Live.
 */
export function reportedText(leg: BusLeg, arrivals: Arrival[] | undefined, stopName: (id: string) => string, lang: Lang = 'en'): string | null {
  const ids = new Set(leg.choices.map((ch) => ch.patternId));
  const r = (arrivals ?? []).filter((a) => a.reported && ids.has(a.patternId)).sort((a, b) => a.etaMin - b.etaMin)[0];
  if (!r?.reported) return null;
  const vars = { route: r.routeNumber, stop: stopName(r.reported.stopId), ago: r.reported.agoMin, min: Math.max(1, r.etaMin) };
  return r.reported.agoMin < 1
    ? translate(lang, 'Riders saw a {route} at {stop} just now, about {min} min from here', vars)
    : translate(lang, 'Riders saw a {route} at {stop} {ago} min ago, about {min} min from here', vars);
}
