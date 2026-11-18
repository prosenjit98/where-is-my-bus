// Seeds a network from OpenStreetMap: bus route relations (public_transport:version=2) with
// their stops and road paths. OSM has no timetables for Kolkata's buses, so first and last
// buses and frequencies are placeholders, said so in the network notice, until surveyed.
//
// The data is © OpenStreetMap contributors, under the Open Database License (ODbL). A network
// built from it that is shared, such as the copy the app downloads, must credit OpenStreetMap
// and be offered under the ODbL too. Decide that before importing into a live network.
//
//   node tools/import-osm.ts --out data/osm-kolkata.json
//   node tools/import-osm.ts --refs 1A,45,S-9 --out data/osm-sample.json
//   node tools/import-osm.ts --network "Kolkata Private Bus|WBTC" --area "Kolkata" --out ...

import { writeFile } from 'node:fs/promises';
import {
  haversine,
  locateOnLine,
  makeLine,
  makeProjection,
  toXY,
  validateNetwork,
  type Network,
  type OperatorType,
  type Pattern,
  type Route,
  type Stop,
} from '../packages/core/src/index.ts';

type OsmMember = { type: 'node' | 'way' | 'relation'; ref: number; role: string; lat?: number; lon?: number; geometry?: ({ lat: number; lon: number } | null)[] };
type OsmElement = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; members?: OsmMember[] };
export type OverpassJson = { elements: OsmElement[] };

export type ImportOptions = {
  region: string;
  firstBus?: string;
  lastBus?: string;
  headwayMin?: number;
  /** Stops of the same name closer than this are one stop (both sides of the road). */
  mergeStopsM?: number;
  today?: string;
};

export type ImportReport = {
  relations: number;
  routes: number;
  patterns: number;
  stops: number;
  skipped: string[];
  straightLines: number;
  /** Directions whose stops were found along the road path, because the relation lists none. */
  stopsMatched: number;
};

const STOP_ROLES = /^stop(_entry_only|_exit_only)?$/;
const PLATFORM_ROLES = /^platform(_entry_only|_exit_only)?$/;

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
}

function operatorOf(network: string, operator: string): OperatorType {
  const s = `${network} ${operator}`;
  if (/mini/i.test(s)) return 'mini';
  if (/WBTC|transport corporation|\bCTC\b|\bSBSTC\b|\bNBSTC\b|govern/i.test(s)) return 'govt';
  if (/private/i.test(s)) return 'private';
  return 'other';
}

/** "00:15", "15" or "15 min" to minutes. */
function intervalMin(tag: string | undefined): number | undefined {
  if (!tag) return undefined;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(tag.trim());
  const n = hm ? Number(hm[1]) * 60 + Number(hm[2]) : Number.parseFloat(tag);
  return Number.isFinite(n) && n > 0 && n < 240 ? n : undefined;
}

/** Simple daily hours such as "06:00-22:00" or "Mo-Su 06:00-22:00". */
function hoursOf(tag: string | undefined): { from: string; to: string } | undefined {
  const m = tag ? /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/.exec(tag) : null;
  return m && !/[;,]/.test(tag ?? '') ? { from: m[1], to: m[2] === '24:00' ? '23:59' : m[2] } : undefined;
}

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

const nearestEnd = (p: Pt, w: Pt[]) => Math.min(dist(p, w[0]), dist(p, w[w.length - 1]));

/**
 * Joins a route's ways into one path in the direction of travel, turning ways round as needed.
 * Mappers usually list the ways in order, but not always, so when the next way listed does not
 * meet the end of the path, the way that does is used instead.
 */
