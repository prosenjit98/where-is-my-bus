# Where Is My Bus

Live bus tracking and journey planning for West Bengal, for buses that have no GPS feed
the app can use. Phones on board stand in for one: riders who tap "I'm on this bus" and
conductors who run the app all trip. Journey search works offline on the phone.

> **Check the name.** News reports say the state's Yatri Sathi app launched live bus tracking called
> "Where Is My Bus" in May 2025 (it was not in the app on 28 October 2026), and a Kerala startup uses
> the name. Decide on the name before any public release (see the project plan).

| Folder | What it is |
|---|---|
| `packages/core` | Shared TypeScript logic used by the server, the phone app and the web app: journey planner (buses, the Metro, trains and ferries), stop search, live tracking engine, learned travel times, riders' reports, on-phone trip tracker, rider-facing wording in English and Bengali, route search by number, name or place. No dependencies. 70 tests. |
| `backend` | API, live tracking pushed to open pages, the admin panel and its dashboard, sign-in for owners, their staff and conductors, syndicates and contributors, the bus owners' dashboard, family follow links, the GTFS export, and the rider web app's files. Plain Node, no runtime dependencies. 55 end-to-end API tests. |
| `web` | Rider web app: the phone app's screens plus a conductor screen, route pages with live buses, and a side nav, in English or Bengali, in plain TypeScript that the backend serves as it is. Works offline after one visit. |
| `mobile` | Bare React Native 0.88 app and its native location module, in English or Bengali, with its own icon and splash screen. The Android app builds and passes 7 end-to-end tests on an Android 16 emulator (`e2e/android`); iOS is not built yet. Setup: [mobile/README.md](mobile/README.md). |
| `tools` | Bus simulator (demos, tests, load tests), an OpenStreetMap route importer, the brand image generator (`npm run brand`), and the check that every text has Bengali. 9 tests. |
| `e2e` | 22 end-to-end tests: the web app, the admin panel, the owners' dashboard and the family follow page in a real Chrome, against a real server. |
| `data/demo-network.json` | Demo network: 22 Kolkata stops, 6 landmarks, 7 routes. **Route numbers are invented and coordinates are approximate.** `data/demo-multimodal.json` adds a Metro line and a ferry. |
| `assets/brand` | The logo; app icons, the splash screen and the web app's icons are made from it. |
| `docs/PROJECT_PLAN.md` | The project plan, research and architecture. |

## Run it

Needs Node 22.18 or newer, which runs TypeScript directly: there is no build step, only the
backend's two libraries (the PostgreSQL and Redis clients) to install. Step by step, from a fresh
clone: [docs/SETUP.md](docs/SETUP.md).

```sh
cd backend
npm install
ADMIN_TOKEN=choose-a-long-secret npm start
```

- Rider web app: http://localhost:8080. Riders never sign in. Its side nav (the menu button on a
  phone) has **Sign in** links for the people who run the buses: owners, their staff and
  conductors, syndicates, and the admin.
- Admin panel: http://localhost:8080/admin (sign in with the token; without `ADMIN_TOKEN` the
  server makes a new one on every start and prints it). It opens on the dashboard.
- Sign-in for bus owners, their managers and conductors, route syndicates and contributors:
  http://localhost:8080/signin, with a mobile number and a password. They create an account there
  and can sign in once it is approved: a conductor by their owner, on the owner's dashboard;
  everyone else by the admin (admin panel, **Bus owners**). The admin can also add an owner there,
  with a temporary password to give them, which only lets them choose their own. Once signed in,
  owners, managers and syndicates see the bus owners' dashboard, http://localhost:8080/owner;
  conductors go to the web app's **Share your bus**; contributors are told to record routes in the
  phone app. A forgotten password: the admin sets a
  temporary one; with an SMS gateway (`SMS_WEBHOOK_URL`) they can also set a new one with a code
  by SMS. To try that without a gateway, start the server with `SMS_TO_LOG=1` and read the codes
  in its log.
