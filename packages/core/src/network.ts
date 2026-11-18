import { haversine, isLat, isLng, locateOnLine, makeLine, type Line } from './geo.ts';
import { buildSearchIndex, type SearchIndex } from './search.ts';
import { isISODate, isValidClock } from './time.ts';
import type { LatLng, LineColor, Network, Pattern, Route, Stop } from './types.ts';

/** Walking distance on real streets is roughly 1.3 times the straight-line distance. */
export const WALK_DETOUR = 1.3;

export type PreparedPattern = {
  id: string;
  pattern: Pattern;
  route: Route;
  line: Line;
  /** Metres from the start of the pattern to each of its stops. */
  stopAlong: number[];
  /** True when there is no drawn road path and straight lines between stops are used. */
  approxShape: boolean;
};

/** A pattern serving a stop, and the stop's position in that pattern. */
export type StopVisit = { patternId: string; pos: number };

export type Transfer = { toStopId: string; walkM: number };

type StopGrid = Map<string, Stop[]>;

export type PreparedNetwork = {
  network: Network;
  stops: Map<string, Stop>;
  routes: Map<string, Route>;
  patterns: Map<string, PreparedPattern>;
  visits: Map<string, StopVisit[]>;
  /** Stops within a short walk of each stop, including the stop itself. */
  transfers: Map<string, Transfer[]>;
  grid: StopGrid;
  searchIndex: SearchIndex;
  center: LatLng;
};

const GRID_DEG = 0.005;

function cellKey(gy: number, gx: number) {
  return `${gy}:${gx}`;
}

export function prepareNetwork(network: Network, opts: { maxTransferWalkM?: number } = {}): PreparedNetwork {
  const maxTransferWalkM = opts.maxTransferWalkM ?? 300;
  const stops = new Map(network.stops.map((s) => [s.id, s]));
  const routes = new Map(network.routes.map((r) => [r.id, r]));
  const patterns = new Map<string, PreparedPattern>();
  const visits = new Map<string, StopVisit[]>();

  for (const route of network.routes) {
    for (const pattern of route.patterns) {
      const points = pattern.stopIds.map((id) => stops.get(id));
      if (points.length < 2 || points.some((p) => !p)) continue; // validateNetwork reports these
      const stopPoints = points as Stop[];
      const approxShape = !(pattern.shape && pattern.shape.length >= 2);
      const line = makeLine(
        approxShape ? stopPoints : (pattern.shape ?? []).map(([lat, lng]) => ({ lat, lng })),
      );
      const stopAlong: number[] = [];
      let prev = 0;
      stopPoints.forEach((s, i) => {
        if (approxShape) prev = line.cum[i];
        else prev = locateOnLine(line, s, prev)?.along ?? prev;
        stopAlong.push(prev);
      });
      patterns.set(pattern.id, { id: pattern.id, pattern, route, line, stopAlong, approxShape });
      pattern.stopIds.forEach((stopId, pos) => {
        const list = visits.get(stopId);
        if (list) list.push({ patternId: pattern.id, pos });
        else visits.set(stopId, [{ patternId: pattern.id, pos }]);
      });
    }
  }

  const grid: StopGrid = new Map();
  let sumLat = 0;
  let sumLng = 0;
  for (const s of network.stops) {
    const key = cellKey(Math.floor(s.lat / GRID_DEG), Math.floor(s.lng / GRID_DEG));
    const cell = grid.get(key);
    if (cell) cell.push(s);
    else grid.set(key, [s]);
    sumLat += s.lat;
    sumLng += s.lng;
  }
  const n = Math.max(1, network.stops.length);
  const center = network.stops.length ? { lat: sumLat / n, lng: sumLng / n } : { lat: 22.5726, lng: 88.3639 };

  const prepared: PreparedNetwork = {
    network,
    stops,
    routes,
    patterns,
    visits,
    transfers: new Map(),
    grid,
    searchIndex: buildSearchIndex(network.stops, network.landmarks ?? []),
    center,
  };

  // At big crossings you usually change to a stop on the cross street, not the same stop.
  for (const s of network.stops) {
    prepared.transfers.set(
      s.id,
      nearbyStops(prepared, s, maxTransferWalkM / WALK_DETOUR).map((near) => ({
        toStopId: near.stop.id,
        walkM: near.stop.id === s.id ? 0 : near.distM * WALK_DETOUR,
      })),
    );
  }
  return prepared;
}