export function stitch(ways: Pt[][]): { path: Pt[]; worstGapM: number } {
  const parts = ways.filter((w) => w.length >= 2);
  if (!parts.length) return { path: [], worstGapM: 0 };
  const left = new Set(parts.keys());
  left.delete(0);
  let path: Pt[] = [...parts[0]];
  // The first way may itself be backwards: it is, if the rest of the route meets its start.
  if (parts.length > 1) {
    const toStart = Math.min(...[...left].map((i) => nearestEnd(path[0], parts[i])));
    const toEnd = Math.min(...[...left].map((i) => nearestEnd(path[path.length - 1], parts[i])));
    if (toStart < toEnd) path = path.reverse();
  }
  let worstGapM = 0;
  let next = 1;
  while (left.size) {
    const end = path[path.length - 1];
    let pick = left.has(next) && nearestEnd(end, parts[next]) <= 30 ? next : -1;
    if (pick < 0) {
      let best = Number.POSITIVE_INFINITY;
      for (const i of left) {
        const d = nearestEnd(end, parts[i]);
        if (d < best) {
          best = d;
          pick = i;
        }
      }
    }
    left.delete(pick);
    next = pick + 1;
    const w = parts[pick];
    const seg = dist(end, w[w.length - 1]) < dist(end, w[0]) ? [...w].reverse() : w;
    const gap = dist(end, seg[0]);
    worstGapM = Math.max(worstGapM, gap);
    path.push(...(gap < 1 ? seg.slice(1) : seg));
  }
  return { path, worstGapM };
}

const isStopNode = (e: OsmElement) =>
  !!e.tags?.name && (e.tags.highway === 'bus_stop' || e.tags.public_transport === 'platform' || e.tags.public_transport === 'stop_position');

/** Named bus stops within `maxOffsetM` of the path, in the order the bus passes them. */
export function stopsAlong(path: Pt[], candidates: OsmElement[], maxOffsetM = 30): OsmElement[] {
  if (path.length < 2) return [];
  const line = makeLine(path.map(([lat, lng]) => ({ lat, lng })));
  const pad = maxOffsetM / 100_000;
  const lats = path.map((p) => p[0]);
  const lngs = path.map((p) => p[1]);
  const [s, n, w, e] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  const hits: { node: OsmElement; along: number }[] = [];
  for (const c of candidates) {
    if (c.lat === undefined || c.lon === undefined || c.lat < s || c.lat > n || c.lon < w || c.lon > e) continue;
    const hit = locateOnLine(line, { lat: c.lat, lng: c.lon });
    if (hit && hit.offset <= maxOffsetM) hits.push({ node: c, along: hit.along });
  }
  return hits.sort((a, b) => a.along - b.along).map((h) => h.node);
}