- GTFS feed of the network: http://localhost:8080/api/gtfs.zip (set `PUBLIC_URL` in production).

On Windows PowerShell, set the variables first:
`$env:ADMIN_TOKEN = "choose-a-long-secret"; npm start`.

To see live buses without riding one, start simulated buses in a second terminal:

```sh
npm run simulate                                      # riders' phones on every route direction
npm run simulate -- --patterns D2-UP,D3-UP --phones 2 # two riders' phones per bus, on two directions
npm run simulate -- --patterns D2-UP --buses 1 --key <conductor key> --plate "WB 19 A 1234"
                                                      # one owner's bus, shared by its conductor
```

Then plan Esplanade to Jadavpur 8B in the web app: waits from tracked buses say "Live". For the
last line, add the bus on an owner's dashboard, sign a conductor up for that owner and approve
them, and take the conductor's key from `POST /api/accounts/sign-in`: the bus then also appears
on its owner's dashboard, as shared by its conductor.

Location in a browser needs HTTPS, or `localhost` while developing. To try the web app on a
phone on the same Wi-Fi, serve it over HTTPS (for example behind a reverse proxy with
`TRUST_PROXY=1`) or use Chrome's USB port forwarding so the phone sees `localhost`.

## Test it

```sh
npm test            # shared logic, API, tools and the Bengali check: 134 tests
npm run typecheck   # strict TypeScript for core, backend, web app, tools and tests
npm run test:e2e    # 22 browser tests; uses the Chrome installed on this computer (or CHROME_PATH)
```

For the end-to-end tests, run `npm install` in `e2e` once (it installs `playwright-core`, which
drives Chrome and downloads no browser). Set `E2E_SCREENSHOTS` to a folder to keep screenshots.

Load test: start the server with `TRUST_PROXY=1`, then
`npm run simulate -- --load 2000 --minutes 2 --reads 200`. On one computer the load generator
slows down long before the server does, so watch the server's CPU use as well.

## How it works

**Journey search.** Finds direct buses and journeys with one change, from stops within a
short walk of where you start and end. Routes that serve the same two stops are shown as
one option ("take whichever comes first"), with the combined wait: a bus every 10 minutes
plus one every 15 minutes means one about every 6 minutes. A tracked bus sets the wait when
it comes sooner than that; one that comes later is mentioned but does not set it, because
most buses are not tracked yet and an untracked one may well come first. Routes not running
at that hour are left out, and the planner says when they start. Variants handle one-way
roads that flip direction during the day; diversions with start and end dates handle
closures such as Durga Puja.

**Stop search.** Finds stops and landmarks by English name, Bengali name, local names
(Dharmatala finds Esplanade), common Banglish spellings (Shyambajar, Jadabpur) and typos.

**Find a bus by its route.** Riders who know the bus they want look it up by the number painted
on it (typed "12c2", "12 C 2" or in Bengali digits for 12C/2), by its name, or by a place it goes
to: "Garia" lists every route that stops there, and a landmark lists the routes stopping within a
short walk of it. A route number typed in the From or To search offers the route too. A route's
page shows its directions, first and last bus, how often it runs now, its stops in order on a line
and on the map, and the buses being tracked on it, placed between the stops they are between and
moved as they report.

**The Metro, trains and ferries.** A route can be a bus, a Metro line, a local train or a ferry,
with its line's colour. Journeys combine them: from Howrah Station to Tollygunge, a bus to
Esplanade and the Blue Line is 31 minutes where the bus all the way is 51. They are planned from
their frequencies at their own speeds; only buses are tracked and shared.

**English or Bengali.** The web app, the phone app, the owners' dashboard and the family follow
page switch between English and Bengali, with a button on the first screen. Bengali shows stop
names in Bengali script where the network has them and numbers in Bengali digits; route numbers
stay as painted on the bus. The first time, the language follows the phone's.

