import { haversine } from './geo.ts';
import { nearbyStops, nearestStops, WALK_DETOUR, type PreparedNetwork, type PreparedPattern } from './network.ts';
import { HIGH_COVERAGE } from './live.ts';
import { headwayAt, isPatternActive, isRouteRunning, istNow } from './time.ts';
import type { LatLng, LineColor, OperatorType, TransitMode } from './types.ts';

/** Typical speed by mode, until travel times are learned (only buses are tracked, so learn). */
export const MODE_SPEED_KMH: Record<TransitMode, number> = { bus: 14, metro: 32, train: 38, ferry: 12 };
/** Minutes standing at each stop on the way, by mode. */
export const MODE_DWELL_MIN: Record<TransitMode, number> = { bus: 0.4, metro: 0.4, train: 0.6, ferry: 1 };

export type Endpoint =
  | { kind: 'stop'; stopId: string; label?: string }
  | { kind: 'point'; lat: number; lng: number; label?: string };

export type PlanOptions = {
  /** Minutes after midnight, IST. Defaults to now. */
  minuteOfDay?: number;
  /** YYYY-MM-DD in IST. Defaults to today; used for diversions. */
  dateISO?: string;
  /** Furthest walk to or from a stop. */
  maxWalkM?: number;
  walkMetresPerMin?: number;
  /** Average bus speed including traffic, used until real segment times are learned. */
  busKmh?: number;
  dwellMinPerStop?: number;
  /** Extra minutes a change "costs" so a direct bus wins unless the change is clearly faster. */
  transferPenaltyMin?: number;
  /** Routes slower than the fastest by more than this are not offered as "take any of these". */
  maxExtraRideMin?: number;
  maxResults?: number;
  /** Minutes until the next tracked buses of a pattern reach a stop. */
  liveEtas?: (patternId: string, stopId: string) => number[] | undefined;
  /** Hook for learned travel times. Return undefined to use the default estimate. */
  rideTimeMin?: (pattern: PreparedPattern, fromPos: number, toPos: number) => number | undefined;
  /**
   * The share of a direction's running buses that are tracked (live.ts coverage). Where every
   * route of a leg is covered well, a tracked bus later than the usual wait sets the wait: there
   * is no untracked bus to come sooner.
   */
  coverage?: (patternId: string) => number | undefined;
};

export type RouteChoice = {
  patternId: string;
  routeId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  headwayMin: number;
  rideMin: number;
  stopsCount: number;
  liveEtasMin?: number[];
  /** Buses are tracked and shared; the Metro, trains and ferries are planned from their frequencies. */
  mode: TransitMode;
  color?: LineColor;
};

export type BusLeg = {
  kind: 'bus';
  boardStopId: string;
  alightStopId: string;
  /** Any of these gets you there: take whichever comes first. */
  choices: RouteChoice[];
  waitMin: number;
  waitIsLive: boolean;
  /** When the wait is live, the route of the bus it is based on. */
  livePatternId?: string;
  rideMin: number;
};

export type WalkLeg = { kind: 'walk'; fromLabel: string; toLabel: string; meters: number; minutes: number };

export type Leg = BusLeg | WalkLeg;

export type PlanOption = {
  id: string;
  legs: Leg[];
  totalMin: number;
  walkMin: number;
  transfers: number;
  liveWait: boolean;
};

export type NotRunning = { routeId: string; routeNumber: string; firstBus: string; lastBus: string };

export type PlanResult = {
  options: PlanOption[];
  /** Routes that would connect these places directly but are not running at this time. */
  notRunning: NotRunning[];
  originStopIds: string[];
  destStopIds: string[];
  minuteOfDay: number;
  dateISO: string;
};

type Cand = { stopId: string; walkM: number };

const SIBLING_STOP_M = 250;
const WALK_ONLY_MAX_M = 1500;

const round1 = (x: number) => Math.round(x * 10) / 10;

export function isBusLeg(leg: Leg): leg is BusLeg {
  return leg.kind === 'bus';
}

