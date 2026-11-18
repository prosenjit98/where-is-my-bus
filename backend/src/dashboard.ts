import { formatClock, istNow, type LiveEngine, type OperatorType, type PreparedNetwork } from '../../packages/core/src/index.ts';
import type { Bus, Owner, OwnerRegistry, Person, Syndicate } from './owners.ts';
import { dayOf, type TripLog, type TripRecord } from './triplog.ts';

// What the owner dashboard shows: where each bus is now, the trips it ran, and alerts about trips
// that stopped short of the end of the route. A route syndicate sees the same, read-only and
// for its members' buses on its routes.

export type TripView = {
  id: string;
  busId: string;
  plate: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  departedAt: number;
  /** When the bus last moved on: the end of the trip, or of the trip so far. */
  movedAt: number;
  running: boolean;
  ended?: TripRecord['ended'];
  fromStop: string;
  toStop: string;
  stops: number;
  stopCount: number;
  km: number;
  wholeRoute: boolean;
};

export type BusNow =
  | {
      state: 'on_route';
      routeNumber: string;
      operator: OperatorType;
      headsign: string;
      lat: number;
      lng: number;
      lastSeenSec: number;
      /** Null at the end of the route. */
      nextStop: string | null;
      since: number;
    }
  | {
      /** Sharing, but the bus is not on the route: not there yet, or not heard from for a while. */
      state: 'waiting';
      routeNumber: string;
      operator: OperatorType;
      headsign: string;
      since: number;
      lastSeenAt?: number;
    };

export type DaySummary = { trips: number; wholeRoute: number; km: number; firstAt?: number; lastAt?: number };

/**
 * Something for the owner to look into today: a trip still running with no position for a while
 * ("quiet"), or one that ended before the end of the route ("stopped"): sharing was stopped, or the
 * signal was lost for good.
 */
export type Alert = {
  id: string;
  kind: 'quiet' | 'stopped';
  busId: string;
  plate: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  /** When the bus was last heard from. */
  at: number;
  /** The furthest stop it reached, and how many of the route's stops that was. */
  afterStop: string;
  stops: number;
  stopCount: number;
  ended?: TripRecord['ended'];
};

/** A running trip with no position for this long is an alert. */
export const QUIET_ALERT_MS = 5 * 60_000;
/** Within this of the last stop, the trip reached the end (as a stop counts as reached in triplog.ts). */
const AT_END_M = 100;

type Deps = { owners: OwnerRegistry; log: TripLog; live: LiveEngine; net: PreparedNetwork };

/** Whose buses and trips a view shows: owners', on all routes or only some (a syndicate's). */
type Scope = { ownerIds: string[]; routeIds?: Set<string> };

const kmOf = (t: TripRecord) => Math.round((t.toM - t.fromM) / 100) / 10;

const tripView = (t: TripRecord): TripView => ({
  id: t.id,
  busId: t.busId,
  plate: t.plate,
  routeNumber: t.routeNumber,
  operator: t.operator,
  headsign: t.headsign,
  departedAt: t.departedAt,
  movedAt: t.movedAt,
  running: t.ended === undefined,
  ended: t.ended,
  fromStop: t.fromStop,
  toStop: t.toStop,
  stops: t.stops,
  stopCount: t.stopCount,
  km: kmOf(t),
  wholeRoute: t.wholeRoute,
});

function summarize(trips: TripRecord[]): DaySummary {
  const out: DaySummary = { trips: trips.length, wholeRoute: 0, km: 0 };
  let metres = 0;
  for (const t of trips) {
    if (t.wholeRoute) out.wholeRoute++;
    metres += t.toM - t.fromM;
    out.firstAt = Math.min(out.firstAt ?? t.departedAt, t.departedAt);
    out.lastAt = Math.max(out.lastAt ?? t.movedAt, t.movedAt);
  }
  out.km = Math.round(metres / 100) / 10;
  return out;
}