/** Drops points that change the path by less than `tolM` metres (Douglas-Peucker), to keep the download small. */
export function simplify(path: Pt[], tolM = 4): Pt[] {
  if (path.length <= 2) return path;
  const pr = makeProjection(path[0][0], path[0][1]);
  const xy = path.map(([lat, lng]) => toXY(pr, { lat, lng }));
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - xy[i][1]) - (ax - xy[i][0]) * (by - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolM) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return path.filter((_, i) => keep[i]).map(([lat, lng]) => [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
}

export function fromOverpass(data: OverpassJson, opts: ImportOptions): { network: Network; report: ImportReport } {
  const mergeM = opts.mergeStopsM ?? 300;
  const nodes = new Map<number, OsmElement>();
  for (const e of data.elements) if (e.type === 'node') nodes.set(e.id, e);
  const relations = data.elements.filter((e) => e.type === 'relation' && e.tags?.route === 'bus');
  const candidates = [...nodes.values()].filter(isStopNode);
  const skipped: string[] = [];
  let straightLines = 0;
  let stopsMatched = 0;

  // One stop per place: same name, close together (the stops on both sides of the road).
  const stops: (Stop & { n: number })[] = [];
  const byName = new Map<string, (Stop & { n: number })[]>();
  const taken = new Set<string>();
  function stopFor(node: OsmElement): Stop | null {
    const t = node.tags ?? {};
    const name = (t.name ?? t['name:en'] ?? '').trim();
    if (!name || node.lat === undefined || node.lon === undefined) return null;
    const key = name.toLowerCase();
    const near = (byName.get(key) ?? []).find((s) => haversine(s, { lat: node.lat as number, lng: node.lon as number }) <= mergeM);
    if (near) {
      // The stop sits between its nodes, in the middle of the road.
      near.lat = (near.lat * near.n + node.lat) / (near.n + 1);
      near.lng = (near.lng * near.n + node.lon) / (near.n + 1);
      near.n += 1;
      return near;
    }
    let id = slug(name);
    for (let i = 2; taken.has(id); i++) id = `${slug(name)}-${i}`;
    taken.add(id);
    const stop: Stop & { n: number } = { id, name, lat: node.lat, lng: node.lon, n: 1 };
    if (t['name:bn']) stop.nameBn = t['name:bn'];
    const aliases = [t['name:en'], t.alt_name, t.old_name, t.short_name]
      .flatMap((v) => (v ? v.split(';') : []))
      .map((v) => v.trim())
      .filter((v) => v && v.toLowerCase() !== key);
    if (aliases.length) stop.aliases = [...new Set(aliases)];
    stops.push(stop);
    byName.set(key, [...(byName.get(key) ?? []), stop]);
    return stop;
  }

  // Hours and frequency may be tagged on either direction of a route; `tagged` says which were.
  const groups = new Map<string, { route: Route; seen: Set<string>; tagged: { hours: boolean; headway: boolean } }>();
  for (const rel of relations) {
    const t = rel.tags ?? {};
    const ref = (t.ref ?? '').trim();
    const label = `relation ${rel.id}${ref ? ` (${ref})` : ''}`;
    if (!ref) {
      skipped.push(`${label}: no route number (ref)`);
      continue;
    }
    const members = rel.members ?? [];
    const pick = (roles: RegExp) =>
      members
        .filter((m) => m.type === 'node' && roles.test(m.role))
        .map((m) => nodes.get(m.ref) ?? { type: 'node' as const, id: m.ref, lat: m.lat, lon: m.lon })
        .map(stopFor)
        .filter((s): s is Stop => s !== null);
    const ways = members
      .filter((m) => m.type === 'way' && !STOP_ROLES.test(m.role) && !PLATFORM_ROLES.test(m.role) && m.geometry)
      .map((m) => (m.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map((g) => [g.lat, g.lon] as Pt));
    const { path, worstGapM } = stitch(ways);
    let stopList = pick(STOP_ROLES);
    if (stopList.length < 2) stopList = pick(PLATFORM_ROLES);
    // Many relations list only the road; then the stops are the named ones along it.
    if (stopList.length < 2 && path.length >= 2 && worstGapM <= 300) {
      stopList = stopsAlong(path, candidates).map(stopFor).filter((s): s is Stop => s !== null);
      if (stopList.length >= 2) stopsMatched++;
    }
    const stopIds = stopList.map((s) => s.id).filter((id, i, a) => i === 0 || a[i - 1] !== id);
    if (stopIds.length < 2) {
      skipped.push(`${label}: fewer than two named stops${worstGapM > 300 ? ', and a gap in its road path' : ''}`);
      continue;
    }
    const key = `${t.network ?? ''}|${ref}`;
    let group = groups.get(key);
    if (!group) {
      let id = slug(ref);
      for (let i = 2; [...groups.values()].some((g) => g.route.id === id); i++) id = `${slug(ref)}-${i}`;
      group = {
        route: {
          id,
          number: ref,
          name: t.name,
          operator: operatorOf(t.network ?? '', t.operator ?? ''),
          firstBus: opts.firstBus ?? '06:00',
          lastBus: opts.lastBus ?? '21:00',
          defaultHeadwayMin: opts.headwayMin ?? 15,
          patterns: [],
        },
        seen: new Set(),
        tagged: { hours: false, headway: false },
      };
      groups.set(key, group);
    }
    const hours = hoursOf(t.opening_hours);
    if (hours && !group.tagged.hours) {
      group.route.firstBus = hours.from;
      group.route.lastBus = hours.to;
      group.tagged.hours = true;
    }
    const every = intervalMin(t.interval);
    if (every && !group.tagged.headway) {
      group.route.defaultHeadwayMin = every;
      group.tagged.headway = true;
    }
    const signature = stopIds.join('>');
    if (group.seen.has(signature)) continue; // the same direction mapped twice
    group.seen.add(signature);
    const n = group.route.patterns.length;
    const pattern: Pattern = {
      id: `${slug(ref).toUpperCase()}-${n === 0 ? 'UP' : n === 1 ? 'DOWN' : `${n % 2 ? 'DOWN' : 'UP'}-${n}`}`,
      direction: n % 2 ? 'DOWN' : 'UP',
      headsign: t.to ?? stopList[stopList.length - 1].name,
      stopIds,
    };
    // A path with a gap would make tracking snap buses to the wrong place; straight lines are safer.
    if (path.length >= 2 && worstGapM <= 300) pattern.shape = simplify(path);
    else straightLines++;
    group.route.patterns.push(pattern);
  }

  const routes = [...groups.values()].map((g) => g.route);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const network: Network = {
    version: 1,
    updatedAt: new Date().toISOString(),
    region: opts.region,
    notice: `Imported from OpenStreetMap on ${today}. © OpenStreetMap contributors, available under the Open Database License (ODbL). Stops and road paths come from OpenStreetMap; first and last buses and frequencies are placeholders until they are surveyed.`,
    stops: stops.map(({ n: _n, ...s }) => ({ ...s, lat: Math.round(s.lat * 1e6) / 1e6, lng: Math.round(s.lng * 1e6) / 1e6 })),
    landmarks: [],
    routes,
  };
  return {
    network,
    report: {
      relations: relations.length,
      routes: routes.length,
      patterns: routes.reduce((sum, r) => sum + r.patterns.length, 0),
      stops: network.stops.length,
      skipped,
      straightLines,
      stopsMatched,
    },
  };
}

export function overpassQuery(opts: { network: string; area?: string; refs?: string[] }): string {
  const refFilter = opts.refs?.length ? `["ref"~"^(${opts.refs.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$"]` : '';
  const area = opts.area ? `area["name"="${opts.area.replace(/"/g, '')}"]["boundary"="administrative"]->.a;\n` : '';
  const inArea = opts.area ? '(area.a)' : '';
  return `[out:json][timeout:240];
${area}relation["type"="route"]["route"="bus"]["network"~"${opts.network.replace(/"/g, '')}",i]${refFilter}${inArea}->.r;
.r out body geom;
node(r.r);
out body;
way(r.r)->.w;
(node(around.w:30)["highway"="bus_stop"]["name"]; node(around.w:30)["public_transport"="platform"]["name"];);
out body;`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/import-osm.ts');
if (isMain) {
  const out = arg('out');
  if (!out) {
    console.error('Say where to write the network: --out data/osm-kolkata.json');
    process.exit(1);
  }
  const query = overpassQuery({ network: arg('network') ?? 'Kolkata|WBTC', area: arg('area'), refs: arg('refs')?.split(',').map((r) => r.trim()) });
  const endpoint = arg('overpass') ?? 'https://overpass-api.de/api/interpreter';
  console.log(`Asking ${endpoint} for bus routes…`);
  // Overpass asks every client to say who it is, and to back off when it is busy.
  let res: Response;
  for (let attempt = 0, waitS = 10; ; attempt++, waitS *= 2) {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'user-agent': 'where-is-my-bus-importer/0.1', accept: 'application/json' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(300_000),
    });
    if (![429, 502, 503, 504].includes(res.status) || attempt === 5) break;
    console.log(`  Overpass is busy (${res.status}); trying again in ${waitS} s.`);
    await new Promise((r) => setTimeout(r, waitS * 1000));
  }
  if (!res.ok) {
    console.error(`Overpass answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const { network, report } = fromOverpass((await res.json()) as OverpassJson, {
    region: arg('region') ?? 'Kolkata',
    firstBus: arg('first-bus'),
    lastBus: arg('last-bus'),
    headwayMin: arg('every') ? Number(arg('every')) : undefined,
  });
  const problems = validateNetwork(network);
  console.log(`${report.relations} route relations: ${report.routes} routes, ${report.patterns} directions, ${report.stops} stops.`);
  if (report.stopsMatched) console.log(`${report.stopsMatched} directions list no stops, so their stops are the named ones within 30 m of the road path: check them.`);
  if (report.straightLines) console.log(`${report.straightLines} directions have gaps in their road path, so they use straight lines between stops.`);
  if (report.skipped.length) console.log(`Skipped ${report.skipped.length}:\n  ${report.skipped.slice(0, 20).join('\n  ')}${report.skipped.length > 20 ? '\n  …' : ''}`);
  if (problems.length) {
    console.error(`The result has problems, so it was not written:\n- ${problems.slice(0, 20).join('\n- ')}`);
    process.exit(1);
  }
  await writeFile(out, `${JSON.stringify(network, null, 2)}\n`);
  console.log(`Written to ${out}. Check it in the admin panel ("Import and export") before riders see it.`);
}
