import type { LatLng } from './types.ts';

const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Flat x/y metres around a reference point. Each route gets its own reference,
 * so the error stays far below GPS noise even for long district routes.
 */
export type Projection = { lat0: number; lng0: number; kx: number; ky: number };

export function makeProjection(lat0: number, lng0: number): Projection {
  const ky = EARTH_R * RAD;
  return { lat0, lng0, ky, kx: ky * Math.cos(lat0 * RAD) };
}

export function toXY(pr: Projection, p: LatLng): [number, number] {
  return [(p.lng - pr.lng0) * pr.kx, (p.lat - pr.lat0) * pr.ky];
}

export function fromXY(pr: Projection, x: number, y: number): LatLng {
  return { lat: pr.lat0 + y / pr.ky, lng: pr.lng0 + x / pr.kx };
}

/** A route path prepared for fast snapping: vertices in metres plus running distance. */
export type Line = {
  proj: Projection;
  xs: number[];
  ys: number[];
  /** Distance from the start of the line to each vertex, in metres. */
  cum: number[];
  length: number;
};

export function makeLine(points: LatLng[]): Line {
  if (points.length < 2) throw new Error('A line needs at least two points');
  let sumLat = 0;
  let sumLng = 0;
  for (const p of points) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  const proj = makeProjection(sumLat / points.length, sumLng / points.length);
  const xs: number[] = [];
  const ys: number[] = [];
  const cum: number[] = [];
  let total = 0;
  points.forEach((p, i) => {
    const [x, y] = toXY(proj, p);
    if (i > 0) total += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
    xs.push(x);
    ys.push(y);
    cum.push(total);
  });
  return { proj, xs, ys, cum, length: total };
}

export type OnLine = {
  /** Metres from the start of the line to the snapped point. */
  along: number;
  /** Metres between the GPS point and the line. */
  offset: number;
  point: LatLng;
};

/**
 * Snap a point onto the line. The search can be limited to a stretch of the line
 * (minAlong..maxAlong), which stops a bus on a route that doubles back on itself
 * from being snapped to the wrong side.
 */
export function locateOnLine(
  line: Line,
  p: LatLng,
  minAlong = 0,
  maxAlong = Number.POSITIVE_INFINITY,
): OnLine | null {
  if (minAlong > maxAlong) return null;
  const [px, py] = toXY(line.proj, p);
  let bestD2 = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestX = 0;
  let bestY = 0;
  let found = false;
  for (let i = 0; i < line.xs.length - 1; i++) {
    const segStart = line.cum[i];
    const segEnd = line.cum[i + 1];
    if (segEnd < minAlong || segStart > maxAlong) continue;
    const segLen = segEnd - segStart;
    const ax = line.xs[i];
    const ay = line.ys[i];
    const dx = line.xs[i + 1] - ax;
    const dy = line.ys[i + 1] - ay;
    let t = 0;
    if (segLen > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / (segLen * segLen);
      const tMin = Math.max(0, (minAlong - segStart) / segLen);
      const tMax = Math.min(1, (maxAlong - segStart) / segLen);
      t = Math.min(tMax, Math.max(tMin, t));
    }
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAlong = segStart + t * segLen;
      bestX = x;
      bestY = y;
      found = true;
    }
  }
  if (!found) return null;
  return { along: bestAlong, offset: Math.sqrt(bestD2), point: fromXY(line.proj, bestX, bestY) };
}

/** The position that is `along` metres from the start of the line. */
export function pointAlong(line: Line, along: number): LatLng {
  const a = Math.max(0, Math.min(line.length, along));
  let lo = 0;
  let hi = line.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const segLen = line.cum[hi] - line.cum[lo];
  const t = segLen > 0 ? (a - line.cum[lo]) / segLen : 0;
  return fromXY(
    line.proj,
    line.xs[lo] + t * (line.xs[hi] - line.xs[lo]),
    line.ys[lo] + t * (line.ys[hi] - line.ys[lo]),
  );
}

/** The part of the line between two distances, e.g. to draw one leg of a journey. */
export function sliceLine(line: Line, fromAlong: number, toAlong: number): LatLng[] {
  const a = Math.max(0, Math.min(fromAlong, toAlong));
  const b = Math.min(line.length, Math.max(fromAlong, toAlong));
  const out: LatLng[] = [pointAlong(line, a)];
  for (let i = 0; i < line.cum.length; i++) {
    if (line.cum[i] > a && line.cum[i] < b) out.push(fromXY(line.proj, line.xs[i], line.ys[i]));
  }
  out.push(pointAlong(line, b));
  return out;
}

export function isLat(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isLng(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}
