import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { after, test } from 'node:test';
import { prepareNetwork, type Network } from '../../packages/core/src/index.ts';
import { gtfsFiles, type GtfsOptions } from '../src/gtfs.ts';
import { startServer } from '../src/server.ts';
import { zip } from '../src/zip.ts';

// The GTFS feed: read back from the zip with a reader written here, then checked the way a feed
// validator would: every reference resolves, times only go forward, frequencies follow the route.

const here = path.dirname(fileURLToPath(import.meta.url));
const multimodal = (): Network => JSON.parse(readFileSync(path.resolve(here, '../../data/demo-multimodal.json'), 'utf8'));
const OPTS: GtfsOptions = { todayISO: '2026-10-28', url: 'https://bus.example.in' };

function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of the zip directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const packed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + packed));
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} checksum`);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  const [header, ...body] = rows;
  for (const r of body) assert.equal(r.length, header.length, `row ${r.join(',')}`);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function feed(net: Network, opts: Partial<GtfsOptions> = {}) {
  const files = unzip(zip(gtfsFiles(prepareNetwork(net), { ...OPTS, ...opts })));
  const table = (name: string) => (files.has(name) ? parseCsv(files.get(name)!) : []);
  return { files, table };
}

const seconds = (t: string) => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

test('the demo network as a GTFS feed that holds together', () => {
  const { files, table } = feed(multimodal());
  for (const name of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'frequencies.txt', 'calendar.txt', 'feed_info.txt', 'translations.txt']) {
    assert.ok(files.has(name), name);
  }
  const agencies = new Set(table('agency.txt').map((a) => a.agency_id));
  const stops = new Set(table('stops.txt').map((s) => s.stop_id));
  const routes = table('routes.txt');
  const routeIds = new Set(routes.map((r) => r.route_id));
  const services = new Set([...table('calendar.txt'), ...table('calendar_dates.txt')].map((c) => c.service_id));
  const shapes = new Set(table('shapes.txt').map((s) => s.shape_id));
  for (const r of routes) assert.ok(agencies.has(r.agency_id), `agency of ${r.route_id}`);
  assert.equal(routes.length, 9);

  const trips = table('trips.txt');
  const tripIds = new Set(trips.map((t) => t.trip_id));
  assert.equal(tripIds.size, trips.length, 'trip ids are unique');
  for (const t of trips) {
    assert.ok(routeIds.has(t.route_id), t.trip_id);
    assert.ok(services.has(t.service_id), t.trip_id);
    assert.ok(!t.shape_id || shapes.has(t.shape_id), t.trip_id);
    assert.match(t.direction_id, /^[01]$/);
  }

  // Each trip's stops in order, at times that never go back.
  const byTrip = new Map<string, Record<string, string>[]>();
  for (const st of table('stop_times.txt')) {
    assert.ok(stops.has(st.stop_id), st.stop_id);
    assert.ok(tripIds.has(st.trip_id), st.trip_id);
    byTrip.set(st.trip_id, [...(byTrip.get(st.trip_id) ?? []), st]);
  }
  assert.equal(byTrip.size, trips.length, 'every trip has stop times');
  for (const [tripId, list] of byTrip) {
    assert.ok(list.length >= 2, tripId);
    list.forEach((st, i) => {
      assert.equal(Number(st.stop_sequence), i + 1);
      assert.equal(st.arrival_time, st.departure_time);
      if (i > 0) {
        assert.ok(seconds(st.arrival_time) >= seconds(list[i - 1].arrival_time), `${tripId} goes back in time`);
        if (st.shape_dist_traveled) assert.ok(Number(st.shape_dist_traveled) >= Number(list[i - 1].shape_dist_traveled));
      }
    });
  }

  // Every trip runs at a frequency, starting when its template leaves the first stop.
  const freqs = table('frequencies.txt');
  for (const f of freqs) {
    assert.ok(tripIds.has(f.trip_id), f.trip_id);
    assert.ok(seconds(f.end_time) > seconds(f.start_time), f.trip_id);
    assert.ok(Number(f.headway_secs) > 0);
    assert.equal(f.exact_times, '0');
    assert.equal(byTrip.get(f.trip_id)![0].departure_time, f.start_time);
  }
  assert.equal(new Set(freqs.map((f) => f.trip_id)).size, trips.length);

  // The Metro and the ferry with their GTFS types and line colours; buses as buses.
  const route = (id: string) => routes.find((r) => r.route_id === id)!;
  assert.deepEqual([route('metro-blue').route_type, route('metro-blue').route_color, route('metro-blue').route_text_color], ['1', '1565C0', 'FFFFFF']);
  assert.equal(route('ferry-howrah').route_type, '4');
  assert.deepEqual([route('d2').route_type, route('d2').route_short_name, route('d2').route_color], ['3', 'D2', '']);

  // Calendars cover a year from today; Bengali names come as translations.
  assert.deepEqual(table('calendar.txt').map((c) => [c.service_id, c.start_date, c.end_date]), [['everyday', '20261028', '20271027']]);
  const info = table('feed_info.txt')[0];
  assert.deepEqual([info.feed_lang, info.feed_start_date, info.feed_end_date, info.feed_publisher_url], ['en', '20261028', '20271027', 'https://bus.example.in']);
  const esplanade = table('translations.txt').find((t) => t.record_id === 'esplanade');
  assert.deepEqual([esplanade?.table_name, esplanade?.field_name, esplanade?.language], ['stops', 'stop_name', 'bn']);
  assert.match(esplanade?.translation ?? '', /[ঀ-৿]/);
});

test('frequencies follow the busy hours and the 1 pm switch of direction', () => {
  const { table } = feed(multimodal());
  const freq = (prefix: string) =>
    table('frequencies.txt')
      .filter((f) => f.trip_id.startsWith(prefix))
      .map((f) => `${f.start_time.slice(0, 5)}-${f.end_time.slice(0, 5)}/${Number(f.headway_secs) / 60}`);
  // D1 runs 06:00 to 21:30, every 8 minutes at the busy hours and every 12 otherwise.
  assert.deepEqual(freq('D1-DOWN-'), ['06:00-08:00/12', '08:00-11:00/8', '11:00-17:00/12', '17:00-20:30/8', '20:30-21:31/12']);
  // Towards one end it takes a different road before and after 1 pm.
  assert.deepEqual(freq('D1-UP-AM-'), ['06:00-08:00/12', '08:00-11:00/8', '11:00-13:00/12']);
  assert.deepEqual(freq('D1-UP-PM-'), ['13:00-17:00/12', '17:00-20:30/8', '20:30-21:31/12']);
  assert.deepEqual(freq('D6-UP-'), ['06:30-21:31/12']);
});

test('service after midnight goes past 24:00', () => {
  const net = multimodal();
  const d6 = net.routes.find((r) => r.id === 'd6')!;
  Object.assign(d6, { firstBus: '22:00', lastBus: '01:30', headways: [{ from: '00:00', to: '05:00', minutes: 30 }] });
  const { table } = feed(net);
  const rows = table('frequencies.txt').filter((f) => f.trip_id.startsWith('D6-UP-'));
  assert.deepEqual(rows.map((f) => [f.trip_id, f.start_time, f.end_time, f.headway_secs]), [
    ['D6-UP-2200', '22:00:00', '24:00:00', '720'],
    ['D6-UP-2400', '24:00:00', '25:31:00', '1800'],
  ]);
  const last = table('stop_times.txt').filter((s) => s.trip_id === 'D6-UP-2400').at(-1)!;
  assert.ok(seconds(last.arrival_time) > 24 * 3600 + 20 * 60, last.arrival_time);
});

test('a diversion runs on its own dates and switches off the direction it replaces', () => {
  const net = multimodal();
  const d2 = net.routes.find((r) => r.id === 'd2')!;
  const up = d2.patterns.find((p) => p.id === 'D2-UP')!;
  const stopIds = up.stopIds.filter((_, i) => i !== 3);
  d2.patterns.push(
    { ...up, id: 'D2-UP-PUJA', stopIds, shape: undefined, replaces: 'D2-UP', validFrom: '2026-10-30', validTo: '2026-11-01' },
    // One that ended before the feed starts: no trips, and D2-UP is not switched off for it.
    { ...up, id: 'D2-UP-OLD', stopIds, shape: undefined, replaces: 'D2-UP', validFrom: '2026-10-01', validTo: '2026-10-05' },
  );
  const { table } = feed(net);
  const calendar = table('calendar.txt').map((c) => [c.service_id, c.start_date, c.end_date]);
  assert.deepEqual(calendar, [
    ['everyday', '20261028', '20271027'],
    ['days-D2-UP', '20261028', '20271027'],
    ['days-D2-UP-PUJA', '20261030', '20261101'],
  ]);
  assert.deepEqual(table('calendar_dates.txt').map((c) => [c.service_id, c.date, c.exception_type]), [
    ['days-D2-UP', '20261030', '2'],
    ['days-D2-UP', '20261031', '2'],
    ['days-D2-UP', '20261101', '2'],
  ]);
  const trips = table('trips.txt');
  assert.ok(trips.some((t) => t.trip_id.startsWith('D2-UP-PUJA-') && t.service_id === 'days-D2-UP-PUJA' && t.shape_id === ''));
  assert.ok(!trips.some((t) => t.trip_id.startsWith('D2-UP-OLD-')));
  const plainUp = trips.filter((t) => /^D2-UP-\d{4}$/.test(t.trip_id));
  assert.ok(plainUp.length >= 3 && plainUp.every((t) => t.service_id === 'days-D2-UP'));
});

test('drawn road paths become shapes, with distances along them', () => {
  const net = multimodal();
  const up = net.routes.find((r) => r.id === 'd2')!.patterns.find((p) => p.id === 'D2-UP')!;
  const pts = up.stopIds.map((id) => net.stops.find((s) => s.id === id)!);
  // Through a point beside the straight line between each pair of stops.
  up.shape = pts.flatMap((s, i): [number, number][] =>
    i === 0 ? [[s.lat, s.lng]] : [[(pts[i - 1].lat + s.lat) / 2, (pts[i - 1].lng + s.lng) / 2 + 0.0005], [s.lat, s.lng]],
  );
  const { table } = feed(net);
  const shape = table('shapes.txt').filter((s) => s.shape_id === 'D2-UP');
  assert.equal(shape.length, up.shape.length);
  shape.forEach((s, i) => {
    assert.equal(Number(s.shape_pt_sequence), i + 1);
    if (i > 0) assert.ok(Number(s.shape_dist_traveled) > Number(shape[i - 1].shape_dist_traveled));
  });
  const trip = table('trips.txt').find((t) => t.trip_id.startsWith('D2-UP-'))!;
  assert.equal(trip.shape_id, 'D2-UP');
  const st = table('stop_times.txt').filter((s) => s.trip_id === trip.trip_id);
  assert.equal(Number(st[0].shape_dist_traveled), 0);
  assert.ok(Math.abs(Number(st.at(-1)!.shape_dist_traveled) - Number(shape.at(-1)!.shape_dist_traveled)) < 1);
  // Directions without a drawn path have none.
  assert.equal(table('trips.txt').find((t) => t.trip_id.startsWith('D2-DOWN-'))!.shape_id, '');
});

test('learned stretch times set the stop times; elsewhere the usual speed', () => {
  const net = multimodal();
  const pp = prepareNetwork(net).patterns.get('D6-UP')!;
  const asked: number[] = [];
  const { table } = feed(net, {
    segmentSec: (patternId, seg, ts) => {
      if (patternId !== 'D6-UP' || seg !== 0) return undefined;
      asked.push(ts);
      return 600;
    },
  });
  const times = table('stop_times.txt').filter((s) => s.trip_id === 'D6-UP-0630');
  assert.equal(times[0].arrival_time, '06:30:00');
  assert.equal(times[1].arrival_time, '06:40:00');
  // The next stretch at 14 km/h plus 24 seconds at the stop.
  const usual = Math.round((pp.stopAlong[2] - pp.stopAlong[1]) / (14_000 / 3600) + 24);
  assert.equal(seconds(times[2].arrival_time) - seconds(times[1].arrival_time), usual);
  // Timed for the middle of the service, 14:00 Indian time, on a weekday.
  const ist = new Date(asked[0] + 330 * 60_000);
  assert.equal(ist.getUTCHours(), 14);
  assert.ok(ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5);
});

test('names with commas and quotes are quoted', () => {
  const net = multimodal();
  net.stops.find((s) => s.id === 'esplanade')!.name = 'Esplanade, "Dharmatala"';
  const { files, table } = feed(net);
  assert.ok(files.get('stops.txt')!.includes('"Esplanade, ""Dharmatala"""'));
  assert.equal(table('stops.txt').find((s) => s.stop_id === 'esplanade')?.stop_name, 'Esplanade, "Dharmatala"');
});

const dir = mkdtempSync(path.join(tmpdir(), 'wimb-gtfs-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('anyone can download the feed; it is sent again only when it changed', async () => {
  const s = await startServer({ port: 0, host: '127.0.0.1', dataFile: path.join(dir, 'network.json'), adminToken: 'x', quiet: true, publicUrl: 'https://bus.example.in/' });
  try {
    const url = `http://127.0.0.1:${s.port}/api/gtfs.zip`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="gtfs.zip"/);
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    const agency = parseCsv(files.get('agency.txt')!);
    assert.ok(agency.every((a) => a.agency_url === 'https://bus.example.in' && a.agency_timezone === 'Asia/Kolkata'));
    const version = ((await (await fetch(`http://127.0.0.1:${s.port}/api/network`)).json()) as Network).version;
    assert.equal(parseCsv(files.get('feed_info.txt')!)[0].feed_version, String(version));

    const again = await fetch(url, { headers: { 'if-none-match': res.headers.get('etag')! } });
    assert.equal(again.status, 304);

    // An admin change makes a new feed.
    const auth = { authorization: 'Bearer x', 'content-type': 'application/json' };
    const stop = { id: 'new-stop', name: 'New Stop', lat: 22.55, lng: 88.35 };
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/admin/stops/new-stop`, { method: 'PUT', headers: auth, body: JSON.stringify(stop) })).status, 200);
    const changed = await fetch(url, { headers: { 'if-none-match': res.headers.get('etag')! } });
    assert.equal(changed.status, 200);
    assert.equal(parseCsv(unzip(Buffer.from(await changed.arrayBuffer())).get('feed_info.txt')!)[0].feed_version, String(version + 1));
  } finally {
    await s.close();
  }
});

test('the credits the data’s licences require go into the feed', () => {
  const net = multimodal();
  assert.equal(feed(net).files.has('attributions.txt'), false, 'none without credits');
  net.attribution = [
    { text: 'Bus stops and routes © OpenStreetMap contributors, ODbL', url: 'https://www.openstreetmap.org/copyright' },
    { text: 'Operator information from Wikipedia (CC BY-SA 4.0)' },
  ];
  assert.deepEqual(
    feed(net).table('attributions.txt').map((r) => [r.organization_name, r.is_producer, r.attribution_url]),
    [
      ['Bus stops and routes © OpenStreetMap contributors, ODbL', '1', 'https://www.openstreetmap.org/copyright'],
      ['Operator information from Wikipedia (CC BY-SA 4.0)', '1', ''],
    ],
  );
});
