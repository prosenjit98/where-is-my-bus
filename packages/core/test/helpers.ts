import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pointAlong, prepareNetwork, type Network, type Ping, type PreparedPattern } from '../src/index.ts';

export function demoNetwork(): Network {
  const file = fileURLToPath(new URL('../../../data/demo-network.json', import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as Network;
}

export const demo = () => prepareNetwork(demoNetwork());

/** 10:00 IST on 27 Oct 2026, as a UTC timestamp. */
export const T0 = Date.UTC(2026, 9, 27, 4, 30);

/** A point `along` metres into the pattern, optionally shifted sideways off the road. */
export function pointOn(pp: PreparedPattern, along: number, sideM = 0): { lat: number; lng: number } {
  const p = pointAlong(pp.line, along);
  if (!sideM) return p;
  const a = pointAlong(pp.line, along - 2);
  const b = pointAlong(pp.line, along + 2);
  const k = Math.cos((p.lat * Math.PI) / 180);
  const dx = (b.lng - a.lng) * k;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular to the direction of travel.
  return { lat: p.lat + ((dx / len) * sideM) / 111_320, lng: p.lng + ((-dy / len) * sideM) / (111_320 * k) };
}

/** Pings for a bus moving along a pattern at a steady speed. */
export function drive(
  pp: PreparedPattern,
  opts: { startM: number; mps: number; count: number; everyS: number; t0: number; sideM?: number },
): Ping[] {
  const pings: Ping[] = [];
  for (let i = 0; i < opts.count; i++) {
    const p = pointOn(pp, opts.startM + opts.mps * opts.everyS * i, opts.sideM ?? 0);
    pings.push({ ...p, accuracy: 15, ts: opts.t0 + i * opts.everyS * 1000 });
  }
  return pings;
}
