# Where Is My Bus: project plan and architecture

Version 0.1, 27 October 2026.

This document brings together everything about the project so far: the research behind it, the
plan, the architecture of the code that has been built, how to set it up and run it, how it was
tested, and what comes next. The code itself is in the project zip; file paths below are relative
to its top folder.

## Contents

1. [Summary](#1-summary)
2. [Problem, users and goals](#2-problem-users-and-goals)
3. [Feasibility: can it work without bus GPS?](#3-feasibility-can-it-work-without-bus-gps)
4. [Strategy](#4-strategy)
5. [Features](#5-features)
6. [Architecture](#6-architecture)
7. [Key decisions](#7-key-decisions)
8. [Setup and running](#8-setup-and-running)
9. [Testing and verification](#9-testing-and-verification)
10. [Rollout plan](#10-rollout-plan)
11. [Launch checklist](#11-launch-checklist)
12. [Roadmap after launch](#12-roadmap-after-launch)
13. [Risks and mitigations](#13-risks-and-mitigations)
14. [Appendices](#14-appendices)

## 1. Summary

Where Is My Bus helps people in West Bengal find which bus to take and see when it will come,
starting with Kolkata. It follows the idea behind Where Is My Train, with one big difference: the
buses have no GPS feed this project can use. Phones on board stand in for one. Riders tap "I'm on
this bus", and conductors keep the app running during their shift. Journey search runs on the
phone, so it works offline.

The first version of the code is written: a shared logic library, a backend with an admin panel,
and a bare React Native app with a small native location module. All 43 automated tests pass. Two
things are not yet proven: the native Android and iOS code has not been compiled, and the bus
network is demo data with invented route numbers.

The hardest problem is not the code. It is getting enough phones onto enough buses. So the plan
launches the features that need no live data first (journey search and the stop alarm), then puts
conductors' phones on two or three busy routes, then adds rider sharing. In parallel, it asks the
state for access to the trackers that are already fitted to buses.

## 2. Problem, users and goals

In Kolkata, knowing which bus goes where is mostly local knowledge. Many route numbers share the
same main roads, private buses do not keep timetables, and the only way to know when a bus is
coming is to wait and watch. Visitors, new residents and anyone making an unfamiliar trip have it
worst.

| Who | What they need |
|---|---|
| Rider planning a trip | Which buses go from here to there, and where to change |
| Rider at a stop | When the next useful bus will come |
| Rider on a bus | Not to miss their stop |
| Conductor or bus owner | More passengers; owners also want to know where their bus is |
| Admin running the service | A simple way to keep stops, routes and diversions correct |

| Goal | How success is measured |
|---|---|
| Answer "which bus from A to B" for any two places, even offline | Searches that return at least one option |
| Show when the next bus comes, live where possible and clearly estimated otherwise | Share of buses visible live on pilot routes; arrival time error |
| Wake riders before their stop | Alarms that ring before the stop, not after |
| Let admins keep the network right | Time to add a route; diversions added before riders notice |

Out of scope for the first version: ticketing and payments, trains, metro and ferries (possible
later through GTFS, see section 12), and cabs.

The constraint that shapes everything: **the project has no direct access to the buses' own GPS.**

## 3. Feasibility: can it work without bus GPS?

Yes, but the constraint changes the problem. Without bus GPS, location has to come from phones
that happen to be on the bus, so the hard part is density and incentives, not engineering.

### 3.1 How Where Is My Train solved it

Where Is My Train never had GPS feeds from trains either. It worked out where a train was from
the cell-tower information on passengers' phones, which let it work without internet or GPS, and
Google bought its maker, Sigmoid Labs, in December 2018. Its on-board features, such as an alarm
before your station and sharing the train's location with family, gave passengers their own reason
to keep it open, and their positions helped everyone else as a side effect. This project copies
that idea of self-benefit, not the cell-tower technique (see 4.3).

### 3.2 Why buses are harder than trains

The deepest difference is arithmetic. If a share *p* of riders are sharing their location, the
chance that a vehicle carrying *n* people has at least one sharing phone is 1 − (1 − *p*)ⁿ.

| Vehicle | People on board | Riders sharing | Chance at least one phone is on board |
|---|---|---|---|
| Long-distance train | about 1,500 | 0.3% | about 99% |
| Kolkata bus | about 60 | 1% | about 45% |
| Kolkata bus | about 60 | 5% | about 95% |

So a bus needs roughly 15 times the participation per vehicle that a train does, and people
actively sharing during a ride are a small part of those who have the app installed.

Other differences make it harder still. A train number identifies one train on a given day, but
one bus route can have dozens of identical buses running at once, so the system has to work out
which bus each phone is on. A railway track carries only trains, while a bus shares its road with
taxis, autos and many other routes. Stations are kilometres apart, bus stops a few hundred metres,
so more precision is needed. And private buses do not keep timetables: they wait at the stand until
they fill up, race each other and crawl for passengers, so timetable-based guessing is weak.

### 3.3 What already exists in West Bengal

These findings come from research done on 27 October 2026; sources are listed in appendix 14.5.

**The GPS exists but is locked away.** West Bengal's transport department began an AIS-140 vehicle
tracking system for public transport vehicles from 1 December 2022, linked to a state backend, and
in 2025 made a working tracker a condition for passing the fitness test. Private bus operators say
the devices are fitted in all 32,000 private buses in the state, while also complaining about the
cost of maintaining them, so the data may have gaps. The constraint is therefore about access, not
absence. A data-sharing arrangement with the Transport Department, or with owners through their
tracker vendor, would be the single biggest improvement available.

**There is a precedent for sharing.** Google worked with WBTC to show real-time arrivals for its
Kolkata buses on Google Maps, its first real-time transit launch in India.

**There is a government competitor.** Pathadisha, the state's commuter app, already shows live
positions and arrival times for buses, trams and ferries in Kolkata and parts of West Bengal, and
combines crowdsourced passenger reports with other system data. This project needs a clear reason
to exist (see 4.4).

**Scale.** Around 16,400 private buses run in and around Kolkata alone (2023), across hundreds of
routes.

### 3.4 Verdict

The app can be built and can be useful from day one, because journey search and the stop alarm
need no live data. Live tracking without bus GPS works only where enough phones ride along, so it
has to be rolled out route by route, starting with conductors, and the app must always say honestly
whether a time is live or estimated.

## 4. Strategy

### 4.1 Where bus positions come from

| Source | Coverage | Reliability | Main hurdle | Role in the plan |
|---|---|---|---|---|
| Conductor or driver phone, one per bus | Every trip of every participating bus | High | Persuading owners and conductors | Backbone of the pilot |
| Rider phones ("I'm on this bus") | Patchy at first, grows with users | Medium: noisy, people forget to stop | Riders need a reason of their own to share | Fills gaps and grows coverage |
| Government AIS-140 tracker data | Potentially every bus | High where devices work | Permission and paperwork | Long-term goal |
| An owner's own tracker account | One owner's buses | High | Each vendor's system is different | Take it where offered |
| Usual frequency, later learned history | Every route | Low; always labelled "usual" | Not live | Fallback everywhere |

### 4.2 Making sharing worth it

The people who need bus positions are waiting at stops; the people who can supply them are already
on board and have no reason to bother. As with Where Is My Train, the answer is features that help
the rider on board directly, so that sharing becomes a side effect: a stop alarm that wakes them
before their stop, the next stop on screen, and later a link to let family follow the bus.

For conductors, the lever is usually the owner. Owners want to know where their bus is and how many
trips it ran, so a future owner dashboard gives them a reason to have the conductor keep the app on.
A 24 V USB charger in the bus covers a full shift. A conductor's phone is trusted more than a
rider's, but only after the conductor enters a code the operator was given.

### 4.3 Location without GPS permission

The original idea was to fall back to mobile-tower location when someone refuses GPS permission.
That cannot work. On Android, reading cell-tower information needs the precise location permission,
the same one the person refused, and since Android 9 the cell-tower functions return nothing when
the person has switched Location off. iOS gives apps no tower information at all. This is a
deliberate privacy rule, not a gap to engineer around.

Instead the app is designed for each level of permission:

| The person allows | What the app can know | What the app does |
|---|---|---|
| Precise location | Usually 3 to 50 m | Nearest stops, stop alarm, sharing |
| Approximate location only | About 3 km² | Lists stops in the area so they can pick theirs. For a trip it asks for precise location, on iOS for that trip only |
| Permission but Location switched off | Nothing, cell towers included | Offers to turn Location on, otherwise manual choice |
| Nothing | Nothing | Search by name or landmark, recent places, picking on a map. The planner and arrival times all still work |

The app asks for location only at the moment it is needed ("Use my location", "I'm on this bus"),
never at launch, because Android stops showing the dialog after two refusals and iOS asks only once.

### 4.4 Standing out from Pathadisha and Google Maps

The app competes on things a commuter notices: journey search that works offline and instantly,
search that understands Bengali script, local names and Banglish spellings, routes grouped as
"whichever comes first" with an honest combined wait, a clear difference between live and usual
times, a stop alarm, and coverage of private and mini buses as data is added.

## 5. Features

| Feature | Status |
|---|---|
| Journey search: direct and one change, walking at both ends, grouped parallel routes, works offline | Built |
| Stop and landmark search: English, Bengali script, local names, Banglish spellings, typos | Built |
| Routes not running at the time are left out, with first and last bus shown | Built |
| Time-window variants (one-way roads that flip during the day) and dated diversions | Built |
| Live arrival times and live buses on the map | Built (server and app) |
| "I'm on this bus": stop alarm, next stop, ends by itself when you get off | Built (native code not yet compiled) |
| Anonymous sharing of the bus position, with optional number-plate digits | Built |
| Conductor mode with a code | Built |
| Location-permission ladder, map picking, recent places | Built |
| Admin panel: stops, routes, directions, frequencies, variants, diversions, road snapping, import and export | Built |
| Likely-diversion alerts from riders leaving a route at the same place | Built |
| Link for family to follow a rider's bus | Planned |
| "Bus just passed this stop" button for people without location | Planned |
| Record-route mode for surveying routes | Planned |
| Trip history and learned travel times | Planned |
| Owner dashboard | Planned |
| GTFS export; journeys combining bus with metro, trains and ferries | Planned |

## 6. Architecture

### 6.1 System overview

```text
   Riders' phones                                Conductors' phones
   (journey search offline, stop alarm,          (same app, with the
    optional sharing of the bus position)         operator's conductor code)
          |                                                |
          |   HTTPS: network download, arrivals,           |
          |   live buses, trips, positions                 |
          v                                                v
   +--------------------------------------------------------------+
   |                      Backend (Node 22+)                      |
   |                                                              |
   |   Public API      Live engine (in memory)      Admin API     |
   |        \                 |                      /            |
   |         +------ shared core library ----------+              |
   |                 (planner, search, snapping)                  |
   |                          |                                   |
   |              Network file (JSON, versioned)                  |
   +--------------------------------------------------------------+
          ^                                          |
          | admin token                              | optional
          |                                          v
   Admin panel in a browser                    OSRM server that you run
   (map of stops and routes)                   (draws road paths between stops)

   Later: state AIS-140 tracker feed, PostgreSQL/PostGIS for trip history,
          Redis for live state across several servers.
```

The same TypeScript library runs on the server and inside the app. The app downloads the whole
network (a few megabytes at most) and plans journeys on the phone, so results are instant and work
offline; it then asks the server for live arrivals and re-ranks the options. The server keeps live
buses in memory and saves the network as one versioned JSON file. Each admin change raises the
version, and phones download the new copy the next time they open the app.

### 6.2 Code layout

```text
where-is-my-bus/
  README.md                        overview, settings, API
  package.json                     "npm test" runs every test
  data/demo-network.json           demo network (invented routes, approximate stops)
  docs/PROJECT_PLAN.md             this document
  packages/core/                   shared logic, no dependencies
    src/types.ts                   network data model
    src/geo.ts                     distances, snapping points onto route paths
    src/time.ts                    IST clock, service hours, frequencies, variants, diversions
    src/search.ts                  stop and landmark search
    src/network.ts                 indexes, nearby stops, walking transfers, validation
    src/planner.ts                 journey search
    src/live.ts                    live tracking engine (runs on the server)
    src/trip.ts                    trip tracker (runs on the phone)
    test/                          36 tests
  backend/                         API, live tracking, admin panel; no runtime dependencies
    src/server.ts                  routes, admin edits, start-up
    src/http.ts                    router, JSON bodies, rate limits
    src/store.ts                   saving the network file safely
    public/admin.html              admin panel (one page, plain JavaScript)
    test/api.test.ts               7 end-to-end tests
  mobile/                          bare React Native app
    App.tsx, index.js, app.json, metro.config.js, tsconfig.json, react-native.config.js
    src/config.ts                  server address, refresh intervals, custom fonts switch
    src/theme.ts                   colours and type
    src/api.ts                     server client
    src/core.ts                    re-exports packages/core
    src/format.ts                  distances and plurals
    src/state/AppState.tsx         network, chosen places, navigation, trip
    src/services/networkStore.ts   built-in, saved and downloaded network
    src/services/recents.ts        recent places
    src/services/trip.ts           "I'm on this bus": alarm, sharing, ending
    src/native/location.ts         JavaScript side of the native module
    src/components/                route board, buttons, journey option row
    src/screens/                   Plan, PlaceSearch, MapPick, Option, Trip
    native/wimb-location/          native module: Kotlin (Android), Objective-C (iOS)
```

### 6.3 Shared core library

| Module | What it does | Main functions |
|---|---|---|
| `types.ts` | Data model for stops, landmarks, routes and route directions | (types only) |
| `geo.ts` | Distances; flat projection per route; snapping a point onto a path; slicing paths | `haversine`, `makeLine`, `locateOnLine`, `pointAlong`, `sliceLine` |
| `time.ts` | India Standard Time without a time-zone library (UTC+5:30, no daylight saving); service hours; frequencies; which variant runs now | `istNow`, `isRouteRunning`, `headwayAt`, `isPatternActive` |
| `search.ts` | Normalising text, phonetic keys for Banglish, trigram matching | `buildSearchIndex`, `search` |
| `network.ts` | Prepares the network: stop positions along each path, which routes serve each stop, stops within a short walk, a spatial grid; checks a network for mistakes | `prepareNetwork`, `nearbyStops`, `nearestStops`, `validateNetwork` |
| `planner.ts` | Journey search | `plan` |
| `live.ts` | Turns phone positions into buses and arrival times | `createLiveEngine` |
| `trip.ts` | On the phone during a trip: next stop, alarm, arrival, leaving the route | `createTripTracker` |

### 6.4 Data model

The model is close to GTFS (the public transit data standard) so it can be exported later, but
simple enough to edit by hand.

| Object | Fields |
|---|---|
| Network | `version`, `updatedAt`, `region`, `notice`, `stops`, `landmarks`, `routes` |
| Stop | `id`, `name`, `nameBn` (Bengali), `aliases` (other names and spellings), `lat`, `lng` |
| Landmark | Same as a stop. Hospitals, colleges, malls: places people search for that are not stops |
| Route | `id`, `number` (as painted on the bus), `name`, `operator` (`private`, `govt`, `mini`, `other`), `firstBus`, `lastBus`, `defaultHeadwayMin`, `headways` (busy-hour frequencies), `patterns` |
| Pattern (a direction or variant) | `id`, `direction` (`UP` or `DOWN`), `headsign` (where it is heading), `stopIds` in order, `shape` (road path; if missing, straight lines between stops), `activeWindows` (daily times it runs), `validFrom` and `validTo` (dates of a temporary diversion), `replaces` (the direction switched off during the diversion) |

Example: a route direction that skips Park Street after 1 pm, and a Durga Puja diversion.

```json
{
  "id": "D1-UP-PM",
  "direction": "UP",
  "headsign": "Tollygunge Phari",
  "stopIds": ["howrah-stn", "bbd-bag", "esplanade", "exide-more", "hazra-more", "kalighat", "tollygunge"],
  "activeWindows": [{ "from": "13:00", "to": "23:59" }]
}
```

```json
{
  "id": "D4-UP-PUJA",
  "direction": "UP",
  "headsign": "Garia More",
  "stopIds": ["shyambazar", "sealdah", "science-city", "ruby", "garia"],
  "validFrom": "2026-10-10",
  "validTo": "2026-10-20",
  "replaces": "D4-UP"
}
```

### 6.5 Algorithms

#### 6.5.1 Snapping a GPS point onto a route

Each route direction gets its own flat projection centred on its middle, accurate far beyond GPS
noise even for long routes. A GPS point is projected onto every segment of the path, and the nearest
projection gives two numbers: **along**, metres from the start of the route, and **offset**, metres
from the road. Once a phone is known to be on a bus, the search is limited to a stretch from 200 m
behind its last position to a little ahead of it. That stops a route that doubles back on itself
from snapping the bus to the wrong side.

#### 6.5.2 Journey search

1. **Candidate stops.** For a point, every stop within a 700 m walk (straight-line distance × 1.3
   for real streets). For a chosen stop, also stops within 250 m, such as the stop across the road.
   If nothing is near, the three closest stops within a 2.1 km walk.
2. **Direct journeys.** A route direction that visits a start stop before an end stop. Only
   directions running at that moment count: within first and last bus, inside any time window, and
   not switched off by a diversion. Routes that would connect but are not running are reported with
   their hours.
3. **One change.** For every pair of route directions, keep only the best place to change. A change
   can include a walk of up to 300 m between stops, because at big crossings you usually change to a
   stop on the cross street.
4. **Grouping.** All routes between the same two stops become one option, "take whichever comes
   first". A route more than 6 minutes slower than the fastest is left out of the group.
5. **Wait time.** If a tracked bus can still be caught after walking to the stop, its arrival sets
   the wait. Otherwise routes running every h₁, h₂, … minutes together give a bus every
   H = 1 / (1/h₁ + 1/h₂ + …) minutes, so the expected wait is H / 2, and the ride time is averaged
   weighted by frequency. For example, every 10 and every 15 minutes together means one about every
   6 minutes, so about 3 minutes' wait.
6. **Ranking.** Total time plus a 6-minute penalty per change. A journey with a change is shown only
   if it beats every direct option. Journeys using the same buses from neighbouring stops are merged.
   Walking is offered when the trip is 1.5 km or less. At most 6 options are returned.

| Setting | Default |
|---|---|
| Longest walk to or from a stop | 700 m |
| Walking speed | 75 m per minute (4.5 km/h) |
| Bus speed until real travel times are learned | 14 km/h |
| Time stopped at each stop on the way | 0.4 min |
| Penalty per change | 6 min |
| Slowest route still grouped | 6 min slower than the fastest |
| Options returned | 6 |

#### 6.5.3 Stop search

Text is lower-cased and stripped of punctuation in a way that keeps Bengali vowel signs. A phonetic
key then folds common Banglish spellings together: sh to s, ch to c, th to t, dh to d, kh to k,
gh to g, jh to j, bh to b, ph to f, z to j, v to b, y to i, ee to i, oo to u, q to k, and doubled
letters to one. So Shyambazar and Shyambajar, Jadavpur and Jadabpur, Dhakuria and Dhakuriya match.
Every stop is searchable by its English name, Bengali name and other names.

| Match | Score |
|---|---|
| Exact | 1.0 |
| Name starts with the query | 0.95, a little less for long names |
| A word starts with the query | 0.88 |
| Name contains the query (3+ letters) | 0.80 |
| Fuzzy: shared three-letter pieces | up to 0.78 |

Results below 0.34 are dropped, and a stop beats a landmark on a tie.

#### 6.5.4 Live tracking

Each phone sharing a trip is a **session**. Sessions moving together on the same route direction are
merged into one **vehicle**, and vehicles give arrival times.

1. A position is rejected if it is older than 3 minutes, a repeat, from a fake-GPS app, or less
   accurate than 100 m.
2. It is snapped onto the route (6.5.1). More than 60 m from the path (plus 150 m when the route has
   only straight lines, plus up to 50 m for GPS accuracy) counts as off the route. Off the route for
   90 seconds means the rider has probably got off: the server says so and detaches the phone.
3. A move faster than 25 m/s (90 km/h) is rejected as a jump. GPS noise never moves a bus more than
   30 m backwards.
4. The phone joins the nearest vehicle of the same route direction within 150 m, unless both have
   number-plate digits that differ (two buses racing side by side). Otherwise it starts a new
   vehicle. A phone more than 350 m from its vehicle splits off.
5. A vehicle's position is its conductor's, if it has one; otherwise the median of its riders.
6. Arrival time = distance to the stop ÷ cruise speed + 25 seconds per stop on the way, where cruise
   speed = 0.4 × observed speed (at most 15 m/s) + 0.6 × 14 km/h, because observed speed swings
   wildly in Kolkata traffic. Between reports, the bus is moved forward at cruise speed.
7. Confidence is **high** for a conductor or two or more riders, **medium** for one rider, and **low**
   once nothing has been heard for 2 minutes. After 10 minutes the bus is dropped.
8. When two or more riders of the same route leave its path within 250 m of each other inside 30
   minutes, the admin panel shows a likely diversion.

When no bus is tracked, arrivals fall back to the usual frequency: half the time between buses,
marked "usual".

| Setting | Default |
|---|---|
| Off the route | 60 m (+150 m with straight-line paths) |
| Off the route long enough to end | 90 s |
| Worst accuracy accepted | 100 m |
| Fastest believable speed | 25 m/s |
| Join a bus within / split from a bus beyond | 150 m / 350 m |
| Low confidence after / dropped after | 2 min / 10 min |
| Idle trip forgotten after | 15 min |
| Typical bus speed | 14 km/h |
| Time at each stop | 25 s |
| Live arrivals per route at a stop | 3 |

#### 6.5.5 Trip tracking on the phone

The same snapping runs on the phone, offline. The alarm rings once, 800 m before the destination.
Within 60 m of it the screen says "This is your stop". More than 300 m past it, or 90 seconds off the
route, ends the trip by itself. A bus crawling in a traffic jam stays "on the route", because
slowness alone is never treated as leaving: only distance from the path is.

### 6.6 Backend

A plain Node HTTP server with no runtime dependencies. Node 22.18 and later runs TypeScript
directly, so there is no build step.

**Admin edits** go through one queue: copy the network, apply the change, check it with
`validateNetwork`, raise the version, save to a temporary file and rename it over the real one (so a
crash never leaves half a file), then swap the new network into memory. If the check fails, nothing
changes and the admin sees every problem in plain words.

**Storage.** Phase 1 keeps the whole network in one JSON file, because a few hundred routes is only
a few megabytes and planning runs in memory anyway. Live buses are only in memory; after a restart,
phones start a new trip by themselves. PostgreSQL/PostGIS comes in with trip history (section 12).

| Method and path | What it does |
|---|---|
| `GET /api/health` | Status, network version, trips and buses being tracked |
| `GET /api/network?since=<version>` | Whole network; `304` if the app already has this version |
| `GET /api/search?q=<text>&limit=<n>` | Stops and landmarks matching the text |
| `GET /api/plan?from=…&to=…&time=HH:MM&date=YYYY-MM-DD` | Journey options. `from` and `to` are `stop:<id>` or `<lat>,<lng>`. Uses live buses when no time or date is given |
| `GET /api/arrivals?stops=<id>,<id>` | Next buses at up to 20 stops, live or usual |
| `GET /api/patterns/<id>/vehicles` | Tracked buses on one route direction |
| `POST /api/trips` | Start sharing: `{ patternId, plate?, role?, conductorCode? }`. Returns `{ sessionId, role }` |
| `POST /api/trips/<id>/pings` | Positions: `{ pings: [{ lat, lng, accuracy, speed, heading, ts, mock }] }`, 1 to 120 at a time |
| `POST /api/trips/<id>/end` | Stop sharing |
| `GET /admin` | Admin panel |
| `GET /api/admin/whoami` | Checks the admin token; says whether road snapping and conductor mode are on |
| `PUT` / `DELETE /api/admin/stops/<id>` | Add, change or remove a stop. A stop still used by a route cannot be removed |
| `PUT` / `DELETE /api/admin/routes/<id>` | Add, change or remove a route |
| `PUT /api/admin/network` | Replace the whole network (import) |
| `GET /api/admin/alerts` | Likely diversions |
| `POST /api/admin/snap` | Road path between stop positions, from your OSRM server |

| Setting (environment variable) | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `ADMIN_TOKEN` | a new random token each start, printed to the console | Password for the admin panel and admin API |
| `CONDUCTOR_CODE` | none, so conductor mode is off | Code conductors enter to share as a trusted source |
| `OSRM_URL` | none, so road snapping is off | Your OSRM server |
| `DATA_FILE` | `backend/data/network.json` | Where the network is saved; created from the demo data on first start |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits see real addresses |

| Limit | Value | Why |
|---|---|---|
| Trips started | 300 per minute per IP address | Generous, because Indian mobile networks put many users behind one address |
| Position batches | 40 per minute per trip | The real protection against flooding |
| Searches, plans, arrivals | 1,200 per minute per IP address | Same reason as trips |
| Request size | 4 KB for a trip, 64 KB for positions, 5 MB for a route, 50 MB for an import | Stops oversized requests |

### 6.7 Admin panel

One web page served by the backend, written in plain JavaScript, with Leaflet maps and
OpenStreetMap tiles. What an admin can do:

- Add, move, edit and delete stops on the map, with Bengali names and other names.
- Build a route by clicking stops in order on the map, reorder or remove them, and add the return
  direction with one click.
- Set first and last bus, the usual frequency and busy-hour frequencies.
- Add a time window ("only 05:00 to 13:00") or a dated diversion that replaces a normal direction.
- Snap a direction's path to real roads with an OSRM server. Straight-line paths show as dashed.
- See likely diversions and jump to them on the map.
- Export the network as one file, or import one (it is checked first).

Security: the admin token is kept in memory only, never in browser storage; everything shown is built
with DOM methods rather than HTML strings, so data cannot inject scripts; and the page is served with
a content security policy, `X-Frame-Options: DENY` and no referrer.

### 6.8 Mobile app

**Technology.** Bare React Native (no Expo), TypeScript, Hermes. Three libraries:
`react-native-maps` (Google Maps on Android, Apple Maps on iOS), `@react-native-async-storage/async-storage`
and `react-native-safe-area-context`. There is no navigation library: five screens are a stack in
state, with the Android back button handled. Location, the trip service and notifications are in
the project's own native module (6.9), not in third-party libraries.

| Screen | What it shows |
|---|---|
| Plan | From and To, journey options with route boards, live or usual waits; a banner for a trip in progress |
| Place search | Search box (English or বাংলা), "Use my location", "Pick on the map", recent places, approximate-location stop list |
| Map pick | Tap a spot; nearest three stops; "Use this spot" |
| Journey | Map of the legs with tracked buses on it, the steps, "I'm on this bus" with route choice, sharing switch, plate digits, conductor code |
| Trip | Route board, next stop, stops and minutes to go, alarm and sharing status, "End trip" |

**Offline first.** The demo network is built into the app. On start, the app loads its saved copy
(or the built-in one), then asks the server for a newer version. Planning always happens on the
phone; live data only re-ranks the results.

| App setting (`src/config.ts`) | Default |
|---|---|
| Server address in development | `http://10.0.2.2:8080` (Android emulator), `http://localhost:8080` (iOS simulator) |
| Server address in release | `https://api.example.com` (change before release) |
| Live arrivals refresh | every 20 s while the Plan screen is open |
| Live buses refresh | every 10 s while the Journey screen is open |
| Positions sent | every 15 s, or after 6 positions, at most 30 per batch |
| Custom fonts | off until the font files are added |

**The trip, step by step:**

```text
Rider taps "I'm on this bus" and chooses the route if several were offered
  |
  |- check location: if not precise, ask; if refused or approximate, explain and link to Settings
  |- ask for notification permission (for the alarm)
  |- native module starts tracking: Android foreground service, iOS background location
  |- if sharing: POST /api/trips (offline is fine: sharing starts when back online)
  |
  |  for every position from the native module (about every 10 s or 20 m)
  |- trip tracker: next stop, distance and time to the destination, alarm, off the route?
  |- alarm due: high-priority notification and vibration, once
  |- queue the position; every 15 s: POST /api/trips/<id>/pings
  |      server: snap, merge into a bus, update arrival times for the stops ahead
  |
  '- the trip ends when the rider taps "End trip", is off the route for 90 s, is 300 m past the
     stop, the server says the rider got off, location stops, or (Android) the app is swiped away
```

Everything in the trip runs on location events, never on timers, because JavaScript timers pause
when the app is in the background. If the app restarts during a trip, it resumes the trip if the
native tracking is still running, and otherwise tidies it up.

### 6.9 Native module (wimb-location)

A small local package that React Native's autolinking adds to both apps, so nothing is added by hand
to `MainApplication` or the Xcode project.

| Method | Android | iOS |
|---|---|---|
| `getStatus()` | Location on? Precise or approximate granted? | Location on? Authorisation, precise or reduced accuracy |
| `requestPermission()` | Returns status (Android asks from JavaScript) | Asks for "while using the app" |
| `requestTemporaryPrecise()` | Returns status (JavaScript re-asks; Android offers the upgrade) | Asks for precise location for this session only |
| `getCurrentPosition(highAccuracy)` | Fused location provider, else last known | One-off location request |
| `startTrip({ title, text, intervalMs, minDistanceM })` | Starts the foreground service | Starts background location updates |
| `stopTrip()`, `isTripRunning()` | Stops or checks the service | Stops or checks updates |
| `updateTripNotification(title, text)` | Updates the ongoing notification ("Next: Park Street") | Nothing (iOS shows its own location indicator) |
| `notify(title, text, loud)` | Stop alarm or trip-update channel | Local notification, vibration when loud |
| `requestNotificationPermission()` | Returns true (Android 13+ asks from JavaScript) | Asks for alerts and sound |
| `openLocationSettings()` | Google's "turn on location" dialog, else system settings | The app's page in Settings |

Events: `WimbLocation:location` with `{ lat, lng, accuracy, speed, heading, ts, mock }`, and
`WimbLocation:error` with `{ message }`.

**Android.** A foreground service of type `location`, started from the rider's tap. Android treats a
location service started while the app is on screen as while-in-use access, so the app never asks
for `ACCESS_BACKGROUND_LOCATION`, which brings a much stricter Play Store review. The service uses
the fused location provider (high accuracy, every 10 s or 20 m), reports fake-GPS locations, and
stops when the app is swiped away (`stopWithTask`). Its manifest merges these permissions into the
app: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` and `VIBRATE`. There are three notification
channels: "Trip in progress" (quiet), "Stop alarm" (high priority, vibration) and "Trip updates".

**iOS.** CoreLocation in Objective-C. Background updates are enabled only if `UIBackgroundModes`
contains `location` (turning them on without it would crash, so it is checked first), with the blue
location indicator shown, automotive activity type, and no automatic pausing. Reports locations
simulated by software. Needs `NSLocationWhenInUseUsageDescription`, a `TripTracking` purpose in
`NSLocationTemporaryUsageDescriptionDictionary`, and `location` in `UIBackgroundModes`.

### 6.10 Design system

The look comes from the city: Kolkata's blue-and-white civic colours, and the painted route boards on
its buses, slate boards with yellow numbers. The route board is the one loud element; everything else
stays quiet.

| Colour | Light | Dark | Used for |
|---|---|---|---|
| Background | `#F4F7FA` | `#0F151C` | Screens |
| Surface | `#FFFFFF` | `#17212B` | Inputs, panels |
| Ink | `#16202A` | `#E8EEF3` | Main text |
| Soft ink | `#5A6876` | `#9AA8B5` | Secondary text |
| Line | `#D9E1E8` | `#2A3642` | Dividers, borders |
| Blue | `#1F66B1` | `#6AA8EC` | Actions |
| Board | `#1E2833` | `#0B1117` | Route boards |
| Paint | `#F4C430` | `#F4C430` | Route numbers, the live dot |
| Danger | `#B3261E` | `#F2B8B5` | Errors, "End trip" |

The left stripe of a route board shows the operator: yellow `#F4C430` for private, light blue
`#5AA9E6` for government, green `#4CAF7A` for mini buses, grey `#A0AAB4` for others.

Type: Hind Siliguri for text, designed for Bengali and Latin together, and Teko for route numbers.
Both are free under the SIL Open Font License and optional. Until they are added the app uses system
fonts, with a condensed face for route boards (Avenir Next Condensed on iOS, sans-serif-condensed on
Android).

Writing: plain words, active voice, sentence case. A button says exactly what it does ("Start trip and
share", "End trip"). Errors say what happened and what to do, without apologising. "Live" and "Usual"
are always labelled, because one confident wrong arrival time costs more trust than showing nothing.
Every interactive element has an accessibility label, and dark mode is supported throughout.

### 6.11 Security and privacy

- **Riders are anonymous.** A shared trip is tied to a random id, not to a person or device. Positions
  are kept only in memory and are gone once the trip ends; nothing is stored long term yet.
- **Sharing is a choice.** The switch is on by default and says exactly what is sent; the stop alarm
  works with sharing off.
- **Conductor trust needs a code** set on the server, so anyone cannot claim to be a conductor.
- **Bad data is filtered:** fake GPS, impossible jumps, poor accuracy, stale positions, oversized or
  too-frequent requests.
- **Admin access** needs a long token compared in constant time; the admin page has a strict content
  security policy.
- **Before launch:** HTTPS everywhere, and a privacy policy covering location as India's Digital
  Personal Data Protection Act, 2023 requires. When trip history is added, store it under trip ids,
  keep only what is needed to learn travel times, and delete raw positions after processing.

## 7. Key decisions

| Decision | Why | Revisit when |
|---|---|---|
| Phones on board stand in for bus GPS | The project has no access to the buses' trackers | Government or owner tracker data becomes available |
| Conductors first, riders second | A bus carries too few people for rider sharing alone to see most buses (3.2) | Rider sharing alone covers a route well |
| No cell-tower fallback | It needs the same permission as GPS, gives nothing when Location is off, and is impossible on iOS | Never: it is a platform rule |
| Ask for location only when it is needed | Android stops asking after two refusals and iOS asks only once | |
| No background-location permission | It brings a stricter Play Store review; a foreground service started by the rider is enough | A feature needs tracking that the rider did not start |
| One shared TypeScript library for server and phone | Same answers online and offline; bugs are fixed in one place | |
| Journey search in code rather than SQL | It runs on the phone offline; a city's network fits in memory | |
| One JSON file instead of a database for now | No setup; the data is small | Trip history is added |
| Live buses kept in memory | Simple; one server is enough for a pilot | More than one server is needed (then Redis) |
| No runtime dependencies on the server | Runs anywhere with Node; nothing to patch | Websockets or an external login are needed |
| Polling every 10 to 20 s instead of websockets | Simple and reliable on mobile networks | Load grows enough to make polling costly |
| Bare React Native | The project owner's choice: full control of native code | |
| Own native module instead of location and notification libraries | Exact control over permissions and background behaviour; fewer third-party dependencies | Maintaining it becomes a burden |
| No navigation library | Five screens do not need one | Deep links or many more screens |
| Parallel routes grouped as one option | That is how people ride in Kolkata: whichever bus comes first | |
| "Live" and "Usual" always labelled | A confident wrong time costs more trust than no time | |
| Conductor role needs a code | Otherwise anyone could pose as a trusted source | Per-conductor accounts are added |
| Demo data with invented route numbers | Guesses must never look like real routes | Real routes are surveyed |

## 8. Setup and running

### 8.1 Requirements

| For | You need |
|---|---|
| Backend, admin panel, tests | Node 22.18 or newer (it runs TypeScript directly). Nothing to install |
| Android app | JDK 17, Android Studio with the Android SDK, a Google Maps API key |
| iOS app | A Mac with Xcode and CocoaPods |
| Road paths in the admin panel (optional) | An OSRM server built from OpenStreetMap data for eastern India |

### 8.2 Run the backend and admin panel

```sh
cd backend
ADMIN_TOKEN=choose-a-long-secret CONDUCTOR_CODE=pilot-code npm start
```

Open `http://localhost:8080/admin` and sign in with the token. On first start the server copies the
demo network to `backend/data/network.json`, and from then on edits are saved there.

### 8.3 Common admin tasks

**Add a stop.** Stops tab, "Add stop", click the map where the stop is. Fill in the English name, the
Bengali name and other names people use, separated by commas. Drag the yellow pin to fine-tune, then
"Save stop".

**Add a route.**

1. Routes tab, "Add route". Picking is already on.
2. Click the stops on the map in the order the bus reaches them. Reorder or remove them in the list.
3. Fill in the route number as painted on the bus, the operator, first and last bus, the usual minutes
   between buses, and busy-hour frequencies, one per line, such as `08:00-11:00 8`.
4. "Add return direction" creates the reverse direction. Change its stops if the bus uses different
   streets on the way back.
5. "Save route". Any problem is listed in plain words and nothing is saved until it is fixed.

**A road whose one-way direction flips during the day.** Give the route two directions with the same
destination, one with "Only at these times" set to `05:00-13:00` and the other to `13:00-23:59`.

**A temporary diversion.** Add a direction with the diverted stops, set the dates, and choose which
normal direction it replaces. Outside those dates the normal direction comes back by itself.

**Road paths.** With `OSRM_URL` set, "Snap to roads" draws the path along real roads. Without a
path, the route is drawn dashed and tracking allows a wider margin.

**Backups.** "Import and export", "Download network file". Importing replaces everything, after
checking the file.

### 8.4 Set up the mobile app

1. Generate the native projects and copy them into `mobile`. The project must be named
   `WhereIsMyBus`, because `app.json` uses that name.

   ```sh
   npx @react-native-community/cli@latest init WhereIsMyBus --directory /tmp/WhereIsMyBus --skip-install
   cd mobile
   cp -R /tmp/WhereIsMyBus/android /tmp/WhereIsMyBus/ios .
   cp /tmp/WhereIsMyBus/package.json /tmp/WhereIsMyBus/babel.config.js /tmp/WhereIsMyBus/Gemfile /tmp/WhereIsMyBus/.watchmanconfig .
   ```

   Keep the `App.tsx`, `index.js`, `app.json`, `metro.config.js` and `tsconfig.json` already in
   `mobile`.

2. Install the libraries and the native module.

   ```sh
   npm install
   npm install react-native-maps @react-native-async-storage/async-storage react-native-safe-area-context ./native/wimb-location
   ```

3. Android: in `android/app/src/main/AndroidManifest.xml`, inside `<application>`, add the Maps key.

   ```xml
   <meta-data android:name="com.google.android.geo.API_KEY" android:value="YOUR_GOOGLE_MAPS_KEY" />
   ```

4. iOS: in `ios/WhereIsMyBus/Info.plist`, inside the top-level `<dict>`, add the location keys, then
   install pods. iOS uses Apple Maps, so it needs no map key.

   ```xml
   <key>NSLocationWhenInUseUsageDescription</key>
   <string>Finds stops near you, wakes you before your stop, and, only when you choose, shows other riders where your bus is.</string>
   <key>NSLocationTemporaryUsageDescriptionDictionary</key>
   <dict>
     <key>TripTracking</key>
     <string>The stop alarm needs precise location to know which stop the bus is at.</string>
   </dict>
   <key>UIBackgroundModes</key>
   <array>
     <string>location</string>
   </array>
   ```

   ```sh
   cd ios && bundle install && bundle exec pod install && cd ..
   ```

5. With the backend running, start the app.

   ```sh
   npm start
   npm run android    # or: npm run ios
   ```

   On a real phone, set the development server address in `src/config.ts` to your computer's address
   on the same Wi-Fi, such as `http://192.168.1.20:8080`.

6. Optional fonts: put the Hind Siliguri (Regular, Medium, SemiBold, Bold) and Teko SemiBold `.ttf`
   files in `mobile/assets/fonts`, run `npx react-native-asset`, and set `CUSTOM_FONTS = true` in
   `src/config.ts`.

### 8.5 Try a trip without riding a bus

Plan Esplanade to Jadavpur 8B, open the journey and tap "I'm on this bus". Then move the simulated
location along the route: on the Android emulator with Extended controls, Location, Routes; in the
iOS simulator with Features, Location, Custom Location, or a GPX file in the Xcode scheme. A second
emulator sharing the same route appears as a second rider on the same bus.

### 8.6 Run the tests

```sh
npm test                 # from the top folder: shared logic and backend
cd packages/core && npm test
cd backend && npm test
```

### 8.7 Example API calls

```sh
curl "http://localhost:8080/api/search?q=dharmatala"
curl "http://localhost:8080/api/plan?from=stop:esplanade&to=stop:jadavpur-8b&time=10:00"
curl "http://localhost:8080/api/plan?from=22.5196,88.3655&to=stop:esplanade"
curl "http://localhost:8080/api/arrivals?stops=park-street,esplanade"
curl -X POST http://localhost:8080/api/trips -H 'content-type: application/json' -d '{"patternId":"D2-UP"}'
curl -X PUT http://localhost:8080/api/admin/stops/rashbehari \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Rashbehari More","nameBn":"রাসবিহারী মোড়","aliases":["Rashbehari"],"lat":22.5174,"lng":88.3487}'
```

## 9. Testing and verification

| Area | How it was checked | Result |
|---|---|---|
| Shared logic: geometry, search, journey search, live tracking, trip tracking, validation | 36 automated tests | All pass |
| Backend API end to end: search, plans, a shared trip becoming a live bus, conductor code, admin token, validation, page headers | 7 tests against a real server with a temporary data file | All pass |
| Shared logic and backend types | Strict TypeScript check | No errors |
| App code (28 files) | Type-check against stand-in declarations for the React Native libraries, confirmed to catch real mistakes | No errors |
| Admin panel | Headless Chromium in light and dark mode: sign-in, Bengali search, stop and route editors | Works; one unclear label was found and fixed |
| Planner results on the demo network | Checked by hand (appendix 14.4) | As expected |
| Native module (Kotlin and Objective-C) | Reviewed line by line | Not compiled yet |
| App on phones | | Not run yet |

**Still to test, in this order:**

1. Build the native module on Android and iOS and fix any compile errors.
2. Run a trip with the screen locked on several Android brands. Phones from Xiaomi, Vivo, Oppo, Realme
   and Samsung are common in India, and some stop background services to save battery; the app may need
   to guide riders to exempt it from battery optimisation.
3. Battery use per hour of tracking, alarm reliability with the screen off, and detection of getting
   off at a real stop.
4. Losing and regaining the internet during a trip.
5. Arrival-time accuracy on a real route, against a stopwatch.
6. Load on the server with thousands of simulated trips.

## 10. Rollout plan

Durations are rough guesses for one or two developers and depend mostly on fieldwork.

| Phase | Goal | Main work | Done when | Rough duration |
|---|---|---|---|---|
| 0. Foundation | Working code base | Shared logic, backend, admin panel, app, native module, tests | Done | Done |
| 1. First release | Useful without live data | Fix the first native builds; device tests (section 9); survey 10 to 20 routes in one corridor with road paths; release journey search and the stop alarm to testers | Testers plan real trips and the alarm works with the screen locked | 4 to 8 weeks |
| 2. Conductor pilot | Reliable live buses on a few routes | Sign up owners or a route syndicate for 2 or 3 busy routes; give conductors the code and a charger; measure arrival-time error | Most buses on pilot routes visible at peak; arrival times trusted by testers | 1 to 2 months |
| 3. Riders join in | More coverage, more routes | Family share link; "bus just passed" button; open rider sharing; add routes corridor by corridor | Rider sharing adds visible buses beyond the conductors' | 2 to 3 months |
| 4. Scale and data | Accuracy and reach | Trip history and learned travel times; Redis; ask the Transport Department for tracker data; other cities such as Siliguri, Durgapur and Asansol | Learned times beat the default estimate; state data in use or a clear answer | Ongoing |

**Roll out by route, not by city.** Ten thousand users spread over 400 routes is almost nothing on
any one route, so each corridor should reach good coverage before the next one starts.

| Measure | Why it matters | Starting target for the pilot (suggested) |
|---|---|---|
| Share of buses on a pilot route visible live at peak | Coverage | 80% or more with conductors |
| Arrival time error when a bus is 10 minutes away | Trust | Within 2 minutes most of the time |
| Searches that return an option | Data completeness | 95% or more inside the covered area |
| Stop alarms that ring before the stop | The rider feature that drives sharing | 99% |
| Conductor phones online during shifts | Backbone health | 90% of shift time |
| Riders sharing per bus at peak | Growth | Rising month on month |
| Crash-free sessions | Quality | 99.5% |

## 11. Launch checklist

- [ ] The native module builds on Android and iOS, and a trip runs with the screen locked on at least
  four Android brands and one iPhone.
- [ ] Surveyed stops and routes for the launch area, with road paths. The demo data is removed.
- [ ] The release server address in `src/config.ts` uses HTTPS.
- [ ] `ADMIN_TOKEN` and `CONDUCTOR_CODE` are set; the admin panel is only reachable over HTTPS.
- [ ] The Google Maps API key is restricted to the app.
- [ ] Monochrome notification icons replace the built-in Android ones in `TripNotifications.kt`.
- [ ] Play Console: the location foreground service is declared, explaining that it runs only while a
  rider has a trip on.
- [ ] App Store: the location background mode is explained in the review notes in the same way.
- [ ] A privacy policy covering location, in English and Bengali, under the DPDP Act, 2023.
- [ ] Server monitoring, logs and daily backups of the network file.
- [ ] The app name and icon are checked against existing apps and trademarks.

## 12. Roadmap after launch

**Learned travel times.** Store trip positions under trip ids in PostgreSQL with PostGIS, learn how
long each stretch between stops takes by hour and day, and feed that to the planner through its
existing `rideTimeMin` hook and to arrival times. This replaces the flat 14 km/h estimate, which is the
biggest single accuracy gain available.

**Scaling the server.** Move live buses to Redis so several servers can share them, and consider
websockets once many people watch the same routes.

**Family share link.** A rider sends a link; the person receiving it sees the bus move and the expected
arrival. This is the strongest reason for riders to share.

**Reports without location.** People who keep location off can tap "Route X just passed this stop" at a
stop they chose. A report counts only when it agrees with other reports or live data.

**Record-route mode.** Staff ride a route once with the app; the path becomes the road path and the
halts become suggested stops, cleaned up in the admin panel.

**Owner dashboard.** Where each of an owner's buses is and how many trips it ran, as the reason owners
ask conductors to keep the app on.

**User corrections.** Riders suggest fixes ("this bus also stops at…"), which go to a review queue.

**Open data and multimodal journeys.** Export GTFS, so other planners can use the data, and use
OpenTripPlanner for journeys that combine buses with the Metro, local trains and ferries.

**Government data.** With pilot results in hand, ask the West Bengal Transport Department for access to
the AIS-140 tracker feed, which could cover every bus fitted with a working device.

## 13. Risks and mitigations

| Risk | Effect | Mitigation |
|---|---|---|
| Too few phones on buses | Few live buses; the app feels empty | Launch features that need no live data first; conductors as the backbone; route-by-route rollout; usual times always available |
| Wrong arrival times | Riders stop trusting the app | Live and usual labelled; confidence levels; buses dropped after 10 minutes of silence; error measured per route |
| Wrong or outdated route data | Bad journeys | Validation before saving; diversion alerts; field surveys; user corrections (planned) |
| Conductors do not keep the app on | Gaps in the backbone | Value for owners (dashboard), chargers, a simple app, small incentives in the pilot |
| Fake or malicious data | Phantom buses | Fake-GPS rejection, speed and accuracy checks, merging with other riders, conductor code, rate limits |
| Phone makers' battery savers stop tracking | Alarm or sharing stops with the screen off | Test on common brands; guide riders to exempt the app; foreground service with a visible notification |
| Store policy on background location | Rejection or delay | No background permission; service started by the rider; clear declarations |
| Battery drain | Uninstalls | Updates every 10 s or 20 m, only during a trip; trips end by themselves |
| Privacy concerns | Loss of trust, legal exposure | Anonymous trips, nothing stored after a trip, clear consent text, privacy policy |
| Competition from Pathadisha and Google Maps | Low adoption | Offline search, Bengali and Banglish search, grouped routes, stop alarm, private and mini buses |
| Many users behind one mobile network address | Real users blocked by rate limits | Per-trip limits do the real work; per-address limits are generous |
| Server restart loses live buses | Short gap | Phones start new trips by themselves; Redis later |
| First native build fails | Delay | Small module, clear errors, fixed in phase 1 |

## 14. Appendices

### 14.1 Demo stops

All coordinates are approximate. Replace them with surveyed positions before launch.

| Id | Name | Bengali | Other names |
|---|---|---|---|
| `howrah-stn` | Howrah Station | হাওড়া স্টেশন | Howrah, Haora, Howrah Stn |
| `bbd-bag` | BBD Bag | বিবাদী বাগ | Dalhousie, Dalhousie Square, ডালহৌসি |
| `esplanade` | Esplanade | এসপ্ল্যানেড | Dharmatala, Dharmatolla, ধর্মতলা |
| `park-street` | Park Street | পার্ক স্ট্রিট | Park St |
| `exide-more` | Exide More | এক্সাইড মোড় | Exide, Exide crossing |
| `hazra-more` | Hazra More | হাজরা মোড় | Hazra, Hazra crossing |
| `kalighat` | Kalighat | কালীঘাট | Kalighat metro |
| `tollygunge` | Tollygunge Phari | টালিগঞ্জ ফাঁড়ি | Tollygunge, Tallyganj, Tolly Phari |
| `ballygunge-phari` | Ballygunge Phari | বালিগঞ্জ ফাঁড়ি | Ballygunge, Baliganj |
| `gariahat` | Gariahat More | গড়িয়াহাট মোড় | Gariahat, Gariahat crossing |
| `dhakuria` | Dhakuria | ঢাকুরিয়া | Dhakuriya, Dhakuria Bridge |
| `jadavpur-8b` | Jadavpur 8B | যাদবপুর ৮বি | 8B bus stand, Jadavpur, Jadabpur, Jadavpur University |
| `garia` | Garia More | গড়িয়া মোড় | Garia, Gariya |
| `sealdah` | Sealdah | শিয়ালদহ | Sealdah Station, Shealdah, Sealda |
| `moulali` | Moulali | মৌলালি | Moulali crossing |
| `science-city` | Science City | সায়েন্স সিটি | Science City crossing |
| `ruby` | Ruby More | রুবি মোড় | Ruby, Ruby Hospital, Kasba Ruby |
| `chingrighata` | Chingrighata | চিংড়িঘাটা | Chingrighata crossing |
| `sector-v` | Sector V | সেক্টর ফাইভ | Salt Lake Sector V, Sector 5, College More, Wipro More |
| `ultadanga` | Ultadanga | উল্টোডাঙা | Ultadanga crossing, Bidhannagar Road |
| `shyambazar` | Shyambazar | শ্যামবাজার | Shyambazar 5 point, Shyambajar, Five Point Crossing |
| `karunamoyee` | Karunamoyee | করুণাময়ী | Karunamoyee bus stand, Salt Lake Karunamoyee |

### 14.2 Demo landmarks

| Id | Name | Bengali | Other names |
|---|---|---|---|
| `victoria-memorial` | Victoria Memorial | ভিক্টোরিয়া মেমোরিয়াল | Victoria |
| `sskm` | SSKM Hospital | এসএসকেএম হাসপাতাল | PG Hospital, SSKM |
| `indian-museum` | Indian Museum | ভারতীয় জাদুঘর | Jadughar |
| `new-market` | New Market | নিউ মার্কেট | Hogg Market |
| `south-city-mall` | South City Mall | সাউথ সিটি মল | South City |
| `salt-lake-stadium` | Salt Lake Stadium | যুবভারতী ক্রীড়াঙ্গন | Yuva Bharati Krirangan, Yuva Bharati |

### 14.3 Demo routes

The route numbers are invented. D1 shows a time-window variant: before 1 pm it stops at Park Street, after 1 pm it does not.

| Route | Operator | Hours | Usual frequency | Busy hours | Directions |
|---|---|---|---|---|---|
| D1 | Private | 06:00-21:30 | every 12 min | 08:00-11:00 every 8 min; 17:00-20:30 every 8 min | `D1-UP-AM` (05:00-13:00): Howrah Station, BBD Bag, Esplanade, Park Street, Exide More, Hazra More, Kalighat, Tollygunge Phari<br>`D1-UP-PM` (13:00-23:59): Howrah Station, BBD Bag, Esplanade, Exide More, Hazra More, Kalighat, Tollygunge Phari<br>`D1-DOWN`: Tollygunge Phari, Kalighat, Hazra More, Exide More, Park Street, Esplanade, BBD Bag, Howrah Station |
| D2 | Private | 05:45-22:00 | every 12 min | 08:00-11:00 every 9 min; 17:00-20:30 every 9 min | `D2-UP`: Howrah Station, BBD Bag, Esplanade, Park Street, Exide More, Ballygunge Phari, Gariahat More, Dhakuria, Jadavpur 8B, Garia More<br>`D2-DOWN`: Garia More, Jadavpur 8B, Dhakuria, Gariahat More, Ballygunge Phari, Exide More, Park Street, Esplanade, BBD Bag, Howrah Station |
| D3 | Mini bus | 06:30-21:00 | every 15 min | 08:00-11:00 every 10 min; 17:00-20:30 every 10 min | `D3-UP`: Esplanade, Park Street, Exide More, Ballygunge Phari, Gariahat More, Dhakuria, Jadavpur 8B<br>`D3-DOWN`: Jadavpur 8B, Dhakuria, Gariahat More, Ballygunge Phari, Exide More, Park Street, Esplanade |
| D4 | Government | 06:00-21:00 | every 20 min | 08:00-11:00 every 15 min; 17:00-20:30 every 15 min | `D4-UP`: Shyambazar, Sealdah, Moulali, Science City, Ruby More, Garia More<br>`D4-DOWN`: Garia More, Ruby More, Science City, Moulali, Sealdah, Shyambazar |
| D5 | Private | 07:00-21:00 | every 15 min | 08:00-11:00 every 10 min; 17:00-20:30 every 10 min | `D5-UP`: Howrah Station, BBD Bag, Esplanade, Moulali, Chingrighata, Sector V<br>`D5-DOWN`: Sector V, Chingrighata, Moulali, Esplanade, BBD Bag, Howrah Station |
| D6 | Private | 06:30-21:30 | every 12 min | none | `D6-UP`: Shyambazar, Ultadanga, Karunamoyee, Sector V<br>`D6-DOWN`: Sector V, Karunamoyee, Ultadanga, Shyambazar |
| AC-D7 (AC express) | Government | 07:00-20:00 | every 20 min | none | `AC-D7-UP`: Garia More, Ruby More, Science City, Chingrighata, Sector V<br>`AC-D7-DOWN`: Sector V, Chingrighata, Science City, Ruby More, Garia More |

### 14.4 Sample journey results

Produced by the planner on the demo network for 27 October 2026, without live buses. Times are door to door.

| Journey | Time | Best option | Total |
|---|---|---|---|
| Esplanade to Jadavpur 8B | 10:00 | D2 or D3 from Esplanade to Jadavpur 8B (wait about 2.4 min) | 39 min |
| Tollygunge Phari to Sector V | 10:00 | D1 from Tollygunge Phari to Esplanade (wait about 4 min), then D5 from Esplanade to Sector V (wait about 5 min) | 80 min |
| Garia More to Sector V | 10:00 | AC-D7 from Garia More to Sector V (wait about 10 min) | 72 min |
| Howrah Station to Park Street | 09:00 | D1 or D2 from Howrah Station to Park Street (wait about 2.1 min) | 19 min |
| Howrah Station to Park Street | 15:00 | D2 from Howrah Station to Park Street (wait about 6 min) | 23 min |
| BBD Bag to Esplanade | 10:00 | D5 or D1 or D2 from BBD Bag to Esplanade (wait about 1.5 min). Walking (16 min) is also offered | 6 min |
| Esplanade to Jadavpur 8B | 23:30 | No buses. D2 runs 05:45-22:00; D3 runs 06:30-21:00 |  |

### 14.5 Sources

Research for sections 3 and 4 was done on 27 October 2026.

- Where Is My Train used cell-tower data instead of GPS or internet, and Google bought its maker:
  [VentureBeat](https://venturebeat.com/ai/google-acquires-sigmoid-labs-developer-of-popular-indian-app-where-is-my-train)
- Where Is My Train's on-train features (works without internet or GPS, alarm, sharing with family):
  [app listing](https://apkmirror.com/apk/sigmoid-labs/where-is-my-train)
- AIS-140 tracking in all public transport vehicles in West Bengal from 1 December 2022:
  [Transport Directorate SOP](https://wbxpress.com/sops-vehicle-location-tracking-system-device-fitment/)
- The tracking system is linked to a state backend:
  [VLT device registration document](https://wbxpress.com/files/2023/01/326-VLTD.pdf)
- A working tracker is needed to pass the fitness test (2025):
  [91trucks](https://www.91trucks.com/news/wb-transport-department-mandates-tracking-panic-buttons-for-cvs)
- Operators say all 32,000 private buses have trackers, and complain about maintenance:
  [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fwest-bengal%2Fbengal-private-bus-operators-urge-transport-dept-to-set-up-grievance-cell-on-vlt-devices-3104399)
- About 16,400 private buses in and around Kolkata (2023):
  [EastMojo](https://eastmojo.com/national-news/west-bengal/2023/06/16/over-30000-buses-taxis-in-west-bengal-get-tracking-devices-with-panic-buttons/)
- Pathadisha's features and its use of crowdsourced reports:
  [FileHippo listing](https://filehippo.com/android/download_pathadisha/),
  [APKPure listing](https://apkpure.net/pathadisha/com.wbtransport.commuter)
- Google Maps real-time arrivals for WBTC buses, a first in India:
  [GizBot](https://www.gizbot.com/apps/news/google-maps-provides-real-time-bus-info-kolkata-042789.html)
- Reading cell-tower information on Android needs the precise location permission:
  [TelephonyManager.getAllCellInfo reference](https://learn.microsoft.com/en-us/dotnet/api/android.telephony.telephonymanager.allcellinfo?view=net-android-37.0)
- Since Android 9, cell-tower functions return nothing when Location is off:
  [translation of the Android 9 behaviour changes](https://blog.csdn.net/yx1166/article/details/84612377)
- Approximate location is accurate to about 3 km²:
  [Android developers](https://developer.android.com/training/location/permissions)
- Precise location is usually accurate to 3 to 50 m:
  [Android Authority](https://androidauthority.com/android-16-density-based-coarse-locations-3614048)
- Kolkata roads whose one-way direction reverses at 1 pm:
  [Road reversal in central Calcutta](https://www.goodreads.com/author_blog_posts/24403128-road-reversal-in-central-calcutta),
  [The Daily Star](https://online-d11.thedailystar.net/news-detail-115393)
- Durga Puja traffic restrictions on dozens of Kolkata roads:
  [The Statesman](https://www.thestatesman.com/bengal/mahalaya-and-durga-puja-traffic-restrictions-announced-by-kolkata-police-1503349211.html)

### 14.6 Glossary

| Term | Meaning |
|---|---|
| AIS-140 | The Indian standard for tracking devices and emergency buttons in public transport vehicles |
| VLTD | Vehicle location tracking device |
| Headway | Minutes between buses on a route |
| Pattern, direction | One way a route runs: an ordered list of stops, with an optional road path and running times |
| Headsign | Where a bus is heading, as shown to riders |
| Session | One phone sharing one bus trip |
| Vehicle | One bus, made from the sessions moving together on it |
| Along, offset | Metres from the start of a route to a snapped point, and from the point to the road |
| Dead reckoning | Moving the last known position forward at an expected speed until the next report |
| Trigram | A three-letter piece of a word, used for typo-tolerant matching |
| Banglish | Bengali written in Latin letters, with many possible spellings |
| GTFS | General Transit Feed Specification, the common format for public transport data |
| OSRM | Open Source Routing Machine, which finds paths along OpenStreetMap roads |
| Fused location provider | Google Play services location, combining GPS, Wi-Fi and cell towers |
| Foreground service | Android work that keeps running with a visible notification |
| While-in-use access | Location permission while the app is in use, including a foreground service it started on screen |
| Carrier-grade NAT | Mobile networks sharing one public IP address among many users |
| IST | India Standard Time, UTC+5:30, with no daylight saving |
| DPDP Act | India's Digital Personal Data Protection Act, 2023 |
