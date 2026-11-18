// Simulated buses, sending positions through the real API the way conductors' and riders'
// phones do. For demos ("show me live buses"), end-to-end tests and load tests.
//
//   node tools/simulate.ts                                   two rider buses on every route direction
//   node tools/simulate.ts --patterns D2-UP --key <conductor key> --plate "WB 19 A 1234"
//                                                            a signed-in conductor's phone on one bus
//   node tools/simulate.ts --load 2000 --minutes 3 --reads 200   load test: 2,000 phones sharing,
//                                                            and 200 arrival or journey requests a second
//
// Load tests need TRUST_PROXY=1 on the server: each simulated phone sends its own address
// in x-forwarded-for, as phones on many mobile networks would.

import { pointAlong, prepareNetwork, type Network, type Ping, type PreparedNetwork } from '../packages/core/src/index.ts';

export type SimOptions = {
  url: string;
  /** Route directions to run; all of them when missing. */
  patterns?: string[];
  busesPerPattern?: number;
  /** Phones on each bus. With a conductor, the first one is the conductor's. */
  phonesPerBus?: number;
  /**
   * A conductor signed in (their key, from /api/accounts/sign-in) and the plate of one of their
   * owner's buses: every bus's first phone shares as that conductor, on that bus.
   */
  conductor?: { key: string; plate: string };
  /** Where the buses start, in metres along their route; spread along it when missing. */
  startAlongM?: number;
  speedMps?: number;
  tickS?: number;
  sendEveryS?: number;
  /** Send each phone's own address in x-forwarded-for (load tests, with TRUST_PROXY=1). */
  ownAddresses?: boolean;
  log?: (line: string) => void;
};

/** Each phone uploads at its own moment, as real ones do, not all in the same millisecond. */
type Phone = { sessionId: string; noiseM: number; queue: Ping[]; ip: string; nextSendAt: number };
type Bus = { patternId: string; along: number; speed: number; dwellUntil: number; nextStop: number; phones: Phone[] };

export type SimStats = {
  pingsSent: number;
  accepted: number;
  rejected: number;
  errors: number;
  /** Errors by HTTP status, or "network" when no answer came. */
  errorKinds: Record<string, number>;
  latenciesMs: number[];
};

const UA = { 'content-type': 'application/json', 'user-agent': 'wimb-simulator/0.1' };

function randomIp(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
}

