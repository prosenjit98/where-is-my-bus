import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, type OwnedBus } from '../api';
import { API_URL, PING_FLUSH_MS } from '../config';
import {
  createTripTracker,
  type OperatorType,
  type Ping,
  type PreparedNetwork,
  type TripState,
  type TripTracker,
} from '../core';
import {
  isNativeTripRunning,
  notifyUser,
  onTripError,
  onTripLocation,
  setTripNotification,
  startNativeTrip,
  stopNativeTrip,
  type NativeFix,
} from '../native/location';
import { plural } from '../format';
import { nameOf, tr } from '../i18n';
import { getAccount } from './account';
import { isRecording } from './recording';

// "I'm on this bus": the phone tracks the trip for the stop alarm and, if the rider agrees,
// shares the bus position. Everything here runs on location events from the native
// module, never on timers, because JavaScript timers pause when the app is in the background.

export type TripConfig = {
  patternId: string;
  routeNumber: string;
  operator: OperatorType;
  headsign: string;
  destStopId: string | null;
  destName: string | null;
  share: boolean;
  /** A conductor shares signed in, giving the bus's whole number plate; a rider may give its last digits. */
  role: 'rider' | 'conductor';
  plate?: string;
};

export type EndReason = 'user' | 'left_route' | 'passed_destination' | 'location_stopped' | 'app_closed';

export type TripSnapshot = {
  active: boolean;
  config: TripConfig | null;
  /** The role the server accepted: conductor for a conductor signed in. */
  role: 'rider' | 'conductor';
  /** Shared by its conductor: which bus, and whose. */
  bus: OwnedBus | null;
  /**
   * For a rider: the bus the server put them on, by where they are. With its conductor sharing it
   * too, the rider knows they are on a bus riders further along already see.
   */
  onBus: { conductor: boolean; plate?: string; riders: number } | null;
  /** The server knows about this trip and receives positions. */
  sharing: boolean;
  state: TripState | null;
  sent: number;
  queued: number;
  online: boolean | null;
  ended: { routeNumber: string; destName: string | null; shared: boolean; reason: EndReason } | null;
};

type Persisted = { config: TripConfig; sessionId: string | null; role: 'rider' | 'conductor'; bus?: OwnedBus | null; startedAt: number };

const STORE_KEY = 'wimb.trip.v1';
const IDLE: TripSnapshot = {
  active: false,
  config: null,
  role: 'rider',
  bus: null,
  onBus: null,
  sharing: false,
  state: null,
  sent: 0,
  queued: 0,
  online: null,
  ended: null,
};

let trip: Persisted | null = null;
/** The network the trip runs on, for its stops' names in the app's language. */
let tripNet: PreparedNetwork | null = null;
let tracker: TripTracker | null = null;
let queue: Ping[] = [];
let sent = 0;
let online: boolean | null = null;
let lastFlushAt = 0;
let lastSessionAttempt = 0;
let flushing = false;
let lastState: TripState | null = null;
let lastNotice = '';
let ended: TripSnapshot['ended'] = null;
let onBus: TripSnapshot['onBus'] = null;
let onBusVehicle: string | undefined;
let onBusCheckedAt = 0;
let unsubscribers: (() => void)[] = [];
let snapshot: TripSnapshot = IDLE;
const listeners = new Set<() => void>();

function emit() {
  snapshot = trip
    ? {
        active: true,
        config: trip.config,
        role: trip.role,
        bus: trip.bus ?? null,
        onBus,
        sharing: trip.sessionId !== null,
        state: lastState,
        sent,
        queued: queue.length,
        online,
        ended: null,
      }
    : { ...IDLE, ended };
  listeners.forEach((l) => l());
}

/**
 * Which bus a rider was put on: when the server's answer names another vehicle, or once a minute,
 * the buses on the route direction are asked for and that one is found, with whether its conductor
 * shares it.
 */
