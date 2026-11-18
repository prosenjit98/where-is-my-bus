import { locateOnLine } from './geo.ts';
import type { PreparedNetwork } from './network.ts';

// Runs on the phone during "I'm on this bus". Works fully offline: GPS needs no internet.

export type TripStatus = 'waiting_for_fix' | 'on_route' | 'off_route' | 'arrived' | 'passed_destination';

export type AlarmState = 'off' | 'waiting' | 'due' | 'done';

export type TripState = {
  status: TripStatus;
  alongM: number | null;
  nextStopId: string | null;
  nextStopName: string | null;
  destStopId: string | null;
  destName: string | null;
  remainingM: number | null;
  stopsToGo: number | null;
  etaMin: number | null;
  offRouteSec: number;
  alarm: AlarmState;
  /** Time to stop sharing: the rider left the route or went past their stop. */
  suggestEnd: boolean;
};

export type TripFix = { lat: number; lng: number; accuracy?: number; ts: number };

export type TripTrackerOptions = {
  /** Ring the alarm this many metres before the destination stop. */
  alarmBeforeM?: number;
  offRouteM?: number;
  endAfterOffRouteS?: number;
  /** Before the first fix on the route (the rider started the trip on the way to the stop), wait this long before ending. */
  boardingGraceS?: number;
  speedKmh?: number;
  maxAccuracyM?: number;
};

/** Fastest believable bus speed, in metres per second; limits how far ahead a fix may snap. */
const MAX_SPEED_MPS = 25;

export function createTripTracker(
  net: PreparedNetwork,
  patternId: string,
  destStopId: string | null,
  opts: TripTrackerOptions = {},
) {
  const pp = net.patterns.get(patternId);
  if (!pp) throw new Error('Unknown route direction.');
  const alarmBeforeM = opts.alarmBeforeM ?? 800;
  const offRouteM = (opts.offRouteM ?? 60) + (pp.approxShape ? 150 : 0);
  const endAfterS = opts.endAfterOffRouteS ?? 90;
  const boardingGraceS = opts.boardingGraceS ?? 600;
  const metresPerMin = ((opts.speedKmh ?? 14) * 1000) / 60;
  const maxAccuracyM = opts.maxAccuracyM ?? 150;
  const stopIds = pp.pattern.stopIds;
  const destPos = destStopId ? stopIds.indexOf(destStopId) : -1;
  const destName = destPos >= 0 ? net.stops.get(stopIds[destPos])?.name ?? null : null;

  let along: number | null = null;
  let alongTs = 0;
  let offSince: number | null = null;
  let lastTs = 0;
  let status: TripStatus = 'waiting_for_fix';
  let alarm: AlarmState = destPos >= 0 ? 'waiting' : 'off';

  function update(fix: TripFix): TripState {
    lastTs = Math.max(lastTs, fix.ts);
    if (fix.accuracy !== undefined && fix.accuracy > maxAccuracyM) return snapshot(fix.ts);
    // Search only as far ahead as a bus could have gone, so a route that doubles back
    // never snaps to its far side and "passes" the destination early.
    const dt = along === null ? 0 : Math.max(0, (fix.ts - alongTs) / 1000);
    const hit =
      along === null
        ? locateOnLine(pp!.line, fix)
        : locateOnLine(pp!.line, fix, along - 200, along + Math.max(400, MAX_SPEED_MPS * dt * 1.3));
    const limit = offRouteM + Math.min(fix.accuracy ?? 20, 50);
    if (!hit || hit.offset > limit) {
      if (offSince === null) offSince = fix.ts;
      status = 'off_route';
      return snapshot(fix.ts);
    }
    offSince = null;
    along = along === null ? hit.along : Math.max(hit.along, along - 30);
    alongTs = fix.ts;
    status = 'on_route';
    if (destPos >= 0) {
      const remaining = pp!.stopAlong[destPos] - along;
      if (remaining < -300) status = 'passed_destination';
      else if (remaining <= 60) status = 'arrived';
      if (alarm === 'waiting' && remaining <= alarmBeforeM) alarm = 'due';
    }
    return snapshot(fix.ts);
  }

  function snapshot(now: number): TripState {
    let nextIndex: number | null = null;
    if (along !== null) {
      const a = along;
      const i = pp!.stopAlong.findIndex((s) => s > a + 20);
      nextIndex = i >= 0 ? i : null;
    }
    const nextStopId = nextIndex !== null ? stopIds[nextIndex] : null;
    let remainingM: number | null = null;
    let stopsToGo: number | null = null;
    let etaMin: number | null = null;
    if (destPos >= 0 && along !== null) {
      remainingM = Math.round(pp!.stopAlong[destPos] - along);
      stopsToGo = nextIndex !== null && nextIndex <= destPos ? destPos - nextIndex + 1 : 0;
      etaMin = remainingM > 0 ? Math.round(remainingM / metresPerMin + stopsToGo * 0.4) : 0;
    }
    const offRouteSec = offSince !== null ? Math.max(0, Math.round((now - offSince) / 1000)) : 0;
    // Someone who has not reached the route yet is still walking to the stop, not getting off.
    const endAfter = along === null ? boardingGraceS : endAfterS;
    return {
      status,
      alongM: along === null ? null : Math.round(along),
      nextStopId,
      nextStopName: nextStopId ? net.stops.get(nextStopId)?.name ?? null : null,
      destStopId: destPos >= 0 ? stopIds[destPos] : null,
      destName,
      remainingM,
      stopsToGo,
      etaMin,
      offRouteSec,
      alarm,
      suggestEnd: offRouteSec >= endAfter || status === 'passed_destination',
    };
  }

  return {
    patternId,
    update,
    /** Call after the alarm has been shown so it rings only once. */
    markAlarmDone() {
      if (alarm === 'due') alarm = 'done';
    },
    state: () => snapshot(lastTs || Date.now()),
  };
}

export type TripTracker = ReturnType<typeof createTripTracker>;
