import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';
import {
  createLiveEngine,
  createReportBook,
  isISODate,
  istNow,
  isLat,
  isLng,
  liveEtasFrom,
  LiveError,
  parseClock,
  plan,
  prepareNetwork,
  search,
  validateNetwork,
  type Arrival,
  type Endpoint,
  type Network,
  type Pattern,
  type PreparedPattern,
  type Route,
  type Stop,
} from '../../packages/core/src/index.ts';
import { openCorrections, pgCorrectionStore } from './corrections.ts';
import { dbSecret, openDb, type Db } from './db.ts';
import { adminDashboard } from './admin-dashboard.ts';
import { busesNow, ownerOverview, syndicateOverview, tripsCsv } from './dashboard.ts';
import { createShareStore, redisShareStore, type ShareStore } from './follow.ts';
import {
  CORS_HEADERS,
  createFailureLimiter,
  createRateLimiter,
  createRouter,
  HANDLED,
  HttpError,
  readJson,
  sendJson,
  type Ctx,
} from './http.ts';
import { createOtpBook, indianMobile, logSender, redisOtpBook, webhookSender, type OtpBook, type SmsSender } from './otp.ts';
import { createPushHub } from './push.ts';
import { openLiveCluster, tidySharedTrips, type LiveCluster, type LiveEvent } from './live-cluster.ts';
import { ttlCache } from './cache.ts';
import {
  approved,
  loadSecret,
  loginOf,
  nameOf,
  openOwnerRegistry,
  pgRegistryStore,
  refOf,
  type Account,
  type AccountRef,
  type Bus,
  type Contributor,
  type Owner,
  type Person,
  type Syndicate,
} from './owners.ts';
import { hashPassword, makeTempPassword, passwordProblem, verifyPassword } from './passwords.ts';
import { openRecordings, pgRecordingStore } from './recordings.ts';
import { openRedis, type Kv } from './redis.ts';
import { redisReportBook, type ReportStore } from './rider-reports.ts';
import { gtfsFiles } from './gtfs.ts';
import { fileStore, openAccuracy, openTravelTimes, pgStore } from './learned.ts';
import { createStaticFiles, listFiles, type StaticFile } from './static.ts';
import { fileNetworkStore, pgNetworkStore, type NetworkStore } from './store.ts';
import { memoryTokens, redisTokens } from './tokens.ts';
import { dayOf, fileTripStore, leaderOnly, openTripLog, pgTripStore } from './triplog.ts';
import { zip } from './zip.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

// The rider web app runs only its own scripts and talks only to this server.
// Map tiles come from OpenStreetMap; Leaflet and everything else is served from here.
const RIDER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// The admin panel's fonts and map library come from this server too, like the rider app's.
// Its own style block and a few style attributes need 'unsafe-inline' for styles, not scripts.
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// The owner dashboard has the rider app's rules: only this server's scripts and styles (it uses
// the web app's copy of Leaflet), and map tiles.
const OWNER_CSP = RIDER_CSP;

// The sign-in page has no map: only this server's scripts, styles and images.
const SIGNIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PAGE_HEADERS: Record<string, string> = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  // OpenStreetMap asks map apps to send the page's origin with tile requests; nothing more is sent.
  'referrer-policy': 'strict-origin',
};

export type ServerOptions = {
  port?: number;
  host?: string;
  dataFile?: string;
  seedFile?: string;
  adminToken?: string;
  osrmUrl?: string;
  trustProxy?: boolean;
  quiet?: boolean;
  /** Folder of the rider web app. */
  webRoot?: string;
  /** Bus owners and their buses; next to the network file when missing. */
  ownersFile?: string;
  /** Owners' trips, one file per day; next to the network file when missing. */
  tripsDir?: string;
  tripHistoryDays?: number;
  /** Where riders reach this server, such as https://bus.example.in; used in the GTFS feed. */
  publicUrl?: string;
  /** Sends the codes for setting a new password; from SMS_WEBHOOK_URL (or SMS_TO_LOG) when missing. */
  sms?: SmsSender;
  /** The one-time codes, with their limits (otp.ts). */
  otp?: OtpBook;
  /**
   * PostgreSQL, such as postgres://wimb@localhost:5432/wimb (db.ts): the network, owners, trips,
   * recordings, suggestions and learned travel times are kept there instead of in files. Not read
   * from the environment here, so tests never touch a real database: the command line passes
   * DATABASE_URL in (see the end of this file).
   */
  databaseUrl?: string;
  /** The schema in that database; public when missing. */
  databaseSchema?: string;
  /** Redis, such as redis://localhost:6379 (redis.ts): codes, links, reports and messages between servers. */
  redisUrl?: string;
  /** Put before every Redis key; "wimb:" when missing. */
  redisPrefix?: string;
  /**
   * This server's name among several, the same after a restart: it marks the trips running on it
   * and the follow links of its live buses. The computer's name when missing.
   */
  serverId?: string;
  /** How long the leader's claim on the live buses lasts unless renewed (live-cluster.ts); 15 s when missing. */
  liveLeaseMs?: number;
  /** How often the live buses are tidied up; 30 s when missing. */
  sweepMs?: number;
  /** How long an answer about arrivals at a stop is reused; 1 s when missing, 0 for never. */
  arrivalsCacheMs?: number;
  /**
   * Take positions phones mark as simulated (core live.ts). Only for testing the app on a real
   * phone (e2e/android); there is deliberately no environment variable for it.
   */
  acceptMockLocations?: boolean;
};

const gzip = promisify(gzipCb);

type Obj = Record<string, unknown>;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function asObj(raw: unknown, what: string): Obj {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `Send the ${what} as a JSON object.`);
  return raw as Obj;
}

function checkId(id: string, what: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, `The ${what} id may only use letters, numbers, dots, dashes and underscores.`);
  return id;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).slice(0, max) : [];

function cleanStop(raw: unknown, id: string): Stop {
  const o = asObj(raw, 'stop');
  const stop: Stop = { id, name: str(o.name), lat: Number(o.lat), lng: Number(o.lng) };
  if (str(o.nameBn)) stop.nameBn = str(o.nameBn);
  const aliases = strList(o.aliases, 30);
  if (aliases.length) stop.aliases = aliases;
  return stop;
}

function cleanPattern(raw: unknown): Pattern {
  const o = asObj(raw, 'direction');
  const p: Pattern = {
    id: str(o.id),
    direction: o.direction === 'DOWN' ? 'DOWN' : 'UP',
    headsign: str(o.headsign),
    stopIds: strList(o.stopIds, 300),
  };
  if (Array.isArray(o.shape) && o.shape.length >= 2) {
    p.shape = o.shape.slice(0, 20_000).map((pt) => (Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [NaN, NaN])) as [number, number][];
  }
  if (Array.isArray(o.activeWindows) && o.activeWindows.length) {
    p.activeWindows = o.activeWindows.slice(0, 10).map((w) => {
      const x = asObj(w, 'running time');
      return { from: str(x.from), to: str(x.to) };
    });
  }
  if (str(o.validFrom)) p.validFrom = str(o.validFrom);
  if (str(o.validTo)) p.validTo = str(o.validTo);
  if (str(o.replaces)) p.replaces = str(o.replaces);
  if (!ID_RE.test(p.id)) throw new HttpError(400, 'Each direction needs an id made of letters, numbers, dots, dashes or underscores.');
  return p;
}