/** Stops within a straight-line radius, nearest first. */
export function nearbyStops(net: PreparedNetwork, p: LatLng, radiusM: number): { stop: Stop; distM: number }[] {
  const out: { stop: Stop; distM: number }[] = [];
  if (radiusM > 20_000) {
    for (const stop of net.stops.values()) {
      const distM = haversine(p, stop);
      if (distM <= radiusM) out.push({ stop, distM });
    }
    return out.sort((a, b) => a.distM - b.distM);
  }
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  const y0 = Math.floor((p.lat - dLat) / GRID_DEG);
  const y1 = Math.floor((p.lat + dLat) / GRID_DEG);
  const x0 = Math.floor((p.lng - dLng) / GRID_DEG);
  const x1 = Math.floor((p.lng + dLng) / GRID_DEG);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      for (const stop of net.grid.get(cellKey(gy, gx)) ?? []) {
        const distM = haversine(p, stop);
        if (distM <= radiusM) out.push({ stop, distM });
      }
    }
  }
  return out.sort((a, b) => a.distM - b.distM);
}

/** The n closest stops regardless of distance. */
export function nearestStops(net: PreparedNetwork, p: LatLng, n: number): { stop: Stop; distM: number }[] {
  return [...net.stops.values()]
    .map((stop) => ({ stop, distM: haversine(p, stop) }))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, n);
}

const OPERATORS = new Set(['private', 'govt', 'mini', 'other']);
const MODES = new Set(['bus', 'metro', 'train', 'ferry']);
/**
 * Line colours, for the GTFS export and the phone app; the web app's style sheet has the same values.
 * White text reads on each (4.5:1 or more), dark text on yellow.
 */
export const LINE_HEX: Record<LineColor, string> = {
  blue: '#1565C0',
  green: '#2E7D32',
  purple: '#6A1B9A',
  orange: '#C24A00',
  pink: '#C2185B',
  yellow: '#F9A825',
  red: '#C62828',
  teal: '#00796B',
};
const LINE_COLORS = new Set(Object.keys(LINE_HEX));

