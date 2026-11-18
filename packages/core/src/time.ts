import type { ClockTime, Pattern, Route } from './types.ts';

const parsed = new Map<string, number>();

/** "HH:MM" to minutes after midnight. Throws on bad input. */
export function parseClock(t: ClockTime): number {
  const cached = parsed.get(t);
  if (cached !== undefined) return cached;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) throw new Error(`Invalid time "${t}". Use HH:MM, for example 05:45.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${t}".`);
  const value = h * 60 + min;
  parsed.set(t, value);
  return value;
}

export function isValidClock(t: unknown): boolean {
  if (typeof t !== 'string') return false;
  try {
    parseClock(t);
    return true;
  } catch {
    return false;
  }
}

export function isISODate(d: unknown): boolean {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
}

/** India is UTC+5:30 all year (no daylight saving), so no time-zone library is needed. */
export function istNow(d: Date = new Date()): { minute: number; dateISO: string } {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return {
    minute: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    dateISO: ist.toISOString().slice(0, 10),
  };
}

export function formatClock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** True if `minute` is in [from, to). Windows may wrap past midnight, e.g. 22:00 to 02:00. */
export function inWindow(minute: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Between the first and last bus (the last bus time itself counts as running). */
export function isRouteRunning(route: Route, minute: number): boolean {
  const first = parseClock(route.firstBus);
  const lastExclusive = (parseClock(route.lastBus) + 1) % 1440;
  return inWindow(minute, first, lastExclusive);
}

export function headwayAt(route: Route, minute: number): number {
  for (const band of route.headways ?? []) {
    if (inWindow(minute, parseClock(band.from), parseClock(band.to))) return band.minutes;
  }
  return route.defaultHeadwayMin;
}

function isDateValid(p: Pattern, dateISO: string): boolean {
  if (p.validFrom && dateISO < p.validFrom) return false;
  if (p.validTo && dateISO > p.validTo) return false;
  return true;
}

/**
 * Whether this pattern is the one buses use at this moment:
 * temporary patterns only run between their dates, a pattern is off while a
 * diversion replaces it, and time-window variants only run in their windows.
 */
export function isPatternActive(route: Route, pattern: Pattern, minute: number, dateISO: string): boolean {
  if (!isDateValid(pattern, dateISO)) return false;
  const replaced = route.patterns.some(
    (p) => p.id !== pattern.id && p.replaces === pattern.id && isDateValid(p, dateISO),
  );
  if (replaced) return false;
  if (pattern.activeWindows?.length) {
    return pattern.activeWindows.some((w) => inWindow(minute, parseClock(w.from), parseClock(w.to)));
  }
  return true;
}
