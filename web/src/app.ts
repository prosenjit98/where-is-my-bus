import { api } from './api.ts';
import { prepareNetwork, type Network, type PlanOption, type PreparedNetwork, type TravelTable } from './core.ts';
import { loadSavedNetwork, readJson, syncNetwork, writeJson } from './storage.ts';

// App state: the network, the chosen places and a stack of screens. A handful of screens do not need
// a router library; the stack is tied to the browser history so Back (and Android's back gesture) work.

export type Place =
  | { kind: 'stop'; stopId: string; name: string }
  | { kind: 'point'; lat: number; lng: number; name: string };

export type Field = 'from' | 'to';

export type Screen =
  | { name: 'plan' }
  | { name: 'search'; field: Field }
  | { name: 'map'; field: Field }
  | { name: 'option'; option: PlanOption }
  | { name: 'trip' }
  | { name: 'conductor' }
  | { name: 'routes' }
  | { name: 'route'; routeId: string }
  | { name: 'suggest'; kind?: 'stop' | 'route' | 'times' | 'other'; routeIds?: string[]; stopId?: string; text?: string };

export type NetInfo = { version: number; source: 'saved' | 'server'; offline: boolean; syncing: boolean };

type State = {
  net: PreparedNetwork | null;
  netInfo: NetInfo | null;
  /** Set when there is no saved copy and the server cannot be reached. */
  loadError: string | null;
  from: Place | null;
  to: Place | null;
  stack: Screen[];
  /** Learned travel times for this hour, kept for offline use (core learn.ts). */
  travel: TravelTable | null;
};

const PLACES_KEY = 'wimb.places.v1';
const TRAVEL_KEY = 'wimb.travel.v1';
const RECENTS_KEY = 'wimb.recents.v1';

const saved = readJson<{ from: Place | null; to: Place | null }>(PLACES_KEY);

export const state: State = {
  net: null,
  netInfo: null,
  loadError: null,
  from: saved?.from ?? null,
  to: saved?.to ?? null,
  stack: [{ name: 'plan' }],
  travel: readJson<TravelTable>(TRAVEL_KEY),
};

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emit() {
  listeners.forEach((fn) => fn());
}

export const top = (): Screen => state.stack[state.stack.length - 1];

// ---- Places ----

export function setPlace(field: Field, place: Place) {
  state[field] = place;
  writeJson(PLACES_KEY, { from: state.from, to: state.to });
  addRecent(place);
  emit();
}

export function swap() {
  [state.from, state.to] = [state.to, state.from];
  writeJson(PLACES_KEY, { from: state.from, to: state.to });
  emit();
}

const placeKey = (p: Place) => (p.kind === 'stop' ? `s:${p.stopId}` : `p:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`);

export const recents = (): Place[] => readJson<Place[]>(RECENTS_KEY) ?? [];

function addRecent(place: Place) {
  if (place.kind === 'point' && place.name === 'Your location') return;
  writeJson(RECENTS_KEY, [place, ...recents().filter((p) => placeKey(p) !== placeKey(place))].slice(0, 8));
}

// ---- Screens ----

history.replaceState({ depth: 0 }, '');

export function push(s: Screen) {
  state.stack = [...state.stack, s];
  history.pushState({ depth: state.stack.length - 1 }, '');
  emit();
}

export function pop() {
  if (state.stack.length > 1) history.back();
}

/** Back to the plan screen. */
export function reset() {
  const extra = state.stack.length - 1;
  if (extra > 0) history.go(-extra);
}

/** The screen the side nav opens once Back has reached the plan screen. */
let after: Screen | null = null;

/** From the side nav: the screen, on top of the plan screen, so Back always returns there. */
export function goTo(s: Screen) {
  const extra = state.stack.length - 1;
  if (s.name === 'plan') return reset();
  if (extra === 1 && top().name === s.name) return;
  if (extra === 0) return push(s);
  after = s;
  history.go(-extra);
}

window.addEventListener('popstate', (e) => {
  const depth = typeof (e.state as { depth?: unknown } | null)?.depth === 'number' ? (e.state as { depth: number }).depth : 0;
  if (depth < state.stack.length - 1) {
    state.stack = state.stack.slice(0, depth + 1);
    const next = depth === 0 ? after : null;
    after = null;
    if (next) push(next);
    else emit();
  } else if (depth > state.stack.length - 1) {
    // Forward to a screen that no longer exists: stay where we are.
    history.replaceState({ depth: state.stack.length - 1 }, '');
  }
});

// ---- Network ----

function apply(network: Network, source: NetInfo['source']) {
  state.net = prepareNetwork(network);
  state.netInfo = { version: network.version, source, offline: state.netInfo?.offline ?? false, syncing: state.netInfo?.syncing ?? false };
  state.loadError = null;
}

/** Learned travel times for this hour; the last ones stay in use offline. */
export async function loadTravelTimes() {
  try {
    state.travel = await api.travelTimes();
    writeJson(TRAVEL_KEY, state.travel);
    emit();
  } catch {
    // Offline: plan with the last ones, or the usual speed.
  }
}

/** The saved copy first, so journey search works at once and offline; then the server's, if newer. */
export async function loadNetwork() {
  const local = await loadSavedNetwork();
  if (local) {
    apply(local, 'saved');
    emit();
  }
  await refreshNetwork();
}

export async function refreshNetwork() {
  if (state.netInfo) state.netInfo = { ...state.netInfo, syncing: true };
  const r = await syncNetwork(state.netInfo?.version ?? 0);
  if (r.network) apply(r.network, 'server');
  if (state.netInfo) state.netInfo = { ...state.netInfo, syncing: false, offline: r.offline };
  else if (r.offline) state.loadError = 'The routes could not be downloaded. Connect to the internet once, and they stay on this phone for offline use.';
  emit();
}