/** Problems that would break planning or tracking, written for the admin panel. */
export function validateNetwork(n: Network): string[] {
  const errors: string[] = [];
  if (!n || typeof n !== 'object') return ['The network must be a JSON object.'];
  if (!Array.isArray(n.stops) || !Array.isArray(n.routes)) return ['The network needs "stops" and "routes" lists.'];
  if (n.attribution !== undefined) {
    if (!Array.isArray(n.attribution)) errors.push('"attribution" must be a list of credits.');
    else {
      for (const a of n.attribution) {
        if (!a || typeof a.text !== 'string' || !a.text.trim() || a.text.length > 300) errors.push('Each credit in "attribution" needs its text (up to 300 characters).');
        else if (a.url !== undefined && (typeof a.url !== 'string' || !/^https?:\/\/\S+$/.test(a.url))) errors.push(`The credit "${a.text}" has a web address that is not one.`);
      }
    }
  }

  const stopIds = new Set<string>();
  for (const s of n.stops) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) {
      errors.push('A stop is missing its id.');
      continue;
    }
    if (stopIds.has(s.id)) errors.push(`Stop id "${s.id}" is used twice.`);
    stopIds.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim()) errors.push(`Stop "${s.id}" has no name.`);
    if (!isLat(s.lat) || !isLng(s.lng)) errors.push(`Stop "${s.id}" has invalid coordinates.`);
    if (s.aliases !== undefined && (!Array.isArray(s.aliases) || s.aliases.some((a) => typeof a !== 'string'))) {
      errors.push(`Stop "${s.id}" has invalid other names.`);
    }
  }

  if (n.landmarks !== undefined && !Array.isArray(n.landmarks)) errors.push('"landmarks" must be a list.');
  const landmarkIds = new Set<string>();
  for (const l of Array.isArray(n.landmarks) ? n.landmarks : []) {
    if (!l || typeof l.id !== 'string' || !l.id.trim()) {
      errors.push('A landmark is missing its id.');
      continue;
    }
    if (landmarkIds.has(l.id)) errors.push(`Landmark id "${l.id}" is used twice.`);
    landmarkIds.add(l.id);
    if (typeof l.name !== 'string' || !l.name.trim()) errors.push(`Landmark "${l.id}" has no name.`);
    if (!isLat(l.lat) || !isLng(l.lng)) errors.push(`Landmark "${l.id}" has invalid coordinates.`);
  }

  const routeIds = new Set<string>();
  const patternIds = new Set<string>();
  for (const r of n.routes) {
    if (!r || typeof r.id !== 'string' || !r.id.trim()) {
      errors.push('A route is missing its id.');
      continue;
    }
    const label = `Route ${r.number || r.id}`;
    if (routeIds.has(r.id)) errors.push(`Route id "${r.id}" is used twice.`);
    routeIds.add(r.id);
    if (typeof r.number !== 'string' || !r.number.trim()) errors.push(`Route "${r.id}" has no number.`);
    if (!OPERATORS.has(r.operator)) errors.push(`${label}: operator must be private, govt, mini or other.`);
    if (r.mode !== undefined && !MODES.has(r.mode)) errors.push(`${label}: mode must be bus, metro, train or ferry.`);
    if (r.color !== undefined && !LINE_COLORS.has(r.color)) errors.push(`${label}: colour must be one of ${[...LINE_COLORS].join(', ')}.`);
    if (!isValidClock(r.firstBus) || !isValidClock(r.lastBus)) errors.push(`${label}: first and last bus times must be HH:MM.`);
    if (!(typeof r.defaultHeadwayMin === 'number' && r.defaultHeadwayMin > 0)) {
      errors.push(`${label}: the usual time between buses must be more than 0 minutes.`);
    }
    for (const b of r.headways ?? []) {
      if (!isValidClock(b.from) || !isValidClock(b.to) || !(b.minutes > 0)) {
        errors.push(`${label}: each busy-hour frequency needs a start, an end and minutes above 0.`);
      }
    }
    if (!Array.isArray(r.patterns) || r.patterns.length === 0) {
      errors.push(`${label} needs at least one direction.`);
      continue;
    }
    for (const p of r.patterns) {
      if (!p || typeof p.id !== 'string' || !p.id.trim()) {
        errors.push(`${label}: a direction is missing its id.`);
        continue;
      }
      const pl = `${label} towards ${p.headsign || p.id}`;
      if (patternIds.has(p.id)) errors.push(`Direction id "${p.id}" is used twice.`);
      patternIds.add(p.id);
      if (p.direction !== 'UP' && p.direction !== 'DOWN') errors.push(`${pl}: direction must be UP or DOWN.`);
      if (!Array.isArray(p.stopIds) || p.stopIds.length < 2) errors.push(`${pl} needs at least two stops.`);
      for (const sid of p.stopIds ?? []) if (!stopIds.has(sid)) errors.push(`${pl} uses unknown stop "${sid}".`);
      if (p.shape !== undefined) {
        const ok = Array.isArray(p.shape) && p.shape.every((pt) => Array.isArray(pt) && isLat(pt[0]) && isLng(pt[1]));
        if (!ok) errors.push(`${pl}: the road path has invalid points.`);
      }
      for (const w of p.activeWindows ?? []) {
        if (!isValidClock(w.from) || !isValidClock(w.to)) errors.push(`${pl}: running times must be HH:MM.`);
      }
      if ((p.validFrom && !isISODate(p.validFrom)) || (p.validTo && !isISODate(p.validTo))) {
        errors.push(`${pl}: dates must be YYYY-MM-DD.`);
      }
      if (p.replaces !== undefined) {
        if (!r.patterns.some((q) => q.id === p.replaces && q.id !== p.id)) {
          errors.push(`${pl} replaces a direction that is not part of this route.`);
        }
        if (!p.validFrom || !p.validTo) errors.push(`${pl}: a diversion needs a start date and an end date.`);
      }
    }
  }
  return errors;
}