**Live buses.** Each phone sharing a trip sends its position every 10 to 15 seconds. The
server snaps it onto the route, merges phones moving together into one bus (also when they
started apart, as phones do just after GPS starts): a rider types nothing about the bus,
and is put on the bus they are next to, the conductor's when its conductor shares it, and the
app then says so. A conductor's bus is known by its plate, so two buses of the same route stay
apart; two conductors are always two buses. It rejects fake GPS, poor fixes and impossible jumps, notices riders who
got off, gives riders still walking to the stop 10 minutes before ending their trip, and
forgets buses nobody has reported for 10 minutes. A bus not heard from for 2 minutes stays
on the map but never sets a "Live" wait. A conductor's phone is trusted more, but only when
the conductor is signed in, with the account their owner approved, and shares one of that
owner's buses: they type its number plate as they start (spaces, dashes and small letters do not
matter). A bus shared by its conductor is known by its plate, so two phones on it count as one
bus and two buses whose plates end in the same digits stay apart. When several riders of one route leave its path at the same place, the admin
panel flags a likely diversion. Open journey maps and owners' dashboards get bus positions
pushed by the server as they come in (server-sent events), instead of asking every few seconds.

**Learned travel times.** Tracked buses teach the server how long each stretch between two stops
takes, by hour and by weekday, Saturday or Sunday. Once a stretch has 3 trips in an hour, its
learned time replaces the flat 14 km/h estimate, in arrival times and in the apps' journey times
(also offline). The admin panel's Accuracy page shows how far arrival times were off, per route.
Where conductors cover nearly every bus of a route, a tracked bus later than the usual wait
sets the wait, because no untracked bus is likely to come first.

**Riders without location, and riders' fixes.** Someone waiting at a stop can say "this bus just
left": once a second person agrees, or a tracked bus was there, people further along see it.
Riders can suggest a fix (a stop in the wrong place, a missing stop, wrong times), which goes to
the admin panel's Suggestions queue.

**Family follow link.** A rider sharing their bus can send a link; whoever opens it sees the
bus on a map, its next stop and when it should reach the rider's stop, until the trip ends.

**Bus owners' dashboard.** The reason for owners to have their conductors keep the app on.
An owner adds their buses by number plate. Their conductors sign up on `/signin` with the owner's
mobile number, and the owner approves them on the dashboard. When a conductor, signed in, shares
a bus by typing its plate, the owner sees where it is (on a map, with the
next stop and how long ago it was heard from) and the trips it runs: when it left and last
moved, from which stop to which, how far, and whether it ran the whole route. There are day
and 7-day totals, any earlier day, and a spreadsheet download of up to 62 days. A trip that
is interrupted (no signal, a server restart, a second phone on the bus, a conductor who
ends sharing by mistake) carries on as the same trip when the bus is seen again within 20
minutes. The dashboard lists alerts: a trip that stopped sharing before the end of the route, or
that has sent no position for 5 minutes, also as notifications on that phone if the owner asks.
A route syndicate sees its members' buses on its routes, read-only. The owner can remove a
conductor at any time; their account then stops working. The phone remembers the plate typed last.

**Signing in.** Riders never sign in. Bus owners, their staff (managers and conductors), route
syndicates and contributors sign in on one page, `/signin`, with their mobile number and a
password, and only once their account is approved: managers and syndicates see owners' buses, a
conductor's phone is trusted on their owner's buses, and contributors' recordings can become
routes. They create an account there, choosing who they are; staff give their owner's number, and
the owner sees them waiting. The owner approves their conductors; the admin approves everyone else
(and can approve conductors too). The admin sees each new account's number in full, to call and
check, and approves or turns it down; for a syndicate, the admin also chooses its routes and member
owners. A conductor's account only shares buses: it does not open the owners' dashboard. The admin can add an owner or a syndicate with a temporary password, which
only lets them choose their own, and set a temporary password for anyone who forgot theirs; with
an SMS gateway, they can also set a new one with a code by SMS. Passwords are kept as salted
scrypt hashes; each device signed in has its own key, and a new password signs the other devices
out. Ten wrong passwords for a number stop it for 15 minutes.