/** A point `noiseM` metres or less from `p`, like a real GPS fix. */
function jitter(p: { lat: number; lng: number }, noiseM: number) {
  const r = noiseM * Math.sqrt(Math.random());
  const a = Math.random() * 2 * Math.PI;
  return { lat: p.lat + (r * Math.sin(a)) / 111_320, lng: p.lng + (r * Math.cos(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

async function post(url: string, body: unknown, ip?: string, key?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...UA, ...(ip ? { 'x-forwarded-for': ip } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

export async function loadNetwork(url: string): Promise<PreparedNetwork> {
  const res = await fetch(`${url}/api/network`, { headers: UA });
  if (!res.ok) throw new Error(`The server answered ${res.status} for the network.`);
  return prepareNetwork((await res.json()) as Network);
}

export async function startSimulation(opts: SimOptions) {
  const net = await loadNetwork(opts.url);
  const log = opts.log ?? (() => undefined);
  const tickS = opts.tickS ?? 10;
  const sendEveryS = opts.sendEveryS ?? 15;
  const meanSpeed = opts.speedMps ?? 5;
  const stats: SimStats = { pingsSent: 0, accepted: 0, rejected: 0, errors: 0, errorKinds: {}, latenciesMs: [] };
  const fail = (kind: string) => {
    stats.errors++;
    stats.errorKinds[kind] = (stats.errorKinds[kind] ?? 0) + 1;
  };
  const ids = opts.patterns ?? [...net.patterns.keys()];
  const buses: Bus[] = [];

  for (const patternId of ids) {
    const pp = net.patterns.get(patternId);
    if (!pp) throw new Error(`There is no route direction "${patternId}".`);
    const count = opts.busesPerPattern ?? 2;
    for (let b = 0; b < count; b++) {
      const along = opts.startAlongM ?? (pp.line.length * (b + 0.3)) / (count + 0.3);
      const phones: Phone[] = [];
      for (let k = 0; k < (opts.phonesPerBus ?? 1); k++) {
        const conductor = k === 0 ? opts.conductor : undefined;
        const ip = opts.ownAddresses ? randomIp() : undefined;
        const r = await post(
          `${opts.url}/api/trips`,
          conductor ? { patternId, role: 'conductor', plate: conductor.plate } : { patternId, role: 'rider' },
          ip,
          conductor?.key,
        );
        if (r.status !== 200) throw new Error(`Could not start a trip on ${patternId}: ${String(r.body.error ?? r.status)}`);
        phones.push({ sessionId: String(r.body.sessionId), noiseM: 4 + Math.random() * 8, queue: [], ip: ip ?? '', nextSendAt: Date.now() + Math.random() * sendEveryS * 1000 });
      }
      const nextStop = pp.stopAlong.findIndex((s) => s > along);
      buses.push({ patternId, along, speed: meanSpeed, dwellUntil: 0, nextStop: nextStop < 0 ? pp.stopAlong.length : nextStop, phones });
    }
  }
  log(`Started ${buses.length} buses with ${buses.reduce((n, b) => n + b.phones.length, 0)} phones on ${ids.length} route directions.`);

  function move(bus: Bus, now: number) {
    const pp = net.patterns.get(bus.patternId);
    if (!pp) return;
    if (now < bus.dwellUntil) return; // at a stop
    // Kolkata traffic: speed wanders, sometimes to a crawl.
    bus.speed = Math.min(12, Math.max(0.5, bus.speed + (Math.random() - 0.5) * 2 + (meanSpeed - bus.speed) * 0.2));
    bus.along = Math.min(pp.line.length, bus.along + bus.speed * tickS);
    if (bus.nextStop < pp.stopAlong.length && bus.along >= pp.stopAlong[bus.nextStop]) {
      bus.along = pp.stopAlong[bus.nextStop];
      bus.nextStop += 1;
      bus.dwellUntil = now + (10 + Math.random() * 20) * 1000;
    }
  }

  function fix(bus: Bus, now: number) {
    const pp = net.patterns.get(bus.patternId);
    if (!pp) return;
    const p = pointAlong(pp.line, bus.along);
    for (const phone of bus.phones) {
      phone.queue.push({ ...jitter(p, phone.noiseM), accuracy: Math.round(phone.noiseM * 1.5), speed: now < bus.dwellUntil ? 0 : bus.speed, ts: now });
    }
  }

  async function sendPhone(phone: Phone) {
    if (!phone.queue.length) return;
    const pings = phone.queue.splice(0, phone.queue.length);
    phone.nextSendAt = Date.now() + sendEveryS * 1000;
    const t0 = performance.now();
    try {
      const r = await post(`${opts.url}/api/trips/${phone.sessionId}/pings`, { pings, sentAt: Date.now() }, phone.ip || undefined);
      stats.latenciesMs.push(performance.now() - t0);
      stats.pingsSent += pings.length;
      if (r.status !== 200) fail(String(r.status));
      else {
        stats.accepted += Number(r.body.accepted ?? 0);
        stats.rejected += Number(r.body.rejected ?? 0);
      }
    } catch {
      fail('network');
    }
  }
  const send = (bus: Bus) => Promise.all(bus.phones.map(sendPhone));

  let running = true;
  for (const bus of buses) fix(bus, Date.now());
  // Positions are taken every tick; each phone uploads when its own moment comes round.
  const fixTimer = setInterval(() => {
    if (!running) return;
    const now = Date.now();
    for (const bus of buses) {
      move(bus, now);
      fix(bus, now);
    }
  }, tickS * 1000);
  const sendTimer = setInterval(() => {
    if (!running) return;
    const now = Date.now();
    for (const bus of buses) for (const phone of bus.phones) if (now >= phone.nextSendAt) void sendPhone(phone);
  }, 100);
  // The first positions go out at once, so the buses show up straight away.
  await Promise.all(buses.map(send));

  return {
    buses,
    stats,
    net,
    /** Moves every bus on by one tick and sends its positions now. */
    async tick() {
      for (const bus of buses) {
        move(bus, Date.now());
        fix(bus, Date.now());
      }
      await Promise.all(buses.map(send));
    },
    async stop() {
      running = false;
      clearInterval(fixTimer);
      clearInterval(sendTimer);
      await Promise.all(buses.flatMap((b) => b.phones.map((p) => post(`${opts.url}/api/trips/${p.sessionId}/end`, {}, p.ip || undefined).catch(() => undefined))));
    },
  };
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/** Many phones at once, while riders ask for arrivals and journeys at a steady rate. */
async function loadTest(url: string, phones: number, minutes: number, readsPerSecond: number) {
  const net = await loadNetwork(url);
  const patterns = [...net.patterns.keys()];
  const perPattern = Math.max(1, Math.round(phones / patterns.length));
  console.log(`Load test: ${perPattern * patterns.length} phones on ${patterns.length} route directions for ${minutes} min, ${readsPerSecond} reads a second.`);
  const t0 = performance.now();
  const sim = await startSimulation({ url, busesPerPattern: perPattern, ownAddresses: true, tickS: 10, sendEveryS: 15 });
  console.log(`  Trips started in ${Math.round(performance.now() - t0)} ms.`);
  const stopIds = [...net.stops.keys()];
  const reads: number[] = [];
  let readErrors = 0;
  const read = async () => {
    const a = stopIds[Math.floor(Math.random() * stopIds.length)];
    const b = stopIds[Math.floor(Math.random() * stopIds.length)];
    const path = Math.random() < 0.5 ? `/api/arrivals?stops=${a},${b}` : `/api/plan?from=stop:${a}&to=stop:${b}`;
    const s = performance.now();
    try {
      const r = await fetch(url + path, { headers: { ...UA, 'x-forwarded-for': randomIp() } });
      await r.arrayBuffer();
      if (r.ok) reads.push(performance.now() - s);
      else readErrors++;
    } catch {
      readErrors++;
    }
  };
  // A steady rate, whether or not earlier requests have been answered, as real riders behave.
  const pending: Promise<void>[] = [];
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    for (let i = 0; i < readsPerSecond / 10; i++) pending.push(read());
    await new Promise((r) => setTimeout(r, 100));
  }
  await Promise.all(pending);
  await sim.stop();
  const health = (await (await fetch(`${url}/api/health`)).json()) as Record<string, unknown>;
  const ms = (x: number) => `${x.toFixed(1)} ms`;
  const kinds = Object.entries(sim.stats.errorKinds).map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`  Position batches: ${sim.stats.latenciesMs.length}, ${sim.stats.pingsSent} positions, ${sim.stats.accepted} accepted, ${sim.stats.errors} errors${kinds ? ` (${kinds})` : ''}.`);
  console.log(`    p50 ${ms(percentile(sim.stats.latenciesMs, 50))}, p95 ${ms(percentile(sim.stats.latenciesMs, 95))}, p99 ${ms(percentile(sim.stats.latenciesMs, 99))}`);
  console.log(`  Arrivals and journeys: ${reads.length} answered, ${readErrors} errors, ${(reads.length / (minutes * 60)).toFixed(0)} a second.`);
  console.log(`    p50 ${ms(percentile(reads, 50))}, p95 ${ms(percentile(reads, 95))}, p99 ${ms(percentile(reads, 99))}`);
  console.log(`  Server after the test: ${JSON.stringify(health)}`);
  console.log('  These times are taken by this load generator and include its own delays. On one computer it is');
  console.log("  the bottleneck long before the server: check the server's CPU use, or time requests from another machine.");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/simulate.ts');
if (isMain) {
  const url = (arg('url') ?? 'http://localhost:8080').replace(/\/+$/, '');
  const load = arg('load');
  if (load) {
    await loadTest(url, Number(load), Number(arg('minutes') ?? 2), Number(arg('reads') ?? 200));
  } else {
    const sim = await startSimulation({
      url,
      patterns: arg('patterns')?.split(','),
      busesPerPattern: Number(arg('buses') ?? 2),
      phonesPerBus: Number(arg('phones') ?? 1),
      conductor: arg('key') ? { key: arg('key') as string, plate: arg('plate') ?? '' } : undefined,
      log: console.log,
    });
    console.log('Buses are moving. Open the app and plan a journey; press Ctrl+C to stop.');
    setInterval(() => {
      const s = sim.stats;
      console.log(`  ${s.pingsSent} positions sent, ${s.accepted} accepted, ${s.rejected} rejected, ${s.errors} errors`);
    }, 30_000);
    process.on('SIGINT', () => void sim.stop().then(() => process.exit(0)));
  }
}