export function alertsOf(trips: TripRecord[], net: PreparedNetwork, now: number): Alert[] {
  const out: Alert[] = [];
  for (const t of trips) {
    const pp = net.patterns.get(t.patternId);
    const reachedEnd = pp ? t.toM >= pp.stopAlong[pp.stopAlong.length - 1] - AT_END_M : t.stops >= t.stopCount;
    if (reachedEnd) continue;
    let kind: Alert['kind'];
    if (t.ended === undefined && now - t.lastSeenAt > QUIET_ALERT_MS) kind = 'quiet';
    else if (t.ended === 'phone' || t.ended === 'no_signal') kind = 'stopped';
    else continue;
    out.push({
      id: `${t.id}:${kind}`,
      kind,
      busId: t.busId,
      plate: t.plate,
      routeNumber: t.routeNumber,
      operator: t.operator,
      headsign: t.headsign,
      at: t.lastSeenAt,
      afterStop: t.toStop,
      stops: t.stops,
      stopCount: t.stopCount,
      ended: t.ended,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

function busNow(bus: Bus, d: Deps, now: number, routeIds?: Set<string>): BusNow | null {
  const phones = d.log.phonesOn(bus.id).filter((p) => !routeIds || routeIds.has(d.net.patterns.get(p.patternId)?.route.id ?? ''));
  if (!phones.length) return null;
  for (const p of phones) {
    const v = d.live.vehicleOfSession(p.sessionId, now);
    const pp = d.net.patterns.get(p.patternId);
    if (!v || !pp) continue;
    const next = pp.stopAlong.findIndex((m) => m > v.alongM + 15);
    return {
      state: 'on_route',
      routeNumber: v.routeNumber,
      operator: v.operator,
      headsign: v.headsign,
      lat: v.lat,
      lng: v.lng,
      lastSeenSec: v.lastSeenSec,
      nextStop: next < 0 ? null : (d.net.stops.get(pp.pattern.stopIds[next])?.name ?? null),
      since: p.trip?.departedAt ?? p.startedAt,
    };
  }
  const p = phones.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  const pp = d.net.patterns.get(p.patternId);
  return {
    state: 'waiting',
    routeNumber: pp?.route.number ?? '?',
    operator: pp?.route.operator ?? 'other',
    headsign: pp?.pattern.headsign ?? '',
    since: p.startedAt,
    lastSeenAt: p.trip?.lastSeenAt,
  };
}

/** The scope's trips on these days (both counted), by day: one read, whatever the number of owners and days. */
async function tripsByDay(d: Pick<Deps, 'log'>, scope: Scope, fromISO: string, toISO: string): Promise<Map<string, TripRecord[]>> {
  const byDay = new Map<string, TripRecord[]>();
  for (const t of await d.log.tripsBetween(fromISO, toISO, scope.ownerIds)) {
    if (scope.routeIds && !scope.routeIds.has(t.routeId)) continue;
    const day = dayOf(t.startedAt);
    const list = byDay.get(day);
    if (list) list.push(t);
    else byDay.set(day, [t]);
  }
  return byDay; // each day's trips stay in order of departure, as the log gives them
}

/** Each bus now, its trips on one day and the last 7 days, all the trips that day, and today's alerts. */
async function overviewOf(d: Deps, scope: Scope, dateISO: string, now: number) {
  const today = dayOf(now);
  const week = Array.from({ length: 7 }, (_, i) => dayOf(now - (6 - i) * 86_400_000));
  // The week and the chosen day, in one read when the day is in the week, two when not.
  const byDay = await tripsByDay(d, scope, week[0], week[6]);
  if (dateISO < week[0] || dateISO > week[6]) byDay.set(dateISO, (await tripsByDay(d, scope, dateISO, dateISO)).get(dateISO) ?? []);
  const onDate = byDay.get(dateISO) ?? [];
  const buses = scope.ownerIds.flatMap((id) => d.owners.buses(id)).map((bus) => {
    const mine = (day: string) => (byDay.get(day) ?? []).filter((t) => t.busId === bus.id);
    const last = week
      .flatMap(mine)
      .filter((t) => t.ended !== undefined)
      .reduce<TripRecord | undefined>((a, t) => (!a || t.movedAt > a.movedAt ? t : a), undefined);
    return {
      id: bus.id,
      plate: bus.plate,
      label: bus.label ?? null,
      owner: d.owners.owner(bus.ownerId)?.name ?? '',
      now: busNow(bus, d, now, scope.routeIds),
      lastTrip: last ? tripView(last) : null,
      day: summarize(mine(dateISO)),
      week: week.map((day) => {
        const s = summarize(mine(day));
        return { date: day, trips: s.trips, wholeRoute: s.wholeRoute, km: s.km };
      }),
    };
  });
  return { date: dateISO, today, buses, trips: onDate.map(tripView), alerts: alertsOf(byDay.get(today) ?? [], d.net, now) };
}

/** Where each bus is now: the live updates pushed to an open dashboard between full ones (push.ts). */
export function busesNow(d: Deps, scope: { ownerIds: string[]; routeIds?: Set<string> }, now = Date.now()) {
  return scope.ownerIds.flatMap((id) => d.owners.buses(id)).map((bus) => ({ id: bus.id, now: busNow(bus, d, now, scope.routeIds) }));
}

/** What an owner, or one of their staff, sees. Only the owner sees who else signs in for them, and who waits for approval. */
export async function ownerOverview(d: Deps, owner: Owner, person: Person, dateISO: string, now = Date.now()) {
  const view = await overviewOf(d, { ownerIds: [owner.id] }, dateISO, now);
  return {
    kind: 'owner' as const,
    owner: { id: owner.id, name: owner.name, pending: owner.pending === true },
    me: { id: person.id, name: person.name, role: person.role, phoneEnd: person.phoneEnd ?? null },
    people:
      person.role === 'owner'
        ? owner.people.map((p) => ({ id: p.id, name: p.name, role: p.role, phoneEnd: p.phoneEnd ?? null, pending: p.pending === true, devices: p.keyHashes.length }))
        : [],
    ...view,
  };
}

/** What a route syndicate sees: its members' buses on its routes. */
export async function syndicateOverview(d: Deps, s: Syndicate, dateISO: string, now = Date.now()) {
  const ownerIds = s.ownerIds.filter((id) => d.owners.owner(id));
  const view = await overviewOf(d, { ownerIds, routeIds: new Set(s.routeIds) }, dateISO, now);
  const routes = s.routeIds.flatMap((id) => {
    const r = d.net.routes.get(id);
    return r ? [{ id: r.id, number: r.number, operator: r.operator }] : [];
  });
  return {
    kind: 'syndicate' as const,
    syndicate: { id: s.id, name: s.name, routes, members: ownerIds.map((id) => ({ id, name: d.owners.owner(id)?.name ?? '' })) },
    /** The person who signs in for the syndicate. */
    me: { name: s.contactName ?? s.name, phoneEnd: s.phoneEnd ?? null },
    ...view,
  };
}

const ENDED: Record<NonNullable<TripRecord['ended']> | 'running', string> = {
  phone: 'sharing stopped',
  no_signal: 'no signal',
  bus_removed: 'bus removed',
  running: 'still running',
};

const clockOf = (ts: number) => formatClock(istNow(new Date(ts)).minute);
const nextDay = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);

/** Spreadsheets run cells starting with = + - or @ as formulas, so those are kept as text. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One row per trip from one day to another, both included, for a spreadsheet: an owner's trips,
 * or a syndicate's members' trips on its routes (with an Owner column).
 */
export async function tripsCsv(
  d: Pick<Deps, 'owners' | 'log'>,
  scope: { ownerIds: string[]; routeIds?: Set<string> },
  fromISO: string,
  toISO: string,
): Promise<string> {
  const withOwner = scope.routeIds !== undefined;
  const buses = new Map(scope.ownerIds.flatMap((id) => d.owners.buses(id)).map((b) => [b.id, b]));
  const ownerName = (id: string) => d.owners.owner(id)?.name ?? '';
  const header = ['Date', 'Bus', 'Bus name', 'Route', 'Towards', 'Left', 'Last moved', 'Minutes', 'From', 'To', 'Stops', 'Km', 'End to end', 'Ended'];
  const rows = [withOwner ? ['Date', 'Bus', 'Owner', ...header.slice(2)] : header];
  const byDay = await tripsByDay(d, scope, fromISO, toISO);
  for (let day = fromISO; day <= toISO; day = nextDay(day)) {
    for (const t of byDay.get(day) ?? []) {
      const row = [
        day,
        t.plate,
        buses.get(t.busId)?.label ?? '',
        t.routeNumber,
        t.headsign,
        clockOf(t.departedAt),
        clockOf(t.movedAt),
        String(Math.round((t.movedAt - t.departedAt) / 60_000)),
        t.fromStop,
        t.toStop,
        `${t.stops} of ${t.stopCount}`,
        String(kmOf(t)),
        t.wholeRoute ? 'yes' : 'no',
        ENDED[t.ended ?? 'running'],
      ];
      rows.push(withOwner ? [row[0], row[1], ownerName(t.ownerId), ...row.slice(2)] : row);
    }
  }
  // The byte-order mark makes Excel read Bengali names correctly.
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