**Privacy.** Riders' shared positions are tied to a random trip id, not to a person, and are
kept only in memory. Nothing is stored after their trip ends. A trip's positions can still
show where someone lives, so treat them as personal data under India's DPDP Act. For buses
shared by their conductors, a summary of each trip is kept for the owner (where on the route
the bus was first and furthest seen, and when, but no positions) for `TRIP_HISTORY_DAYS`, 90
by default. The conductor is told, before and during sharing, that the owner sees the trips.

**Admin panel.** Opens on a dashboard: buses on the road now (on a map and by route), phones
sharing, owners' trips today by the hour they started, the network's size, arrival-time accuracy
for the last 7 days, and a list of things to look at (accounts waiting for approval, riders'
suggestions, likely diversions, owners' buses that stopped sharing, directions without a road
path, stops no route uses). A side nav, which folds to its icons, leads to the rest; the token is
kept for the browser tab, so a reload stays signed in. Add and edit stops on a map with Bengali
and local names, build routes by clicking stops in order (a click on the road where there is no
stop yet adds one there), add the return direction in one click, set busy-hour frequencies,
time windows and diversions, snap paths to roads (with your own OSRM server), see likely
diversions, and import or export the whole network. Record a route by riding it once: the path
becomes the road path and the halts become suggested stops. Review riders' suggestions, see
arrival-time accuracy, approve the owners, managers, syndicates and contributors who signed up (or
add owners and syndicates with a temporary password, and set one for anyone who forgot theirs),
and set up route syndicates.

**Contributors.** People who know the buses can help map them. They sign up on `/signin` as a
contributor, and the admin approves them. In the phone app they record a route from inside the
bus: the road it takes, and each stop, marked as the bus reaches it, with its name if they like.
Their recordings come to the admin panel's **Record a route**, marked "by" the contributor, with
the stops they marked. The admin checks each one on the map and, if it is good, uses it for a
route direction: its path becomes the road path and, if asked, its stops become the direction's
stops. A stop already there is used when one is within 80 m; a new stop keeps the name the
contributor typed. Nothing changes for riders before the admin applies it. Every change is
checked before it is saved and raises the network version, so phones download the new copy.

**Open data.** `GET /api/gtfs.zip` is the network as a GTFS feed, for journey planners and map
apps: stops, routes (with Metro and ferry types and colours), frequency-based trips timed from
the learned travel times, calendars with diversions on their dates, road paths, and Bengali stop
names as translations. Check the data's licence first if it came from OpenStreetMap (below).

## Real routes from OpenStreetMap

```sh
npm run import-osm -- --out data/osm-kolkata.json
```

Builds a network from OpenStreetMap's Kolkata bus routes: on 27 October 2026 that gave 216
routes, 309 directions and 354 stops. Most route relations list only the road, so the stops
are the named bus stops within 30 m of it, in order: check them. Some big stops, such as
Esplanade and Howrah Station, are not mapped as bus stops along the routes and must be
added in the admin panel. OpenStreetMap has no timetables, so first and last buses and
frequencies are placeholders. The data is under the ODbL: a network built from it that riders
download must credit OpenStreetMap and be offered under the ODbL too. Decide that first.
Import the file in the admin panel ("Import and export"), where it is checked before saving.

**Seed network.** `data/seed-kolkata.json` is the Kolkata network built from OpenStreetMap (274
routes, 439 stops, Bengali names, credits; placeholder timings, and 241 routes marked to check in
`data/draft-routes-kolkata-all.sources.json`). With `SEED_FILE` pointing at it (as in
`backend/.env.example` and `docker-compose.yml`), a new server or an empty database starts from
it; files kept next to `DATA_FILE` from before still come first. From `backend/`,
`npm run seed -- ../data/seed-kolkata.json` loads it by hand, and `--replace` replaces the network
there now, after saving a copy in `backend/data/`; running servers are told through Redis. Like the
other files built from OpenStreetMap, it stays out of git until the ODbL decision is made.