export function plan(net: PreparedNetwork, from: Endpoint, to: Endpoint, opts: PlanOptions = {}): PlanResult {
  const now = istNow();
  const minute = opts.minuteOfDay ?? now.minute;
  const dateISO = opts.dateISO ?? now.dateISO;
  const maxWalkM = opts.maxWalkM ?? 700;
  const walkMpm = opts.walkMetresPerMin ?? 75;
  const busMpm = ((opts.busKmh ?? 14) * 1000) / 60;
  const dwell = opts.dwellMinPerStop ?? 0.4;
  const transferPenalty = opts.transferPenaltyMin ?? 6;
  const maxExtraRide = opts.maxExtraRideMin ?? 6;
  const maxResults = opts.maxResults ?? 6;

  const origins = endpointStops(net, from, maxWalkM);
  const dests = endpointStops(net, to, maxWalkM);
  const notRunning = new Map<string, NotRunning>();

  const activeCache = new Map<string, boolean>();
  const isActive = (pp: PreparedPattern): boolean => {
    let v = activeCache.get(pp.id);
    if (v === undefined) {
      v = isRouteRunning(pp.route, minute) && isPatternActive(pp.route, pp.pattern, minute, dateISO);
      activeCache.set(pp.id, v);
    }
    return v;
  };
  const rideMin = (pp: PreparedPattern, fromPos: number, toPos: number): number => {
    const mode = pp.route.mode ?? 'bus';
    const mpm = mode === 'bus' ? busMpm : (MODE_SPEED_KMH[mode] * 1000) / 60;
    const perStop = mode === 'bus' ? dwell : MODE_DWELL_MIN[mode];
    return (
      opts.rideTimeMin?.(pp, fromPos, toPos) ??
      (pp.stopAlong[toPos] - pp.stopAlong[fromPos]) / mpm + perStop * Math.max(0, toPos - fromPos - 1)
    );
  };

  const destByPattern = new Map<string, { pos: number; cand: Cand }[]>();
  for (const d of dests) {
    for (const v of net.visits.get(d.stopId) ?? []) {
      const list = destByPattern.get(v.patternId);
      if (list) list.push({ pos: v.pos, cand: d });
      else destByPattern.set(v.patternId, [{ pos: v.pos, cand: d }]);
    }
  }

  // 1. Direct journeys: one bus from a stop near the start to a stop near the end.
  const directKeys = new Map<string, { board: Cand; alight: Cand }>();
  for (const o of origins) {
    for (const v of net.visits.get(o.stopId) ?? []) {
      const pp = net.patterns.get(v.patternId);
      if (!pp) continue;
      for (const d of destByPattern.get(v.patternId) ?? []) {
        if (d.pos <= v.pos) continue; // wrong direction
        if (!isActive(pp)) {
          if (!isRouteRunning(pp.route, minute)) {
            notRunning.set(pp.route.id, {
              routeId: pp.route.id,
              routeNumber: pp.route.number,
              firstBus: pp.route.firstBus,
              lastBus: pp.route.lastBus,
            });
          }
          continue;
        }
        const key = `${o.stopId}>${d.cand.stopId}`;
        if (!directKeys.has(key)) directKeys.set(key, { board: o, alight: d.cand });
      }
    }
  }

  // 2. One change: best change point for every pair of routes.
  type TransferChoice = { board1: Cand; alight1: string; board2: string; transferWalkM: number; alight2: Cand };
  const bestPair = new Map<string, { est: number; choice: TransferChoice }>();
  for (const o of origins) {
    for (const v1 of net.visits.get(o.stopId) ?? []) {
      const pp1 = net.patterns.get(v1.patternId);
      if (!pp1 || !isActive(pp1)) continue;
      const half1 = headwayAt(pp1.route, minute) / 2;
      for (let i = v1.pos + 1; i < pp1.pattern.stopIds.length; i++) {
        const changeStop = pp1.pattern.stopIds[i];
        const ride1 = rideMin(pp1, v1.pos, i);
        for (const t of net.transfers.get(changeStop) ?? []) {
          for (const v2 of net.visits.get(t.toStopId) ?? []) {
            const pp2 = net.patterns.get(v2.patternId);
            if (!pp2 || pp2.route.id === pp1.route.id) continue;
            const dList = destByPattern.get(v2.patternId);
            if (!dList || !isActive(pp2)) continue;
            const half2 = headwayAt(pp2.route, minute) / 2;
            for (const d of dList) {
              if (d.pos <= v2.pos) continue;
              const est =
                (o.walkM + t.walkM + d.cand.walkM) / walkMpm + half1 + ride1 + half2 + rideMin(pp2, v2.pos, d.pos);
              const pairKey = `${pp1.id}|${pp2.id}`;
              const prev = bestPair.get(pairKey);
              if (prev && prev.est <= est) continue;
              bestPair.set(pairKey, {
                est,
                choice: { board1: o, alight1: changeStop, board2: t.toStopId, transferWalkM: t.walkM, alight2: d.cand },
              });
            }
          }
        }
      }
    }
  }
  const transferKeys = new Map<string, TransferChoice>();
  for (const { choice: c } of bestPair.values()) {
    transferKeys.set(`${c.board1.stopId}>${c.alight1}|${c.board2}>${c.alight2.stopId}`, c);
  }

  // All routes between two stops, grouped: in Kolkata you take whichever bus comes first.
  const busLeg = (board: string, alight: string, reachMin: number): BusLeg | null => {
    const alightPositions = new Map<string, number[]>();
    for (const v of net.visits.get(alight) ?? []) {
      const list = alightPositions.get(v.patternId);
      if (list) list.push(v.pos);
      else alightPositions.set(v.patternId, [v.pos]);
    }
    const raw: RouteChoice[] = [];
    for (const v of net.visits.get(board) ?? []) {
      const aPos = alightPositions.get(v.patternId)?.find((p) => p > v.pos);
      if (aPos === undefined) continue;
      const pp = net.patterns.get(v.patternId);
      if (!pp || !isActive(pp) || raw.some((c) => c.routeId === pp.route.id)) continue;
      const live = opts
        .liveEtas?.(pp.id, board)
        ?.filter((eta) => eta >= reachMin - 0.5)
        .sort((a, b) => a - b);
      raw.push({
        patternId: pp.id,
        routeId: pp.route.id,
        routeNumber: pp.route.number,
        operator: pp.route.operator,
        headsign: pp.pattern.headsign,
        headwayMin: headwayAt(pp.route, minute),
        rideMin: rideMin(pp, v.pos, aPos),
        stopsCount: aPos - v.pos,
        liveEtasMin: live && live.length ? live.slice(0, 3).map(round1) : undefined,
        mode: pp.route.mode ?? 'bus',
        color: pp.route.color,
      });
    }
    if (!raw.length) return null;
    const fastest = Math.min(...raw.map((c) => c.rideMin));
    const choices = raw.filter((c) => c.rideMin <= fastest + maxExtraRide);
    // Several routes every h1, h2... minutes together give a bus every 1/(1/h1 + 1/h2 + ...) minutes.
    const freq = choices.reduce((sum, c) => sum + 1 / c.headwayMin, 0);
    const usualWait = 1 / freq / 2;
    const usualRide = choices.reduce((sum, c) => sum + c.rideMin / c.headwayMin, 0) / freq;

    // A tracked bus gives a real wait; pick the one that gets you there soonest.
    let bestLive: { eta: number; c: RouteChoice } | null = null;
    for (const c of choices) {
      for (const eta of c.liveEtasMin ?? []) {
        if (!bestLive || eta + c.rideMin < bestLive.eta + bestLive.c.rideMin) bestLive = { eta, c };
      }
    }
    choices.sort((a, b) => (a.liveEtasMin?.[0] ?? 999) - (b.liveEtasMin?.[0] ?? 999) || a.rideMin - b.rideMin);
    // Most buses are not tracked yet, so a tracked bus that comes later than the usual wait
    // does not mean no bus comes sooner. Then the usual wait stands, and the tracked bus
    // stays in the choices' liveEtasMin for the app to mention. Where conductors cover nearly
    // every bus of every route here, it does mean a gap, and the tracked bus sets the wait.
    const liveWait = bestLive ? Math.max(0, bestLive.eta - reachMin) : Number.POSITIVE_INFINITY;
    const wellCovered = !!opts.coverage && choices.every((c) => (opts.coverage?.(c.patternId) ?? 0) >= HIGH_COVERAGE);
    if (bestLive && (liveWait <= usualWait || wellCovered)) {
      return {
        kind: 'bus',
        boardStopId: board,
        alightStopId: alight,
        choices,
        waitMin: round1(liveWait),
        waitIsLive: true,
        livePatternId: bestLive.c.patternId,
        rideMin: round1(bestLive.c.rideMin),
      };
    }
    return {
      kind: 'bus',
      boardStopId: board,
      alightStopId: alight,
      choices,
      waitMin: round1(usualWait),
      waitIsLive: false,
      rideMin: round1(usualRide),
    };
  };

  const stopName = (id: string) => net.stops.get(id)?.name ?? id;
  const fromLabel = endpointLabel(net, from, 'Your start');
  const toLabel = endpointLabel(net, to, 'Your destination');
  const walkLeg = (a: string, b: string, meters: number): WalkLeg[] =>
    meters < 40
      ? []
      : [{ kind: 'walk', fromLabel: a, toLabel: b, meters: Math.round(meters), minutes: Math.max(1, Math.round(meters / walkMpm)) }];

  type Scored = PlanOption & { cost: number };
  const options: Scored[] = [];

  for (const [key, k] of directKeys) {
    const walkIn = k.board.walkM / walkMpm;
    const leg = busLeg(k.board.stopId, k.alight.stopId, walkIn);
    if (!leg) continue;
    const walkOut = k.alight.walkM / walkMpm;
    const total = walkIn + leg.waitMin + leg.rideMin + walkOut;
    options.push({
      id: key,
      legs: [
        ...walkLeg(fromLabel, stopName(k.board.stopId), k.board.walkM),
        leg,
        ...walkLeg(stopName(k.alight.stopId), toLabel, k.alight.walkM),
      ],
      totalMin: Math.round(total),
      walkMin: Math.round(walkIn + walkOut),
      transfers: 0,
      liveWait: leg.waitIsLive,
      cost: total,
    });
  }

  for (const [key, k] of transferKeys) {
    const walkIn = k.board1.walkM / walkMpm;
    const leg1 = busLeg(k.board1.stopId, k.alight1, walkIn);
    if (!leg1) continue;
    const walkMid = k.transferWalkM / walkMpm;
    const leg2 = busLeg(k.board2, k.alight2.stopId, walkIn + leg1.waitMin + leg1.rideMin + walkMid);
    if (!leg2) continue;
    const walkOut = k.alight2.walkM / walkMpm;
    const total = walkIn + leg1.waitMin + leg1.rideMin + walkMid + leg2.waitMin + leg2.rideMin + walkOut;
    options.push({
      id: key,
      legs: [
        ...walkLeg(fromLabel, stopName(k.board1.stopId), k.board1.walkM),
        leg1,
        ...walkLeg(stopName(k.alight1), stopName(k.board2), k.transferWalkM),
        leg2,
        ...walkLeg(stopName(k.alight2.stopId), toLabel, k.alight2.walkM),
      ],
      totalMin: Math.round(total),
      walkMin: Math.round(walkIn + walkMid + walkOut),
      transfers: 1,
      liveWait: leg1.waitIsLive,
      cost: total + transferPenalty,
    });
  }

  // Short trips: walking may simply be quicker.
  const a = endpointPoint(net, from);
  const b = endpointPoint(net, to);
  if (a && b) {
    const walkM = haversine(a, b) * WALK_DETOUR;
    if (walkM <= WALK_ONLY_MAX_M) {
      const minutes = Math.max(1, Math.round(walkM / walkMpm));
      options.push({
        id: 'walk',
        legs: [{ kind: 'walk', fromLabel, toLabel, meters: Math.round(walkM), minutes }],
        totalMin: minutes,
        walkMin: minutes,
        transfers: 0,
        liveWait: false,
        cost: walkM / walkMpm,
      });
    }
  }

  // A change is only worth showing if it beats every direct bus.
  const bestDirect = Math.min(
    ...options.filter((o) => o.transfers === 0 && o.id !== 'walk').map((o) => o.cost),
  );
  const kept = options
    .filter((o) => o.transfers === 0 || o.cost < bestDirect)
    .sort((x, y) => x.cost - y.cost);

  // Boarding the same buses one stop earlier is not a different journey.
  const bySignature = new Map<string, Scored>();
  for (const o of kept) {
    const sig =
      o.id === 'walk'
        ? 'walk'
        : o.legs
            .filter(isBusLeg)
            .map((l) => l.choices.map((c) => c.routeId).sort().join('+'))
            .join('>');
    if (!bySignature.has(sig)) bySignature.set(sig, o);
  }

  return {
    options: [...bySignature.values()].slice(0, maxResults).map(({ cost: _cost, ...o }) => o),
    notRunning: directKeys.size ? [] : [...notRunning.values()],
    originStopIds: origins.map((c) => c.stopId),
    destStopIds: dests.map((c) => c.stopId),
    minuteOfDay: minute,
    dateISO,
  };
}

