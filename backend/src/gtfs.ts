import {
  headwayAt,
  inWindow,
  LINE_HEX,
  MODE_DWELL_MIN,
  MODE_SPEED_KMH,
  parseClock,
  type OperatorType,
  type Pattern,
  type PreparedNetwork,
  type PreparedPattern,
  type Route,
  type TransitMode,
} from '../../packages/core/src/index.ts';
import type { ZipFile } from './zip.ts';

// The network as a GTFS feed (https://gtfs.org/documentation/schedule/reference/), so journey
// planners and map apps can show these routes too. Buses here keep no timetable, only how often
// they come, so each direction becomes frequency-based trips: one for each part of the day with its
// own frequency, timed stop to stop from the learned travel times where known and the usual speed
// elsewhere. A diversion runs on its own dates and switches off the direction it replaces on them.

const ROUTE_TYPE: Record<TransitMode, number> = { bus: 3, metro: 1, train: 2, ferry: 4 };
const DIRECTION_ID = { UP: 0, DOWN: 1 } as const;
const AGENCY_NAME: Record<OperatorType, string> = {
  private: 'Private bus operators',
  govt: 'Government transport',
  mini: 'Minibus operators',
  other: 'Other operators',
};

export type GtfsOptions = {
  /** The feed's first day, YYYY-MM-DD in Indian time. */
  todayISO: string;
  /** Where riders find this service; GTFS asks for a web address for each agency and the publisher. */
  url: string;
  publisherName?: string;
  /** How many days the feed covers. */
  days?: number;
  /** Learned seconds over a stretch of a direction at a moment, if known (learn.ts). */
  segmentSec?: (patternId: string, seg: number, ts: number) => number | undefined;
};

type Cell = string | number | undefined;

