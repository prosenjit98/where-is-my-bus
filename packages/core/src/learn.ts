import type { PreparedNetwork, PreparedPattern } from './network.ts';

// Learned travel times: how long each stretch between two stops of a route direction takes, by
// hour and by kind of day (weekday, Saturday, Sunday) in Indian time, from the buses phones
// tracked. Where enough trips have been seen they replace the flat 14 km/h estimate, the biggest
// single gain in accuracy available; elsewhere the estimate stays. Only these averages are kept,
// never positions. A stretch's time runs from passing one stop to passing the next, so it already
// includes the time standing at the stop.

export type DayKind = 'wd' | 'sat' | 'sun';

/** Trips a stretch needs in an hour before its learned time is used. */
export const MIN_TRIPS = 3;

/** Weekday, Saturday or Sunday, and the hour, in Indian time: "wd8", "sun19". */
export function timeBucket(ts: number): string {
  const ist = new Date(ts + 330 * 60_000);
  const day = ist.getUTCDay();
  return `${day === 0 ? 'sun' : day === 6 ? 'sat' : 'wd'}${ist.getUTCHours()}`;
}

const hourOf = (bucket: string) => bucket.replace(/^[a-z]+/, '');

type Stat = { n: number; mean: number; m2: number };

export type TravelTimesSnapshot = { version: 1; stats: [string, number, number, number][] };

/** A stretch's learned seconds per route direction, for one hour: what the apps plan with. */
export type TravelTable = { bucket: string; patterns: Record<string, (number | null)[]> };

export function createTravelTimes(saved?: TravelTimesSnapshot | null) {
  const stats = new Map<string, Stat>((saved?.stats ?? []).map(([k, n, mean, m2]) => [k, { n, mean, m2 }]));
  let changed = false;

  function add(key: string, seconds: number) {
    const s = stats.get(key) ?? { n: 0, mean: 0, m2: 0 };
    s.n += 1;
    // Recent trips count more (at least a tenth each), so the times follow changes on the road.
    const a = Math.max(1 / s.n, 0.1);
    const d = seconds - s.mean;
    s.mean += a * d;
    s.m2 = (1 - a) * (s.m2 + a * d * d);
    stats.set(key, s);
  }

  /** Learned seconds for a stretch at that time: its hour on that kind of day, else that hour on any day. */
  function segmentSec(patternId: string, seg: number, ts: number): number | undefined {
    const bucket = timeBucket(ts);
    for (const key of [`${patternId}|${seg}|${bucket}`, `${patternId}|${seg}|h${hourOf(bucket)}`]) {
      const s = stats.get(key);
      if (s && s.n >= MIN_TRIPS) return s.mean;
    }
    return undefined;
  }

  return {
    /**
     * One bus's time over one stretch. A time far from what is usual there (a breakdown, a phone
     * left at the depot) is refused once the stretch is known.
     */
    record(patternId: string, seg: number, startTs: number, seconds: number): boolean {
      if (!(seconds > 0) || seconds > 3600) return false;
      const bucket = timeBucket(startTs);
      const key = `${patternId}|${seg}|${bucket}`;
      const known = stats.get(key);
      if (known && known.n >= 5 && (seconds > known.mean * 4 || seconds < known.mean / 4)) return false;
      add(key, seconds);
      add(`${patternId}|${seg}|h${hourOf(bucket)}`, seconds);
      changed = true;
      return true;
    },

    segmentSec,

    /**
     * Minutes from one stop to another of a direction, using learned stretches where known and
     * `fallbackSec` for the others; undefined while fewer than half the stretches are learned.
     */
    rideMin(pp: PreparedPattern, fromPos: number, toPos: number, ts: number, fallbackSec: (seg: number) => number): number | undefined {
      let sec = 0;
      let learned = 0;
      for (let seg = fromPos; seg < toPos; seg++) {
        const s = segmentSec(pp.id, seg, ts);
        if (s !== undefined) learned++;
        sec += s ?? fallbackSec(seg);
      }
      const total = toPos - fromPos;
      return total > 0 && learned * 2 >= total ? sec / 60 : undefined;
    },

    /** Every direction's learned stretches for the hour of `ts`, for the apps (null: not learned). */
    table(net: PreparedNetwork, ts: number): TravelTable {
      const patterns: Record<string, (number | null)[]> = {};
      for (const pp of net.patterns.values()) {
        const segs = pp.stopAlong.slice(1).map((_, seg) => {
          const s = segmentSec(pp.id, seg, ts);
          return s === undefined ? null : Math.round(s);
        });
        if (segs.some((s) => s !== null)) patterns[pp.id] = segs;
      }
      return { bucket: timeBucket(ts), patterns };
    },

    /** How many stretch-hours have enough trips. */
    learnedCount: () => [...stats.entries()].filter(([k, s]) => !k.includes('|h') && s.n >= MIN_TRIPS).length,

    snapshot(): TravelTimesSnapshot {
      changed = false;
      return { version: 1, stats: [...stats].map(([k, s]) => [k, s.n, Math.round(s.mean * 10) / 10, Math.round(s.m2)]) };
    },

    hasChanges: () => changed,
  };
}

export type TravelTimes = ReturnType<typeof createTravelTimes>;

/** The planner's rideTimeMin hook from a table of learned stretches, as the apps get it from the server. */
export function rideTimeFromTable(table: TravelTable | null, busKmh = 14, dwellMin = 0.4) {
  const mps = (busKmh * 1000) / 3600;
  return (pp: PreparedPattern, fromPos: number, toPos: number): number | undefined => {
    const segs = table?.patterns[pp.id];
    if (!segs) return undefined;
    let sec = 0;
    let learned = 0;
    for (let seg = fromPos; seg < toPos; seg++) {
      const s = segs[seg];
      if (s !== null && s !== undefined) learned++;
      sec += s ?? (pp.stopAlong[seg + 1] - pp.stopAlong[seg]) / mps + (seg > fromPos ? dwellMin * 60 : 0);
    }
    const total = toPos - fromPos;
    return total > 0 && learned * 2 >= total ? sec / 60 : undefined;
  };
}
