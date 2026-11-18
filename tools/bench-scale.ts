// How much one server process can carry, measured on a made-up city of the size the project must
// handle: 1,000 routes (two directions each, 40 stops, a road path of a point every 25 m), stops
// shared so that the busiest are on a hundred route directions or more, and 30 buses on every
// route sharing their position. It runs the real code of the server (core library, and the
// PostgreSQL network store when DATABASE_URL is set), without HTTP, and prints what each part costs.
//
//   node tools/bench-scale.ts                         1,000 routes, 30 buses each
//   node tools/bench-scale.ts --routes 2000 --buses 30
//   node --env-file=backend/.env tools/bench-scale.ts    also times the network in PostgreSQL
//   node tools/bench-scale.ts --write city.json          only writes the made-up network, for a
//                                                        server to load (DATA_FILE) and a load test
//
// HTTP itself (parsing, JSON, connections) costs more on top; tools/simulate.ts --load measures
// that against a running server.

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  createLiveEngine,
  haversine,
  plan,
  pointAlong,
  prepareNetwork,
  validateNetwork,
  type Network,
  type Ping,
  type Route,
  type Stop,
} from '../packages/core/src/index.ts';

const { values: args } = parseArgs({
  options: {
    routes: { type: 'string', default: '1000' },
    buses: { type: 'string', default: '30' },
    stops: { type: 'string', default: '40' },
    reads: { type: 'string', default: '20000' },
    write: { type: 'string' },
  },
});
const ROUTES = Number(args.routes);
const BUSES = Number(args.buses);
const STOPS_PER_ROUTE = Number(args.stops);

const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const heap = () => (globalThis.gc?.(), process.memoryUsage().heapUsed);
const line = (label: string, value: string) => console.log(`  ${label.padEnd(44)} ${value}`);

// ---- A made-up city: a grid of stops over Kolkata, routes walking across it ----

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

function makeCity(): Network {
  const side = Math.ceil(Math.sqrt(ROUTES * 8)); // about 8,000 stops for 1,000 routes
  const stops: Stop[] = [];
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) stops.push({ id: `s${i}-${j}`, name: `Stop ${i}-${j}`, lat: 22.45 + (i * 0.25) / side, lng: 88.28 + (j * 0.22) / side });
  }
  const at = (i: number, j: number) => stops[i * side + j];
  const routes: Route[] = [];
  for (let r = 0; r < ROUTES; r++) {
    // Most routes pass through the middle of the city, as they do: that is where stops get busy.
    let i = Math.floor(rand() * side);
    let j = rand() < 0.5 ? 0 : Math.floor(rand() * side);
    const path: Stop[] = [];
    const seen = new Set<string>();
    while (path.length < STOPS_PER_ROUTE) {
      const s = at(i, j);
      if (!seen.has(s.id)) {
        path.push(s);
        seen.add(s.id);
      }
      const towardsMiddle = rand() < 0.35;
      if (towardsMiddle) i += Math.sign(side / 2 - i) || 1;
      else if (rand() < 0.75) j = Math.min(side - 1, j + 1);
      else i = Math.min(side - 1, Math.max(0, i + (rand() < 0.5 ? -1 : 1)));
      if (j >= side - 1 && path.length < STOPS_PER_ROUTE) j = Math.max(0, j - 3);
    }
    const shapeOf = (list: Stop[]) => {
      const pts: [number, number][] = [];
      for (let k = 0; k + 1 < list.length; k++) {
        const a = list[k];
        const b = list[k + 1];
        const n = Math.max(1, Math.round(haversine(a, b) / 25));
        for (let t = 0; t < n; t++) pts.push([+(a.lat + ((b.lat - a.lat) * t) / n).toFixed(6), +(a.lng + ((b.lng - a.lng) * t) / n).toFixed(6)]);
      }
      const last = list[list.length - 1];
      pts.push([last.lat, last.lng]);
      return pts;
    };
    const ids = path.map((s) => s.id);
    routes.push({
      id: `r${r}`,
      number: String(r + 1),
      operator: 'private',
      firstBus: '05:00',
      lastBus: '23:00',
      defaultHeadwayMin: 8,
      patterns: [
        { id: `r${r}-UP`, direction: 'UP', headsign: path[path.length - 1].name, stopIds: ids, shape: shapeOf(path) },
        { id: `r${r}-DOWN`, direction: 'DOWN', headsign: path[0].name, stopIds: [...ids].reverse(), shape: shapeOf([...path].reverse()) },
      ],
    });
  }
  const used = new Set(routes.flatMap((r) => r.patterns.flatMap((p) => p.stopIds)));
  return { version: 1, updatedAt: new Date().toISOString(), region: 'Bench city', stops: stops.filter((s) => used.has(s.id)), routes };
}

if (args.write) {
  const { writeFile } = await import('node:fs/promises');
  const city = makeCity();
  await writeFile(args.write, JSON.stringify(city));
  console.log(`Wrote ${city.routes.length} routes and ${city.stops.length} stops to ${args.write}`);
  process.exit(0);
}

console.log(`\nA city of ${ROUTES} routes with ${BUSES} buses each\n`);

console.log('The network');
let t = performance.now();
const network = makeCity();
const json = JSON.stringify(network);
line('stops, route directions', `${network.stops.length}, ${ROUTES * 2}`);
line('size as JSON (what /api/network sends)', mb(json.length));
t = performance.now();
const problems = validateNetwork(network);
line('validate', `${ms(t)}${problems.length ? `, ${problems.length} problems: ${problems[0]}` : ''}`);
const before = heap();
t = performance.now();
const prepared = prepareNetwork(network);
line('prepare (on start and after each admin edit)', ms(t));
line('memory for the prepared network', mb(heap() - before));
t = performance.now();
structuredClone(network);
line('copy (each admin edit works on a copy)', ms(t));
const visits = [...prepared.visits.values()].map((v) => v.length).sort((a, b) => b - a);
line('route directions at the busiest stop', String(visits[0]));
line('route directions at the 100th busiest stop', String(visits[99] ?? 0));