**Credits.** A network carries the credits its data's licences require in `attribution`, a list
of `{ text, url }`, for example `{ "text": "Bus stops and routes © OpenStreetMap contributors,
ODbL", "url": "https://www.openstreetmap.org/copyright" }`. They are kept through admin imports
and shown wherever the data is: on the web app's home screen, in the phone app's Settings
("Data sources"), and in the GTFS feed's `attributions.txt`. The drafts in `data/` built by the
route research (`data/draft-routes-kolkata.md`) carry theirs. The map tiles on the website credit
OpenStreetMap themselves; the phone app's Google map shows Google's own credit.

## Server settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `ADMIN_TOKEN` | new random token each start | Password for the admin panel and admin API |
| `OSRM_URL` | none (snapping off) | Your OSRM server, for drawing road paths between stops |
| `DATA_FILE` | `backend/data/network.json` | Where the network is saved. Created from the demo data on first start |
| `OWNERS_FILE` | `owners.json` next to `DATA_FILE` | Bus owners, their staff and buses, syndicates and contributors |
| `TRIPS_DIR` | `trips` next to `DATA_FILE` | Owners' trips, one file per day, and the trips running when the server stopped |
| `TRIP_HISTORY_DAYS` | `90` | Days of owners' trips to keep; older days are deleted |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits see real addresses |
| `PUBLIC_URL` | `http://localhost:<port>` | Where riders reach the server, such as `https://bus.example.in`; used in the GTFS feed |
| `SMS_WEBHOOK_URL` | none (forgotten passwords are set by the admin) | Your SMS gateway: it gets `{ "to": "+91…", "text": "…" }` as JSON, for the codes that set a forgotten password |
| `SMS_WEBHOOK_TOKEN` | none | Sent to the gateway as `Authorization: Bearer …` |
| `SMS_TO_LOG` | off | Set to `1` to write the codes to the server's log instead, for trying it out. Not for real use |
| `DATABASE_URL` | none (files) | PostgreSQL, such as `postgres://wimb@localhost:5432/wimb`: the network, owners and buses, trips, recordings, suggestions and learned travel times are kept there |
| `DATABASE_SCHEMA` | `public` | The schema to use in that database |
| `REDIS_URL` | none (memory) | Redis, such as `redis://localhost:6379`: one-time codes, password-change steps, follow links and riders' reports, and live updates passed between servers |
| `REDIS_PREFIX` | `wimb:` | Put before every Redis key |
| `SERVER_ID` | the computer's name | This server's name among several, in its logs and `/api/health` |
| `SEED_FILE` | `data/demo-network.json` | The network a new server or an empty database starts from, such as `data/seed-kolkata.json` |
| `WORKERS` | one per CPU core | Server processes on this machine, with `npm run start:cluster` |

The server also keeps `secret.key` next to `DATA_FILE`: phone numbers are stored only as hashes
made with it. Back it up with the data. With `DATABASE_URL` it is kept in the database instead.

### PostgreSQL and Redis

`npm start` and `npm run dev` read `backend/.env` (copy `backend/.env.example`). With
`DATABASE_URL` set, the server makes its tables on start (`backend/src/db.ts`); on an empty
database it first copies in what the files next to `DATA_FILE` hold, so moving a server over keeps
its data. The network is stored a row per stop and per route, so an edit to one route writes one row,
and other servers read only the rows that changed. Changes to owners and to the network are
checked against the version saved: a server whose copy was out of date reads it again and makes its
change on top. `npm run test:db` runs the tests against the database and Redis in `backend/.env`,
in a schema and key prefix of their own that are removed afterwards.

### Several servers

With `REDIS_URL` set, any number of server processes can run together, on one machine
(`npm run start:cluster`, one per CPU core) or on several behind a load balancer. Each keeps its own
copy of the live buses, so any of them answers riders, and the copies stay the same because every
change to them (a phone starting or stopping, its positions, the half-minute tidy-up) goes through
one Redis stream that each process applies in the same order (`backend/src/live-cluster.ts`). One
process, chosen through a Redis lease, leads: it saves trips and learned times, and another takes
over within 15 s if it stops. A process that starts while others run reads the trips being shared,
then shows every bus within one round of positions; `/api/health` says `ready: false` until then.
Arrivals at a stop are reused for a second and journeys for 15 s, so many riders asking about the
same stops cost little more than one.