async function checkOnBus(vehicleId: string | undefined) {
  if (!trip) return;
  if (!vehicleId) {
    if (onBus) {
      onBus = null;
      emit();
    }
    return;
  }
  if (vehicleId === onBusVehicle && Date.now() - onBusCheckedAt < 60_000) return;
  onBusVehicle = vehicleId;
  onBusCheckedAt = Date.now();
  try {
    const v = (await api.vehicles(trip.config.patternId)).find((x) => x.id === vehicleId);
    onBus = v ? { conductor: v.source === 'conductor', plate: v.plate, riders: v.riders } : null;
    emit();
  } catch {
    // Offline: asked again with the next positions.
  }
}

export function subscribeTrip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTripSnapshot(): TripSnapshot {
  return snapshot;
}

function noticeFor(config: TripConfig, state: TripState | null): { title: string; text: string } {
  const title = config.share
    ? tr('Sharing bus {route}', { route: config.routeNumber })
    : config.destName
      ? tr('Stop alarm for {stop}', { stop: config.destName })
      : tr('Stop alarm for your stop');
  if (!state?.nextStopName) return { title, text: tr('Stops by itself when you get off.') };
  const next = state.nextStopId ? tripNet?.stops.get(state.nextStopId) : undefined;
  const toGo =
    config.destName && state.stopsToGo !== null && state.stopsToGo > 0
      ? ` ${tr('{stops} to {stop}.', { stops: plural(state.stopsToGo, 'stop', 'stops'), stop: config.destName })}`
      : '';
  return { title, text: `${tr('Next: {stop}.', { stop: next ? nameOf(next) : state.nextStopName })}${toGo}` };
}

async function persist() {
  if (trip) await AsyncStorage.setItem(STORE_KEY, JSON.stringify(trip)).catch(() => undefined);
}

function listen() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [onTripLocation(handleFix), onTripError(() => void endTrip('location_stopped'))];
}

/** A link for family to follow this bus: they see it move and when it reaches the rider's stop. */
export async function followLink(): Promise<string> {
  if (!trip?.sessionId) throw new Error('The trip is not shared yet. Try again once the phone is online.');
  const r = await api.shareTrip(trip.sessionId, trip.config.destStopId);
  return `${API_URL}${r.path}`;
}

/** The sign-in key a conductor's trip is shared with: the account signed in on this phone. */
const keyFor = (config: TripConfig) => (config.role === 'conductor' ? getAccount()?.key : undefined);

export async function startTrip(net: PreparedNetwork, config: TripConfig): Promise<void> {
  if (isRecording()) throw new Error(tr('Finish recording the route first.'));
  if (config.share && config.role === 'conductor' && !keyFor(config)) throw new Error(tr('Sign in as a conductor to share a bus as its conductor.'));
  if (trip) await endTrip('user', false);
  const nextTracker = createTripTracker(net, config.patternId, config.destStopId);
  tripNet = net;
  // Start the phone's tracking first: if it fails, nothing is sent to the server.
  await startNativeTrip(noticeFor(config, null));
  let sessionId: string | null = null;
  let role: 'rider' | 'conductor' = 'rider';
  let bus: OwnedBus | null = null;
  online = null;
  if (config.share) {
    try {
      const s = await api.startTrip({ patternId: config.patternId, role: config.role, plate: config.plate }, keyFor(config));
      sessionId = s.sessionId;
      role = s.role;
      bus = s.bus ?? null;
      online = true;
    } catch (e) {
      // The server said no (a plate that is not the owner's, a conductor no longer signed in): say so.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        await stopNativeTrip().catch(() => undefined);
        throw e;
      }
      online = false; // The alarm still works; sharing starts when the internet is back.
    }
  }
  trip = { config, sessionId, role, bus, startedAt: Date.now() };
  tracker = nextTracker;
  queue = [];
  sent = 0;
  lastState = null;
  lastNotice = '';
  ended = null;
  lastSessionAttempt = Date.now();
  listen();
  await persist();
  emit();
}