function cleanRoute(raw: unknown, id: string): Route {
  const o = asObj(raw, 'route');
  const route: Route = {
    id,
    number: str(o.number),
    operator: (['private', 'govt', 'mini', 'other'].includes(String(o.operator)) ? o.operator : 'other') as Route['operator'],
    firstBus: str(o.firstBus),
    lastBus: str(o.lastBus),
    defaultHeadwayMin: Number(o.defaultHeadwayMin),
    patterns: Array.isArray(o.patterns) ? o.patterns.slice(0, 20).map(cleanPattern) : [],
  };
  if (str(o.name)) route.name = str(o.name);
  // Buses when missing; validateNetwork refuses a mode or colour it does not know.
  if (str(o.mode) && str(o.mode) !== 'bus') route.mode = str(o.mode) as Route['mode'];
  if (str(o.color)) route.color = str(o.color) as Route['color'];
  if (Array.isArray(o.headways) && o.headways.length) {
    route.headways = o.headways.slice(0, 12).map((h) => {
      const x = asObj(h, 'frequency');
      return { from: str(x.from), to: str(x.to), minutes: Number(x.minutes) };
    });
  }
  return route;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export async function startServer(opts: ServerOptions = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8080);
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0';
  const dataFile = opts.dataFile ?? process.env.DATA_FILE ?? path.resolve(here, '../data/network.json');
  const seedFile = opts.seedFile ?? path.resolve(here, '../../data/demo-network.json');
  const osrmUrl = (opts.osrmUrl ?? process.env.OSRM_URL ?? '').replace(/\/+$/, '');
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const configuredToken = opts.adminToken ?? process.env.ADMIN_TOKEN ?? '';
  const publicUrl = (opts.publicUrl ?? process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\/[^/\s]+/.test(publicUrl)) throw new Error('PUBLIC_URL must be a web address such as https://bus.example.in.');
  const adminToken = configuredToken || randomBytes(18).toString('base64url');
  const log = opts.quiet ? () => undefined : console.log;

  const dataDir = path.dirname(dataFile);
  const serverId = opts.serverId ?? process.env.SERVER_ID ?? os.hostname();
  /** This process, to tell its own messages to other servers from theirs. */
  const instanceId = randomBytes(8).toString('hex');

  // PostgreSQL and Redis when set; otherwise files next to the network file, and memory. The files
  // there are copied into an empty database the first time, so moving a server over keeps its data.
  const db: Db | null = opts.databaseUrl ? await openDb(opts.databaseUrl, opts.databaseSchema ?? 'public') : null;
  let kv: Kv | null = null;
  try {
    kv = opts.redisUrl ? await openRedis(opts.redisUrl, opts.redisPrefix ?? 'wimb:') : null;
  } catch (e) {
    await db?.close();
    throw e;
  }

  const netStore: NetworkStore = db ? pgNetworkStore(db, dataFile, seedFile) : fileNetworkStore(dataFile, seedFile);
  let network: Network = await netStore.load();
  const problems = validateNetwork(network);
  if (problems.length) throw new Error(`The network in ${netStore.describe} has problems:\n- ${problems.join('\n- ')}`);
  let prepared = prepareNetwork(network);
  // Learned travel times feed arrival times and are learned from them; conductors' buses show how good they are.
  const learnedStore = <T>(name: string) => (db ? pgStore<T>(db, name, path.join(dataDir, `${name}.json`)) : fileStore<T>(path.join(dataDir, `${name}.json`)));
  const travel = await openTravelTimes(learnedStore('travel-times'));
  const accuracy = await openAccuracy(learnedStore('accuracy'));
  /** Live buses on every server, kept the same through Redis (live-cluster.ts); set up below. */
  let cluster: LiveCluster | null = null;
  const live = createLiveEngine(() => prepared, { acceptMockLocations: opts.acceptMockLocations === true }, {
    newId: () => cluster?.newId() ?? randomUUID(),
    segmentSec: travel.model.segmentSec,
    onSegment: (patternId, seg, startTs, seconds) => void travel.model.record(patternId, seg, startTs, seconds),
    onPrediction: (r) => accuracy.add(r),
  });
  const reports: ReportStore = kv ? redisReportBook(kv, () => prepared) : createReportBook(() => prepared);
  let savedLearnedAt = Date.now();

  /** Tells the other servers that owners or the network changed, so they read them again. */
  function announce(kind: 'owners') {
    void kv?.publish('events', JSON.stringify({ kind, from: instanceId })).catch((e: unknown) => console.error('Could not tell other servers of a change:', e));
  }

  const ownersFile = opts.ownersFile ?? process.env.OWNERS_FILE ?? path.join(dataDir, 'owners.json');
  const owners = await openOwnerRegistry(db ? pgRegistryStore(db, ownersFile) : ownersFile, {
    phoneSecret: db ? await dbSecret(db, 'phone-secret', path.join(dataDir, 'secret.key')) : await loadSecret(path.join(dataDir, 'secret.key')),
    onSaved: () => announce('owners'),
  });
  // A forgotten password is set again with a code by SMS only where an SMS gateway is set up (otp.ts).
  const smsUrl = process.env.SMS_WEBHOOK_URL ?? '';
  const sms: SmsSender | null =
    opts.sms ?? (smsUrl ? webhookSender(smsUrl, process.env.SMS_WEBHOOK_TOKEN) : process.env.SMS_TO_LOG === '1' ? logSender(console.log) : null);
  const otp: OtpBook = opts.otp ?? (kv ? redisOtpBook(kv) : createOtpBook());
  const keepDays = opts.tripHistoryDays ?? (Number(process.env.TRIP_HISTORY_DAYS) || 90);
  const tripsDir = opts.tripsDir ?? process.env.TRIPS_DIR ?? path.join(dataDir, 'trips');
  // With Redis every server keeps the same trips in memory and the leader saves them, so running
  // trips belong to all the servers together, not to one.
  const tripStore = db ? await pgTripStore(db, kv ? 'cluster' : serverId, tripsDir) : await fileTripStore(tripsDir);
  const tripLog = await openTripLog({
    store: leaderOnly(tripStore, () => cluster?.isLeader() ?? true),
    keepDays,
    getNet: () => prepared,
  });
  if (!kv) await tripLog.sweep(Date.now(), live.hasSession);
  const recordingsDir = path.join(dataDir, 'recordings');
  const recordings = await openRecordings(db ? await pgRecordingStore(db, recordingsDir) : recordingsDir);
  const correctionsFile = path.join(dataDir, 'corrections.json');
  const corrections = await openCorrections(db ? await pgCorrectionStore(db, correctionsFile) : correctionsFile, {
    route: (id) => prepared.routes.has(id),
    stop: (id) => prepared.stops.has(id),
  });
  const shares: ShareStore = kv ? redisShareStore(kv, () => cluster?.isLeader() ?? false) : createShareStore();
  /** After signing in with a temporary password: one change of password, within 15 minutes. */
  const changeTokens = kv ? redisTokens<AccountRef>(kv, 'pwchange', 15 * 60_000) : memoryTokens<AccountRef>(15 * 60_000);
  const push = createPushHub();

  /**
   * Something on this topic changed: this server's streams showing it get a snapshot soon
   * (push.ts). Every server applies every live event, so each tells its own streams.
   */
  const changed = (topic: string) => push.changed(topic);

  // Admin edits are applied one at a time, validated, saved, then swapped in. `change` may run
  // twice: when another server saved the network first, it runs again on what that server saved.
  let writeQueue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(run, run);
    writeQueue = result.catch(() => undefined);
    return result;
  }
  async function refreshNetwork() {
    const fresh = await netStore.refresh(network);
    if (!fresh) return;
    network = fresh;
    prepared = prepareNetwork(fresh);
  }
  function mutate(change: (draft: Network) => void): Promise<{ version: number }> {
    return enqueue(async () => {
      for (let attempt = 1; ; attempt++) {
        const draft = structuredClone(network);
        change(draft);
        const errors = validateNetwork(draft);
        if (errors.length) throw new HttpError(400, 'The change was not saved because the network would have problems.', errors);
        draft.version = network.version + 1;
        draft.updatedAt = new Date().toISOString();
        if ((await netStore.save(network, draft)) === 'conflict') {
          if (attempt >= 3) throw new HttpError(409, 'The network was changed elsewhere at the same time. Try again.');
          await refreshNetwork();
          continue;
        }
        network = draft;
        prepared = prepareNetwork(draft);
        // Other servers read it at this point among the live events, so their buses match.
        if (kv) void cluster?.submit({ t: 'network', version: draft.version }).catch((e: unknown) => console.error('Could not tell other servers of the new network:', e));
        return { version: draft.version };
      }
    });
  }

  if (kv) {
    await kv.subscribe('events', (message) => {
      const { kind, from } = JSON.parse(message) as { kind: string; from: string };
      if (from === instanceId) return;
      if (kind === 'owners') void owners.reload().catch((e: unknown) => console.error('Could not read owners again:', e));
    });
  }

  /**
   * One live event, applied to this server's live buses and trips (live-cluster.ts). It must
   * depend only on the event and the ones before it, so it uses the event's time, never the clock.
   */
  function applyLive(ev: LiveEvent): unknown {
    switch (ev.t) {
      case 'start': {
        if (live.hasSession(ev.id)) return { sessionId: ev.id };
        const started = live.startSession({ patternId: ev.patternId, role: ev.role, plate: ev.plate, busId: ev.bus?.id }, ev.now, ev.id);
        if (ev.bus) tripLog.start(ev.id, ev.bus, ev.patternId, ev.now);
        return started;
      }
      case 'pings': {
        const result = live.ingest(ev.id, ev.pings, ev.now);
        tripLog.update(ev.id, result, ev.now);
        if (result.accepted) pushMoved(live.sessionInfo(ev.id)?.patternId, tripLog.ownerOf(ev.id));
        return result;
      }
      case 'end': {
        const patternId = live.sessionInfo(ev.id)?.patternId;
        const ownerId = tripLog.ownerOf(ev.id);
        const ended = live.endSession(ev.id);
        tripLog.endSession(ev.id, ev.now);
        pushMoved(patternId, ownerId);
        return { ended };
      }
      case 'dropBus':
        tripLog.dropBus(ev.busId, ev.now);
        return undefined;
      case 'tick':
        live.sweep(ev.now);
        live.notePredictions(ev.now);
        // Its changes in memory happen now, in order; saving them (the leader's) follows.
        void tripLog.sweep(ev.now, live.hasSession);
        return undefined;
      case 'network':
        return network.version < ev.version ? enqueue(refreshNetwork) : undefined;
    }
  }
  cluster = await openLiveCluster({ kv, instanceId, apply: applyLive, leaseMs: opts.liveLeaseMs, log });
  const liveCluster = cluster;

  const sweeper = setInterval(() => {
    const leader = liveCluster.isLeader();
    const fail = (what: string) => (e: unknown) => console.error(`Could not ${what}:`, e);
    if (leader) {
      void liveCluster.submit({ t: 'tick', now: Date.now() }).catch(fail('tidy the live buses'));
      void Promise.resolve(shares.sweep(live)).catch(fail('tidy follow links'));
      if (kv) void tidySharedTrips(kv, live.hasSession).catch(fail('tidy the list of shared trips'));
    }
    void Promise.resolve(otp.sweep()).catch(() => undefined);
    changeTokens.sweep();
    if (leader && Date.now() - savedLearnedAt > 5 * 60_000) {
      savedLearnedAt = Date.now();
      void travel.save().catch(fail('save travel times'));
      void accuracy.save().catch(fail('save the accuracy report'));
    }
  }, opts.sweepMs ?? 30_000);
  sweeper.unref();

  /**
   * Arrivals at a stop, reused for a moment. Riders ask about the same stops over and over (a city
   * has a few thousand), so with many riders this caps the work at about one answer per stop per
   * second, however many ask. Buses report every 10 s, so a second old is as good as new.
   */
  const arrivalsCacheMs = opts.arrivalsCacheMs ?? 1_000;
  const liveArrivalsCache = ttlCache<Arrival[]>(arrivalsCacheMs, 20_000);
  const liveArrivals = (stopId: string, now = Date.now()) => liveArrivalsCache.get(`${network.version}|${stopId}`, () => live.arrivals(stopId, now));
  /** Journeys asked for again within 15 s (for now) or 5 minutes (for a time) get the same answer. */
  const planCache = ttlCache<unknown>(0, 5_000);

  const tripStartLimit = createRateLimiter(300, 60_000); // per IP address
  const pingLimit = createRateLimiter(40, 60_000); // per trip
  const readLimit = createRateLimiter(1200, 60_000); // per IP address
  const reportLimit = createRateLimiter(20, 10 * 60_000); // per IP address
  const suggestLimit = createRateLimiter(10, 10 * 60_000); // per IP address
  const gtfsLimit = createRateLimiter(30, 10 * 60_000); // per IP address
  const smsLimit = createRateLimiter(10, 3600_000); // per IP address; each phone has its own limits too (otp.ts)
  const wrongPhoneCodes = createFailureLimiter(20, 15 * 60_000); // per IP address
  const wrongPasswords = createFailureLimiter(20, 15 * 60_000); // per IP address
  const wrongPasswordsForPhone = createFailureLimiter(10, 15 * 60_000); // per mobile number, against guessing from many addresses
  const signUpLimit = createRateLimiter(10, 3600_000); // per IP address

  function requireAdmin(ctx: Ctx) {
    const header = ctx.req.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    const expected = Buffer.from(adminToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'The admin token is missing or wrong.');
    }
  }

  const bearerOf = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  };
  const bearer = (ctx: Ctx) => bearerOf(ctx.req);

  /** The owner, or one of their managers, signed in with this key. */
  function requireOwner(ctx: Ctx): { owner: Owner; person: Person } {
    const who = owners.signIn(bearer(ctx));
    if (!who) {
      if (owners.syndicateByKey(bearer(ctx))) throw new HttpError(403, 'A syndicate’s account only shows its buses; owners make changes.');
      throw new HttpError(401, 'The sign-in key is missing or wrong.');
    }
    if (who.person.role === 'conductor') throw new HttpError(403, CONDUCTOR_ONLY);
    return who;
  }

  const CONDUCTOR_ONLY = 'A conductor’s account is for sharing the owner’s buses. The owner and managers see the dashboard.';

  /** A contributor signed in, approved: they record routes (recordings.ts). */
  function requireContributor(ctx: Ctx): Contributor {
    const account = owners.accountByKey(bearer(ctx));
    if (!account) throw new HttpError(401, 'The sign-in key is missing or wrong.');
    if (account.kind !== 'contributor') throw new HttpError(403, 'Only contributors record routes. Sign up as a contributor first.');
    return account.contributor;
  }

  /** Only the owner manages who else signs in for them. */
  function requireMainOwner(ctx: Ctx): { owner: Owner; person: Person } {
    const who = requireOwner(ctx);
    if (who.person.role !== 'owner') throw new HttpError(403, 'Only the owner adds and removes people.');
    return who;
  }

  /** An owner's or a manager's view, or a syndicate's read-only one. */
  function requireViewer(ctx: Ctx): { owner: Owner; person: Person } | { syndicate: Syndicate } {
    const key = bearer(ctx);
    const who = owners.signIn(key);
    if (who?.person.role === 'conductor') throw new HttpError(403, CONDUCTOR_ONLY);
    if (who) return who;
    const syndicate = owners.syndicateByKey(key);
    if (syndicate) return { syndicate };
    throw new HttpError(401, 'The sign-in key is missing or wrong.');
  }

  /** A phone number from a request, as +91 and ten digits. */
  function phoneOf(raw: unknown): string {
    const phone = indianMobile(raw);
    if (!phone) throw new HttpError(400, 'Type a 10-digit Indian mobile number, for example 98300 12345.');
    return phone;
  }

  /** The one-time code sent to that phone, checked; it is spent by the caller once used. */
  async function checkOtp(ip: string, phone: string, code: unknown) {
    if (wrongPhoneCodes.blocked(ip)) throw new HttpError(429, 'Too many wrong codes from this network. Try again in 15 minutes.');
    const result = await otp.check(phone, code);
    if (result === 'ok') return;
    if (result === 'wrong') {
      wrongPhoneCodes.fail(ip);
      throw new HttpError(400, 'That code is not right. Check the SMS and try again.');
    }
    throw new HttpError(400, 'That code has run out, or was typed wrong too often. Ask for a new one.');
  }

  /** A new password, checked against the rules (passwords.ts); its hash. */
  async function newPasswordHash(raw: unknown, phone?: string): Promise<string> {
    const problem = passwordProblem(raw, phone);
    if (problem) throw new HttpError(400, problem);
    return hashPassword(raw as string);
  }

  /** For the admin to give someone: it only lets them choose their own. */
  async function tempPassword() {
    const password = makeTempPassword();
    return { password, passwordHash: await hashPassword(password) };
  }

  function parseEndpoint(raw: string | null, name: string): Endpoint {
    if (!raw) throw new HttpError(400, `Add "${name}" as stop:<id> or <lat>,<lng>.`);
    if (raw.startsWith('stop:')) {
      const stopId = raw.slice(5);
      if (!prepared.stops.has(stopId)) throw new HttpError(404, `There is no stop with id "${stopId}".`);
      return { kind: 'stop', stopId };
    }
    const [lat, lng] = raw.split(',').map(Number);
    if (!isLat(lat) || !isLng(lng)) throw new HttpError(400, `"${name}" must be stop:<id> or <lat>,<lng>.`);
    return { kind: 'point', lat, lng };
  }

  const router = createRouter();

  // ---- Rider web app ----

  const webRoot = path.resolve(opts.webRoot ?? path.resolve(here, '../../web'));
  const coreRoot = path.resolve(here, '../../packages/core/src');
  const webFiles = createStaticFiles(webRoot);
  const coreFiles = createStaticFiles(coreRoot);
  const publicFiles = createStaticFiles(path.resolve(here, '../public'));

  function sendFile(ctx: Ctx, file: StaticFile | null, headers: Record<string, string> = {}) {
    if (!file) throw new HttpError(404, 'Not found.');
    const common = { etag: file.etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...headers };
    if (ctx.req.headers['if-none-match'] === file.etag) {
      ctx.res.writeHead(304, common);
      ctx.res.end();
    } else {
      ctx.res.writeHead(200, { 'content-type': file.type, ...common });
      ctx.res.end(file.body);
    }
    return HANDLED;
  }

  /** The service worker, with the list of files to keep for offline use and a version that changes with them. */
  async function serviceWorker(): Promise<StaticFile | null> {
    const template = await webFiles('sw.js');
    if (!template) return null;
    const web = (await listFiles(webRoot)).filter((f) => f !== 'sw.js' && f !== 'index.html' && f !== 'manifest.webmanifest');
    const core = await listFiles(coreRoot);
    const files = await Promise.all([webFiles('index.html'), ...web.map(webFiles), ...core.map(coreFiles)]);
    const version = createHash('sha1').update(files.map((f) => f?.etag ?? '').join()).digest('base64url').slice(0, 12);
    const assets = ['/', '/manifest.webmanifest', ...web.map((f) => `/web/${f}`), ...core.map((f) => `/packages/core/src/${f}`)];
    const body = String(template.body).replace('/*ASSETS*/[]', JSON.stringify(assets)).replace('/*VERSION*/', version);
    return { body, type: template.type, etag: `"${version}"` };
  }

  router.get('/', async (ctx) =>
    sendFile(ctx, await webFiles('index.html'), { ...PAGE_HEADERS, 'content-security-policy': RIDER_CSP }),
  );
  router.get('/manifest.webmanifest', async (ctx) => sendFile(ctx, await webFiles('manifest.webmanifest')));
  router.get('/sw.js', async (ctx) => sendFile(ctx, await serviceWorker()));
  router.get('/web/*', async (ctx) => sendFile(ctx, await webFiles(ctx.params.rest)));
  router.get('/packages/core/src/:file', async (ctx) => sendFile(ctx, await coreFiles(ctx.params.file)));

  router.get('/api/health', () => ({
    ok: true,
    networkVersion: network.version,
    storage: { database: db ? 'postgresql' : 'files', shared: kv ? 'redis' : 'memory' },
    live: { server: serverId, leader: liveCluster.isLeader(), ready: liveCluster.ready() },
    ...live.stats(),
  }));

  // The app keeps a full copy for offline planning and asks for it again only when it changed.
  // A city's network is tens of MB as JSON: it is made into text once per version, and compressed
  // once (to about a tenth) for every phone that accepts gzip, instead of again for each request.
  let networkBody: { version: number; json: Buffer; gz: Promise<Buffer> } | null = null;
  router.get('/api/network', async ({ req, res, url }) => {
    const etag = `"v${network.version}"`;
    if (Number(url.searchParams.get('since')) === network.version || req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, ...CORS_HEADERS });
      res.end();
      return HANDLED;
    }
    if (networkBody?.version !== network.version) {
      const json = Buffer.from(JSON.stringify(network));
      const gz = gzip(json, { level: 6 });
      gz.catch(() => undefined);
      networkBody = { version: network.version, json, gz };
    }
    const body = networkBody;
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', etag, vary: 'accept-encoding', ...CORS_HEADERS };
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip' });
      res.end(await body.gz);
    } else {
      res.writeHead(200, headers);
      res.end(body.json);
    }
    return HANDLED;
  });

  router.get('/api/search', ({ url, ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    const q = url.searchParams.get('q') ?? '';
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 8));
    return {
      results: search(prepared.searchIndex, q, limit).map((h) => ({
        ...h.place,
        score: Math.round(h.score * 100) / 100,
        matched: h.matched,
      })),
    };
  });

  router.get('/api/plan', ({ url, ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    const from = parseEndpoint(url.searchParams.get('from'), 'from');
    const to = parseEndpoint(url.searchParams.get('to'), 'to');
    const time = url.searchParams.get('time');
    const date = url.searchParams.get('date');
    let minuteOfDay: number | undefined;
    if (time) {
      try {
        minuteOfDay = parseClock(time);
      } catch {
        throw new HttpError(400, '"time" must be HH:MM.');
      }
    }
    if (date && !isISODate(date)) throw new HttpError(400, '"date" must be YYYY-MM-DD.');
    const forNow = !time && !date;
    // Learning a new stretch changes the answer; finer learning within one waits for the next.
    const key = `${network.version}|${travel.model.learnedCount()}|${url.searchParams.get('from')}|${url.searchParams.get('to')}|${time ?? ''}|${date ?? ''}`;
    return planCache.get(key, () => planNow(), forNow ? 15_000 : 5 * 60_000);

    function planNow() {
    // The planner asks about one route direction at one stop at a time, at hundreds of stops for
    // one journey: only that direction's buses are looked at, not the stop's hundred others.
    const liveEtas = (patternId: string, stopId: string) =>
      liveEtasFrom(() => liveArrivalsCache.get(`${network.version}|${stopId}|${patternId}`, () => live.arrivals(stopId, Date.now(), new Set([patternId]))))(patternId, stopId);
    // Live waits only make sense when planning for now.
    // Learned travel times for the hour being planned (now, or the time asked for).
    const at = time || date ? Date.parse(`${date ?? istNow().dateISO}T${time ?? '12:00'}:00+05:30`) : Date.now();
    const busMps = 14 / 3.6;
    const rideTimeMin = (pp: PreparedPattern, fromPos: number, toPos: number) =>
      travel.model.rideMin(pp, fromPos, toPos, at, (seg) => (pp.stopAlong[seg + 1] - pp.stopAlong[seg]) / busMps + (seg > fromPos ? 24 : 0));
    return plan(prepared, from, to, {
      minuteOfDay,
      dateISO: date ?? undefined,
      liveEtas: forNow ? liveEtas : undefined,
      // Where conductors cover nearly every bus of a route, a late tracked bus sets the wait.
      coverage: forNow ? (id) => live.coverage(id) : undefined,
      rideTimeMin,
    });
    }
  });

  router.get('/api/arrivals', async ({ url, ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    const ids = (url.searchParams.get('stops') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    if (!ids.length) throw new HttpError(400, 'Add "stops" as a comma-separated list of stop ids.');
    const now = Date.now();
    const arrivals: Record<string, Arrival[]> = {};
    for (const id of ids) {
      if (!prepared.stops.has(id)) {
        arrivals[id] = [];
        continue;
      }
      const tracked = liveArrivals(id, now);
      // What riders reported, unless a tracked bus of that route comes at about the same time:
      // that is most likely the same bus, and it is better known.
      const reported = (await reports.arrivals(id, now)).filter((r) => !tracked.some((a) => a.live && a.patternId === r.patternId && Math.abs(a.etaMin - r.etaMin) <= 3));
      arrivals[id] = [...tracked, ...reported];
    }
    return { at: now, arrivals };
  });

  // Riders suggest fixes; admins review them (corrections.ts).
  router.post('/api/corrections', async ({ req, ip }) => {
    if (!suggestLimit(ip)) throw new HttpError(429, 'Too many suggestions from this network. Try again in a few minutes.');
    const body = asObj(await readJson(req, 4_000), 'suggestion');
    const c = await corrections.add({ kind: body.kind, text: body.text, routeId: body.routeId, stopId: body.stopId });
    return { id: c.id };
  });

  // "Route X just passed this stop", from people who keep location off (core reports.ts).
  router.post('/api/reports', async ({ req, ip }) => {
    if (!reportLimit(ip)) throw new HttpError(429, 'Too many reports from this network. Try again in a few minutes.');
    const body = asObj(await readJson(req, 1_000), 'report');
    const patternId = typeof body.patternId === 'string' ? body.patternId : '';
    const stopId = typeof body.stopId === 'string' ? body.stopId : '';
    // People are told apart by their phone's own random id and their network, never by who they are.
    const device = typeof body.device === 'string' ? body.device.slice(0, 64) : '';
    const reporter = createHash('sha256').update(`${ip}|${device}`).digest('base64url').slice(0, 16);
    const out = await reports.add({ patternId, stopId, reporter });
    if (out === 'unknown') throw new HttpError(400, 'Reports are for a bus passing a stop on its route, before its last stop.');
    if (out === 'repeat') return { accepted: false, agreed: false, repeat: true };
    // A tracked bus right at that stop agrees as well.
    const pp = prepared.patterns.get(patternId);
    const stopAlong = pp ? pp.stopAlong[pp.pattern.stopIds.indexOf(stopId)] : 0;
    const tracked = live.vehiclesOnPattern(patternId).some((v) => Math.abs(v.alongM - stopAlong) <= 300);
    return { accepted: true, agreed: out.agreed || tracked, repeat: false };
  });

  router.get('/api/patterns/:id/vehicles', ({ params, ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    if (!prepared.patterns.has(params.id)) throw new HttpError(404, 'There is no route direction with that id.');
    return { patternId: params.id, at: Date.now(), vehicles: live.vehiclesOnPattern(params.id) };
  });

  // The same, pushed to the page as buses move (push.ts): for the map of a journey.
  router.get('/api/live', ({ req, res, url, ip }) => {
    const ids = [...new Set((url.searchParams.get('patterns') ?? '').split(',').filter(Boolean))];
    if (!ids.length || ids.length > 12) throw new HttpError(400, 'Add "patterns": 1 to 12 route direction ids, comma-separated.');
    for (const id of ids) if (!prepared.patterns.has(id)) throw new HttpError(404, `There is no route direction with id "${id}".`);
    if (!push.canOpen(ip)) throw new HttpError(429, 'Too many live connections from this network.');
    push.open(req, res, ip, 'vehicles', ids.map((id) => `pattern:${id}`), () => ({
      at: Date.now(),
      vehicles: ids.flatMap((id) => live.vehiclesOnPattern(id)),
    }));
    return HANDLED;
  });

  /** Tells the pages showing this phone's bus that it moved. */
  function pushMoved(patternId?: string, ownerId?: string) {
    if (patternId) changed(`pattern:${patternId}`);
    if (ownerId) changed(`owner:${ownerId}`);
  }

  router.post('/api/trips', async ({ req, ip }) => {
    if (!tripStartLimit(ip)) throw new HttpError(429, 'Too many trips started from this network. Try again in a minute.');
    const body = asObj(await readJson(req, 4_000), 'trip');
    if (typeof body.patternId !== 'string') throw new HttpError(400, 'Say which route direction you are on ("patternId").');
    // Conductor phones are trusted more, so the role needs a conductor signed in (or their owner,
    // or a manager), sharing one of their owner's buses, given by its number plate. The bus's trips
    // are kept for the owner.
    let bus: Bus | undefined;
    const isConductor = body.role === 'conductor';
    if (isConductor) {
      const who = owners.signIn(bearerOf(req));
      if (!who) throw new HttpError(401, 'Sign in as a conductor to share a bus as its conductor.');
      if (typeof body.plate !== 'string' || !body.plate.trim()) throw new HttpError(400, 'Type the bus’s number plate, for example WB 19 A 1234.');
      bus = owners.busByPlate(who.owner.id, body.plate);
      if (!bus) {
        throw new HttpError(400, `None of ${who.owner.name}’s buses has the number plate “${body.plate.trim()}”. Check the plate, or ask your owner to add the bus.`);
      }
    }
    const started = (await liveCluster.submit({
      t: 'start',
      id: randomUUID(),
      patternId: body.patternId,
      role: isConductor ? 'conductor' : 'rider',
      // A registered bus is told apart by its id, and by its own plate whatever was typed.
      plate: bus ? bus.plate : typeof body.plate === 'string' ? body.plate : undefined,
      // Only what the trip log needs.
      bus: bus ? { id: bus.id, ownerId: bus.ownerId, plate: bus.plate } : undefined,
      now: Date.now(),
    })) as { sessionId: string };
    if (!bus) return { ...started, role: 'rider' };
    // The conductor is told who sees this bus's trips.
    return { ...started, role: 'conductor', bus: { plate: bus.plate, owner: owners.owner(bus.ownerId)?.name ?? '' } };
  });

  router.post('/api/trips/:id/pings', async ({ req, params }) => {
    if (!pingLimit(params.id)) throw new HttpError(429, 'Sending too often. Send locations in batches every 10 seconds or more.');
    const body = asObj(await readJson(req, 64_000), 'locations');
    if (!Array.isArray(body.pings) || body.pings.length === 0 || body.pings.length > 120) {
      throw new HttpError(400, 'Send between 1 and 120 locations in "pings".');
    }
    // A phone with a wrong clock would have every position rejected as old or as a repeat.
    // When it says what its clock read as it sent them ("sentAt", same clock as "ts"),
    // its positions are moved onto the server's clock. Only when they fit that clock, though:
    // positions newer than sentAt, or far older, were not timed by it and are left alone.
    const now = Date.now();
    const sentAt = typeof body.sentAt === 'number' && Number.isFinite(body.sentAt) ? body.sentAt : now;
    const onSenderClock = body.pings.every((p: unknown) => {
      const ts = (p as { ts?: unknown } | null)?.ts;
      return typeof ts !== 'number' || (ts <= sentAt + 5_000 && ts >= sentAt - 15 * 60_000);
    });
    const shift = onSenderClock && Math.abs(now - sentAt) > 2_000 ? now - sentAt : 0;
    const pings = shift
      ? body.pings.map((p: unknown) => {
        const q = p as { ts?: unknown };
        return q && typeof q === 'object' && typeof q.ts === 'number' ? { ...q, ts: q.ts + shift } : p;
      })
      : body.pings;
    // A trip nobody shares is refused here, before it costs every server anything.
    if (!live.hasSession(params.id)) throw new LiveError('unknown_session', 'This trip has ended.');
    return liveCluster.submit({ t: 'pings', id: params.id, pings, now });
  });

  router.post('/api/trips/:id/end', async ({ params }) => {
    const out = (await liveCluster.submit({ t: 'end', id: params.id, now: Date.now() })) as { ended: boolean };
    await shares.endSession(params.id);
    return out;
  });

  // A link for family to follow the bus. Only the phone sharing the trip has its id.
  router.post('/api/trips/:id/share', async ({ req, params, ip }) => {
    if (!tripStartLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    const info = live.sessionInfo(params.id);
    if (!info) throw new HttpError(404, 'This trip has ended.');
    const body = asObj(await readJson(req, 1_000), 'link');
    return await shares.create(params.id, info.patternId, prepared, body.destStopId);
  });

  router.get('/api/follow/:token', async ({ params, ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    return await shares.view(params.token, live, prepared);
  });

  router.get('/follow/:token', async (ctx) =>
    sendFile(ctx, await publicFiles('follow.html'), { ...PAGE_HEADERS, 'content-security-policy': OWNER_CSP }),
  );
  router.get('/follow.js', async (ctx) => sendFile(ctx, await publicFiles('follow.js')));

  // ---- Admin ----

  // The admin script is a separate file so the page's policy can refuse every inline script.
  router.get('/admin', async (ctx) =>
    sendFile(ctx, await publicFiles('admin.html'), {
      ...PAGE_HEADERS,
      'cache-control': 'no-store',
      'content-security-policy': ADMIN_CSP,
    }),
  );
  router.get('/admin.js', async (ctx) => sendFile(ctx, await publicFiles('admin.js'), { 'cache-control': 'no-store' }));

  router.get('/api/admin/whoami', (ctx) => {
    requireAdmin(ctx);
    return { ok: true, roadSnapping: osrmUrl !== '' };
  });

  router.put('/api/admin/stops/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = checkId(ctx.params.id, 'stop');
    const stop = cleanStop(await readJson(ctx.req, 50_000), id);
    return mutate((draft) => {
      const i = draft.stops.findIndex((s) => s.id === id);
      if (i >= 0) draft.stops[i] = stop;
      else draft.stops.push(stop);
    });
  });

  router.delete('/api/admin/stops/:id', (ctx) => {
    requireAdmin(ctx);
    const id = ctx.params.id;
    const usedBy = network.routes.filter((r) => r.patterns.some((p) => p.stopIds.includes(id))).map((r) => r.number);
    if (usedBy.length) {
      throw new HttpError(409, `Route ${usedBy.join(', ')} still uses this stop. Remove it from those routes first.`, usedBy);
    }
    return mutate((draft) => {
      const before = draft.stops.length;
      draft.stops = draft.stops.filter((s) => s.id !== id);
      if (draft.stops.length === before) throw new HttpError(404, 'There is no stop with that id.');
    });
  });

  router.put('/api/admin/routes/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = checkId(ctx.params.id, 'route');
    const route = cleanRoute(await readJson(ctx.req, 5_000_000), id);
    return mutate((draft) => {
      const i = draft.routes.findIndex((r) => r.id === id);
      if (i >= 0) draft.routes[i] = route;
      else draft.routes.push(route);
    });
  });

  router.delete('/api/admin/routes/:id', (ctx) => {
    requireAdmin(ctx);
    const id = ctx.params.id;
    return mutate((draft) => {
      const before = draft.routes.length;
      draft.routes = draft.routes.filter((r) => r.id !== id);
      if (draft.routes.length === before) throw new HttpError(404, 'There is no route with that id.');
    });
  });

  // Replace everything, e.g. importing a file exported earlier.
  router.put('/api/admin/network', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 50_000_000), 'network') as unknown as Network;
    return mutate((draft) => {
      draft.region = typeof body.region === 'string' && body.region.trim() ? body.region.trim() : draft.region;
      draft.notice = typeof body.notice === 'string' ? body.notice : undefined;
      // The credits the data's licences require come with it, and stay (validateNetwork checks them).
      draft.attribution = Array.isArray(body.attribution)
        ? body.attribution.slice(0, 20).map((a) => {
            const x = asObj(a, 'credit');
            return typeof x.url === 'string' && x.url.trim() ? { text: str(x.text), url: str(x.url) } : { text: str(x.text) };
          })
        : undefined;
      draft.stops = Array.isArray(body.stops) ? body.stops.map((s) => cleanStop(s, checkId(String(asObj(s, 'stop').id ?? ''), 'stop'))) : [];
      draft.landmarks = Array.isArray(body.landmarks)
        ? body.landmarks.map((l) => cleanStop(l, checkId(String(asObj(l, 'landmark').id ?? ''), 'landmark')))
        : [];
      draft.routes = Array.isArray(body.routes)
        ? body.routes.map((r) => cleanRoute(r, checkId(String(asObj(r, 'route').id ?? ''), 'route')))
        : [];
    });
  });

  // The network as a GTFS feed for journey planners and map apps (gtfs.ts). It changes with the
  // network, the date and the learned travel times, so it is built again once a day or on a change.
  let gtfsCache: { etag: string; body: Buffer } | null = null;
  router.get('/api/gtfs.zip', ({ req, res, ip }) => {
    if (!gtfsLimit(ip)) throw new HttpError(429, 'Too many downloads from this network. Try again in a few minutes.');
    const todayISO = istNow().dateISO;
    const etag = `"gtfs-${network.version}-${todayISO}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, ...CORS_HEADERS });
      res.end();
      return HANDLED;
    }
    if (gtfsCache?.etag !== etag) {
      const address = server.address();
      const url = publicUrl || `http://localhost:${typeof address === 'object' && address ? address.port : port}`;
      gtfsCache = { etag, body: zip(gtfsFiles(prepared, { todayISO, url, segmentSec: travel.model.segmentSec })) };
    }
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="gtfs.zip"',
      'cache-control': 'no-cache',
      etag,
      ...CORS_HEADERS,
    });
    res.end(gtfsCache.body);
    return HANDLED;
  });

  // The learned stretches for this hour, so the apps plan with them offline too.
  router.get('/api/travel-times', ({ ip }) => {
    if (!readLimit(ip)) throw new HttpError(429, 'Too many requests from this network. Try again in a minute.');
    return travel.model.table(prepared, Date.now());
  });

  router.get('/api/admin/accuracy', (ctx) => {
    requireAdmin(ctx);
    return { days: 7, routes: accuracy.report(prepared), learnedStretchHours: travel.model.learnedCount() };
  });

  // The admin panel's dashboard: the network, buses on the road, owners, today's trips, what to look at.
  router.get('/api/admin/dashboard', async (ctx) => {
    requireAdmin(ctx);
    return adminDashboard({ net: prepared, live, owners, log: tripLog, corrections, accuracy, learnedStretchHours: travel.model.learnedCount() });
  });

  router.get('/api/admin/alerts', (ctx) => {
    requireAdmin(ctx);
    return { diversions: live.possibleDiversions() };
  });

  // Record-route mode (recordings.ts): staff ride a route once; the path and the halts are checked
  // here, then applied to a route direction.
  router.get('/api/admin/recordings', async (ctx) => {
    requireAdmin(ctx);
    return { recordings: await recordings.list() };
  });
  router.post('/api/admin/recordings', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 1_000), 'recording');
    return { recording: await recordings.create(body.name) };
  });
  router.get('/api/admin/recordings/:id', async (ctx) => {
    requireAdmin(ctx);
    const { points, ...rest } = await recordings.get(ctx.params.id);
    return { recording: { ...rest, pointCount: points.length } };
  });
  router.post('/api/admin/recordings/:id/points', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 64_000), 'positions');
    return recordings.addPoints(ctx.params.id, body.points);
  });
  router.post('/api/admin/recordings/:id/finish', async (ctx) => {
    requireAdmin(ctx);
    const { points, ...rest } = await recordings.finish(ctx.params.id, prepared);
    return { recording: { ...rest, pointCount: points.length } };
  });
  router.delete('/api/admin/recordings/:id', async (ctx) => {
    requireAdmin(ctx);
    return recordings.remove(ctx.params.id);
  });
  // The recording's path becomes a direction's road path; with `stops`, its halts become the
  // direction's stops in order: a stop already there when one is close, otherwise a new one to name.
  router.post('/api/admin/recordings/:id/apply', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'use');
    const rec = await recordings.get(ctx.params.id);
    if (!rec.path || !rec.halts) throw new HttpError(409, 'Finish the recording first.');
    const recPath = rec.path;
    const halts = rec.halts;
    let added = 0;
    const out = await mutate((draft) => {
      added = 0; // the change may run again on a fresher network
      const route = draft.routes.find((r) => r.id === body.routeId);
      const pattern = route?.patterns.find((p) => p.id === body.patternId);
      if (!route || !pattern) throw new HttpError(404, 'There is no such route direction.');
      pattern.shape = recPath;
      if (body.stops === true) {
        const ids: string[] = [];
        const taken = new Set(draft.stops.map((s) => s.id));
        for (const halt of halts) {
          let id = halt.stop?.id;
          if (!id) {
            let n = 1;
            while (taken.has(`recorded-${rec.id.slice(2)}-${n}`)) n++;
            id = `recorded-${rec.id.slice(2)}-${n}`;
            taken.add(id);
            // A stop the contributor marked and named keeps that name; the admins can change it.
            draft.stops.push({ id, name: halt.name ?? `New stop ${n} (from ${rec.name})`, lat: halt.lat, lng: halt.lng });
            added++;
          }
          if (ids[ids.length - 1] !== id) ids.push(id);
        }
        if (ids.length < 2) throw new HttpError(400, 'The recording has fewer than two halts, so it cannot set the stops.');
        pattern.stopIds = ids;
      }
    });
    return { ...out, newStops: added };
  });

  // Contributors: people who record routes from buses in the phone app. The admin approves them.
  const contributorForAdmin = (x: Contributor) => ({
    id: x.id,
    name: x.name,
    pending: x.pending === true,
    createdAt: x.createdAt,
    ...loginForAdmin(x),
  });
  router.get('/api/admin/contributors', async (ctx) => {
    requireAdmin(ctx);
    const counts = new Map<string, number>();
    for (const r of await recordings.list()) if (r.by) counts.set(r.by.contributorId, (counts.get(r.by.contributorId) ?? 0) + 1);
    return { contributors: owners.contributors().map((x) => ({ ...contributorForAdmin(x), recordings: counts.get(x.id) ?? 0 })) };
  });
  router.post('/api/admin/contributors/:id/approve', async (ctx) => {
    requireAdmin(ctx);
    return { contributor: contributorForAdmin(await owners.approveContributor(ctx.params.id)) };
  });
  router.post('/api/admin/contributors/:id/password', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 1_000), 'password');
    const phone = body.phone === undefined || body.phone === '' ? undefined : phoneOf(body.phone);
    const { password, passwordHash } = await tempPassword();
    await owners.setPassword({ contributorId: ctx.params.id }, passwordHash, { temp: true, signIn: false, phone });
    return { password };
  });
  router.delete('/api/admin/contributors/:id', async (ctx) => {
    requireAdmin(ctx);
    return owners.removeContributor(ctx.params.id);
  });

  // ---- Contributors recording a route from inside a bus (the phone app) ----

  const recordingView = (r: { points: unknown[] } & Record<string, unknown>) => {
    const { points, path: _path, ...rest } = r;
    return { ...rest, pointCount: points.length };
  };
  router.get('/api/contributor/recordings', async (ctx) => {
    const me = requireContributor(ctx);
    return { recordings: await recordings.list(me.id) };
  });
  router.post('/api/contributor/recordings', async (ctx) => {
    const me = requireContributor(ctx);
    const body = asObj(await readJson(ctx.req, 1_000), 'recording');
    return { recording: await recordings.create(body.name, Date.now(), { contributorId: me.id, name: me.name }) };
  });
  router.post('/api/contributor/recordings/:id/points', async (ctx) => {
    const me = requireContributor(ctx);
    const body = asObj(await readJson(ctx.req, 64_000), 'positions');
    await recordings.own(ctx.params.id, me.id);
    return recordings.addPoints(ctx.params.id, body.points);
  });
  router.post('/api/contributor/recordings/:id/marks', async (ctx) => {
    const me = requireContributor(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'stop');
    await recordings.own(ctx.params.id, me.id);
    return recordings.addMark(ctx.params.id, body);
  });
  router.post('/api/contributor/recordings/:id/finish', async (ctx) => {
    const me = requireContributor(ctx);
    await recordings.own(ctx.params.id, me.id);
    return { recording: recordingView(await recordings.finish(ctx.params.id, prepared)) };
  });
  router.delete('/api/contributor/recordings/:id', async (ctx) => {
    const me = requireContributor(ctx);
    const r = await recordings.own(ctx.params.id, me.id);
    if (r.finishedAt) throw new HttpError(409, 'A finished recording waits for the team; they remove it once checked.');
    return recordings.remove(ctx.params.id);
  });

  router.get('/api/admin/corrections', async (ctx) => {
    requireAdmin(ctx);
    return { corrections: await corrections.list(ctx.url.searchParams.get('status') ?? undefined), counts: await corrections.counts() };
  });

  router.put('/api/admin/corrections/:id', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'review');
    return { correction: await corrections.review(ctx.params.id, { status: body.status, note: body.note }) };
  });

  // Draws the road path between stops using an OSRM server you run on OpenStreetMap data.
  router.post('/api/admin/snap', async (ctx) => {
    requireAdmin(ctx);
    if (!osrmUrl) throw new HttpError(501, 'Road snapping is off. Set OSRM_URL to your OSRM server to turn it on.');
    const body = asObj(await readJson(ctx.req, 200_000), 'points');
    const points = (Array.isArray(body.points) ? body.points : []).filter(
      (p): p is [number, number] => Array.isArray(p) && isLat(p[0]) && isLng(p[1]),
    );
    if (points.length < 2 || points.length > 100) throw new HttpError(400, 'Send between 2 and 100 stop positions.');
    const coords = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
    let data: { code?: string; routes?: { geometry?: { coordinates?: [number, number][] } }[] };
    try {
      const r = await fetch(`${osrmUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new HttpError(502, `The road-snapping server answered ${r.status}.`);
      data = (await r.json()) as typeof data;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'Could not reach the road-snapping server.');
    }
    const line = data.routes?.[0]?.geometry?.coordinates;
    if (data.code !== 'Ok' || !line?.length) throw new HttpError(502, 'The road-snapping server found no road between these stops.');
    return { shape: line.map(([lng, lat]) => [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]) };
  });

  // Admins add bus owners and send each a sign-in link, or check owners who signed up with their
  // phone; owners add their own buses.
  /** How someone signs in, for the admin: their number in full, to check who they are. */
  const loginForAdmin = (l: Person | Syndicate | Contributor) => ({
    phone: l.phone ?? null,
    phoneEnd: l.phoneEnd ?? null,
    password: l.passwordHash ? (l.tempPassword ? 'temporary' : 'set') : 'none',
    devices: l.keyHashes.length,
  });
  const ownerForAdmin = (o: Owner) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    pending: o.pending === true,
    people: o.people.map((p) => ({ id: p.id, name: p.name, role: p.role, pending: p.pending === true, ...loginForAdmin(p) })),
    buses: owners.buses(o.id).map((b) => ({ id: b.id, plate: b.plate, label: b.label ?? null })),
  });

  router.post('/api/admin/owners/:id/approve', async (ctx) => {
    requireAdmin(ctx);
    return { owner: ownerForAdmin(await owners.approveOwner(ctx.params.id)) };
  });

  // An owner's staff signed up with the owner's number: the admin approves them, or turns them down.
  router.post('/api/admin/owners/:id/people/:personId/approve', async (ctx) => {
    requireAdmin(ctx);
    return { owner: ownerForAdmin((await owners.approvePerson(ctx.params.id, ctx.params.personId)).owner) };
  });

  router.delete('/api/admin/owners/:id/people/:personId', async (ctx) => {
    requireAdmin(ctx);
    return owners.removePerson(ctx.params.id, ctx.params.personId);
  });

  // A forgotten password: a temporary one, shown once, for the admin to give them. Their devices are signed out.
  router.post('/api/admin/owners/:id/people/:personId/password', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 1_000), 'password');
    const phone = body.phone === undefined || body.phone === '' ? undefined : phoneOf(body.phone);
    const { password, passwordHash } = await tempPassword();
    await owners.setPassword({ ownerId: ctx.params.id, personId: ctx.params.personId }, passwordHash, { temp: true, signIn: false, phone });
    return { password };
  });

  // Route syndicates: a read-only link showing their members' buses on their routes.
  const syndicateForAdmin = (s: Syndicate) => ({
    id: s.id,
    name: s.name,
    routeIds: s.routeIds,
    ownerIds: s.ownerIds,
    contactName: s.contactName ?? null,
    pending: s.pending === true,
    ...loginForAdmin(s),
    createdAt: s.createdAt,
  });
  async function syndicateInput(ctx: Ctx) {
    const body = asObj(await readJson(ctx.req, 8_000), 'syndicate');
    const ids = (v: unknown, what: string) => {
      if (!Array.isArray(v) || !v.length || v.length > 200 || v.some((x) => typeof x !== 'string')) throw new HttpError(400, `Choose at least one ${what}.`);
      return v as string[];
    };
    const routeIds = ids(body.routeIds, 'route');
    for (const id of routeIds) if (!prepared.routes.has(id)) throw new HttpError(400, `There is no route with id "${id}".`);
    return { name: body.name, routeIds, ownerIds: ids(body.ownerIds, 'bus owner'), contactName: body.contactName, phone: body.phone };
  }

  router.get('/api/admin/syndicates', (ctx) => {
    requireAdmin(ctx);
    return { syndicates: owners.syndicates().map(syndicateForAdmin) };
  });

  // Added by the admin: approved at once, and its contact signs in with a temporary password.
  router.post('/api/admin/syndicates', async (ctx) => {
    requireAdmin(ctx);
    const input = await syndicateInput(ctx);
    const phone = phoneOf(input.phone);
    const { password, passwordHash } = await tempPassword();
    const syndicate = await owners.addSyndicate({ ...input, phone, passwordHash });
    return { syndicate: syndicateForAdmin(syndicate), password };
  });

  // A syndicate that signed up: the admin chooses its routes and members, and approves it.
  router.post('/api/admin/syndicates/:id/approve', async (ctx) => {
    requireAdmin(ctx);
    return { syndicate: syndicateForAdmin(await owners.updateSyndicate(ctx.params.id, await syndicateInput(ctx), { approve: true })) };
  });

  router.put('/api/admin/syndicates/:id', async (ctx) => {
    requireAdmin(ctx);
    return { syndicate: syndicateForAdmin(await owners.updateSyndicate(ctx.params.id, await syndicateInput(ctx))) };
  });

  router.post('/api/admin/syndicates/:id/password', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 1_000), 'password');
    const phone = body.phone === undefined || body.phone === '' ? undefined : phoneOf(body.phone);
    const { password, passwordHash } = await tempPassword();
    await owners.setPassword({ syndicateId: ctx.params.id }, passwordHash, { temp: true, signIn: false, phone });
    return { password };
  });

  router.delete('/api/admin/syndicates/:id', async (ctx) => {
    requireAdmin(ctx);
    return owners.removeSyndicate(ctx.params.id);
  });

  router.get('/api/admin/owners', (ctx) => {
    requireAdmin(ctx);
    return { owners: owners.owners().map(ownerForAdmin) };
  });

  // Added by the admin: approved at once, and the owner signs in with a temporary password.
  router.post('/api/admin/owners', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'owner');
    const phone = phoneOf(body.phone);
    const { password, passwordHash } = await tempPassword();
    return { owner: ownerForAdmin(await owners.addOwner(body.name, phone, passwordHash)), password };
  });

  router.put('/api/admin/owners/:id', async (ctx) => {
    requireAdmin(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'owner');
    return { owner: ownerForAdmin(await owners.renameOwner(ctx.params.id, body.name)) };
  });

  router.delete('/api/admin/owners/:id', async (ctx) => {
    requireAdmin(ctx);
    const { removedBuses } = await owners.removeOwner(ctx.params.id);
    for (const id of removedBuses) await liveCluster.submit({ t: 'dropBus', busId: id, now: Date.now() });
    return { removed: ctx.params.id };
  });

  // ---- Bus owners ----

  router.get('/owner', async (ctx) =>
    sendFile(ctx, await publicFiles('owner.html'), { ...PAGE_HEADERS, 'content-security-policy': OWNER_CSP }),
  );
  router.get('/owner.js', async (ctx) => sendFile(ctx, await publicFiles('owner.js')));
  router.get('/owner.css', async (ctx) => sendFile(ctx, await publicFiles('owner.css')));
  router.get('/owner-bn.js', async (ctx) => sendFile(ctx, await publicFiles('owner-bn.js')));
  // Only for showing alerts as notifications on phones (owner-sw.js).
  router.get('/owner/sw.js', async (ctx) => sendFile(ctx, await publicFiles('owner-sw.js')));

  router.get('/api/owner/overview', async (ctx) => {
    const viewer = requireViewer(ctx);
    const date = ctx.url.searchParams.get('date') ?? dayOf(Date.now());
    if (!isISODate(date)) throw new HttpError(400, '"date" must be YYYY-MM-DD.');
    const deps = { owners, log: tripLog, live, net: prepared };
    const view = 'syndicate' in viewer ? await syndicateOverview(deps, viewer.syndicate, date) : await ownerOverview(deps, viewer.owner, viewer.person, date);
    return { ...view, keepDays };
  });

  // Where the buses are, pushed as they move (push.ts), between the page's full updates. With a
  // fetch stream, not EventSource, because it carries the sign-in key in its header. A replaced
  // key ends the stream at its next update.
  router.get('/api/owner/live', (ctx) => {
    const viewer = requireViewer(ctx);
    if (!push.canOpen(ctx.ip)) throw new HttpError(429, 'Too many live connections from this network.');
    const key = bearer(ctx);
    const scope =
      'syndicate' in viewer
        ? { ownerIds: viewer.syndicate.ownerIds, routeIds: new Set(viewer.syndicate.routeIds) }
        : { ownerIds: [viewer.owner.id] };
    push.open(ctx.req, ctx.res, ctx.ip, 'buses', scope.ownerIds.map((id) => `owner:${id}`), () => {
      if (!owners.signIn(key) && !owners.syndicateByKey(key)) return null;
      return { at: Date.now(), buses: busesNow({ owners, log: tripLog, live, net: prepared }, scope) };
    });
    return HANDLED;
  });

  // ---- Signing in on /signin: a mobile number and a password (passwords.ts) ----

  router.get('/signin', async (ctx) =>
    sendFile(ctx, await publicFiles('signin.html'), { ...PAGE_HEADERS, 'content-security-policy': SIGNIN_CSP }),
  );
  router.get('/signin.js', async (ctx) => sendFile(ctx, await publicFiles('signin.js')));

  router.get('/api/accounts/options', () => ({ sms: sms !== null }));

  // Bus owners, their staff and route syndicates sign up here, and wait for the admin.
  router.post('/api/accounts/sign-up', async ({ req, ip }) => {
    if (!signUpLimit(ip)) throw new HttpError(429, 'Too many accounts made from this network. Try again in an hour.');
    const body = asObj(await readJson(req, 2_000), 'account');
    const kind = body.kind;
    if (kind !== 'owner' && kind !== 'manager' && kind !== 'conductor' && kind !== 'syndicate' && kind !== 'contributor') {
      throw new HttpError(400, 'Choose who you are: a bus owner, an owner’s manager or conductor, a route syndicate or a contributor.');
    }
    const phone = phoneOf(body.phone);
    const staff = kind === 'manager' || kind === 'conductor';
    const ownerPhone = staff ? indianMobile(body.ownerPhone) : null;
    if (staff && !ownerPhone) throw new HttpError(400, 'Type your bus owner’s 10-digit mobile number.');
    const passwordHash = await newPasswordHash(body.password, phone);
    const made = await owners.signUp({ kind, name: body.name, orgName: body.orgName, phone, passwordHash, ownerPhone: ownerPhone ?? undefined });
    return { pending: true, ...made, phoneEnd: phone.slice(-4) };
  });

  router.post('/api/accounts/sign-in', async ({ req, ip }) => {
    const body = asObj(await readJson(req, 1_000), 'sign-in');
    const phone = phoneOf(body.phone);
    if (wrongPasswords.blocked(ip) || wrongPasswordsForPhone.blocked(phone)) {
      throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, then try again.');
    }
    const account = owners.account(phone);
    // A number without an account is checked against a stand-in, so the answer takes as long.
    const right = await verifyPassword(typeof body.password === 'string' ? body.password : '', account ? loginOf(account).passwordHash : undefined);
    if (!right || !account) {
      wrongPasswords.fail(ip);
      wrongPasswordsForPhone.fail(phone);
      throw new HttpError(401, 'The mobile number or the password is not right.');
    }
    // Only with the right password does it say the account waits, so nobody can find out which do.
    if (!approved(account)) {
      throw new HttpError(
        403,
        account.kind === 'conductor' && !account.owner.pending
          ? 'Your account is waiting for your bus owner to approve it. Ask them to approve you in their dashboard.'
          : 'Your account is waiting for the Where Is My Bus team to approve it. You can sign in once they have.',
      );
    }
    if (loginOf(account).tempPassword) {
      const changeToken = randomBytes(24).toString('base64url');
      await changeTokens.put(changeToken, refOf(account));
      return { mustChange: true, changeToken, kind: account.kind };
    }
    const { key } = await owners.newSession(refOf(account));
    return { key, kind: account.kind };
  });

  // A password of their own: after a temporary one, with its change token; or when signed in, with the present one.
  router.post('/api/accounts/password', async (ctx) => {
    const body = asObj(await readJson(ctx.req, 1_000), 'password');
    let ref: AccountRef;
    const token = typeof body.changeToken === 'string' ? body.changeToken : '';
    if (token) {
      const saved = await changeTokens.get(token);
      if (!saved) throw new HttpError(401, 'This step ran out. Sign in again with the temporary password.');
      ref = saved;
    } else {
      const me = owners.accountByKey(bearer(ctx));
      if (!me) throw new HttpError(401, 'Sign in again to change your password.');
      if (wrongPasswords.blocked(ctx.ip)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, then try again.');
      if (!(await verifyPassword(typeof body.current === 'string' ? body.current : '', loginOf(me).passwordHash))) {
        wrongPasswords.fail(ctx.ip);
        throw new HttpError(400, 'Your present password is not right.');
      }
      ref = refOf(me);
    }
    const account: Account | undefined = owners.byRef(ref);
    if (!account || !approved(account)) throw new HttpError(401, 'Sign in again to change your password.');
    const passwordHash = await newPasswordHash(body.password, loginOf(account).phone);
    const { key } = await owners.setPassword(ref, passwordHash, { temp: false, signIn: true });
    if (token) await changeTokens.remove(token);
    return { key, kind: account.kind };
  });

  // Who a key signs in: for the phone app, which shows conductors and contributors what they can do.
  router.get('/api/accounts/me', (ctx) => {
    const account = owners.accountByKey(bearer(ctx));
    if (!account) throw new HttpError(401, 'The sign-in key is missing or wrong.');
    return {
      kind: account.kind,
      name: nameOf(account),
      phoneEnd: loginOf(account).phoneEnd ?? null,
      owner: account.kind === 'syndicate' || account.kind === 'contributor' ? null : account.owner.name,
    };
  });

  // Signing out on one device: its key stops working.
  router.post('/api/accounts/sign-out', async (ctx) => {
    const key = bearer(ctx);
    if (owners.accountByKey(key)) await owners.endSession(key);
    return { signedOut: true };
  });

  // A forgotten password, with a code by SMS. The same answer whether or not the number has an
  // account, so nobody can find out which do; only accounts are sent the code.
  router.post('/api/accounts/forgot/code', async ({ req, ip }) => {
    if (!sms) throw new HttpError(404, 'Setting a new password by SMS is not switched on here. Ask the Where Is My Bus team to set one for you.');
    if (!smsLimit(ip)) throw new HttpError(429, 'Too many codes asked for from this network. Try again in an hour.');
    const phone = phoneOf(asObj(await readJson(req, 1_000), 'phone number').phone);
    const issued = await otp.issue(phone);
    if ('waitSec' in issued) throw new HttpError(429, `A code was sent to this number just now. You can ask for another in ${Math.ceil(issued.waitSec / 60)} min.`);
    if (owners.account(phone)) {
      try {
        await sms.send(phone, `${issued.code} is your Where Is My Bus code to set a new password. It works for 10 minutes. Do not share it with anyone.`);
      } catch (e) {
        console.error('Could not send an SMS:', e);
        throw new HttpError(502, 'The SMS could not be sent. Try again in a minute.');
      }
    }
    return { sent: true, phoneEnd: phone.slice(-4) };
  });

  router.post('/api/accounts/forgot/reset', async ({ req, ip }) => {
    if (!sms) throw new HttpError(404, 'Setting a new password by SMS is not switched on here.');
    const body = asObj(await readJson(req, 1_000), 'new password');
    const phone = phoneOf(body.phone);
    await checkOtp(ip, phone, body.code);
    const account = owners.account(phone);
    if (!account) throw new HttpError(400, 'That code is not right. Check the SMS and try again.');
    const passwordHash = await newPasswordHash(body.password, phone);
    await otp.spend(phone);
    // An account still waiting for the admin gets its new password, but no key yet.
    const ok = approved(account);
    const { key } = await owners.setPassword(refOf(account), passwordHash, { temp: false, signIn: ok });
    return ok ? { key, kind: account.kind } : { pending: true };
  });

  // ---- People who sign in for an owner: their staff, who sign up on /signin with the owner's number ----

  router.delete('/api/owner/people/:id', async (ctx) => {
    const { owner } = requireMainOwner(ctx);
    return owners.removePerson(owner.id, ctx.params.id);
  });

  // A conductor who signed up with the owner's number: the owner lets them share the buses.
  router.post('/api/owner/people/:id/approve', async (ctx) => {
    const { owner } = requireMainOwner(ctx);
    const person = owner.people.find((p) => p.id === ctx.params.id);
    if (!person) throw new HttpError(404, 'There is nobody with that id.');
    if (person.role !== 'conductor') throw new HttpError(403, 'The Where Is My Bus team approves managers. You approve your conductors.');
    const out = await owners.approvePerson(owner.id, person.id);
    return { person: { id: out.person.id, name: out.person.name, role: out.person.role, pending: false } };
  });

  // ---- Buses ----

  router.post('/api/owner/buses', async (ctx) => {
    const { owner } = requireOwner(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'bus');
    return { bus: await owners.addBus(owner.id, { plate: body.plate, label: body.label }) };
  });

  router.put('/api/owner/buses/:id', async (ctx) => {
    const { owner } = requireOwner(ctx);
    const body = asObj(await readJson(ctx.req, 2_000), 'bus');
    return { bus: await owners.updateBus(owner.id, ctx.params.id, { plate: body.plate, label: body.label }) };
  });

  router.delete('/api/owner/buses/:id', async (ctx) => {
    const { owner } = requireOwner(ctx);
    const out = await owners.removeBus(owner.id, ctx.params.id);
    await liveCluster.submit({ t: 'dropBus', busId: ctx.params.id, now: Date.now() });
    return out;
  });

  router.get('/api/owner/trips.csv', async (ctx) => {
    const viewer = requireViewer(ctx);
    const from = ctx.url.searchParams.get('from') ?? '';
    const to = ctx.url.searchParams.get('to') ?? '';
    if (!isISODate(from) || !isISODate(to)) throw new HttpError(400, 'Add "from" and "to" as YYYY-MM-DD.');
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0 || days > 62) throw new HttpError(400, 'Choose up to 62 days, with "from" before "to".');
    const scope =
      'syndicate' in viewer
        ? { ownerIds: viewer.syndicate.ownerIds, routeIds: new Set(viewer.syndicate.routeIds) }
        : { ownerIds: [viewer.owner.id] };
    const csv = await tripsCsv({ owners, log: tripLog }, scope, from, to);
    ctx.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bus-trips-${from}-to-${to}.csv"`,
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    });
    ctx.res.end(csv);
    return HANDLED;
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const m = router.match(req.method ?? 'GET', url.pathname);
      if (m === null) throw new HttpError(404, 'Not found.');
      if (m === 'wrong_method') throw new HttpError(405, 'That method is not allowed here.');
      // A sign-in key given out a moment ago by another server: this one catches up first.
      const key = bearerOf(req);
      if (key && key !== adminToken && !owners.accountByKey(key)) await owners.catchUp();
      const out = await m.handler({ req, res, url, params: m.params, ip: clientIp(req, trustProxy) });
      if (out !== HANDLED) sendJson(res, 200, out);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, details: e.details });
      else if (e instanceof LiveError) sendJson(res, e.code === 'busy' ? 503 : e.code === 'not_a_bus' ? 400 : 404, { error: e.message, code: e.code });
      else if (e instanceof URIError) sendJson(res, 400, { error: 'The address has bad encoding.' });
      else {
        console.error(e);
        sendJson(res, 500, { error: 'The server hit an unexpected problem.' });
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  log(`Where Is My Bus server on http://localhost:${actualPort}`);
  log(`  Network v${network.version}: ${network.stops.length} stops, ${network.routes.length} routes (${netStore.describe})`);
  log(db ? `  Data in PostgreSQL (schema ${db.schema})` : `  Data in files in ${dataDir}. Set DATABASE_URL to keep it in PostgreSQL.`);
  log(kv ? `  Codes, links, reports and live updates shared through Redis (server ${serverId})` : '  Codes, links and reports in memory. Set REDIS_URL to share them between servers.');
  log(`  Admin panel: http://localhost:${actualPort}/admin`);
  log(`  Bus owners' dashboard: http://localhost:${actualPort}/owner (owners sign in with a link from the admin panel)`);
  if (!configuredToken) log(`  Admin token for this run: ${adminToken}  (set ADMIN_TOKEN to keep one)`);
  log(sms ? `  Owners can sign in with their phone: codes go to ${sms.describe}` : '  Owners sign in with links from the admin panel. Set SMS_WEBHOOK_URL to let them sign in with their phone.');

  let closing: Promise<void> | null = null;
  return {
    server,
    port: actualPort,
    adminToken,
    live,
    close: () => (closing ??= stop()),
  };

  async function stop() {
    clearInterval(sweeper);
    push.close();
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    // Running trips are saved, so the next start carries them on: by the leader, while it still is.
    try {
      const wasLeader = liveCluster.isLeader();
      await tripLog.close();
      if (wasLeader) {
        await travel.save();
        await accuracy.save();
      }
    } finally {
      await liveCluster.close();
      await kv?.close();
      await db?.close();
    }
  }
}

/**
 * The server as the command line starts it. Only here are the database and Redis taken from the
 * environment (or from backend/.env, which npm start reads), so a test's server never uses them
 * by accident.
 */
export function startFromEnv(extra: Partial<ServerOptions> = {}) {
  return startServer({
    databaseUrl: process.env.DATABASE_URL || undefined,
    databaseSchema: process.env.DATABASE_SCHEMA || undefined,
    redisUrl: process.env.REDIS_URL || undefined,
    redisPrefix: process.env.REDIS_PREFIX || undefined,
    // The network a new server or an empty database starts from; the demo network when missing.
    seedFile: process.env.SEED_FILE ? path.resolve(process.env.SEED_FILE) : undefined,
    ...extra,
  })
    .then((s) => {
      const stop = () => void s.close().finally(() => process.exit(0));
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return s;
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void startFromEnv();
