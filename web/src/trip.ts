import { keepScreenOn, isScreenKeptOn, ring } from './alarm.ts';
import { api, ApiError, type OwnedBus } from './api.ts';
import { signInKey } from './account.ts';
import { createTripTracker, type OperatorType, type Ping, type PreparedNetwork, type TripState, type TripTracker } from './core.ts';
import { tr } from './i18n.ts';
import { watchFixes, type Fix, type FixError } from './location.ts';
import { readJson, writeJson } from './storage.ts';

// "I'm on this bus" in the browser: the stop alarm and, if the rider agrees, anonymous sharing
// of the bus position, with the same rules as the phone app. It runs on location events, not
// timers. Browsers stop both when the screen is off, so the screen is kept on during a trip.
// A conductor signed in on /signin shares as the conductor of one of their owner's buses (account.ts).

export type TripConfig = {
  patternId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  destStopId: string | null;
  destName: string | null;
  /** Ring before destStopId. Conductors ride to the end of the route and need no alarm. */
  alarm: boolean;
  share: boolean;
  /** A conductor shares signed in, with the whole number plate of one of their owner's buses. */
  role: 'rider' | 'conductor';
  /** A rider's: the last 4 digits, if they typed them. A conductor's: the whole plate. */
  plate?: string;
};

export type EndReason = 'user' | 'left_route' | 'passed_destination' | 'location_denied' | 'too_old';

export type TripSnapshot = {
  active: boolean;
  config: TripConfig | null;
  /** The role the server accepted. */
  role: 'rider' | 'conductor';
  /** Shared by its conductor: which bus, and whose. */
  bus: OwnedBus | null;
  /** The server stopped taking this phone as the bus's conductor, in its words; sharing stopped. */
  refused: string | null;
  /** The server knows about this trip and receives positions. */
  sharing: boolean;
  state: TripState | null;
  sent: number;
  queued: number;
  online: boolean | null;
  locationProblem: 'unavailable' | 'timeout' | null;
  screenOn: boolean;
  alarmRinging: boolean;
  ended: { routeNumber: string; destName: string | null; shared: boolean; reason: EndReason } | null;
};

type Persisted = {
  config: TripConfig;
  sessionId: string | null;
  role: 'rider' | 'conductor';
  bus?: OwnedBus | null;
  startedAt: number;
  alarmRang: boolean;
};

const STORE_KEY = 'wimb.trip.v1';
const FLUSH_MS = 15_000;
const IDLE: TripSnapshot = {
  active: false,
  config: null,
  role: 'rider',
  bus: null,
  refused: null,
  sharing: false,
  state: null,
  sent: 0,
  queued: 0,
  online: null,
  locationProblem: null,
  screenOn: false,
  alarmRinging: false,
  ended: null,
};

let trip: Persisted | null = null;
let tracker: TripTracker | null = null;
let stopWatching: (() => void) | null = null;
let queue: Ping[] = [];
let sent = 0;
let online: boolean | null = null;
let locationProblem: TripSnapshot['locationProblem'] = null;
let alarmRinging = false;
let lastFlushAt = 0;
let lastSessionAttempt = 0;
let flushing = false;
let lastState: TripState | null = null;
let ended: TripSnapshot['ended'] = null;
let refused: string | null = null;
let snapshot: TripSnapshot = IDLE;
const listeners = new Set<() => void>();

function emit() {
  snapshot = trip
    ? {
        active: true,
        config: trip.config,
        role: trip.role,
        bus: trip.bus ?? null,
        refused,
        sharing: trip.sessionId !== null,
        state: lastState,
        sent,
        queued: queue.length,
        online,
        locationProblem,
        screenOn: isScreenKeptOn(),
        alarmRinging,
        ended: null,
      }
    : { ...IDLE, ended };
  listeners.forEach((l) => l());
}

export function subscribeTrip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getTripSnapshot = () => snapshot;

const persist = () => writeJson(STORE_KEY, trip);

function begin(net: PreparedNetwork, saved: Persisted) {
  trip = saved;
  tracker = createTripTracker(net, saved.config.patternId, saved.config.destStopId);
  queue = [];
  sent = 0;
  online = saved.config.share ? online : null;
  locationProblem = null;
  alarmRinging = false;
  lastState = null;
  ended = null;
  refused = null;
  lastSessionAttempt = Date.now();
  stopWatching?.();
  stopWatching = watchFixes(handleFix, handleError);
  void keepScreenOn(true).then(emit);
  persist();
  emit();
}

const startOnServer = (c: TripConfig) =>
  api.startTrip({ patternId: c.patternId, role: c.role, plate: c.plate }, c.role === 'conductor' ? signInKey() : undefined);

/** The server answered, and said no: not signed in as a conductor, or not one of the owner's buses. */
const isRefusal = (e: unknown): e is ApiError => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 429;

/**
 * Call from the rider's tap, after unlockSound() and a precise location check. A conductor the
 * server refuses (signed out, or a plate that is not one of their owner's buses) gets the server's
 * reason as the error, and the trip does not start.
 */
export async function startTrip(net: PreparedNetwork, config: TripConfig): Promise<void> {
  if (trip) await endTrip('user');
  let sessionId: string | null = null;
  let role: 'rider' | 'conductor' = 'rider';
  let bus: OwnedBus | null = null;
  online = null;
  if (config.share) {
    try {
      const s = await startOnServer(config);
      sessionId = s.sessionId;
      role = s.role;
      bus = s.bus ?? null;
      online = true;
    } catch (e) {
      if (config.role === 'conductor' && isRefusal(e)) throw e;
      online = false; // The alarm still works; sharing starts when the internet is back.
    }
  }
  begin(net, { config, sessionId, role, bus, startedAt: Date.now(), alarmRang: false });
}