function handleFix(fix: NativeFix) {
  if (!trip || !tracker) return;
  const state = tracker.update({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ts: fix.ts });
  lastState = state;
  if (trip.config.share) {
    queue.push({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speed: fix.speed,
      heading: fix.heading,
      ts: fix.ts,
      mock: fix.mock === true,
    });
    if (queue.length > 60) queue.splice(0, queue.length - 60);
  }
  if (state.alarm === 'due') {
    tracker.markAlarmDone();
    notifyUser(trip.config.destName ? tr('{stop} is next', { stop: trip.config.destName }) : tr('Your stop is next'), tr('Get ready to get off.'), true);
  }
  if (state.suggestEnd) {
    void endTrip(state.status === 'passed_destination' ? 'passed_destination' : 'left_route');
    return;
  }
  const noticeKey = `${state.nextStopId}|${state.stopsToGo}`;
  if (noticeKey !== lastNotice) {
    lastNotice = noticeKey;
    const n = noticeFor(trip.config, state);
    setTripNotification(n.title, n.text);
  }
  if (Date.now() - lastFlushAt >= PING_FLUSH_MS || queue.length >= 6) void flush();
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
      const s = await api.startTrip({ patternId: trip.config.patternId, role: trip.config.role, plate: trip.config.plate }, keyFor(trip.config));
      if (!trip) return;
      trip.sessionId = s.sessionId;
      trip.role = s.role;
      trip.bus = s.bus ?? null;
      await persist();
    }
    const batch = queue.slice(0, 30);
    const res = await api.sendPings(trip.sessionId as string, batch);
    queue.splice(0, batch.length);
    sent += batch.length;
    online = true;
    if (res.suggestEnd) stopSharing();
    if (trip.role === 'rider') void checkOnBus(res.vehicleId);
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
  void persist();
}

export async function endTrip(reason: EndReason = 'user', announce = true): Promise<void> {
  const ending = trip;
  if (!ending) return;
  trip = null;
  tracker = null;
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  await stopNativeTrip().catch(() => undefined);
  if (ending.sessionId) {
    // Positions not sent yet go first, so the trip ends where the bus really was.
    const sessionId = ending.sessionId;
    const last = queue.slice(-30);
    void (async () => {
      if (last.length) await api.sendPings(sessionId, last).catch(() => undefined);
      await api.endTrip(sessionId).catch(() => undefined);
    })();
  }
  await AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
  queue = [];
  lastState = null;
  onBus = null;
  onBusVehicle = undefined;
  const c = ending.config;
  ended = { routeNumber: c.routeNumber, destName: c.destName, shared: c.share, reason };
  if (announce && reason !== 'user') {
    const what = c.share ? tr('Stopped sharing bus {route}', { route: c.routeNumber }) : tr('Stop alarm turned off');
    const why =
      reason === 'left_route'
        ? tr('it looks like you got off.')
        : reason === 'passed_destination'
          ? c.destName
            ? tr('you passed {stop}.', { stop: c.destName })
            : tr('you passed your stop.')
          : tr('location updates stopped.');
    notifyUser(tr('Trip ended'), `${what}: ${why}`, false);
  }
  emit();
}

/** After the app restarts: pick up a trip that is still being tracked, or tidy up one that is not. */
export async function restoreTrip(net: PreparedNetwork): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STORE_KEY).catch(() => null);
  if (!raw) return false;
  let saved: Persisted;
  try {
    saved = JSON.parse(raw) as Persisted;
  } catch {
    await AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
    return false;
  }
  const running = await isNativeTripRunning().catch(() => false);
  const tooOld = Date.now() - saved.startedAt > 6 * 3600_000;
  if (!running || tooOld || !net.patterns.has(saved.config.patternId)) {
    await AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
    if (running) await stopNativeTrip().catch(() => undefined);
    ended = { routeNumber: saved.config.routeNumber, destName: saved.config.destName, shared: saved.config.share, reason: 'app_closed' };
    emit();
    return false;
  }
  trip = saved;
  tracker = createTripTracker(net, saved.config.patternId, saved.config.destStopId);
  tripNet = net;
  listen();
  emit();
  return true;
}