`node tools/bench-scale.ts` measures one process on a made-up city of 1,000 routes with 30 buses
each; `--write city.json` saves that city for `DATA_FILE`, to load-test a running server with
`npm run simulate -- --load …`. Run the load generator on another machine than the server.

## Deploy with Docker

`Dockerfile` builds the server for a Linux host (Node 22, about 15 MB of app); `docker-compose.yml`
runs it with PostgreSQL 17 and Redis 8, one process per CPU core:

```sh
cp deploy.env.example deploy.env     # set POSTGRES_PASSWORD, REDIS_PASSWORD, ADMIN_TOKEN, PUBLIC_URL
docker compose --env-file deploy.env up -d --build
docker compose logs -f app
```

Only the app's port (8080, or `APP_PORT`) is published. Put a reverse proxy with HTTPS in front of
it, such as Caddy or nginx: browsers share location only over HTTPS. To move a server that kept its
data in files, copy them into the `app-data` volume before the first start; they are copied into the
empty database. Back up the `postgres-data` volume. On its own, without a database,
`docker run -p 8080:8080 -v wimb-data:/data -e ADMIN_TOKEN=… where-is-my-bus` keeps the data as files
in `/data`.

## API

| Method and path | What it does |
|---|---|
| `GET /` | Rider web app (with `/web/…`, `/packages/core/src/…`, `/sw.js` and `/manifest.webmanifest`) |
| `GET /api/health` | Status, network version, trips and buses being tracked. `HEAD` works too |
| `GET /api/network?since=<version>` | Whole network; `304` if the app already has this version |
| `GET /api/search?q=<text>` | Stops and landmarks matching the text |
| `GET /api/plan?from=stop:<id>\|<lat>,<lng>&to=…` | Journey options, using live buses when planning for now |
| `GET /api/arrivals?stops=<id>,<id>` | Next buses at stops, live or estimated |
| `GET /api/patterns/<id>/vehicles` | Tracked buses on one route direction |
| `GET /api/live?patterns=<id>,<id>` | The same, pushed as server-sent events (`vehicles`) whenever a bus on them moves, and every 15 s. Up to 12 directions; 12 open streams per network |
| `GET /api/travel-times` | Learned seconds per stretch of each direction for this hour, for planning on the phone |
| `GET /api/gtfs.zip` | The network as a GTFS feed |
| `POST /api/reports` | "This bus just left": `{ patternId, stopId, device }`. Says whether it agreed with another report or a tracked bus |
| `POST /api/corrections` | A rider's suggested fix: `{ kind: stop\|route\|times\|other, text, routeId?, stopId? }` |
| `POST /api/trips` | Start sharing a trip: `{ patternId }` for a rider (an optional `plate`, the last 4 digits, is still taken from older apps). A conductor sends `{ patternId, role: conductor, plate }` with their key in `Authorization`: 401 without a valid key, 400 if the plate is not one of their owner's buses. Returns `{ sessionId, role }`, and `bus: { plate, owner }` for a conductor. Buses only |
| `POST /api/trips/<id>/pings` | Send positions: `{ pings: [{ lat, lng, accuracy, speed, ts, mock }], sentAt? }`. `sentAt` is the phone's clock when sending, on the same clock as `ts`; it lets the server correct a phone whose clock is wrong |
| `POST /api/trips/<id>/end` | Stop sharing |
| `POST /api/trips/<id>/share` | A link for family to follow the bus: `{ destStopId? }`. Returns `{ token, path }` |
| `GET /follow/<token>`, `GET /api/follow/<token>` | The follow page, and what it shows: the bus, its next stop, the time to the rider's stop |
| `GET /signin` | Sign-in for bus owners, their staff and conductors, route syndicates and contributors |
| `POST /api/accounts/sign-up` | A new account, waiting for approval: `{ kind: owner\|manager\|conductor\|syndicate\|contributor, name, orgName?, ownerPhone?, phone, password }`. Managers and conductors give `ownerPhone` |
| `POST /api/accounts/sign-in` | `{ phone, password }`. Returns `{ key, kind }`, kind being owner, manager, conductor, syndicate or contributor; after a temporary password, `{ mustChange, changeToken, kind }` instead. 403 while the account waits for approval |
| `GET /api/accounts/me` | Who the key in `Authorization` signs in: `{ kind, name, phoneEnd, owner }`, `owner` being the owner's name for an owner and their staff |
| `POST /api/accounts/password` | A new password: `{ password, changeToken }` after a temporary one, or `{ password, current }` with the key. Signs the other devices out; returns a new key |
| `POST /api/accounts/sign-out` | Ends this device's key |
| `GET /api/accounts/options`, `POST /api/accounts/forgot/code`, `POST /api/accounts/forgot/reset` | Whether SMS is on; a code to the number; `{ phone, code, password }` sets a new password |
| `GET /owner` | Bus owners' dashboard |
| `GET /api/owner/overview?date=<YYYY-MM-DD>` | The buses now, their trips that day and the last 7 days, today's alerts, and for the owner their people (with an owner's, manager's or syndicate's key; a conductor's gets 403) |
| `GET /api/owner/live` | Where the buses are, pushed as they move (a stream; send the key in `Authorization`) |
| `POST /api/owner/people/<id>/approve` | The owner approves a conductor who signed up with their number (managers are approved by the admin) |
| `DELETE /api/owner/people/<id>` | The owner removes one of their staff, or turns down one who signed up |
| `POST /api/owner/buses`, `PUT` / `DELETE /api/owner/buses/<id>` | Add a bus `{ plate, label? }`, change it, or remove it |
| `GET /api/owner/trips.csv?from=…&to=…` | Trips as a spreadsheet, up to 62 days |
| `/api/admin/…` | The dashboard (`GET /api/admin/dashboard`), stops, routes, network import, diversion alerts, road snapping, recorded routes (contributors' too, with the stops they marked), riders' suggestions, accuracy, bus owners and their staff (add, approve, turn down, rename, set a temporary password, remove), route syndicates (the same, and their routes and members) and contributors (approve, set a temporary password, remove) (needs the admin token) |
| `/api/contributor/recordings…` | A contributor's recordings from the phone app: start one, send positions, mark a stop `{ lat, lng, ts, name? }`, finish (with a contributor's key) |