function handleError(e: FixError) {
  if (!trip) return;
  if (e === 'denied') {
    void endTrip('location_denied');
    return;
  }
  locationProblem = e; // Keep watching: GPS often comes back after a flyover or a tunnel.
  emit();
}

function handleFix(fix: Fix) {
  if (!trip || !tracker) return;
  locationProblem = null;
  const state = tracker.update(fix);
  lastState = state;
  if (trip.config.share) {
    queue.push({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, speed: fix.speed, heading: fix.heading, ts: fix.ts, mock: false });
    if (queue.length > 60) queue.splice(0, queue.length - 60);
  }
  if (state.alarm === 'due') {
    tracker.markAlarmDone();
    if (trip.config.alarm && !trip.alarmRang) {
      trip.alarmRang = true;
      alarmRinging = true;
      persist();
      void ring(trip.config.destName ? tr('{stop} is next', { stop: trip.config.destName }) : tr('Your stop is next'), tr('Get ready to get off.'), true);
    }
  }
  if (state.suggestEnd) {
    void endTrip(state.status === 'passed_destination' ? 'passed_destination' : 'left_route');
    return;
  }
  if (Date.now() - lastFlushAt >= FLUSH_MS || queue.length >= 6) void flush();
  emit();
}

async function flush() {
  if (!trip || !trip.config.share || flushing || queue.length === 0) return;
  flushing = true;
  lastFlushAt = Date.now();
  try {
    if (trip.sessionId === null) {
      if (Date.now() - lastSessionAttempt < 30_000) return;
      lastSessionAttempt = Date.now();
      let s;
      try {
        s = await startOnServer(trip.config);
      } catch (e) {
        if (trip && trip.config.role === 'conductor' && isRefusal(e)) {
          // For example signed out on another device: the phone stops sharing rather than ask forever.
          refused = e.message;
          stopSharing();
          return;
        }
        throw e;
      }
      if (!trip) return;
      trip.sessionId = s.sessionId;
      trip.role = s.role;
      trip.bus = s.bus ?? null;
      persist();
    }
    const batch = queue.slice(0, 30);
    const res = await api.sendPings(trip.sessionId as string, batch);
    queue.splice(0, batch.length);
    sent += batch.length;
    online = true;
    if (res.suggestEnd) stopSharing();
  } catch (e) {
    online = false;
    // The server forgot this trip (for example after a restart): start a new one next time.
    if (e instanceof ApiError && e.status === 404 && trip) trip.sessionId = null;
  } finally {
    flushing = false;
    emit();
  }
}

/**
 * The server thinks this phone has left the bus. The phone's own tracker decides about the
 * stop alarm, because it sees every fix and the server may not, so only the sharing stops.
 */
function stopSharing() {
  if (!trip) return;
  const sessionId = trip.sessionId;
  trip.sessionId = null;
  trip.config = { ...trip.config, share: false };
  queue = [];
  if (sessionId) void api.endTrip(sessionId).catch(() => undefined);
  persist();
}

/** A link for family to follow this bus. Only while the trip is shared: there is no bus to follow otherwise. */
export async function followLink(): Promise<string> {
  if (!trip || !trip.config.share || !trip.sessionId) throw new Error('This bus is not being shared right now, so there is nothing to follow.');
  const r = await api.shareTrip(trip.sessionId, trip.config.destStopId);
  return new URL(r.path, location.origin).toString();
}

export function dismissAlarm() {
  alarmRinging = false;
  emit();
}

export async function endTrip(reason: EndReason = 'user'): Promise<void> {
  const ending = trip;
  if (!ending) return;
  trip = null;
  tracker = null;
  stopWatching?.();
  stopWatching = null;
  void keepScreenOn(false);
  if (ending.sessionId) {
    // Positions not sent yet go first, so the trip ends where the bus really was.
    const sessionId = ending.sessionId;
    const last = queue.slice(-30);
    void (async () => {
      if (last.length) await api.sendPings(sessionId, last, true).catch(() => undefined);
      await api.endTrip(sessionId).catch(() => undefined);
    })();
  }
  writeJson(STORE_KEY, null);
  queue = [];
  lastState = null;
  alarmRinging = false;
  const c = ending.config;
  ended = { routeNumber: c.routeNumber, destName: c.destName, shared: c.share, reason };
  if (reason !== 'user') {
    const what = c.share ? tr('Stopped sharing bus {route}', { route: c.routeNumber }) : tr('Stop alarm turned off');
    const why =
      reason === 'left_route'
        ? tr('it looks like you got off.')
        : reason === 'passed_destination'
          ? c.destName
            ? tr('you passed {stop}.', { stop: c.destName })
            : tr('you passed your stop.')
          : reason === 'location_denied'
            ? tr('location was turned off for this site.')
            : tr('the trip was too old.');
    void ring(tr('Trip ended'), `${what}: ${why}`, false);
  }
  emit();
}

/** After a reload: carry on with a trip that was in progress, if it is recent enough. */
export function restoreTrip(net: PreparedNetwork): boolean {
  const saved = readJson<Persisted>(STORE_KEY);
  if (!saved?.config) return false;
  const tooOld = Date.now() - saved.startedAt > 6 * 3600_000;
  if (tooOld || !net.patterns.has(saved.config.patternId)) {
    writeJson(STORE_KEY, null);
    ended = { routeNumber: saved.config.routeNumber, destName: saved.config.destName, shared: saved.config.share, reason: 'too_old' };
    emit();
    return false;
  }
  begin(net, saved);
  return true;
}
