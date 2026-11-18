import type { Arrival } from './live.ts';
import type { PreparedNetwork } from './network.ts';

// "Route X just passed this stop", from people who keep location off. One report alone is not
// trusted: it counts once a rider on another phone reports the same bus at the same stop within
// a few minutes (the server also counts one that agrees with a tracked bus). Counted reports tell
// people further along the route roughly when that bus comes. They are never called "Live": the
// apps say what riders saw, and how long ago.

export type ReportConfig = {
  /** Two reports this close in time, at one stop of one route direction, are the same bus. */
  agreeWithinS: number;
  /** A sighting is used for this long, then the bus is too far along to guess. */
  keepS: number;
  /** One phone reporting the same bus at the same stop again within this is a repeat. */
  repeatAfterS: number;
  defaultSpeedKmh: number;
  dwellSecPerStop: number;
};

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  agreeWithinS: 180,
  keepS: 1800,
  repeatAfterS: 600,
  defaultSpeedKmh: 14,
  dwellSecPerStop: 25,
};

export type Sighting = { patternId: string; stopId: string; pos: number; at: number; reporters: number };

export type Report = { patternId: string; stopId: string; reporter: string; ts: number };

/**
 * Whether riders may report this bus at this stop. A bus at its last stop takes nobody further, so
 * a report there tells nobody anything. The Metro, trains and ferries run to their timetables, so
 * reports are for buses.
 */
export function reportable(net: PreparedNetwork, patternId: string, stopId: string): boolean {
  const pp = net.patterns.get(patternId);
  const pos = pp ? pp.pattern.stopIds.indexOf(stopId) : -1;
  return !!pp && pos >= 0 && pos < pp.pattern.stopIds.length - 1 && (pp.route.mode ?? 'bus') === 'bus';
}

/**
 * Reports that agree: phones of two or more people at one stop of one route direction, close in
 * time. `reports` may hold other route directions' too; only this one's are used.
 */
export function findSightings(net: PreparedNetwork, patternId: string, reports: readonly Report[], now: number, cfg: ReportConfig): Sighting[] {
  const pp = net.patterns.get(patternId);
  if (!pp) return [];
  const mine = reports.filter((r) => r.patternId === patternId && now - r.ts <= cfg.keepS * 1000).sort((a, b) => a.ts - b.ts);
  const used = new Set<Report>();
  const out: Sighting[] = [];
  for (const r of mine) {
    if (used.has(r)) continue;
    const group = mine.filter((o) => !used.has(o) && o.stopId === r.stopId && Math.abs(o.ts - r.ts) <= cfg.agreeWithinS * 1000);
    const reporters = new Set(group.map((g) => g.reporter)).size;
    if (reporters < 2) continue;
    group.forEach((g) => used.add(g));
    out.push({ patternId, stopId: r.stopId, pos: pp.pattern.stopIds.indexOf(r.stopId), at: Math.max(...group.map((g) => g.ts)), reporters });
  }
  return out;
}

/**
 * Buses riders saw at a stop before this one, with roughly when they come here: the distance at
 * the usual speed, plus time at the stops between, less the time since. Not Live: `live` is false,
 * and `reported` says where the bus was seen and how long ago.
 */
export function reportedArrivals(
  net: PreparedNetwork,
  stopId: string,
  sightingsOf: (patternId: string) => Sighting[],
  now: number,
  cfg: ReportConfig,
): Arrival[] {
  const mps = cfg.defaultSpeedKmh / 3.6;
  const out: Arrival[] = [];
  for (const visit of net.visits.get(stopId) ?? []) {
    const pp = net.patterns.get(visit.patternId);
    if (!pp || visit.pos === pp.pattern.stopIds.length - 1) continue;
    for (const s of sightingsOf(pp.id)) {
      if (s.pos >= visit.pos) continue;
      const travelS = (pp.stopAlong[visit.pos] - pp.stopAlong[s.pos]) / mps + (visit.pos - s.pos - 1) * cfg.dwellSecPerStop;
      const etaS = travelS - (now - s.at) / 1000;
      if (etaS < -60) continue; // gone by now
      out.push({
        patternId: pp.id,
        routeId: pp.route.id,
        routeNumber: pp.route.number,
        operator: pp.route.operator,
        headsign: pp.pattern.headsign,
        live: false,
        etaMin: Math.max(0, Math.round(etaS / 60)),
        confidence: 'low',
        reported: { stopId: s.stopId, agoMin: Math.round((now - s.at) / 60_000), reporters: s.reporters },
      });
    }
  }
  return out.sort((a, b) => a.etaMin - b.etaMin);
}

export function createReportBook(getNet: () => PreparedNetwork, config: Partial<ReportConfig> = {}) {
  const cfg: ReportConfig = { ...DEFAULT_REPORT_CONFIG, ...config };
  let reports: Report[] = [];

  const prune = (now: number) => {
    reports = reports.filter((r) => now - r.ts <= cfg.keepS * 1000);
  };

  /** Reports that agree: phones of two or more people at one stop of one route direction, close in time. */
  const sightings = (patternId: string, now = Date.now()): Sighting[] => findSightings(getNet(), patternId, reports, now, cfg);

  return {
    /**
     * One person's report. "repeat" when the same phone already reported this bus here lately,
     * "unknown" when the route direction does not stop there or is not a bus. `agreed` says whether it now
     * agrees with another person's report.
     */
    add(input: { patternId: string; stopId: string; reporter: string }, now = Date.now()): { agreed: boolean } | 'repeat' | 'unknown' {
      if (!reportable(getNet(), input.patternId, input.stopId)) return 'unknown';
      prune(now);
      const repeat = reports.some(
        (r) => r.reporter === input.reporter && r.patternId === input.patternId && r.stopId === input.stopId && now - r.ts < cfg.repeatAfterS * 1000,
      );
      if (repeat) return 'repeat';
      reports.push({ ...input, ts: now });
      return { agreed: sightings(input.patternId, now).some((s) => s.stopId === input.stopId && now - s.at <= cfg.agreeWithinS * 1000) };
    },

    sightings,

    /** Buses riders saw at a stop before this one, with roughly when they come here (reportedArrivals). */
    arrivals(stopId: string, now = Date.now()): Arrival[] {
      return reportedArrivals(getNet(), stopId, (id) => sightings(id, now), now, cfg);
    },

    stats: () => ({ reports: reports.length }),
  };
}

export type ReportBook = ReturnType<typeof createReportBook>;
