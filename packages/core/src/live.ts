import { haversine, locateOnLine, pointAlong } from './geo.ts';
import type { PreparedNetwork, PreparedPattern } from './network.ts';
import { headwayAt, isPatternActive, isRouteRunning, istNow } from './time.ts';
import type { OperatorType } from './types.ts';

// Buses have no GPS feed we can use, so phones on board stand in for one.
// A "session" is one phone on one bus trip. Sessions moving together on the same
// route are merged into one "vehicle". Vehicles give arrival times at stops.

export type Ping = {
  lat: number;
  lng: number;
  /** Reported GPS accuracy radius in metres. */
  accuracy?: number;
  /** Metres per second, as reported by the phone. */
  speed?: number;
  heading?: number;
  /** Milliseconds since epoch when the fix was taken. */
  ts: number;
  /** Android reports locations from fake-GPS apps. */
  mock?: boolean;
};

export type SessionRole = 'rider' | 'conductor';
export type VehicleSource = 'conductor' | 'riders';

export type PingOutcome =
  | 'accepted'
  | 'off_route'
  | 'low_accuracy'
  | 'mock'
  | 'jump'
  | 'stale'
  | 'duplicate'
  | 'invalid';

export type IngestResult = {
  accepted: number;
  rejected: number;
  lastOutcome: PingOutcome;
  /** The phone has been off the route long enough that the rider has probably got off. */
  suggestEnd: boolean;
  vehicleId?: string;
  alongM?: number;
  /** When the latest accepted position was taken. */
  seenAt?: number;
  /** The first position accepted from this batch, in metres along the route, and when it was taken. */
  firstAlongM?: number;
  firstSeenAt?: number;
};

export type Confidence = 'high' | 'medium' | 'low';

export type Arrival = {
  patternId: string;
  routeId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  /** True when based on a tracked bus; false when estimated from frequency. */
  live: boolean;
  /** Live: minutes until the bus reaches the stop. Estimated: average wait. */
  etaMin: number;
  headwayMin?: number;
  vehicleId?: string;
  lastSeenSec?: number;
  riders?: number;
  source?: VehicleSource;
  plate?: string;
  confidence?: Confidence;
  /** Not tracked: riders reported this bus passing an earlier stop (reports.ts). Never Live. */
  reported?: { stopId: string; agoMin: number; reporters: number };
  /** The share of this route direction's buses running now that are tracked (0 to 1). */
  coverage?: number;
};

/** With this share of a direction's buses tracked, a late tracked bus does mean a gap. */
export const HIGH_COVERAGE = 0.8;

export type VehicleView = {
  id: string;
  patternId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  lat: number;
  lng: number;
  alongM: number;
  lastSeenSec: number;
  riders: number;
  source: VehicleSource;
  plate?: string;
  confidence: Confidence;
};

export type DiversionAlert = {
  patternId: string;
  routeNumber: string;
  headsign: string;
  lat: number;
  lng: number;
  sessions: number;
  lastSeen: number;
};

export type LiveConfig = {
  /** Distance from the route path beyond which a ping counts as off the route. */
  offRouteM: number;
  /** Extra tolerance when a route only has straight lines between stops. */
  approxShapeExtraM: number;
  offRouteEndAfterS: number;
  /** Before a phone's first position on the route, how long it may be off the route (walking to the stop) before the trip ends. */
  boardingGraceS: number;
  maxAccuracyM: number;
  maxSpeedMps: number;
  joinDistanceM: number;
  splitDistanceM: number;
  /** Two vehicles of the same route direction this close for mergeAfterS are one bus. */
  mergeDistanceM: number;
  mergeAfterS: number;
  staleAfterS: number;
  dropAfterS: number;
  sessionIdleS: number;
  defaultSpeedKmh: number;
  dwellSecPerStop: number;
  maxPingAgeS: number;
  maxArrivalsPerPattern: number;
  maxSessions: number;
  /**
   * Take positions the phone marks as simulated. Never in real use: a mock location app could put
   * a bus anywhere. Only for testing the app on a real phone, whose GPS a test moves that way.
   */
  acceptMockLocations?: boolean;
};