// ---- Live buses ----

console.log('\nLive buses');
const live = createLiveEngine(() => prepared);
type Bus = { session: string; patternId: string; along: number; length: number; line: ReturnType<typeof prepared.patterns.get> };
const buses: Bus[] = [];
const start = Date.now() - 60_000;
t = performance.now();
for (const pp of prepared.patterns.values()) {
  const length = pp.stopAlong[pp.stopAlong.length - 1];
  for (let k = 0; k < BUSES / 2; k++) {
    const { sessionId } = live.startSession({ patternId: pp.id, role: 'conductor', plate: `WB${randomBytes(3).toString('hex')}` }, start);
    buses.push({ session: sessionId, patternId: pp.id, along: (length * (k + 0.5)) / (BUSES / 2), length, line: pp });
  }
}
line('buses sharing', `${buses.length} (started in ${ms(t)})`);

/** Each bus's next 10 s: two positions 5 s apart at 8 m/s, as a phone batches them. */
function batch(b: Bus, at: number): Ping[] {
  const pts: Ping[] = [];
  for (const dt of [5_000, 10_000]) {
    b.along = Math.min(b.length - 1, b.along + 40);
    pts.push({ ...pointAlong(b.line!.line, b.along), accuracy: 12, speed: 8, ts: at + dt });
  }
  return pts;
}

let clock = start;
const rounds = 3;
let worst = 0;
for (let round = 0; round < rounds; round++) {
  const at = clock;
  const payloads = buses.map((b) => batch(b, at));
  clock += 10_000;
  t = performance.now();
  let accepted = 0;
  for (const [k, b] of buses.entries()) accepted += live.ingest(b.session, payloads[k], clock).accepted;
  const took = performance.now() - t;
  worst = Math.max(worst, took);
  line(`round ${round + 1}: every bus sends 10 s of positions`, `${took.toFixed(0)} ms (${accepted} of ${buses.length * 2} accepted)`);
}
line('position batches a second, one process (ingest only)', `${Math.round(buses.length / (worst / 1000))}`);
line('needed: every bus every 10 s', `${Math.round(buses.length / 10)} a second`);
line('memory for live buses', mb(heap() - before));

// ---- Riders' questions ----

console.log("\nRiders' questions");
const busiest = [...prepared.visits.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 200).map(([id]) => id);
const anyStop = network.stops.map((s) => s.id);
const READS = Number(args.reads);
t = performance.now();
for (let k = 0; k < READS; k++) live.arrivals(anyStop[k % anyStop.length], clock);
let took = performance.now() - t;
line('arrivals at a stop, any stop', `${Math.round(READS / (took / 1000))} a second`);
t = performance.now();
for (let k = 0; k < READS; k++) live.arrivals(busiest[k % busiest.length], clock);
took = performance.now() - t;
line('arrivals at a stop, the 200 busiest', `${Math.round(READS / (took / 1000))} a second`);
t = performance.now();
const vehiclesReads = READS;
const patternIds = [...prepared.patterns.keys()];
for (let k = 0; k < vehiclesReads; k++) live.vehiclesOnPattern(patternIds[k % patternIds.length], clock);
took = performance.now() - t;
line('buses on a route direction (the map)', `${Math.round(vehiclesReads / (took / 1000))} a second`);
const plans = 200;
t = performance.now();
for (let k = 0; k < plans; k++) {
  const from = anyStop[(k * 7919) % anyStop.length];
  const to = anyStop[(k * 104729 + 13) % anyStop.length];
  plan(prepared, { kind: 'stop', stopId: from }, { kind: 'stop', stopId: to }, {});
}
took = performance.now() - t;
line('journeys planned', `${(plans / (took / 1000)).toFixed(0)} a second`);

// ---- The network in PostgreSQL ----

const DB_URL = process.env.DATABASE_URL;
if (DB_URL) {
  console.log('\nThe network in PostgreSQL');
  const { openDb } = await import('../backend/src/db.ts');
  const { pgNetworkStore } = await import('../backend/src/store.ts');
  const schema = `wimb_bench_${randomBytes(3).toString('hex')}`;
  const db = await openDb(DB_URL, schema);
  try {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(`${tmpdir()}/wimb-bench-`);
    await writeFile(`${dir}/network.json`, json);
    const store = pgNetworkStore(db, `${dir}/network.json`, `${dir}/network.json`);
    t = performance.now();
    const loaded = await store.load();
    line('first start: copy the whole network in', ms(t));
    const other = pgNetworkStore(db, `${dir}/network.json`, `${dir}/network.json`);
    t = performance.now();
    await other.load();
    line('a server starting: read it all', ms(t));
    // An admin edit: one route's road path changes.
    const next = structuredClone(loaded);
    next.routes[5].patterns[0].headsign = 'Changed';
    next.version = loaded.version + 1;
    t = performance.now();
    const outcome = await store.save(loaded, next);
    line('one route edited: save', `${ms(t)} (${outcome})`);
    t = performance.now();
    const fresh = await other.refresh(loaded);
    line('another server reads only what changed', `${ms(t)} (${fresh?.routes[5].patterns[0].headsign})`);
  } finally {
    await db.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.close();
  }
}
console.log('');
