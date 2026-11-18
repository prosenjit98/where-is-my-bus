import type { LiveEngine, OperatorType, PreparedNetwork, TransitMode, VehicleView } from '../../packages/core/src/index.ts';
import { alertsOf } from './dashboard.ts';
import type { RouteAccuracy } from './learned.ts';
import type { OwnerRegistry } from './owners.ts';
import { dayOf, type TripLog, type TripRecord } from './triplog.ts';

// The admin panel's dashboard: everything at a glance. The network, the buses on the road now,
// owners and their buses, owners' trips today by hour, what needs looking at, and how close the
// arrival times were.

type Deps = {
  net: PreparedNetwork;
  live: LiveEngine;
  owners: OwnerRegistry;
  log: TripLog;
  corrections: { counts(): Promise<{ new: number; all: number }> };
  accuracy: { report(net: PreparedNetwork, now?: number): RouteAccuracy[] };
  learnedStretchHours: number;
};

/** The hour of the day in Indian time. */
const istHour = (ts: number) => new Date(ts + 330 * 60_000).getUTCHours();

export async function adminDashboard(d: Deps, now = Date.now()) {
  const n = d.net.network;
  const modes: Record<TransitMode, number> = { bus: 0, metro: 0, train: 0, ferry: 0 };
  for (const r of n.routes) modes[r.mode ?? 'bus']++;
  const patterns = n.routes.flatMap((r) => r.patterns);
  const served = new Set(patterns.flatMap((p) => p.stopIds));
  const unused = n.stops.filter((s) => !served.has(s.id));

  // Every bus being tracked, and how many on each route.
  const vehicles: VehicleView[] = [...d.net.patterns.keys()].flatMap((id) => d.live.vehiclesOnPattern(id, now));
  const byRoute = new Map<string, { routeId: string; routeNumber: string; operator: OperatorType; buses: number; byConductors: number }>();
  for (const v of vehicles) {
    const routeId = d.net.patterns.get(v.patternId)?.route.id ?? v.patternId;
    const row = byRoute.get(routeId) ?? { routeId, routeNumber: v.routeNumber, operator: v.operator, buses: 0, byConductors: 0 };
    row.buses++;
    if (v.source === 'conductor') row.byConductors++;
    byRoute.set(routeId, row);
  }

  // Owners' buses' trips today, every owner together.
  const today = dayOf(now);
  const trips: TripRecord[] = await d.log.tripsBetween(today, today);
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const t of trips) byHour[istHour(t.departedAt)]++;
  const owners = d.owners.owners();

  const accuracy = d.accuracy
    .report(d.net, now)
    .filter((r) => r.horizons['10'].predictions > 0)
    .map((r) => ({ routeNumber: r.routeNumber, ...r.horizons['10'] }));

  return {
    at: now,
    network: {
      region: n.region,
      version: n.version,
      updatedAt: n.updatedAt,
      stops: n.stops.length,
      landmarks: n.landmarks?.length ?? 0,
      routes: n.routes.length,
      modes,
      directions: patterns.length,
      roadPaths: patterns.filter((p) => (p.shape?.length ?? 0) >= 2).length,
      unusedStops: { count: unused.length, first: unused.slice(0, 8).map((s) => ({ id: s.id, name: s.name })) },
      learnedStretchHours: d.learnedStretchHours,
    },
    live: {
      sharing: d.live.stats().sessions,
      buses: vehicles.length,
      byConductors: vehicles.filter((v) => v.source === 'conductor').length,
      routes: [...byRoute.values()].sort((a, b) => b.buses - a.buses || a.routeNumber.localeCompare(b.routeNumber, undefined, { numeric: true })),
      vehicles: vehicles.map((v) => ({
        lat: v.lat,
        lng: v.lng,
        routeNumber: v.routeNumber,
        operator: v.operator,
        headsign: v.headsign,
        source: v.source,
        lastSeenSec: v.lastSeenSec,
      })),
      possibleDiversions: d.live.possibleDiversions().length,
    },
    owners: {
      owners: owners.length,
      // Everyone who signed up on /signin and waits for the admin: owners, their staff, syndicates.
      waiting: [
        ...owners.filter((o) => o.pending).map((o) => ({ kind: 'owner' as const, id: o.id, name: o.name })),
        // Staff by their role: the admin approves managers; conductors are approved by their owner, or here.
        ...owners.flatMap((o) => o.people.filter((p) => p.pending).map((p) => ({ kind: p.role, id: p.id, name: p.name, of: o.name }))),
        ...d.owners.syndicates().filter((s) => s.pending).map((s) => ({ kind: 'syndicate' as const, id: s.id, name: s.name })),
        ...d.owners.contributors().filter((x) => x.pending).map((x) => ({ kind: 'contributor' as const, id: x.id, name: x.name })),
      ],
      people: owners.reduce((sum, o) => sum + o.people.length, 0),
      buses: d.owners.buses().length,
      syndicates: d.owners.syndicates().length,
    },
    today: {
      date: today,
      trips: trips.length,
      wholeRoute: trips.filter((t) => t.wholeRoute).length,
      km: Math.round(trips.reduce((sum, t) => sum + (t.toM - t.fromM), 0) / 100) / 10,
      busesRan: new Set(trips.map((t) => t.busId)).size,
      byHour,
      alerts: alertsOf(trips, d.net, now).slice(0, 10),
    },
    suggestions: (await d.corrections.counts()).new,
    accuracy,
  };
}

export type AdminDashboard = Awaited<ReturnType<typeof adminDashboard>>;