/** Optional links to learned travel times (learn.ts) and to measuring arrival-time error. */
export type LiveHooks = {
  /** Learned seconds for a stretch between two stops; without it, the usual speed and time at stops. */
  segmentSec?: (patternId: string, seg: number, ts: number) => number | undefined;
  /** A phone's bus went from one stop to the next, in `seconds`: for learning travel times. */
  onSegment?: (patternId: string, seg: number, startTs: number, seconds: number) => void;
  /** A conductor's bus reached a stop whose arrival was predicted 10 or 5 minutes before. */
  onPrediction?: (r: { routeId: string; patternId: string; horizonMin: 5 | 10; errorSec: number; ts: number }) => void;
  /**
   * New ids for trips and buses; random when missing. Servers that each keep a copy of the live
   * buses, fed the same events in the same order, give ids made from the event, so the copies match.
   */
  newId?: () => string;
};

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
  offRouteM: 60,
  approxShapeExtraM: 150,
  offRouteEndAfterS: 90,
  boardingGraceS: 600,
  maxAccuracyM: 100,
  maxSpeedMps: 25,
  joinDistanceM: 150,
  splitDistanceM: 350,
  mergeDistanceM: 60,
  mergeAfterS: 45,
  staleAfterS: 120,
  dropAfterS: 600,
  sessionIdleS: 900,
  defaultSpeedKmh: 14,
  dwellSecPerStop: 25,
  maxPingAgeS: 180,
  maxArrivalsPerPattern: 3,
  maxSessions: 100_000,
};

export class LiveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Session = {
  id: string;
  patternId: string;
  role: SessionRole;
  plate?: string;
  /** A bus its owner registered, known from the plate its signed-in conductor shared it by. */
  busId?: string;
  startedAt: number;
  lastSeen: number;
  along?: number;
  alongTs?: number;
  speed?: number;
  offRouteSince?: number;
  vehicleId?: string;
  /** The last stop the bus passed, and when. */
  lastStop?: { pos: number; ts: number };
};

type Vehicle = {
  id: string;
  patternId: string;
  plate?: string;
  busId?: string;
  along: number;
  alongTs: number;
  speed?: number;
  members: Set<string>;
  source: VehicleSource;
  /** Conductors' buses: arrival times predicted at each stop on the way, as [when predicted, predicted arrival]. */
  predictions?: Map<number, [number, number][]>;
};

type OffRouteEvent = { patternId: string; sessionId: string; lat: number; lng: number; ts: number };

type BusMarks = { busId?: string; plate?: string; conductor: boolean };

/**
 * Whether reports could come from one bus. A bus its owner registered is known by its id.
 * Otherwise plate digits that differ (two buses of a route racing side by side) or two
 * conductors (each bus has one) mean two buses.
 */
function couldBeOneBus(a: BusMarks, b: BusMarks): boolean {
  if (a.busId && b.busId) return a.busId === b.busId;
  if (a.plate && b.plate && a.plate !== b.plate) return false;
  return !(a.conductor && b.conductor);
}

const marksOf = (v: Vehicle): BusMarks => ({ busId: v.busId, plate: v.plate, conductor: v.source === 'conductor' });

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Keeps the last four digits of a number plate, which is all riders are asked for. */
export function normalizePlate(plate: unknown): string | undefined {
  if (typeof plate !== 'string') return undefined;
  const digits = plate.replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(-4) : undefined;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isPing(p: unknown): p is Ping {
  const q = p as Ping;
  return (
    !!q &&
    typeof q.lat === 'number' &&
    typeof q.lng === 'number' &&
    typeof q.ts === 'number' &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lng) &&
    Number.isFinite(q.ts) &&
    Math.abs(q.lat) <= 90 &&
    Math.abs(q.lng) <= 180
  );
}