## Before launch

- Check the name: the state used "Where Is My Bus" for a Yatri Sathi feature in 2025, and a Kerala startup uses it.
- Survey real routes, or import them from OpenStreetMap and check them, and replace the demo
  data. Hours and frequencies need a survey either way.
- Start with conductors on two or three busy routes, measure how close the arrival times are,
  then add rider sharing. Sign their buses' owners up for the dashboard first: it is what makes
  owners ask conductors to keep the app on. Each conductor then signs up with their owner's
  number, and the owner approves them.
- Check each account that signs up before approving it, for example by calling the number, and
  give temporary passwords to people yourself. Put the owners' dashboard, its trip records and the
  account holders' mobile numbers in the privacy policy.
- For setting forgotten passwords by SMS, connect an SMS gateway with DLT-registered templates
  (India requires them for one-time codes) through `SMS_WEBHOOK_URL`.
- Data from OpenStreetMap: credit it and offer the GTFS feed under the ODbL.
- Serve the API and web app over HTTPS. Release builds of the phone app refuse plain HTTP, and
  browsers give location only to secure pages.
- Use a map tile provider: OpenStreetMap's own tile servers are not for apps with many users.
- Ask the West Bengal Transport Department about access to the AIS-140 tracker data; a working
  pilot makes that conversation easier.