function csv(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** "HH:MM:SS"; the hours pass 24 for service after midnight, as GTFS wants. */
function gtfsTime(sec: number): string {
  const s = Math.round(sec);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

const gtfsDate = (iso: string) => iso.replaceAll('-', '');
const coord = (x: number) => Number(x.toFixed(6));
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * A moment at a minute of the day in Indian time (past 1440 after midnight) on an ordinary weekday,
 * Wednesday 7 January 2026: the feed's trips run every day, so they are timed as on a weekday.
 */
const weekdayTs = (minute: number) => Date.UTC(2026, 0, 7) - 330 * 60_000 + minute * 60_000;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type ServiceInterval = { from: number; to: number; headwayMin: number };

/**
 * The parts of the day a direction runs, each with the minutes between buses. Minutes count from
 * midnight and pass 1440 when service runs after midnight; the last bus time itself is included.
 */
export function serviceIntervals(route: Route, pattern: Pattern): ServiceInterval[] {
  const start = parseClock(route.firstBus);
  let end = parseClock(route.lastBus) + 1;
  if (end <= start) end += 1440;
  const cuts = new Set([start, end]);
  const cut = (clock: string) => {
    const m = parseClock(clock);
    for (const x of [m, m + 1440]) if (x > start && x < end) cuts.add(x);
  };
  for (const b of route.headways ?? []) {
    cut(b.from);
    cut(b.to);
  }
  const windows = pattern.activeWindows ?? [];
  for (const w of windows) {
    cut(w.from);
    cut(w.to);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: ServiceInterval[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    const m = a % 1440;
    if (windows.length && !windows.some((w) => inWindow(m, parseClock(w.from), parseClock(w.to)))) continue;
    const headwayMin = headwayAt(route, m);
    const last = out.at(-1);
    if (last && last.to === a && last.headwayMin === headwayMin) last.to = b;
    else out.push({ from: a, to: b, headwayMin });
  }
  return out;
}

type Days = { start: string; end: string; removed: string[] };

/** The days within the feed a direction runs on, or null for none. */
function daysOf(route: Route, p: Pattern, feedStart: string, feedEnd: string): Days | null {
  const start = p.validFrom && p.validFrom > feedStart ? p.validFrom : feedStart;
  const end = p.validTo && p.validTo < feedEnd ? p.validTo : feedEnd;
  if (start > end) return null;
  const removed = new Set<string>();
  for (const q of route.patterns) {
    if (q.id === p.id || q.replaces !== p.id || !q.validFrom || !q.validTo) continue;
    for (let d = q.validFrom < start ? start : q.validFrom; d <= q.validTo && d <= end; d = addDays(d, 1)) removed.add(d);
  }
  const total = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  return removed.size >= total ? null : { start, end, removed: [...removed].sort() };
}

/** Seconds from the first stop to each stop, for a bus leaving around `minute`. */
function stopOffsets(pp: PreparedPattern, minute: number, segmentSec: GtfsOptions['segmentSec']): number[] {
  const mode = pp.route.mode ?? 'bus';
  const mps = (MODE_SPEED_KMH[mode] * 1000) / 3600;
  const dwellSec = MODE_DWELL_MIN[mode] * 60;
  const out = [0];
  for (let seg = 0; seg + 1 < pp.stopAlong.length; seg++) {
    const usual = (pp.stopAlong[seg + 1] - pp.stopAlong[seg]) / mps + (seg > 0 ? dwellSec : 0);
    out.push(out[seg] + (segmentSec?.(pp.id, seg, weekdayTs(minute)) ?? usual));
  }
  return out.map(Math.round);
}

export function gtfsFiles(net: PreparedNetwork, opts: GtfsOptions): ZipFile[] {
  const feedStart = opts.todayISO;
  const feedEnd = addDays(feedStart, (opts.days ?? 365) - 1);
  const services = new Map<string, Days>();
  const trips: Cell[][] = [];
  const stopTimes: Cell[][] = [];
  const frequencies: Cell[][] = [];
  const shapes: Cell[][] = [];
  const usedRoutes = new Set<string>();
  const usedStops = new Set<string>();

  for (const route of net.network.routes) {
    for (const p of route.patterns) {
      const pp = net.patterns.get(p.id);
      const days = pp ? daysOf(route, p, feedStart, feedEnd) : null;
      const intervals = days ? serviceIntervals(route, p) : [];
      if (!pp || !days || !intervals.length) continue;
      const plain = days.start === feedStart && days.end === feedEnd && !days.removed.length;
      const serviceId = plain ? 'everyday' : `days-${p.id}`;
      services.set(serviceId, days);
      usedRoutes.add(route.id);
      // Drawn road paths only; without one, apps draw straight lines between the stops anyway.
      const shape = pp.approxShape ? undefined : p.shape;
      const shapeId = shape ? p.id : undefined;
      shape?.forEach(([lat, lng], i) => shapes.push([p.id, coord(lat), coord(lng), i + 1, round1(pp.line.cum[i])]));

      for (const iv of intervals) {
        const tripId = `${p.id}-${gtfsTime(iv.from * 60).slice(0, 5).replace(':', '')}`;
        trips.push([route.id, serviceId, tripId, p.headsign, DIRECTION_ID[p.direction], shapeId]);
        const offsets = stopOffsets(pp, Math.floor((iv.from + iv.to) / 2), opts.segmentSec);
        p.stopIds.forEach((stopId, i) => {
          const t = gtfsTime(iv.from * 60 + offsets[i]);
          // The times are estimates (timepoint 0); buses come every few minutes rather than at set times.
          stopTimes.push([tripId, t, t, stopId, i + 1, 0, shapeId ? round1(pp.stopAlong[i]) : undefined]);
          usedStops.add(stopId);
        });
        frequencies.push([tripId, gtfsTime(iv.from * 60), gtfsTime(iv.to * 60), Math.round(iv.headwayMin * 60), 0]);
      }
    }
  }

  const routes = net.network.routes.filter((r) => usedRoutes.has(r.id));
  const stops = net.network.stops.filter((s) => usedStops.has(s.id));
  const agencies = [...new Set(routes.map((r) => r.operator))];
  const files: ZipFile[] = [
    {
      name: 'agency.txt',
      data: csv(
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
        agencies.map((a) => [a, AGENCY_NAME[a], opts.url, 'Asia/Kolkata', 'en']),
      ),
    },
    { name: 'stops.txt', data: csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], stops.map((s) => [s.id, s.name, coord(s.lat), coord(s.lng)])) },
    {
      name: 'routes.txt',
      data: csv(
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'],
        routes.map((r) => {
          const hex = r.color ? LINE_HEX[r.color].slice(1) : undefined;
          return [r.id, r.operator, r.number, r.name, ROUTE_TYPE[r.mode ?? 'bus'], hex, hex && (r.color === 'yellow' ? '1E2833' : 'FFFFFF')];
        }),
      ),
    },
    { name: 'trips.txt', data: csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], trips) },
    {
      name: 'stop_times.txt',
      data: csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint', 'shape_dist_traveled'], stopTimes),
    },
    { name: 'frequencies.txt', data: csv(['trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times'], frequencies) },
    {
      name: 'calendar.txt',
      data: csv(
        ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
        [...services].map(([id, d]) => [id, 1, 1, 1, 1, 1, 1, 1, gtfsDate(d.start), gtfsDate(d.end)]),
      ),
    },
  ];
  const removed = [...services].flatMap(([id, d]) => d.removed.map((day) => [id, gtfsDate(day), 2]));
  if (removed.length) files.push({ name: 'calendar_dates.txt', data: csv(['service_id', 'date', 'exception_type'], removed) });
  if (shapes.length) {
    files.push({ name: 'shapes.txt', data: csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled'], shapes) });
  }
  files.push({
    name: 'feed_info.txt',
    data: csv(
      ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version'],
      [[opts.publisherName ?? 'Where Is My Bus', opts.url, 'en', gtfsDate(feedStart), gtfsDate(feedEnd), String(net.network.version)]],
    ),
  });
  // The credits the data's licences require (OpenStreetMap's ODbL, for one) travel with the feed.
  const credits = net.network.attribution ?? [];
  if (credits.length) {
    files.push({
      name: 'attributions.txt',
      data: csv(
        ['attribution_id', 'organization_name', 'is_producer', 'attribution_url'],
        credits.map((a, i) => [`credit-${i + 1}`, a.text, 1, a.url]),
      ),
    });
  }
  // Stop names in Bengali script, for apps showing the feed in Bengali.
  const bengali = stops.filter((s) => s.nameBn);
  if (bengali.length) {
    files.push({
      name: 'translations.txt',
      data: csv(['table_name', 'field_name', 'language', 'translation', 'record_id'], bengali.map((s) => ['stops', 'stop_name', 'bn', s.nameBn, s.id])),
    });
  }
  return files;
}