export function createLiveEngine(getNet: () => PreparedNetwork, config: Partial<LiveConfig> = {}, hooks: LiveHooks = {}) {
  const cfg: LiveConfig = { ...DEFAULT_LIVE_CONFIG, ...config };
  const sessions = new Map<string, Session>();
  const vehicles = new Map<string, Vehicle>();
  /** The same vehicles by route direction: arrivals and merging look only at one direction's buses. */
  const onPattern = new Map<string, Set<Vehicle>>();
  const addVehicle = (v: Vehicle) => {
    vehicles.set(v.id, v);
    const set = onPattern.get(v.patternId);
    if (set) set.add(v);
    else onPattern.set(v.patternId, new Set([v]));
  };
  const removeVehicle = (v: Vehicle) => {
    vehicles.delete(v.id);
    const set = onPattern.get(v.patternId);
    set?.delete(v);
    if (set && !set.size) onPattern.delete(v.patternId);
  };
  const vehiclesOn = (patternId: string): Iterable<Vehicle> => onPattern.get(patternId) ?? [];
  /** Pairs of vehicles moving together ("idA|idB"), and since when. */
  const together = new Map<string, number>();
  const offRouteEvents: OffRouteEvent[] = [];
  const defaultMps = cfg.defaultSpeedKmh / 3.6;

  /** Speed used for predictions: observed speed is noisy in Kolkata traffic, so blend it with the typical speed. */
  const cruise = (v: Vehicle) => 0.4 * Math.min(15, Math.max(0, v.speed ?? defaultMps)) + 0.6 * defaultMps;

  const makeId = hooks.newId ?? newId;

  /** A phone starts sharing. `id`: the trip's id when it was chosen elsewhere; starting it again changes nothing. */
  function startSession(input: { patternId: string; role?: SessionRole; plate?: string; busId?: string }, now = Date.now(), givenId?: string) {
    if (givenId && sessions.has(givenId)) return { sessionId: givenId };
    const pp = getNet().patterns.get(input.patternId);
    if (!pp) throw new LiveError('unknown_pattern', 'That route direction does not exist.');
    // The Metro, trains and ferries run to their timetables; only buses are shared.
    if ((pp.route.mode ?? 'bus') !== 'bus') throw new LiveError('not_a_bus', 'Only buses can be shared. This line runs to its timetable.');
    if (sessions.size >= cfg.maxSessions) throw new LiveError('busy', 'Too many trips are being shared right now.');
    const id = givenId ?? makeId();
    sessions.set(id, {
      id,
      patternId: pp.id,
      role: input.role === 'conductor' ? 'conductor' : 'rider',
      plate: normalizePlate(input.plate),
      busId: input.busId || undefined,
      startedAt: now,
      lastSeen: now,
    });
    return { sessionId: id };
  }

  function ingest(sessionId: string, pings: unknown[], now = Date.now()): IngestResult {
    const s = sessions.get(sessionId);
    if (!s) throw new LiveError('unknown_session', 'This trip has ended.');
    const pp = getNet().patterns.get(s.patternId);
    if (!pp) {
      endSession(sessionId);
      throw new LiveError('unknown_pattern', 'This route was removed.');
    }
    s.lastSeen = now;
    let accepted = 0;
    let rejected = 0;
    let lastOutcome: PingOutcome = 'invalid';
    let suggestEnd = false;
    let firstAlongM: number | undefined;
    let firstSeenAt: number | undefined;
    const valid = pings.filter(isPing).sort((a, b) => a.ts - b.ts);
    rejected += pings.length - valid.length;
    for (const p of valid) {
      lastOutcome = ingestOne(s, pp, p, now);
      if (lastOutcome === 'accepted') {
        accepted++;
        firstAlongM ??= s.along;
        firstSeenAt ??= s.alongTs;
      } else rejected++;
      // Someone who has not reached the route yet is still walking to the stop, not getting off.
      const endAfterS = s.along === undefined ? cfg.boardingGraceS : cfg.offRouteEndAfterS;
      if (
        lastOutcome === 'off_route' &&
        s.offRouteSince !== undefined &&
        (Math.min(p.ts, now) - s.offRouteSince) / 1000 >= endAfterS
      ) {
        suggestEnd = true;
      }
    }
    if (suggestEnd) detach(s);
    return { accepted, rejected, lastOutcome, suggestEnd, vehicleId: s.vehicleId, alongM: s.along, seenAt: s.alongTs, firstAlongM, firstSeenAt };
  }

  function ingestOne(s: Session, pp: PreparedPattern, p: Ping, now: number): PingOutcome {
    const ts = Math.min(p.ts, now);
    if ((now - ts) / 1000 > cfg.maxPingAgeS) return 'stale';
    if (s.alongTs !== undefined && ts <= s.alongTs) return 'duplicate';
    if (p.mock && !cfg.acceptMockLocations) return 'mock';
    if (p.accuracy !== undefined && p.accuracy > cfg.maxAccuracyM) return 'low_accuracy';

    const dt = s.alongTs !== undefined ? (ts - s.alongTs) / 1000 : 0;
    const minAlong = s.along !== undefined ? s.along - 200 : 0;
    const maxAlong =
      s.along !== undefined ? s.along + Math.max(400, cfg.maxSpeedMps * dt * 1.3) : Number.POSITIVE_INFINITY;
    const hit = locateOnLine(pp.line, p, minAlong, maxAlong);
    if (!hit) return 'invalid';

    const limit =
      cfg.offRouteM + (pp.approxShape ? cfg.approxShapeExtraM : 0) + Math.min(p.accuracy ?? 20, 50);
    if (hit.offset > limit) {
      if (s.offRouteSince === undefined) {
        s.offRouteSince = ts;
        // Only a rider who was on the route can show a diversion.
        if (s.along !== undefined) {
          offRouteEvents.push({ patternId: pp.id, sessionId: s.id, lat: p.lat, lng: p.lng, ts });
          if (offRouteEvents.length > 1000) offRouteEvents.splice(0, offRouteEvents.length - 1000);
        }
      }
      return 'off_route';
    }
    s.offRouteSince = undefined;

    if (s.along !== undefined && dt > 0) {
      const v = (hit.along - s.along) / dt;
      if (v > cfg.maxSpeedMps) return 'jump';
      const forward = Math.max(0, v);
      s.speed = s.speed === undefined ? forward : 0.7 * s.speed + 0.3 * forward;
    }
    // GPS noise can nudge a stopped bus backwards; never move more than 30 m back.
    const before = s.along;
    const beforeTs = s.alongTs;
    s.along = s.along === undefined ? hit.along : Math.max(hit.along, s.along - 30);
    s.alongTs = ts;
    assign(s, ts);
    if (before !== undefined && beforeTs !== undefined && s.along > before) passStops(s, pp, before, beforeTs, s.along, ts);
    return 'accepted';
  }

  /**
   * The stops a phone's bus passed between two positions, timed in a straight line between them.
   * Each stretch from one stop to the next is a sample for learned travel times; a conductor's
   * bus also shows how good the arrival times predicted for it were. The first stop counts as
   * passed once the bus has left it by 15 m, and the last once it is within 15 m: no bus goes past it.
   */
  function passStops(s: Session, pp: PreparedPattern, a: number, ta: number, b: number, tb: number) {
    const last = pp.stopAlong.length - 1;
    for (let pos = (s.lastStop?.pos ?? -1) + 1; pos <= last; pos++) {
      const at = pp.stopAlong[pos] + (pos === 0 ? 15 : pos === last ? -15 : 0);
      if (at > b) break;
      if (at <= a) continue;
      const ts = ta + ((at - a) / (b - a)) * (tb - ta);
      if (s.lastStop && s.lastStop.pos === pos - 1 && ts - s.lastStop.ts <= 30 * 60_000) {
        hooks.onSegment?.(pp.id, pos - 1, s.lastStop.ts, (ts - s.lastStop.ts) / 1000);
      }
      if (s.role === 'conductor' && hooks.onPrediction) checkPredictions(s, pp, pos, ts);
      s.lastStop = { pos, ts };
    }
  }

  /** The predictions made for this stop 10 and 5 minutes before the bus got there, against when it did. */
  function checkPredictions(s: Session, pp: PreparedPattern, pos: number, ts: number) {
    const list = (s.vehicleId ? vehicles.get(s.vehicleId) : undefined)?.predictions?.get(pos);
    if (!list) return;
    for (const horizonMin of [10, 5] as const) {
      let best: [number, number] | undefined;
      for (const p of list) {
        const off = Math.abs(ts - p[0] - horizonMin * 60_000);
        if (off <= 45_000 && (!best || off < Math.abs(ts - best[0] - horizonMin * 60_000))) best = p;
      }
      if (best) hooks.onPrediction?.({ routeId: pp.route.id, patternId: pp.id, horizonMin, errorSec: Math.round((best[1] - ts) / 1000), ts });
    }
  }

  /** Call every 30 s or so: keeps the arrival times predicted for conductors' buses, to check them later. */
  function notePredictions(now = Date.now()) {
    if (!hooks.onPrediction) return;
    const net = getNet();
    for (const v of vehicles.values()) {
      const pp = net.patterns.get(v.patternId);
      if (!pp || v.source !== 'conductor') continue;
      const ageS = Math.max(0, (now - v.alongTs) / 1000);
      if (ageS > cfg.staleAfterS) continue;
      const est = estimateAlong(v, ageS);
      v.predictions ??= new Map();
      for (let pos = 0; pos < pp.stopAlong.length; pos++) {
        if (pp.stopAlong[pos] <= est) continue;
        const etaSec = etaSecTo(v, pp, pos, est);
        if (etaSec > 16 * 60) break;
        const list = v.predictions.get(pos) ?? [];
        list.push([now, now + etaSec * 1000]);
        v.predictions.set(pos, list.filter((p) => now - p[0] <= 20 * 60_000));
      }
    }
  }

  function predict(v: Vehicle, ts: number): number {
    const dt = Math.max(0, Math.min(cfg.staleAfterS, (ts - v.alongTs) / 1000));
    return v.along + (v.speed ?? 0) * dt;
  }

  function assign(s: Session, ts: number) {
    const along = s.along as number;
    if (s.vehicleId) {
      const v = vehicles.get(s.vehicleId);
      if (v && Math.abs(predict(v, ts) - along) <= cfg.splitDistanceM) {
        refresh(v, ts);
        mergeTogether(v, ts);
        return;
      }
      detach(s);
    }
    let best: Vehicle | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    const marks: BusMarks = { busId: s.busId, plate: s.plate, conductor: s.role === 'conductor' };
    for (const v of vehiclesOn(s.patternId)) {
      if (!couldBeOneBus(marks, marksOf(v))) continue;
      const gap = Math.abs(predict(v, ts) - along);
      if (gap <= cfg.joinDistanceM && gap < bestGap) {
        best = v;
        bestGap = gap;
      }
    }
    if (!best) {
      best = {
        id: makeId(),
        patternId: s.patternId,
        along,
        alongTs: ts,
        speed: s.speed,
        members: new Set(),
        source: s.role === 'conductor' ? 'conductor' : 'riders',
      };
      addVehicle(best);
    }
    best.members.add(s.id);
    s.vehicleId = best.id;
    refresh(best, ts);
    mergeTogether(best, ts);
  }

  /**
   * Two phones on one bus start as two vehicles when their first fixes are far apart, as
   * they often are just after GPS starts. Vehicles that keep moving together are one bus.
   */
  function mergeTogether(v: Vehicle, ts: number) {
    for (const w of vehiclesOn(v.patternId)) {
      if (w === v) continue;
      const key = v.id < w.id ? `${v.id}|${w.id}` : `${w.id}|${v.id}`;
      if (!couldBeOneBus(marksOf(v), marksOf(w)) || Math.abs(predict(w, ts) - v.along) > cfg.mergeDistanceM) {
        together.delete(key);
        continue;
      }
      const since = together.get(key);
      if (since === undefined) together.set(key, ts);
      if (since === undefined || ts - since < cfg.mergeAfterS * 1000) continue;
      together.delete(key);
      const [keep, drop] = w.source === 'conductor' || w.members.size > v.members.size ? [w, v] : [v, w];
      for (const id of drop.members) {
        keep.members.add(id);
        const m = sessions.get(id);
        if (m) m.vehicleId = keep.id;
      }
      keep.plate = keep.plate ?? drop.plate;
      keep.busId = keep.busId ?? drop.busId;
      removeVehicle(drop);
      refresh(keep, ts);
      return;
    }
  }

  /** Position of a vehicle = its conductor if there is one, otherwise the median of its riders. */
  function refresh(v: Vehicle, ts: number) {
    const fresh: Session[] = [];
    for (const id of v.members) {
      const m = sessions.get(id);
      if (m && m.along !== undefined && m.alongTs !== undefined && ts - m.alongTs <= 60_000) fresh.push(m);
    }
    if (!fresh.length) return;
    const conductor = fresh.find((m) => m.role === 'conductor');
    const ref = conductor ? [conductor] : fresh;
    const projected = ref.map(
      (m) => (m.along as number) + (m.speed ?? 0) * Math.max(0, Math.min(60, (ts - (m.alongTs as number)) / 1000)),
    );
    v.along = median(projected);
    v.alongTs = ts;
    const speeds = ref.map((m) => m.speed).filter((x): x is number => x !== undefined);
    if (speeds.length) v.speed = median(speeds);
    v.plate = v.plate ?? fresh.find((m) => m.plate)?.plate;
    v.busId = v.busId ?? fresh.find((m) => m.busId)?.busId;
    v.source = conductor ? 'conductor' : 'riders';
  }

  function detach(s: Session) {
    if (!s.vehicleId) return;
    const v = vehicles.get(s.vehicleId);
    s.vehicleId = undefined;
    if (!v) return;
    v.members.delete(s.id);
    if (v.members.size === 0) removeVehicle(v);
  }

  function endSession(sessionId: string): boolean {
    const s = sessions.get(sessionId);
    if (!s) return false;
    detach(s);
    sessions.delete(sessionId);
    return true;
  }

  function confidenceOf(v: Vehicle, ageS: number): Confidence {
    if (ageS > cfg.staleAfterS) return 'low';
    return v.source === 'conductor' || v.members.size >= 2 ? 'high' : 'medium';
  }

  /** Moves the bus forward at cruise speed since its last report, for at most staleAfterS: after that nobody knows. */
  function estimateAlong(v: Vehicle, ageS: number): number {
    return v.along + cruise(v) * Math.min(ageS, cfg.staleAfterS);
  }

  /** Seconds until a bus estimated at `est` reaches stop `pos` of its route, with the stops on the way. */
  function etaSecTo(v: Vehicle, pp: PreparedPattern, pos: number, est: number): number {
    const learned = hooks.segmentSec ? learnedEtaSec(v, pp, pos, est) : undefined;
    if (learned !== undefined) return learned;
    let between = 0;
    for (let i = 0; i < pos; i++) if (pp.stopAlong[i] > est + 10) between++;
    return Math.max(0, pp.stopAlong[pos] - est) / cruise(v) + between * cfg.dwellSecPerStop;
  }

  /**
   * With learned travel times: what is left of the stretch the bus is on, then whole stretches,
   * at the usual speed where a stretch is not learned. Undefined while fewer than half are.
   */
  function learnedEtaSec(v: Vehicle, pp: PreparedPattern, pos: number, est: number): number | undefined {
    if (est >= pp.stopAlong[pos]) return 0;
    let k = 0;
    while (k + 1 < pos && pp.stopAlong[k + 1] <= est) k++;
    let sec = 0;
    let learned = 0;
    for (let seg = k; seg < pos; seg++) {
      const len = pp.stopAlong[seg + 1] - pp.stopAlong[seg];
      const share = seg === k && len > 0 ? Math.max(0, Math.min(1, (pp.stopAlong[seg + 1] - est) / len)) : 1;
      const l = hooks.segmentSec?.(pp.id, seg, v.alongTs);
      if (l !== undefined) learned++;
      sec += share * (l ?? len / cruise(v) + (seg > k ? cfg.dwellSecPerStop : 0));
    }
    return learned * 2 >= pos - k ? sec : undefined;
  }

  /**
   * The share of a route direction's buses running now that are tracked. Buses on the road at once
   * = the time to run the whole direction ÷ the minutes between buses. Undefined when it is not running.
   */
  function coverage(patternId: string, now = Date.now()): number | undefined {
    const pp = getNet().patterns.get(patternId);
    if (!pp) return undefined;
    const { minute, dateISO } = istNow(new Date(now));
    if (!isRouteRunning(pp.route, minute) || !isPatternActive(pp.route, pp.pattern, minute, dateISO)) return undefined;
    const runMin = (pp.line.length / defaultMps + Math.max(0, pp.stopAlong.length - 2) * cfg.dwellSecPerStop) / 60;
    const running = Math.max(1, runMin / headwayAt(pp.route, minute));
    let tracked = 0;
    for (const v of vehiclesOn(patternId)) if ((now - v.alongTs) / 1000 <= cfg.staleAfterS) tracked++;
    return Math.min(1, Math.round((tracked / running) * 100) / 100);
  }

  function arrivals(stopId: string, now = Date.now(), patternIds?: Set<string>): Arrival[] {
    const net = getNet();
    const { minute, dateISO } = istNow(new Date(now));
    const out: Arrival[] = [];
    for (const visit of net.visits.get(stopId) ?? []) {
      const pp = net.patterns.get(visit.patternId);
      if (!pp || (patternIds && !patternIds.has(pp.id))) continue;
      // A bus reaching the end of its route takes nobody further from here.
      if (visit.pos === pp.pattern.stopIds.length - 1) continue;
      const base = {
        patternId: pp.id,
        routeId: pp.route.id,
        routeNumber: pp.route.number,
        operator: pp.route.operator,
        headsign: pp.pattern.headsign,
        coverage: coverage(pp.id, now),
      };
      const stopAlong = pp.stopAlong[visit.pos];
      const live: Arrival[] = [];
      for (const v of vehiclesOn(pp.id)) {
        const ageS = Math.max(0, (now - v.alongTs) / 1000);
        if (ageS > cfg.dropAfterS) continue;
        const est = estimateAlong(v, ageS);
        if (est > stopAlong + 15) continue; // already gone past this stop
        const etaSec = etaSecTo(v, pp, visit.pos, est);
        live.push({
          ...base,
          live: true,
          etaMin: Math.round((etaSec / 60) * 10) / 10,
          vehicleId: v.id,
          lastSeenSec: Math.round(ageS),
          riders: v.members.size,
          source: v.source,
          plate: v.plate,
          confidence: confidenceOf(v, ageS),
        });
      }
      live.sort((a, b) => a.etaMin - b.etaMin);
      out.push(...live.slice(0, cfg.maxArrivalsPerPattern));
      if (!live.length && isRouteRunning(pp.route, minute) && isPatternActive(pp.route, pp.pattern, minute, dateISO)) {
        const h = headwayAt(pp.route, minute);
        out.push({ ...base, live: false, etaMin: h / 2, headwayMin: h });
      }
    }
    return out.sort((a, b) => a.etaMin - b.etaMin || Number(b.live) - Number(a.live));
  }

  function viewOf(v: Vehicle, pp: PreparedPattern, now: number): VehicleView | null {
    const ageS = Math.max(0, (now - v.alongTs) / 1000);
    if (ageS > cfg.dropAfterS) return null;
    const along = Math.min(pp.line.length, estimateAlong(v, ageS));
    const pos = pointAlong(pp.line, along);
    return {
      id: v.id,
      patternId: pp.id,
      routeNumber: pp.route.number,
      operator: pp.route.operator,
      headsign: pp.pattern.headsign,
      lat: pos.lat,
      lng: pos.lng,
      alongM: Math.round(along),
      lastSeenSec: Math.round(ageS),
      riders: v.members.size,
      source: v.source,
      plate: v.plate,
      confidence: confidenceOf(v, ageS),
    };
  }

  function vehiclesOnPattern(patternId: string, now = Date.now()): VehicleView[] {
    const pp = getNet().patterns.get(patternId);
    if (!pp) return [];
    const out: VehicleView[] = [];
    for (const v of vehiclesOn(patternId)) {
      const view = viewOf(v, pp, now);
      if (view) out.push(view);
    }
    return out;
  }

  /** The bus a phone is on, as riders see it; undefined until the phone is on the route. */
  function vehicleOfSession(sessionId: string, now = Date.now()): VehicleView | undefined {
    const s = sessions.get(sessionId);
    const v = s?.vehicleId ? vehicles.get(s.vehicleId) : undefined;
    const pp = v ? getNet().patterns.get(v.patternId) : undefined;
    return (v && pp && viewOf(v, pp, now)) || undefined;
  }

  /**
   * Minutes until the bus a phone is on reaches one of its route's stops, its last one included;
   * undefined before the phone is on the route, once the bus is past the stop, or when it is lost.
   */
  function etaOfSession(sessionId: string, stopId: string, now = Date.now()): number | undefined {
    const s = sessions.get(sessionId);
    const v = s?.vehicleId ? vehicles.get(s.vehicleId) : undefined;
    const pp = v ? getNet().patterns.get(v.patternId) : undefined;
    const pos = pp ? pp.pattern.stopIds.indexOf(stopId) : -1;
    if (!v || !pp || pos < 0) return undefined;
    const ageS = Math.max(0, (now - v.alongTs) / 1000);
    const est = estimateAlong(v, ageS);
    if (ageS > cfg.dropAfterS || est > pp.stopAlong[pos] + 15) return undefined;
    return Math.round((etaSecTo(v, pp, pos, est) / 60) * 10) / 10;
  }

  /** Places where several riders of the same route left the drawn path recently: a likely diversion. */
  function possibleDiversions(now = Date.now(), windowMin = 30): DiversionAlert[] {
    const recent = offRouteEvents.filter((e) => now - e.ts <= windowMin * 60_000);
    const used = new Set<OffRouteEvent>();
    const alerts: DiversionAlert[] = [];
    for (const e of recent) {
      if (used.has(e)) continue;
      const group = recent.filter(
        (o) => !used.has(o) && o.patternId === e.patternId && haversine(o, e) <= 250,
      );
      const riders = new Set(group.map((g) => g.sessionId));
      if (riders.size < 2) continue;
      group.forEach((g) => used.add(g));
      const pp = getNet().patterns.get(e.patternId);
      alerts.push({
        patternId: e.patternId,
        routeNumber: pp?.route.number ?? '?',
        headsign: pp?.pattern.headsign ?? '',
        lat: group.reduce((sum, g) => sum + g.lat, 0) / group.length,
        lng: group.reduce((sum, g) => sum + g.lng, 0) / group.length,
        sessions: riders.size,
        lastSeen: Math.max(...group.map((g) => g.ts)),
      });
    }
    return alerts;
  }

  /** Forget idle trips and buses nobody has reported for a while. Call every ~30 s. */
  function sweep(now = Date.now()) {
    for (const s of [...sessions.values()]) {
      if ((now - s.lastSeen) / 1000 > cfg.sessionIdleS) endSession(s.id);
    }
    const net = getNet();
    for (const v of [...vehicles.values()]) {
      const ageS = (now - v.alongTs) / 1000;
      const pp = net.patterns.get(v.patternId);
      const atEnd = pp ? v.along >= pp.line.length - 30 && ageS > 60 : true;
      if (ageS > cfg.dropAfterS || atEnd) {
        for (const id of v.members) {
          const s = sessions.get(id);
          if (s) s.vehicleId = undefined;
        }
        removeVehicle(v);
      }
    }
    for (const key of together.keys()) {
      const [a, b] = key.split('|');
      if (!vehicles.has(a) || !vehicles.has(b)) together.delete(key);
    }
  }

  return {
    startSession,
    ingest,
    endSession,
    arrivals,
    vehiclesOnPattern,
    vehicleOfSession,
    etaOfSession,
    coverage,
    notePredictions,
    possibleDiversions,
    sweep,
    stats: () => ({ sessions: sessions.size, vehicles: vehicles.size }),
    hasSession: (id: string) => sessions.has(id),
    /** Which route direction a phone's trip is on, and as whom; undefined once it ended. */
    sessionInfo: (id: string) => {
      const s = sessions.get(id);
      return s ? { patternId: s.patternId, role: s.role } : undefined;
    },
  };
}

export type LiveEngine = ReturnType<typeof createLiveEngine>;

/** The planner's coverage hook, from arrival lists: each arrival carries its direction's coverage. */
export function coverageFrom(lists: Record<string, Arrival[]> | null | undefined) {
  const m = new Map<string, number>();
  for (const list of Object.values(lists ?? {})) {
    for (const a of list) if (a.coverage !== undefined) m.set(a.patternId, Math.max(m.get(a.patternId) ?? 0, a.coverage));
  }
  return (patternId: string): number | undefined => m.get(patternId);
}

/**
 * The planner's liveEtas hook, from arrival lists. A bus nobody has heard from for a while
 * ("low" confidence) stays on the map but never sets a wait labelled "Live".
 */
export function liveEtasFrom(arrivalsAt: (stopId: string) => Arrival[] | undefined) {
  return (patternId: string, stopId: string): number[] | undefined => {
    const etas = (arrivalsAt(stopId) ?? [])
      .filter((a) => a.live && a.patternId === patternId && a.confidence !== 'low')
      .map((a) => a.etaMin);
    return etas.length ? etas : undefined;
  };
}