function endpointPoint(net: PreparedNetwork, ep: Endpoint): LatLng | null {
  if (ep.kind === 'point') return { lat: ep.lat, lng: ep.lng };
  return net.stops.get(ep.stopId) ?? null;
}

function endpointLabel(net: PreparedNetwork, ep: Endpoint, fallback: string): string {
  if (ep.label) return ep.label;
  if (ep.kind === 'stop') return net.stops.get(ep.stopId)?.name ?? fallback;
  return fallback;
}

function endpointStops(net: PreparedNetwork, ep: Endpoint, maxWalkM: number): Cand[] {
  if (ep.kind === 'stop') {
    const s = net.stops.get(ep.stopId);
    if (!s) return [];
    // Include stops a short walk away, such as the stop on the other side of the road.
    return nearbyStops(net, s, SIBLING_STOP_M / WALK_DETOUR).map((n) => ({
      stopId: n.stop.id,
      walkM: n.stop.id === s.id ? 0 : n.distM * WALK_DETOUR,
    }));
  }
  const p = { lat: ep.lat, lng: ep.lng };
  let near = nearbyStops(net, p, maxWalkM / WALK_DETOUR);
  if (!near.length) {
    // Nothing within an easy walk: offer the closest stops if they are not absurdly far.
    near = nearestStops(net, p, 3).filter((n) => n.distM * WALK_DETOUR <= maxWalkM * 3);
  }
  return near.slice(0, 12).map((n) => ({ stopId: n.stop.id, walkM: n.distM * WALK_DETOUR }));
}
