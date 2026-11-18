# Where Is My Bus: project plan and architecture

Version 0.3, 28 October 2026. Version 0.1 was written on 27 October 2026 and version 0.2 the same
day; sections 1.1 to 1.3 list what changed since.

This document brings together everything about the project so far: the research behind it, the
plan, the architecture of the code that has been built, how to set it up and run it, how it was
tested, and what comes next. File paths below are relative to the top folder of the code.

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

The code is written and tested end to end: a shared logic library, a backend with an admin panel,
a dashboard for bus owners, a rider web app, a bare React Native app with a small native location
module, a bus simulator and an OpenStreetMap importer. Both apps and the owners' dashboard are in
English and Bengali. Every item of the roadmap in version 0.2 is built except two that wait on
others: the state's tracker data and the rewrite of the native module (1.3, 12). Since then the
admin panel opens on a dashboard, both web layouts have a side nav, and riders can find a bus by its
route (1.4); bus owners, their staff and syndicates sign in with a mobile number and a password,
once the admin has approved them (1.5). Conductors have their own accounts, approved by their owner,
and share a bus by its number plate; contributors record routes for the admin to check (1.6).
22 browser tests pass. The
Android app builds
and passes 7 end-to-end tests on an Android 16 emulator, including a whole trip with the app in the
background and the screen off. Not yet proven: the iOS app, which has not been compiled (it is not
needed yet), and the Android app on real phones of the brands common in India. Real route data can
now be imported (216 Kolkata routes from OpenStreetMap), but its stops, hours and frequencies still
need checking on the ground.

The hardest problem is not the code. It is getting enough phones onto enough buses. So the plan
launches the features that need no live data first (journey search and the stop alarm), then puts
conductors' phones on two or three busy routes, then adds rider sharing. In parallel, it asks the
state for access to the trackers that are already fitted to buses.

Two findings from this version's research change the plan. Pathadisha, named as the competitor in
version 0.1, appears to be defunct. And news reports from 2025 say the state's Yatri Sathi app added
live bus tracking under the name "Where Is My Bus"; but when the project owner checked the app on
28 October 2026 it showed no live bus status, so the feature may have been withdrawn. There may be
no live-bus app for Kolkata at all today, which is an opening; the name has still been used by the
state, so check it before release.

### 1.1 What changed in version 0.2

| Area | Change | Section |
|---|---|---|
| Research | Pathadisha appears defunct. Yatri Sathi's "Where Is My Bus" live tracking was reported in 2025 but not found in the app on 28 October 2026. Bus trackers are fitted but many are failing. No Kolkata GTFS exists, but OpenStreetMap maps about 200 routes | 3.3, 4.4 |
| Name | "Where Is My Bus" was used by the state for that feature, and by a Kerala startup: check it before any public release | 11, 13 |
| Rider web app | New: the five screens of the phone app plus a conductor screen, served by the backend with no build step. Works offline after one visit. Lets testers and conductors start without installing anything | 5, 6.12, 10 |
| Real data | New importer seeds stops and road paths from OpenStreetMap; hubs, hours and frequencies still need a survey | 6.13, 10 |
| Simulator | New: simulated conductor and rider phones through the real API, for demos, tests and load tests | 8.5, 9 |
| Live waits | A tracked bus sets the wait only when it comes sooner than the usual wait; buses not heard from for 2 minutes never set a "Live" wait | 6.5.2, 6.5.4 |
| Tracking fixes | Phones on one bus that start apart are merged; two conductors are always two buses; riders walking to the stop are not ended; no arrivals at a route's last stop; phone clocks that are wrong are corrected | 6.5.4 |
| Stop alarm fixes | A fix can no longer snap to the far side of a route that doubles back and end the trip before the alarm; a trip started on the way to the stop is not ended | 6.5.5 |
| Phone app | Setup done for React Native 0.88: native projects generated, a broken `tsconfig` fixed, one type error fixed, plate digits fixed, a sharing rule changed. The Android app now builds and passes 6 end-to-end tests on an Android 16 emulator | 6.8, 9 |
| Security | Admin page refuses inline scripts and checks its CDN files' integrity; the web app has a strict policy and sends nothing to a CDN | 6.7, 6.11 |
| Privacy | Trip positions are pseudonymous, not anonymous; DPDP Rules dates added | 6.11 |
| Testing | 63 unit and API tests (was 43), 11 browser tests, a load test, type checks against the real React Native types | 9 |

### 1.2 Added after version 0.2: the bus owners' dashboard

| Area | Change | Section |
|---|---|---|
| Owner dashboard | New page at `/owner`: each of an owner's buses now (on a map, with its next stop), the trips it ran, day and 7-day totals, any earlier day, a spreadsheet of up to 62 days | 5, 6.14 |
| Conductor codes | Each bus an owner adds gets its own 8-digit code. Sharing with it makes the phone a conductor's and keeps the bus's trips for the owner; the shared `CONDUCTOR_CODE` still works. Replaced by conductor accounts in 1.6 | 4.2, 6.6 |
| Admin panel | New "Bus owners" tab: add an owner and send them a sign-in link, make a new link, rename or remove them | 6.7 |
| Tracking | A bus shared with its own code is known by it: two phones on it are one bus, and two buses whose plates end in the same digits stay apart. Since 1.6 the bus is known by its plate instead | 6.5.4 |
| Security | After 10 wrong conductor codes from one network in 15 minutes, codes from there are not checked until the 15 minutes are up (gone with the codes in 1.6). Owners' keys are stored only as hashes | 6.6, 6.11 |
| Privacy | A trip summary, not positions, is kept for owners' buses, for 90 days. Conductors are told before and during sharing that the owner sees the bus's trips | 6.11, 6.14 |
| Web app | Its service worker no longer answers for `/owner`: on a slow or lost connection it showed the rider app there, in a browser that had opened the rider app | 6.12 |
| Phone app fix | A bus standing still (at a stop, at the terminus, in a jam) went silent: the trip service asked for a position only after 20 m, and positions are sent only when a new one arrives. After 2 minutes the bus looked lost to riders and to its owner. The service now reports every 10 s, moving or not. Found by the new Android test | 6.9 |
| Both apps | Ending a trip sends the positions not yet sent first, so the trip ends where the bus really was | 6.12, 6.14 |
| Testing | 74 unit and API tests (was 63) and 13 browser tests (was 11) | 9 |

### 1.3 Version 0.3: the roadmap built, a new design, Bengali

The project owner asked for everything on the roadmap (section 12 of version 0.2) except the state's
tracker data and the Turbo Native Module, a more professional look, and app icons with a splash
screen. Storage stays in files behind small interfaces, so PostgreSQL and Redis can replace them
later without changing the rest (6.15).

| Area | Change | Section |
|---|---|---|
| Design | A logo (a map pin holding a bus front), app icons for Android (adaptive, with a themed monochrome layer) and iOS, the Android 12+ splash screen, web app icons. The web app, the phone app, the owners' dashboard and the follow page share one look: Kolkata blue, slate route boards with yellow numbers, Hind Siliguri and Teko served with the app, line icons from Lucide | 6.10 |
| Bengali | Every screen of both apps, the owners' dashboard and the follow page in English or Bengali, with a switch; Bengali stop names and digits; route numbers as painted. A test fails if any text lacks Bengali | 6.16 |
| Family follow link | A rider sharing a bus sends a link; the page shows the bus, its next stop and when it reaches the rider's stop, until an hour after the trip | 5, 6.6 |
| Reports without location | "This bus just left" at a stop counts once a second person agrees or a tracked bus was there; people further along see what riders saw, never as Live | 6.5 |
| Riders' fixes | Suggestions from both apps go to a review queue in the admin panel | 6.7 |
| Record-route mode | Staff ride a route once; the path becomes the road path and the halts become suggested stops, applied in the admin panel | 6.7 |
| Learned travel times | Each stretch's time by hour and kind of day, learned from tracked buses, replaces the flat estimate in arrival times and in both apps' journeys; an accuracy report per route | 6.5 |
| Late tracked buses | Where conductors cover nearly every bus of a route, a tracked bus later than the usual wait sets the wait | 6.5.2 |
| The Metro, trains and ferries | Routes have a mode and a line colour; journeys combine buses with the Metro and ferries; a demo with the Blue Line and a ferry | 5, 6.4 |
| GTFS export | The network as a GTFS feed at `/api/gtfs.zip`: frequency-based trips timed from learned times, diversions on their dates, shapes, Bengali names | 6.6 |
| Owners | Phone sign-up and sign-in with a one-time code by SMS (through the operator's gateway), checked by the admin before buses can be added; managers with their own links; alerts when a trip stops short or goes quiet, also as notifications; route syndicates' read-only view; the bus's code remembered on the conductor's phone (codes were replaced by conductor accounts in 1.6) | 6.14 |
| Live pushed to pages | Journey maps and owners' dashboards get bus positions pushed (server-sent events) instead of asking every few seconds | 6.6, 6.15 |
| Security | The admin panel serves its map library and fonts itself and refuses scripts from anywhere else; phone numbers kept only as keyed hashes; a replaced key ends its live stream | 6.11 |
| Fix | Ending a trip in the web app sends its last positions and the end with `keepalive`, so they arrive even if the page is closed at once (a browser test found the gap) | 6.12 |
| Testing | 127 unit and API tests (was 74), 17 browser tests (was 13), the Android tests again | 9 |

### 1.4 After version 0.3: a dashboard, side menus, finding a bus by its route

The project owner found the route editor not working, and asked for a dashboard with all the
details, a side nav that folds away, sign-in only for admins, bus owners and syndicates (riders
never sign in), and a way for riders to find buses by route.

| Area | Change | Section |
|---|---|---|
| Route editor | While a direction is built, a click on the road where there is no stop adds a stop there (its name typed in the panel), and a click near a stop picks it. Before, only a click exactly on a stop's small dot counted, so on a road with no stops nothing happened | 6.7 |
| Admin dashboard | The admin panel opens on a dashboard: buses on the road on a map and by route, phones sharing, owners' trips today by the hour they started, the network's size, arrival-time accuracy, and a list of what needs a look, each with a link to it. From `GET /api/admin/dashboard`, refreshed every 15 seconds | 6.6, 6.7 |
| Admin side nav | The tabs became a side nav with icons and counts of what waits. It folds to its icons (remembered), and on a narrow screen it is a rail that opens over the page. The token is now kept for the browser tab, so a reload stays signed in | 6.7, 6.11 |
| Rider web app side nav | Plan a journey, Find a route, Share your bus, Suggest a fix, and set apart under Sign in: Admin, Bus owner, Route syndicate. On a wide screen it stays beside the app and folds to its icons; on a phone it slides out from a menu button. Beside it the app takes the width, with its content in a readable column | 6.12 |
| Find a route | By the number painted on the bus (in any spacing or case, or in Bengali digits), its name, or a place it goes to; every route when nothing is typed; a route number typed in the From or To search offers the route too. A route's page has its directions, hours, how often it runs now, its stops on a line and on the map, and the tracked buses, placed between the stops they are between and moved as they report | 6.3, 6.12 |
| Syndicate sign-in | `/owner?as=syndicate`: the owners' page worded for a syndicate, which signed in with its link only. Replaced by `/signin` in 1.5 | 6.14 |
| Testing | 131 unit and API tests, 21 browser tests | 9 |

### 1.5 Signing in with a mobile number and a password

The project owner asked for one sign-in page, with a mobile number and a password, for bus owners,
syndicates and the other people who run the buses (not riders), allowed only once the admin has
approved the account. It replaces the sign-in links and the sign-in codes by SMS; an SMS code now
only sets a forgotten password, where there is a gateway.

| Area | Change | Section |
|---|---|---|
| Sign-in page | `/signin`: sign in, or create an account as a bus owner, an owner's staff (with the owner's number) or a route syndicate. In English and Bengali, like the owner page; the server's answers too | 6.14 |
| Approval | A new account cannot sign in until the admin approves it; only someone with the right password is told it waits. The admin sees the number in full, to call and check, and approves or turns it down; for a syndicate, the admin also chooses its routes and members. The admin's nav and dashboard count the accounts waiting | 6.7, 6.14 |
| Passwords | Salted scrypt hashes. At least 8 characters, not the mobile number, not a common one. Ten wrong passwords for a number stop it for 15 minutes, from any network; 20 from one network stop it too | 6.11 |
| Temporary passwords | The admin adds an owner or a syndicate, or helps someone who forgot theirs, with a temporary password shown once; it only lets them choose their own | 6.7 |
| Devices | Each device signed in has its own key; signing out ends it; a new password signs every other device out | 6.11 |
| Forgotten passwords | With an SMS gateway, a code by SMS sets a new one; the answer is the same for numbers without an account, and only accounts get an SMS. Without one, the admin sets a temporary password | 6.14 |
| Owner page | Sends anyone not signed in to `/signin`; an account card with a password change; staff waiting for approval shown under People, where the owner can remove them | 6.14 |
| Rider app | One sign-in link for owners, staff and syndicates, and one for the admin | 6.12 |
| Testing | 134 unit and API tests, 21 browser tests | 9 |

### 1.6 Conductor accounts and contributors

Conductor codes are gone. A code could be passed on or written down, and it told the server
nothing about who shared the bus. Conductors now have accounts, approved by their own owner, and a
new kind of account lets people who know the buses record routes for the team to check.

| Area | Change | Section |
|---|---|---|
| Conductor accounts | A conductor signs up on `/signin` (or in the phone app) with their own mobile number, a password and their owner's mobile number. Their owner approves them on the dashboard; the admin can too. Signed in, they share one of the owner's buses by typing its number plate as they start (spaces, dashes and small letters do not matter). A plate that is not one of the owner's buses is refused, in plain words | 4.2, 6.6, 6.14 |
| Conductor codes removed | No codes on buses, no "New code", no `CONDUCTOR_CODE` setting, no `--code` for the simulator (it takes `--key` and `--plate` instead). The wrong-code limit went with them: a conductor's key is as hard to guess as an owner's | 6.6, 6.11 |
| Owner page | Conductors are listed under People with their role; a waiting conductor has an Approve button, and the owner removes any of their staff. A conductor's account does not open the dashboard: it only shares buses | 6.14 |
| Rider web app | "Share your bus" asks a conductor to sign in on `/signin` (the same key, on the same site), then for the route, the direction and the plate. On a journey, "I'm on this bus" offers "I'm the conductor", with the whole plate, to someone signed in as a conductor, owner or manager. The plate typed last is remembered | 6.12 |
| Contributors | A new account, approved by the admin. In the phone app they record a route from inside a bus, marking each stop as the bus reaches it and naming it if they like. Their recordings come to the admin panel's Record a route, marked with who made them and their marked stops; the admin checks each one and uses it for a route direction, where a new stop keeps the name the contributor typed | 6.7 |
| Admin panel | A Contributors list under Bus owners (approve, temporary password, remove, how many recordings); waiting contributors in the waiting list; "by" and marked stops on recordings | 6.7 |
| Sign-in page | Two more choices, "A conductor" and "A contributor". A conductor signed in goes to the web app's "Share your bus"; a contributor is told to record routes in the phone app, and this device does not stay signed in | 6.14 |

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

**The GPS exists but is locked away, and much of it does not work.** West Bengal's transport
department began an AIS-140 vehicle tracking system for public transport vehicles from 1 December
2022, linked to a state backend that C-DAC runs, and in 2025 made a working tracker a condition for
passing the fitness test. About 1.58 lakh buses and other vehicles had trackers by November 2024.
Version 0.1 said all 32,000 private buses have one; that figure could not be confirmed (the nearest
is "over 30,000 buses and taxis" in 2023). The devices are failing: the department blacklisted nine
device makers in June 2025, and in July 2026 the transport minister gave the state's vendor 48 hours
to fix devices that "cannot be recharged and have become inactive". No public API or data-sharing
policy was found. The constraint is therefore about access and reliability, not absence. A
data-sharing arrangement with the Transport Department, or with owners through their tracker
vendor, would still be the single biggest improvement available, but phones on board are needed
either way.

**There is a precedent for sharing.** Google worked with WBTC in 2017 to show real-time arrivals
for its Kolkata buses on Google Maps, its first real-time transit launch in India. No evidence was
found that this still works.

**The state tried live bus tracking in Yatri Sathi; it is not there now.** Yatri Sathi, the state's
app built on the open-source Namma Yatri platform, sells WBTC bus tickets. News reports say that on
11 May 2025 it added a feature called "Where Is My Bus": live tracking, arrival times, route maps
and fares for 60 government buses on 16 routes at launch, with a target of over 1,000 buses on 40
government and 25 private routes. On private routes 223 and 45 it tracked a phone on the bus,
registered to the owner, and operators complained about the data it used and about phones dying
"after just two trips". But when the project owner checked the app on 28 October 2026, it showed no
live bus status. The feature may have been withdrawn, perhaps after the change of state government
in May 2026, or limited to some routes; that is not known. Pathadisha, the commuter app named as the
competitor in version 0.1, appears to be defunct: its last Android release was in January 2022, and
it was removed from Google Play in 2024. So there may be no app showing live Kolkata buses today.
That is an opening, and a warning: the state's own attempt, with phones on private buses, ran into
the same problems this project faces (4.4).

**Open route data is partial.** There is no Kolkata GTFS feed (the Mobility Database and Transitland
list none). OpenStreetMap has 405 route relations tagged "Kolkata Private Bus" and a few for WBTC,
which is about 200 routes in both directions, each with its number, its ends and its road path.
Most list no stops, but about 550 named bus stops are mapped in the city, so stops can be matched
along the paths (6.13). Some big stops, such as Esplanade and Howrah Station, are missing.

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
trips it ran, so the owner dashboard (6.14) gives them a reason to have the conductor keep the app on.
A 24 V USB charger in the bus covers a full shift. A conductor's phone is trusted more than a
rider's, but only when the conductor is signed in with the account their owner approved, and shares
one of that owner's buses by its number plate, which also puts the bus on the owner's dashboard.

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

### 4.4 Standing out from Yatri Sathi and Google Maps

Yatri Sathi sells government bus tickets, and in 2025 showed live government buses; that was not in
the app when checked on 28 October 2026. If it comes back, it will most likely cover government
buses, where the state's trackers are. This app competes on things a commuter notices: private and
mini buses, which are most of Kolkata's buses; journey search that works offline and instantly,
including one change; search that understands Bengali script, local names and Banglish spellings;
routes grouped as "whichever comes first" with an honest combined wait; a clear difference between
live and usual times; a stop alarm; and a web app that needs no install. It should learn from the
state's private-route trial: budget the data and battery a conductor's phone uses (batched uploads
every 15 s, no tracking outside a trip), and require a charger for conductors.

There is a second path worth testing early: offering the app, its private-bus coverage or its data
to the Transport Department, which has tried live tracking itself, as a partner rather than a
competitor. A working pilot is the strongest argument either way.

## 5. Features

| Feature | Status |
|---|---|
| Journey search: direct and one change, walking at both ends, grouped parallel routes, works offline | Built |
| Stop and landmark search: English, Bengali script, local names, Banglish spellings, typos | Built |
| Routes not running at the time are left out, with first and last bus shown | Built |
| Time-window variants (one-way roads that flip during the day) and dated diversions | Built |
| Live arrival times and live buses on the map | Built (server, phone app and web app) |
| "I'm on this bus": stop alarm, next stop, ends by itself when you get off | Built. Tested end to end in the web app, and in the Android app on an emulator with the screen off; iOS not yet built |
| Pseudonymous sharing of the bus position; a rider is put on the bus they are next to, nothing to type | Built |
| Conductor mode for conductors signed in with the account their owner approved, sharing one of the owner's buses by its plate | Built; the web app also has a conductor screen that starts from the route |
| Location-permission ladder, map picking, recent places | Built |
| Rider web app: every rider screen and the conductor screen, offline after one visit, nothing to install | Built and tested end to end |
| Admin panel: stops, routes, directions, frequencies, variants, diversions, road snapping, import and export | Built |
| Likely-diversion alerts from riders leaving a route at the same place | Built |
| Route import from OpenStreetMap: route numbers, ends, road paths and stops | Built; the data needs checking |
| Bus simulator for demos, tests and load tests | Built |
| Owner dashboard: each bus now, the trips it ran, day and 7-day totals, earlier days, spreadsheet download | Built and tested end to end in the browser and through the API |
| Owners: sign-up and sign-in with a mobile number and a password after the admin's approval, managers, conductors approved by their owner, alerts and notifications, route syndicates | Built and tested end to end (the SMS goes through the operator's gateway) |
| Both apps, the owners' dashboard and the follow page in English or Bengali | Built and tested end to end in the browser; the Android app's Bengali checked by hand |
| New design, logo, app icons, splash screen | Built; the Android icon and splash checked on the emulator, iOS needs a Mac |
| Link for family to follow a rider's bus | Built and tested end to end |
| "Bus just passed this stop" button for people without location | Built and tested through the API; in both apps |
| Riders' suggested fixes, reviewed in the admin panel | Built and tested through the API; in both apps |
| Record-route mode for surveying routes | Built and tested through the API; in the admin panel, and for contributors in the phone app, with stops they mark and name |
| Learned travel times, and an arrival-time accuracy report | Built and tested; used offline by both apps |
| Late tracked buses trusted where coverage is high | Built and tested |
| Journeys combining buses with the Metro, trains and ferries | Built and tested on a demo with the Blue Line and a ferry |
| GTFS export | Built and tested; a standard reader opens the zip |
| Live buses pushed to open pages | Built and tested for the web app and the owners' dashboard; the phone app still asks every 10 s |
| Find a bus by its route number, name or a place it goes to; route pages with live buses | Built and tested end to end in the web app; not in the phone app yet |
| Admin dashboard, and a side nav that folds away in the admin panel and the web app | Built and tested end to end |
| Sign-in only for the people who run the buses: bus owners, their managers and conductors, syndicates and contributors on `/signin` with a mobile number and a password, once approved; the admin with the token | Built and tested end to end; riders never sign in |
| Government tracker data (AIS-140) | Not started: waits on the state (12) |
| Native module rewritten as a Turbo Native Module | Not started (12) |

## 6. Architecture

### 6.1 System overview

```text
   Riders' phones: the app, or the web app       Conductors' phones
   in a browser (journey search offline,         (same apps, signed in, with the
   stop alarm, optional sharing)                  plate of one of their owner's buses)
          |                                                |
          |   HTTPS: network download, arrivals,           |
          |   live buses, trips, positions                 |
          v                                                v
   +--------------------------------------------------------------+
   |                      Backend (Node 22+)                      |
   |                                                              |
   |   Public API      Live engine (in memory)      Admin API     |
   |   Web app files         |                         /          |
   |        \                |                        /           |
   |         +------ shared core library ----------+              |
   |                 (planner, search, snapping)                  |
   |                          |                                   |
   |              Network file (JSON, versioned)                  |
   |                                                              |
   |   Owner API: owners file, owners' trips (one file a day)     |
   +--------------------------------------------------------------+
          ^                    ^                     |
          | admin token        | owner's key         | optional
          |                    |                     v
   Admin panel in a browser  Owner dashboard    OSRM server that you run
   (stops, routes, owners)   (buses and trips)  (draws road paths between stops)

   Tools: bus simulator (through the API), OpenStreetMap importer (writes a network file)
   Later: state AIS-140 tracker feed, PostgreSQL/PostGIS for trip history,
          Redis for live state across several servers.
```

The same TypeScript library runs on the server, inside the app and in the browser. The app
downloads the whole network (a few megabytes at most: 2.6 MB for the 216 routes imported from
OpenStreetMap, with road paths) and plans journeys on the phone, so results are instant and work
offline; it then asks the server for live arrivals and re-ranks the options. The server keeps live
buses in memory and saves the network as one versioned JSON file. Each admin change raises the
version, and phones download the new copy the next time they open the app. The server sends the
library's TypeScript files to browsers with their types stripped, as Node itself runs them, so the
web app plans with exactly the server's code and there is still no build step.

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
    src/trip.ts                    trip tracker (runs on the phone and in the web app)
    src/describe.ts                wording of live and usual waits, shared by both apps
    src/routes.ts                  finding a route by its number, its name or a place it goes to
    test/                          70 tests
  backend/                         API, live tracking, admin panel, owner dashboard; no runtime dependencies
    src/server.ts                  routes, admin edits, start-up
    src/http.ts                    router, JSON bodies, rate limits
    src/static.ts                  web app files, TypeScript sent with types stripped
    src/store.ts                   saving the network file safely
    src/owners.ts                  bus owners, their staff and buses, syndicates and contributors
    src/triplog.ts                 owners' buses' trips: what each trip covered, one file a day
    src/dashboard.ts               what the owner dashboard shows, and its spreadsheet
    src/admin-dashboard.ts         what the admin dashboard shows
    public/admin.html, admin.js    admin panel (one page, plain JavaScript)
    public/owner.html, owner.css, owner.js   owner dashboard (one page, plain JavaScript)
    src/passwords.ts               password hashes, rules and temporary passwords
    public/signin.html, signin.js  the sign-in page for owners, their staff, syndicates and contributors
    test/                          55 end-to-end API tests
  web/                             rider web app, served by the backend as it is
    index.html, app.css, sw.js     page, styles, service worker for offline use
    src/                           state, trip service, location, alarm, map, side nav, nine screens
    vendor/leaflet/                Leaflet 1.9.4 (BSD), served with the app
  tools/                           no runtime dependencies
    simulate.ts                    simulated buses through the API; load tests
    import-osm.ts                  network from OpenStreetMap route relations
    test/                          9 tests
  e2e/                             22 browser tests (playwright-core and the installed Chrome)
  mobile/                          bare React Native 0.88 app
    android/, ios/                 native projects from the 0.88.1 template, set up
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
| `describe.ts` | The words riders read about a wait, the same in both apps | `waitText`, `laterTrackedText` |

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
5. **Wait time.** Routes running every h₁, h₂, … minutes together give a bus every
   H = 1 / (1/h₁ + 1/h₂ + …) minutes, so the usual wait is H / 2, and the ride time is averaged
   weighted by frequency. For example, every 10 and every 15 minutes together means one about every
   6 minutes, so about 3 minutes' wait. A tracked bus that can still be caught after walking to the
   stop sets the wait, labelled "Live", only when it comes sooner than the usual wait. Most buses are
   not tracked yet, so a tracked bus 25 minutes away does not mean no bus comes for 25 minutes; then
   the usual wait stands and the app adds "A tracked D2 is 25 min away". (Version 0.1 let any
   tracked bus set the wait, which made tracked routes look slower than untracked ones.) A bus not
   heard from for 2 minutes never sets a "Live" wait. Once conductors cover nearly every bus on a
   pilot route, a late tracked bus does mean a gap; trusting it then is on the roadmap (12).
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
   number-plate digits that differ (two buses racing side by side) or both are conductors' (each
   bus has one conductor). Otherwise it starts a new vehicle. A phone more than 350 m from its
   vehicle splits off. Two vehicles of the same direction that stay within 60 m of each other for
   45 seconds are merged, under the same two exceptions: two phones on one bus often start far
   apart, because the first fixes after GPS starts are poor. A bus shared by its signed-in
   conductor (6.14) is known by its plate instead: phones on the same registered bus are one bus,
   even two conductors' phones, and phones of two registered buses never join, even when their
   plates end in the same four digits.
5. A vehicle's position is its conductor's, if it has one; otherwise the median of its riders.
6. Arrival time = distance to the stop ÷ cruise speed + 25 seconds per stop on the way, where cruise
   speed = 0.4 × observed speed (at most 15 m/s) + 0.6 × 14 km/h, because observed speed swings
   wildly in Kolkata traffic. Between reports, the bus is moved forward at cruise speed for at most
   2 minutes; the map and the arrival times use the same estimate.
7. Confidence is **high** for a conductor or two or more riders, **medium** for one rider, and **low**
   once nothing has been heard for 2 minutes. After 10 minutes the bus is dropped.
8. When two or more riders of the same route leave its path within 250 m of each other inside 30
   minutes, the admin panel shows a likely diversion. Only riders who were on the route count, so
   people who start a trip while still walking to a stop do not raise false alarms.
9. A phone that has not yet been on the route is still walking to the stop: it is told to stop
   sharing only after 10 minutes, not 90 seconds.
10. A phone whose clock is wrong would have every position rejected as old. When a batch says what
    the phone's clock read as it was sent (`sentAt`), and the positions fit that clock, they are
    moved onto the server's clock.

When no bus is tracked, arrivals fall back to the usual frequency: half the time between buses,
marked "usual". A route's last stop gets no arrivals, since a bus arriving there takes nobody
further.

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

Two rules were added in version 0.2, because without them the alarm could fail. Each fix is looked
for only as far ahead as a bus could have gone since the last one (25 m/s, at least 400 m): on a
route that doubles back, a noisy fix could otherwise snap to the far side, "pass" the destination
and end the trip before the alarm rang. And a trip started on the way to the stop, before the phone
has been on the route, ends only after 10 minutes off it.

When the server thinks the rider has got off but the phone does not, the phone stops sharing and
keeps the alarm: it sees every fix, and the server may not.

### 6.6 Backend

A plain Node HTTP server with no runtime dependencies. Node 22.18 and later runs TypeScript
directly, so there is no build step.

**Admin edits** go through one queue: copy the network, apply the change, check it with
`validateNetwork`, raise the version, save to a temporary file and rename it over the real one (so a
crash never leaves half a file), then swap the new network into memory. If the check fails, nothing
changes and the admin sees every problem in plain words.

**Storage.** Phase 1 keeps the whole network in one JSON file, because a few hundred routes is only
a few megabytes and planning runs in memory anyway. Live buses are only in memory; after a restart,
phones start a new trip by themselves. Bus owners and their buses are in a second JSON file, saved
the same safe way. Owners' buses' trips are summaries in one file of JSON lines a day (6.14); the
trips running when the server stops are saved too, so they carry on after the restart. That is
enough for a pilot; PostgreSQL/PostGIS comes in with learned travel times (section 12).

| Method and path | What it does |
|---|---|
| `GET /` | Rider web app, with `/web/…`, `/packages/core/src/…` (TypeScript sent as JavaScript), `/sw.js` and `/manifest.webmanifest`. Only files inside those folders, with known extensions, are served |
| `GET /api/health` | Status, network version, trips and buses being tracked. `HEAD` works too, for health checks |
| `GET /api/network?since=<version>` | Whole network; `304` if the app already has this version |
| `GET /api/search?q=<text>&limit=<n>` | Stops and landmarks matching the text |
| `GET /api/plan?from=…&to=…&time=HH:MM&date=YYYY-MM-DD` | Journey options. `from` and `to` are `stop:<id>` or `<lat>,<lng>`. Uses live buses when no time or date is given |
| `GET /api/arrivals?stops=<id>,<id>` | Next buses at up to 20 stops, live or usual |
| `GET /api/patterns/<id>/vehicles` | Tracked buses on one route direction |
| `POST /api/trips` | Start sharing. A rider: `{ patternId }`; the apps no longer ask riders for the plate (an optional `plate`, its last 4 digits, is still taken from older apps). A conductor: `{ patternId, role: conductor, plate }` with their key (or their owner's or a manager's) in `Authorization`; 401 without a valid key, 400 if the plate is not one of the owner's buses. Returns `{ sessionId, role }`, and for a conductor `bus: { plate, owner }`, so the app can tell them who sees the trip |
| `POST /api/trips/<id>/pings` | Positions: `{ pings: [{ lat, lng, accuracy, speed, heading, ts, mock }], sentAt? }`, 1 to 120 at a time. `sentAt` is the phone's clock when sending, on the same clock as `ts` |
| `POST /api/trips/<id>/end` | Stop sharing |
| `GET /admin` | Admin panel |
| `GET /api/admin/whoami` | Checks the admin token; says whether road snapping is on |
| `GET /api/admin/dashboard` | What the dashboard shows: the network's size and gaps, buses and phones on the road now, owners and syndicates, owners' trips today by hour and their alerts, suggestions waiting, accuracy per route |
| `PUT` / `DELETE /api/admin/stops/<id>` | Add, change or remove a stop. A stop still used by a route cannot be removed |
| `PUT` / `DELETE /api/admin/routes/<id>` | Add, change or remove a route |
| `PUT /api/admin/network` | Replace the whole network (import) |
| `GET /api/admin/alerts` | Likely diversions |
| `POST /api/admin/snap` | Road path between stop positions, from your OSRM server |
| `GET` / `POST /api/admin/owners` | List bus owners with their buses and people (numbers in full); add one `{ name, phone }`, which returns a temporary password once |
| `PUT` / `DELETE /api/admin/owners/<id>` | Rename an owner, or remove them (or turn down their sign-up) with their buses (their trips stay until they expire) |
| `POST /api/admin/owners/<id>/approve`, `POST /api/admin/owners/<id>/people/<id>/approve` | Approve an owner, or one of their staff (a manager, or a conductor), who signed up |
| `DELETE /api/admin/owners/<id>/people/<id>` | Turn down or remove one of an owner's staff |
| `POST /api/admin/owners/<id>/people/<id>/password`, `POST /api/admin/syndicates/<id>/password` | A temporary password, shown once (`{ phone }` for an account without one); every device is signed out |
| `POST /api/admin/syndicates/<id>/approve` | Approve a syndicate that signed up: `{ name, routeIds, ownerIds }` |
| `GET /api/admin/contributors` | Contributors, with their numbers in full, password state, devices and how many recordings |
| `POST /api/admin/contributors/<id>/approve`, `POST /api/admin/contributors/<id>/password`, `DELETE /api/admin/contributors/<id>` | Approve a contributor; a temporary password, shown once (`{ phone }` for one without a number); remove them (their recordings stay) |
| `GET /api/admin/recordings`, `GET /api/admin/recordings/<id>` | Recordings, the admin's and contributors' (`by`, and `marks`: how many stops were marked); one with its path and halts, a marked halt carrying `marked` and the `name` typed |
| `POST /api/admin/recordings/<id>/apply` | Use a finished recording for a direction: `{ routeId, patternId, stops? }`. With `stops`, a halt near a stop uses it; others become new stops, named as the contributor typed, if they did |
| `GET /signin` | Sign-in for bus owners, their staff and conductors, route syndicates and contributors |
| `POST /api/accounts/sign-up` | A new account, waiting for approval: `{ kind: owner\|manager\|conductor\|syndicate\|contributor, name, orgName?, ownerPhone?, phone, password }`. Managers and conductors give their owner's number; a conductor is approved by that owner |
| `POST /api/accounts/sign-in` | `{ phone, password }`: a key and the kind of account (owner, manager, conductor, syndicate or contributor); after a temporary password, a change token instead. 403 while the account waits |
| `GET /api/accounts/me` | Who a key signs in: `{ kind, name, phoneEnd, owner }`, `owner` being the owner's name for an owner and their staff |
| `POST /api/accounts/password` | A new password with the change token, or with the present password and the key; every other device is signed out |
| `POST /api/accounts/sign-out` | Ends this device's key |
| `GET /api/accounts/options`, `POST /api/accounts/forgot/code`, `POST /api/accounts/forgot/reset` | A forgotten password, with a code by SMS where there is a gateway |
| `GET /owner` | Owner dashboard |
| `GET /api/owner/overview?date=<YYYY-MM-DD>` | With the owner's key: each bus now, its trips that day and in the last 7 days, and all the owner's trips that day; for the owner, their people. A conductor's key gets 403 here, and on the other dashboard routes |
| `POST /api/owner/people/<id>/approve`, `DELETE /api/owner/people/<id>` | The owner approves a conductor who signed up with their number; removes one of their staff |
| `POST /api/owner/buses` | Add a bus: `{ plate, label? }` |
| `PUT` / `DELETE /api/owner/buses/<id>` | Change a bus's plate or name, or remove it. Only the owner's own buses |
| `GET /api/owner/trips.csv?from=…&to=…` | The owner's trips as a spreadsheet, up to 62 days |

| Setting (environment variable) | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `ADMIN_TOKEN` | a new random token each start, printed to the console | Password for the admin panel and admin API |
| `OSRM_URL` | none, so road snapping is off | Your OSRM server |
| `DATA_FILE` | `backend/data/network.json` | Where the network is saved; created from the demo data on first start |
| `OWNERS_FILE` | `owners.json` next to `DATA_FILE` | Bus owners and their staff (with hashes of their keys), their buses, syndicates and contributors |
| `TRIPS_DIR` | `trips` next to `DATA_FILE` | Owners' buses' trips, one file a day, and the trips running at the last stop |
| `TRIP_HISTORY_DAYS` | `90` | Days of owners' trips to keep; older days are deleted |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits see real addresses |
| `PUBLIC_URL` | `http://localhost:<port>` | Where riders reach the server; used in the GTFS feed |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN` | none, so the admin sets forgotten passwords | The SMS gateway for the codes that set a forgotten password: it gets `{ "to", "text" }` as JSON, with the token as a bearer token |
| `SMS_TO_LOG` | off | `1` writes the codes to the server's log instead, for trying phone sign-in out |

| Limit | Value | Why |
|---|---|---|
| Trips started | 300 per minute per IP address | Generous, because Indian mobile networks put many users behind one address |
| Position batches | 40 per minute per trip | The real protection against flooding |
| Searches, plans, arrivals | 1,200 per minute per IP address | Same reason as trips |
| Request size | 4 KB for a trip, 64 KB for positions, 5 MB for a route, 50 MB for an import | Stops oversized requests |

### 6.7 Admin panel

One web page served by the backend, written in plain JavaScript, with Leaflet maps and
OpenStreetMap tiles. A side nav with icons leads to each part, with a count beside the parts where
something waits (owners to approve, suggestions, likely diversions); it folds to its icons, which it
remembers, and on a narrow screen it is a rail of icons that opens over the page. What an admin can
do:

- Start on the dashboard, which updates every 15 seconds: headline numbers (buses on the road, by
  conductors and by riders; phones sharing; owners' trips today, their buses and distance; routes,
  directions and modes; stops and landmarks; owners, their buses and syndicates), the buses on a
  map and by route, owners' trips today by the hour they started (a bar chart with the numbers on
  hover and as a table), arrival-time accuracy for the last 7 days, the network's details, and a
  list of things to look at, each with a link to the part that deals with it: owners waiting for
  approval, riders' suggestions, likely diversions, owners' buses that stopped sharing or went
  quiet, stops no route uses, directions without a road path.
- Add, move, edit and delete stops on the map, with Bengali names and other names.
- Build a route by clicking stops in order on the map, reorder or remove them, and add the return
  direction with one click. A click on the road where there is no stop yet adds one there: the panel
  asks for its name (and Bengali name), saves the stop and puts it next in the direction. A click
  within 18 pixels of a stop picks that stop, so the small dots need not be hit exactly.
- Set first and last bus, the usual frequency and busy-hour frequencies.
- Add a time window ("only 05:00 to 13:00") or a dated diversion that replaces a normal direction.
- Snap a direction's path to real roads with an OSRM server. Straight-line paths show as dashed.
- See likely diversions and jump to them on the map.
- Export the network as one file, or import one (it is checked first).
- Approve, or turn down, the bus owners, their staff and the syndicates who signed up on `/signin`,
  listed first under Bus owners with their mobile numbers in full, so the admin can call and check;
  a syndicate's routes and members are chosen as it is approved. The nav and the dashboard count
  them.
- Add an owner or a syndicate with a temporary password, shown once; give anyone who forgot theirs
  a new temporary password, which signs them out everywhere; rename or remove an owner, remove
  their staff; see each owner's buses and who signs in for them, managers and conductors.
- Approve contributors, who sign up on `/signin` to record routes with the phone app; give them a
  temporary password, or remove them (their recordings stay). The Contributors list under Bus owners
  shows each one's number in full, whether they wait, their devices and how many recordings they
  made.
- Record a route by riding it with the panel open on a phone, or check a contributor's: each
  recording says who made it and how many stops they marked. On the map a marked stop has a
  thicker ring, and a list gives each marked stop's name and whether a stop is already there. Used
  for a direction, the recording's path becomes the road path and, if asked, its halts the stops; a
  new stop keeps the name the contributor typed.

Security: the admin token is kept in the browser tab's session storage, so a reload stays signed in;
it goes when the tab is closed or the admin signs out, other tabs do not get it, and a token the
server no longer accepts is dropped at the next load. (Until the dashboard was added it was kept in
memory only; to go back to that, remove `keepToken` and `storedToken` in `admin.js`.) Everything
shown is built with DOM methods rather than HTML strings, so data cannot inject scripts; and the page
is served with a content security policy, `X-Frame-Options: DENY` and a referrer of the origin only
(OpenStreetMap asks map pages to send one). In version 0.2 the script moved to its own file,
`admin.js`, so the policy refuses every inline script; since version 0.3 the page serves Leaflet and
its fonts itself and refuses scripts from anywhere else.

### 6.8 Mobile app

**Technology.** Bare React Native (no Expo), TypeScript, Hermes. Three libraries:
`react-native-maps` (Google Maps on Android, Apple Maps on iOS), `@react-native-async-storage/async-storage`
and `react-native-safe-area-context`. There is no navigation library: five screens are a stack in
state, with the Android back button handled. Location, the trip service and notifications are in
the project's own native module (6.9), not in third-party libraries.

**React Native 0.88 (version 0.2).** The native projects come from the 0.88.1 template: target API
36, which Google Play requires from 31 August 2026, Kotlin 2.2 and Gradle 9.4. Since 0.82 the new
architecture is the only one, and classic native modules such as `wimb-location` run through an
interop layer that is still in 0.88; rewriting the module as a Turbo Native Module is planned for
phase 1. Checking the app against the real 0.88 types found two problems, now fixed: `tsconfig.json`
extended a file path the package no longer exports, so the app could not be type-checked at all,
and event listeners now receive untyped payloads. AsyncStorage is now version 3; its API is
unchanged for this app.

| Screen | What it shows |
|---|---|
| Plan | From and To, journey options with route boards, live or usual waits; a banner for a trip in progress |
| Place search | Search box (English or বাংলা), "Use my location", "Pick on the map", recent places, approximate-location stop list |
| Map pick | Tap a spot; nearest three stops; "Use this spot" |
| Journey | Map of the legs with tracked buses on it, the steps, "I'm on this bus" with route choice and sharing switch (riders type nothing about the bus: the server puts them on the bus they are next to, and the trip screen says when it is the one its conductor shares); for a signed-in conductor, "I'm the conductor" with the bus's whole plate, and the note that its owner sees the trips |
| Trip | Route board, next stop, stops and minutes to go, alarm and sharing status, "End trip". Shared by its conductor: its plate, and which owner sees the trips |

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
  |  for every position from the native module (about every 10 s, also when the bus stands still)
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
the fused location provider (high accuracy, every 10 s with no minimum distance, so a bus standing
still keeps reporting), reports fake-GPS locations, and stops when the app is swiped away
(`stopWithTask`). Its manifest merges these permissions into the
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

- **Riders are pseudonymous, not anonymous.** A shared trip is tied to a random id, not to a person or
  device. Positions are kept only in memory and are gone once the trip ends; nothing of a rider's
  trip is stored. But the ends of a trip can show where someone lives or works, so positions are
  personal data under the DPDP Act, and are handled as such.
- **Sharing is a choice.** The switch is on by default and says exactly what is sent; the stop alarm
  works with sharing off.
- **Conductor trust needs a signed-in conductor**, so anyone cannot claim to be one: an account
  their owner approved (or the admin), sharing one of that owner's buses by its plate. The owner
  removes a conductor who leaves, and their key stops working. A conductor's account cannot open
  the owners' dashboard.
- **Owners see only their own buses, and only while one of their conductors shares them.**
  For those trips a summary is kept for the owner: when the bus left and last moved, where on the
  route it was first and furthest seen, and how the trip ended; no positions. Riders' trips are never
  part of it, even on the same bus. Summaries are deleted after `TRIP_HISTORY_DAYS`, 90 by default.
  The summary also shows when the conductor worked, so it is the conductor's personal data too: the
  app tells them before they start ("the owner sees where the bus is and the trips it runs") and on
  the trip screen, naming the owner. Whether that notice is enough, or the conductor must also
  consent, depends on how they are employed: take legal advice before the pilot.
- **Owners, their staff, syndicates and contributors sign in with a mobile number and a password**
  on `/signin`, and only once approved: conductors by their owner, everyone else by the admin. Passwords are kept as scrypt hashes, each with its own
  salt; a number without an account costs the same work, so timing does not tell which numbers have
  accounts, and only the right password is told that an account waits. Ten wrong passwords for a
  number stop it for 15 minutes from any network, and 20 from one network stop that network. A
  temporary password from the admin only lets them choose their own. Each device signed in gets its
  own key, kept in the browser's storage until they sign out; only its hash is stored, signing out
  ends it, and a new password ends all the others. Their mobile numbers are kept in full, for the
  admin to check who signed up: that is personal data, for the privacy policy (the admin token is
  kept only for the browser tab, 6.7). The owner page has the
  web app's strict policy: its own scripts and styles only, Leaflet served from this server, no CDN.
- **Bad data is filtered:** fake GPS, impossible jumps, poor accuracy, stale positions, oversized or
  too-frequent requests.
- **Admin access** needs a long token compared in constant time; the admin page has a strict content
  security policy.
- **The web app** runs only its own scripts (`script-src 'self'`, no inline scripts or styles), talks
  only to its own server, and serves Leaflet itself, so riders make no requests to a CDN. Only map
  tiles come from elsewhere.
- **The DPDP Rules** were notified on 13 November 2025 and phase in. The duties that matter here
  (notice, consent, security safeguards with logs kept for a year, breach reports within 72 hours,
  deleting data once its purpose is served, and verifiable parental consent for anyone under 18)
  apply from about 13 May 2027, so a pilot in 2027 must have them. Riders under 18, such as students,
  need particular thought before rider sharing opens: take legal advice.
- **Before launch:** HTTPS everywhere, and a privacy policy covering location and the owners'
  trip summaries, in English and Bengali. When riders' trip history is added for learned travel
  times, store it under trip ids, cut the first and last few hundred metres of each trip (they
  show homes), keep only what is needed to learn travel times, and delete raw positions after
  processing.

### 6.12 Rider web app

The same rider screens as the phone app (Plan, Place search, Map pick, Journey, Trip), a
Conductor screen, and two the phone app does not have yet: Find a route and a route's page. They are
written in plain TypeScript with DOM methods and no framework.

**Side nav.** Plan a journey, Find a route, Share your bus and Suggest a fix, and set apart under
"Sign in", with the note that riders need no account: owners, staff (conductors too) and syndicates
(`/signin`), and the admin (`/admin`). Riders never sign in. On a screen 900 pixels wide or more
the nav stays beside the app, folds to its icons (remembered on that browser, with the names kept for
screen readers and shown as tooltips), and the app takes the rest of the width with its content in a
column of at most 760 pixels. On a phone it slides out from the menu button on the home screen; the
page behind cannot be reached until it closes, and Escape closes it. A screen opened from the nav sits
on top of the plan screen, so Back always returns there.

**Find a route.** Riders who know the bus they want type its number as painted (12C/2 found by
"12c2", "12 C 2" or Bengali digits), its name, or a place it goes to: a stop lists the routes that
stop there, a landmark the routes stopping within 700 m (as far as the planner lets people walk).
With nothing typed, the screen lists every route, buses first, then the Metro, trains and ferries.
A route number typed in the From or To search offers the route too. A route's page shows what runs
it, its first and last bus, how often it runs now (or that it is not running), a choice of the
directions running today (time-window variants with their hours), the direction on the map, and
its stops in order on a line. Tracked buses on that direction are pushed by the server as they move
and placed on the line between the two stops they are between; the Metro, trains and ferries are
not tracked, and the page says so. The backend serves the
files as they are, with the shared library's types stripped, so there is no build step. A service
worker keeps the app's files, and the page keeps the network in the browser's Cache Storage, so
after one visit the app opens and plans journeys with no internet. Live data is never cached.

| What | How the web app does it | Limit, compared with the phone app |
|---|---|---|
| Location | Geolocation API, asked for only when "Use my location" or a trip needs it | Only on HTTPS or localhost. After "Block" the page cannot ask again; only the browser's site settings can undo it. "Approximate" shows up as a wide accuracy circle (over 1 km) |
| Trip tracking | `watchPosition` while the page is open, with the same trip tracker as the phone app | **Stops when the screen is off or the tab is hidden**, so the screen is kept on with the Screen Wake Lock API |
| Stop alarm | On-screen alarm, a sound, vibration and a notification | No vibration on iOS; notifications on iOS only for a web app added to the Home Screen |
| After a reload | The trip carries on if it is under 6 hours old | Tracking pauses while the page is closed |
| Conductors | Sign in on `/signin`, which opens the conductor screen; there: route, direction, the bus's plate, then sharing. The key from `/signin` is read from the same browser storage (`web/src/account.ts`) | Phone on a charger with the screen on |

So the web app suits testers, riders checking when a bus comes, and conductors whose phone sits on
a charger with the screen on. A rider who wants the alarm with the phone in a pocket needs the
phone app. The web app also makes the planned family link easy: the person receiving the link
needs no app.

### 6.13 Route import from OpenStreetMap

`tools/import-osm.ts` asks the Overpass API for bus route relations and turns them into a network
file: route numbers, ends and road paths, and the stops. Most Kolkata relations list only the road,
so for them the stops are the named bus stops within 30 m of the path, in order. Stops of the same
name within 300 m become one stop, placed between the two sides of the road. Ways listed out of
order are put back in order; a path with a gap over 300 m is replaced by straight lines between
stops. The road path is simplified to within 4 m to keep the download small. OpenStreetMap has no
timetables, so first and last buses and frequencies are placeholders, and the network's notice says
so. The file is checked by `validateNetwork` before it is written.

| Import on 27 October 2026 | Result |
|---|---|
| Route relations | 408 (405 "Kolkata Private Bus") |
| Imported | 216 routes, 309 directions, 354 stops; 2.6 MB |
| Stops per direction | 15 in the middle (median) |
| Directions with a road path | 302 of 309 |
| Skipped | 97 relations, mostly with fewer than two named stops along them |
| Missing | Big stops such as Esplanade and Howrah Station are not mapped as bus stops along the routes |
| Journeys tried | Gariahat to Jadavpur 8B: 45, 13C or 218, 16 min. Shyambazar to Gariahat: one change at Jora Girja, 48 min. Sector V to Gariahat: AC-47, 82 min. Each planned in 10 to 40 ms |

The data is © OpenStreetMap contributors under the Open Database License. A network built from it
that riders download must credit OpenStreetMap and be offered under the ODbL too. That fits the
plan to publish GTFS, but it is a decision to make before importing into the live network.

### 6.14 Owner dashboard

The reason for owners to have their conductors keep the app on (4.2). It is one page at `/owner`,
served by the backend and written in plain JavaScript like the admin panel. It is laid out for a
phone first, because owners will check it on theirs; on a wide screen the map sits beside the list.

**Signing up.** An owner creates an account on `/signin` with their mobile number and a password,
and signs in once the admin has approved it; or the admin adds them, with a temporary password to
give them, which only lets them choose their own. Their staff create accounts there too, giving the owner's number: a manager
chooses "A bus owner's manager", and the admin approves them; a conductor chooses "A conductor", and
the owner approves them under People (the admin can too). Owners add their buses by number plate,
as painted, with a name of their own if they like. A conductor, signed in, types the plate of the
bus they are on when they start sharing it, in the web app's "Share your bus" or under "I'm the
conductor"; a plate that is not one of the owner's buses is refused. When a conductor leaves, the
owner removes them, and their account stops working. A conductor's account only shares buses: on
`/signin` it opens the web app's "Share your bus", not the dashboard.

**Syndicates.** One person signs in for a syndicate. They create its account on `/signin` (or the
admin adds it), and the admin chooses its routes and member owners as they approve it. The sign-in
page links to the rider app, for anyone who came to find a bus, and to the admin's own sign-in.

**What the owner sees.** The page updates itself every 15 seconds.

- The day's headline numbers: buses on the road now, trips (and how many ran end to end), distance.
- Each bus now: on the road (its route board, direction, next stop, how long ago it was heard from,
  and its place on the map); sharing but not yet on the route, or not heard from for a while; or not
  sharing, with when and where its last trip ended. Each state has a dot and a label, never colour
  alone.
- Each bus's trips that day: when it left and last moved, from which stop to which, how many of the
  route's stops, how far, and whether it ran end to end, is still running or lost its signal.
- Each bus's last 7 days (trips, end to end, km), with each day one tap away, and any earlier day
  from the date picker. Trips of buses the owner has since removed are listed apart.
- A spreadsheet of up to 62 days, one row per trip. Cells a spreadsheet would run as formulas are
  kept as text, and Excel shows Bengali names correctly.

**How trips are counted** (`backend/src/triplog.ts`).

| Rule | Why |
|---|---|
| A trip is one run of one route direction by a bus shared by one of the owner's conductors | Owners count trips by direction, as timekeepers do |
| It begins at the bus's first position on the route, not when sharing starts | A conductor who starts sharing early is not yet on a trip |
| "Left" is the last time the bus was within 100 m of where it was first seen; "last moved" is the last time it moved on 20 m or more | Time waiting at either end of the route is not counted as running |
| A stop counts as reached within 100 m. End to end: first seen within 300 m of the first stop, and reached the last | GPS and the stop positions are both a little off |
| Trips under 300 m are not kept | The bus never really went anywhere |
| The same bus on the same direction seen again within 20 minutes, no more than 500 m behind where it was last seen, carries on the same trip | No signal, a server restart, the driver's phone as well as the conductor's, or sharing ended by mistake would otherwise split one trip into several |
| A trip that reached the end does not carry on | The next run, usually the return trip, is a new trip |
| A trip nobody shares for 20 minutes ends where the bus was last seen, marked "signal lost" | The phone was switched off, or left the bus |
| Riders' trips never count, even on the same bus | Owners see what their conductors share, nothing about riders |

**Storage.** `owners.json`, next to the network file, holds the owners and their staff (with hashes
of their keys), their buses, syndicates and contributors, saved the same safe way as the network. Trips go in
`trips/YYYY-MM-DD.jsonl`, by the day in Indian time on which the trip started, one line per trip;
when a trip carried on, its later line replaces the earlier one. The trips running are saved to
`trips/running.json` every 30 seconds and when the server stops, so a restart carries them on. Day
files older than `TRIP_HISTORY_DAYS` are deleted every hour. A hundred buses running 16 trips a day
write well under 1 MB a day.

**Added in version 0.3** (`backend/src/owners.ts`, `otp.ts`, `dashboard.ts`, `push.ts`).

| Feature | How it works |
|---|---|
| Bengali | The page follows the language chosen in the rider app on that phone, or the browser's; its own button switches it. Dates and times in Bengali, numbers in Bengali digits; plates and route numbers as they are |
| Signing in (since 1.5) | On `/signin`, with a mobile number and a password (`passwords.ts`); a new account waits for approval: a conductor's for their owner, any other for the admin. A forgotten password is set again with a 6-digit code by SMS where there is a gateway (`SMS_WEBHOOK_URL`): codes work for 10 minutes and 5 wrong guesses, one a minute and five an hour per phone, ten an hour per network, and the answer is the same whether or not a number has an account. Numbers are kept in full, for the admin to check, and as a keyed hash (`secret.key`) to find the account. Until 1.5 owners signed in with a link or a code by SMS |
| Approval | Everyone who signed up waits until they are approved, and cannot sign in until then: conductors by their owner (or the admin), everyone else by the admin under Bus owners. A conductor's phone is trusted on the owner's buses, managers and syndicates see owners' buses, and contributors' recordings can become routes |
| Several people | The owner, and their staff, who sign up with the owner's number: managers, approved by the admin, run the buses but do not see or remove people; conductors, approved by the owner, only share the buses. The owner sees them all, waiting or approved, with their role, approves conductors and can remove anyone. Each device signed in has its own key (five at most); a new password ends them all |
| Alerts | A trip still running with no position for 5 minutes, or one that ended (sharing stopped, or the signal lost for good) before the end of its route. Listed at the top of the day's page until marked as seen; with permission, a notification on that device while the page is open, through a service worker that does nothing else (`/owner/sw.js`) |
| Route syndicates | One person signs in for each. It signs up on `/signin`, and the admin chooses its routes and member owners as they approve it; or the admin adds it, with a temporary password. It sees the members' buses on those routes, their trips and alerts, and a spreadsheet with an Owner column, read-only |
| Live | Bus positions are pushed to the open page as they come (a fetch stream with the key in its header); the rest of the page is fetched every minute instead of every 15 seconds, and at once when a bus starts or stops sharing. A replaced key ends its stream at its next update |
| Remembered plate | The web app remembers the plate a conductor typed last, for the next trip. (Until 1.6, the phone kept the bus's conductor code) |

**Not done yet.** Sign-up for syndicates themselves (the admin sets them up), alerts sent by SMS, and
notifications on a phone whose dashboard page is closed (it needs Web Push and a server key).

### 6.15 Storage and scaling

Each kind of data sits behind a small interface with two stores: files next to the network file
(the default, no setup), or PostgreSQL and Redis when `DATABASE_URL` and `REDIS_URL` are set. On
an empty database the files are copied in on first start.

| Data | Without a database | With PostgreSQL and Redis | Interface |
|---|---|---|---|
| The network | `network.json`, written to a temporary file and renamed | Tables `network_meta` and `network_items`: a row per stop, landmark and route, each with the version that last changed it. An edit writes only changed rows; other servers read only those | `NetworkStore` (`store.ts`) |
| Live buses and trips | Memory | Memory in every server process, kept the same by one Redis stream of changes (below) | the live engine (`packages/core/src/live.ts`), `live-cluster.ts` |
| Pushed updates | Memory: open streams by topic | Each process applies every live change, so it tells its own streams | `createPushHub().changed(topic)` (`push.ts`) |
| Learned travel times, accuracy | `travel-times.json`, `accuracy.json`, saved every 5 minutes | Table `snapshots` | `SnapshotStore<T>` (`learned.ts`) |
| Owners, people, buses, syndicates | `owners.json`, written whole, one change at a time | Tables `owners`, `people`, `buses`, `syndicates`; a change writes the rows it touched, checked against a version; servers told through Redis | `RegistryStore` (`owners.ts`) |
| Owners' trips | `trips/YYYY-MM-DD.jsonl` | Tables `trips` (by owner and day) and `running_trips` (by server) | `TripStore` (`triplog.ts`) |
| One-time codes, password-change steps, follow links, reports | Memory, with expiry | Redis keys with expiry; limits checked in Lua scripts; reports in one sorted set, read by each server at most once a second | `OtpBook`, `TokenStore`, `ShareStore`, `ReportStore` |
| Recordings, suggestions | `recordings/`, `corrections.json` | Tables `recordings`, `corrections` | `RecordingStore`, `CorrectionStore` |

**What one process carries** (`node tools/bench-scale.ts`, 1,000 routes, 30 buses each, one laptop
core, without HTTP): taking in every bus's positions every 10 s costs about 8% of a core (38,700
batches a second against 3,000 needed). Answering riders is what runs out first: arrival times at a
stop about 4,100 a second (1,400 at the busiest stops, on up to 364 route directions), journeys
about 100 a second. The network is 20.7 MB as JSON.

**Several servers for 100,000 riders.** So the reading side is spread over as many processes as
needed, on one machine (`npm run start:cluster`) or several behind a load balancer, and each keeps a
full copy of the live buses (`backend/src/live-cluster.ts`):

- Every change to live buses (a phone starts or stops, its positions, a removed bus, the half-minute
  tidy-up, a new network version) is an event added to one Redis stream. Every process applies the
  stream in order, and a request is answered with what applying its event gave. An event carries
  its time and new bus ids come from its place in the stream, so every copy ends the same. Taking in
  30,000 buses costs each copy about 8% of a core, so copies are cheap.
- One process leads, through a Redis key it renews every few seconds: it adds the tidy-up event and
  alone saves trips and learned times. Another takes over within the lease (15 s) if it stops.
- A process that joins reads the trips being shared (a Redis hash) and the stream from then on;
  within one round of positions (10 s) it shows every bus.
- Riders' questions are reused briefly: arrivals at a stop for 1 s, journeys for 15 s (5 minutes
  for a set time), so the work follows the number of stops, not the number of riders. The planner
  asks only about the route direction it is weighing, not every route at a stop.
- The network is sent compressed (20.7 MB becomes 3 MB) and made once per version.

Kafka was considered for the stream and not used: about 3,000 small events a second is far within
what a Redis stream carries, and the limit was answering riders, which a log does not change. It
would earn its place for keeping every raw position for analysis, or for several regions.

On a 4-core laptop shared with the load generator, one process answered about 570 arrival
questions a second (two stops each, 2,000 buses moving) and 46 journeys a second; the laptop, not the
server, was the limit, so scaling with more processes must be measured on the real servers with the
load generated from another machine.

**Pushing live buses.** A journey map opens `GET /api/live?patterns=…` with `EventSource`; the
owners' dashboard opens `GET /api/owner/live` with a streaming `fetch`, because it must send its key
in a header. When positions from a phone are accepted, the server marks that direction (and, for a
registered bus, its owner) as changed; each stream on it gets a new snapshot within a second, and
every 15 seconds anyway. A stream ends after 30 minutes and the browser opens it again; a slow
client is let go; at most 12 streams per network and 10,000 in all. Where a stream cannot stay open
(a proxy that buffers, an old browser), the pages fall back to asking every 10 or 15 seconds. The
phone app still asks every 10 seconds: React Native has no event source built in.

### 6.16 Languages

The apps' text is written in English and looked up by its English wording in a Bengali table:
`packages/core/src/bn.ts` for the web app, the phone app and the wording the core library builds
(waits, reports), `backend/public/owner-bn.js` for the owners' dashboard, and a small table in the
follow page. `translate(lang, text, vars)` fills in `{parts}`; numbers given as numbers come out in
Bengali digits, while names, plates and route numbers are passed as text and stay
as they are. Counted words have their own forms ("৩টি স্টপ"). Stop names show in Bengali script where
the network has `nameBn`. A missing entry shows the English, and `tools/test/i18n.test.ts` fails if
any text the apps pass to `tr()` has no Bengali, or if an entry drops a `{part}`.

The choice is kept on the device (`wimb.lang.v1`, shared by the web app, the owners' dashboard and
the follow page on one site); until it is made, Bengali if the phone's language is Bengali. The web
app reloads in the new language; the phone app builds its screens again, keeping where the rider
was. Messages that come from the server (mostly errors) are in English. The Bengali needs a native
speaker's review before the public launch.

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
| Files by default, PostgreSQL and Redis when configured | No setup for trying it out; a database and several servers for the city | |
| Live buses kept in memory, a copy in every process kept the same by a Redis stream | Answers come from memory, fast; any process can answer; taking positions in is cheap enough to do in every copy | Positions grow past what one process can apply (about 10× today's target): then split the stream by route |
| Two runtime dependencies on the server: `pg` and `redis` | The PostgreSQL and Redis wire protocols are not worth writing by hand; the server still runs without either | |
| Polling every 10 to 20 s instead of websockets | Simple and reliable on mobile networks | Load grows enough to make polling costly |
| Bare React Native | The project owner's choice: full control of native code | |
| Own native module instead of location and notification libraries | Exact control over permissions and background behaviour; fewer third-party dependencies | Maintaining it becomes a burden |
| No navigation library | Five screens do not need one | Deep links or many more screens |
| Parallel routes grouped as one option | That is how people ride in Kolkata: whichever bus comes first | |
| "Live" and "Usual" always labelled | A confident wrong time costs more trust than no time | |
| Conductor role needs a signed-in conductor (1.6; a code until then) | Otherwise anyone could pose as a trusted source. An account says who shared the bus, and the owner, who knows their conductors, approves and removes them | |
| Demo data with invented route numbers | Guesses must never look like real routes | Real routes are surveyed |
| A tracked bus sets the wait only when it is sooner than usual (0.2) | With most buses untracked, a late tracked bus says little about the next bus | Conductors cover nearly every bus on a route |
| A rider web app beside the phone app (0.2) | Testers and conductors can start with no install and no store review, and it is fully testable in a browser | The phone app is out and the web app adds nothing |
| Web app served from source, types stripped (0.2) | Keeps "no build step" and runs the server's own planner code in the browser | Startup time or file count on slow networks becomes a problem |
| Leaflet served with the web app, not from a CDN (0.2) | Works offline; riders' addresses go to no third party | |
| Seed routes from OpenStreetMap, then survey (0.2) | About 200 routes with paths at once, instead of surveying from nothing | A better source appears, such as state data |
| Check the name before release (0.2) | "Where Is My Bus" was the name of the state's 2025 Yatri Sathi feature, and is a Kerala startup's name | |
| The conductor types the bus's plate at the start of each trip (1.6; a code per bus until then) | The plate tells the server which of the owner's buses it is, so trips are kept for the right owner and two phones on the bus are one bus; conductors move between buses, so it is asked each trip | Buses carry their own trackers that send data |
| Owners, staff, syndicates and contributors sign in with a mobile number and a password, after approval (1.5, 1.6) | What the project owner asked for; needs no SMS provider, and everyone is checked before they see buses or share them: conductors by the owner who employs them, the rest by the admin | A verified SMS gateway makes one-time codes cheap enough to sign in with them alone |
| Owners' trips as summaries, not positions | Enough for owners; deleted after TRIP_HISTORY_DAYS; daily files, or a table with DATABASE_URL | Learned travel times need full trip history |

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
ADMIN_TOKEN=choose-a-long-secret npm start
```

Open `http://localhost:8080` for the rider web app, and `http://localhost:8080/admin` for the admin
panel, where you sign in with the token. On first start the server copies the demo network to
`backend/data/network.json`, and from then on edits are saved there.

### 8.3 Common admin tasks

**Add a stop.** Stops in the side nav, "Add stop", click the map where the stop is. Fill in the English name, the
Bengali name and other names people use, separated by commas. Drag the yellow pin to fine-tune, then
"Save stop".

**Add a route.**

1. Routes in the side nav, "Add route". Picking is already on.
2. Click the stops on the map in the order the bus reaches them; a click next to a stop picks it.
   Where there is no stop yet, click the road there: type the stop's name (and its Bengali name) in
   the panel and "Add this stop". Reorder or remove stops in the list.
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
checking the file. Owners and their trips are separate files (`owners.json` and the `trips`
folder next to the network file): back those up with the server's files.

**Approve an account.** Bus owners in the side nav: accounts that signed up on `/signin` are listed
first, with their mobile numbers. Call to check who it is, then "Approve" or "Turn down". For a
syndicate, "Choose routes and approve" asks for its routes and member owners first. Conductors are
usually approved by their own owner, but are listed here too. Contributors are listed there as well,
and again under Contributors, with how many recordings each has made.

**Check a contributor's recording.** Record a route in the side nav: recordings made in the phone app
say "by" who made them and how many stops they marked. "Show on map" draws the path and the halts
(a thicker ring for a stop the contributor marked) and lists the marked stops, with the names typed
and whether a stop is already there. If it is good, "Use for a route", choose the route and the
direction, and tick "Also make its stops from the halts" to set the stops too. New stops keep the
contributor's names; check them in the Stops tab. Delete a recording that is not good.

**Add a bus owner yourself.** Bus owners, type the owner's name and mobile number, "Add owner".
Give them the temporary password it shows, yourself: it is shown only once. They sign in on
`/signin` with it and choose their own. If someone forgets their password, "New password" beside
their name makes another temporary one and signs them out everywhere. The owner adds their buses
themselves, and approves their conductors, who sign up with the owner's number.

### 8.4 Set up the mobile app

Version 0.2 did steps 1 and 2 of version 0.1's setup: the `android` and `ios` projects are generated
from the React Native 0.88.1 template and are in `mobile`, the libraries and the native module are
in `mobile/package.json`, the Android manifest reads the Maps key from a `MAPS_API_KEY` Gradle
property or environment variable (never from a file in the repository), and the iOS location keys
are in `Info.plist`. See `mobile/README.md`.

1. Install: `cd mobile && npm install`.
2. Android: put `MAPS_API_KEY=your-google-maps-key` in `~/.gradle/gradle.properties`.
3. iOS: `cd ios && bundle install && bundle exec pod install && cd ..`. iOS uses Apple Maps, so it
   needs no map key.
4. With the backend running, start the app.

   ```sh
   npm start
   npm run android    # or: npm run ios
   ```

   On a real phone, set the development server address in `src/config.ts` to your computer's address
   on the same Wi-Fi, such as `http://192.168.1.20:8080`.

5. Optional fonts: put the Hind Siliguri (Regular, Medium, SemiBold, Bold) and Teko SemiBold `.ttf`
   files in `mobile/assets/fonts`, run `npx react-native-asset`, and set `CUSTOM_FONTS = true` in
   `src/config.ts`.

### 8.5 Try it without riding a bus

**Live buses.** With the server running, start simulated buses in a second terminal:
`npm run simulate` puts riders' phones on every route direction. Open
http://localhost:8080, plan Esplanade to Jadavpur 8B, and waits from tracked buses say "Live";
open the journey to see the buses on the map.

**A trip.** In the web app, open the journey and tap "I'm on this bus". In Chrome's developer tools
(More tools, Sensors), set the location and move it along the route. In the phone app, move the
simulated location instead: on the Android emulator with Extended controls, Location, Routes; in the
iOS simulator with Features, Location, Custom Location, or a GPX file in the Xcode scheme. A second
device sharing the same route appears as a second rider on the same bus.

**Real routes.** `npm run import-osm -- --out data/osm-kolkata.json` builds a network from
OpenStreetMap (6.13); import it in the admin panel to try it.

**An owner's bus.** Add an owner in the admin panel and sign in as them on
http://localhost:8080/signin. Add a bus, then sign a conductor up on `/signin` with the owner's
number and approve them under People. Take the conductor's key from `POST /api/accounts/sign-in`
and run one simulated bus with it:
`npm run simulate -- --patterns D2-UP --buses 1 --key <the key> --plate "<the bus's plate>"`. The bus appears on the
owner's page within 15 seconds, on the map and as "On the road", and once it has gone 300 m its
trip is in the day's trips as running. The simulated bus starts part of the way along the route,
so the trip is not end to end. Stop the simulator with Ctrl+C and the trip ends. Or sign in as the conductor and share the bus in
the web app ("Conductor? Share your bus") by its plate, moving the location in Chrome's developer
tools.

### 8.6 Run the tests

```sh
npm test               # from the top folder: shared logic, API, tools and the Bengali check (134 tests)
npm run typecheck      # strict TypeScript for every package
npm run test:e2e       # 22 browser tests, with the Chrome installed on the computer
cd mobile && npx tsc -p tsconfig.json   # the phone app against the real React Native types
```

Run `npm install` once in each of `packages/core`, `backend`, `web`, `tools` and `e2e` for the
type-checker and `playwright-core` (tests only; the server still has no runtime dependencies).

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

**Conductor accounts and contributors, 17 November 2026** (1.6), on the same laptop.

| Area | How it was checked | Result |
|---|---|---|
| Browser | 22 tests (was 21). Simulated conductors are now signed-in accounts sharing their owner’s bus by its plate (`conductorAccount` in `e2e/helpers.ts` makes the owner, the bus and the approved conductor). A conductor signs in from the web app’s "Share your bus", is refused with a plate that is not their owner’s, shares with the plate typed with dashes and small letters, shares as the conductor from "I’m on this bus" with the plate remembered, and signs out (the key then fails). In the owner test a conductor signs up from the web app, is told the account waits, is approved by the owner under People, signs in and drives the route; a manager waiting has no Approve button; a conductor’s key gets 403 on the dashboard, and `/owner` sends them to "Share your bus". New: a contributor signs up, is approved in the admin panel, is told on `/signin` to record in the phone app (and no key is kept), records T1 with two marked stops through the API; the admin sees who made it and its marked stops, uses it for T1 with its stops (the new stop keeps the name typed), gives a temporary password and removes them | All pass |
| Bengali | `tools/test/i18n.test.ts` for the web app; the same check, by a script, for the sign-in and owner pages’ table (`owner-bn.js`) | None missing |
| Types | `npm run typecheck` (core, backend, web app, tools, browser tests) | No errors |

**Signing in with a mobile number and a password, 29 October 2026** (1.5), on the same laptop.

| Area | How it was checked | Result |
|---|---|---|
| Backend API | 55 tests (was 52). New: password hashes and rules; an owner who signs up cannot sign in until approved (and only the right password hears it waits); staff with their owner's number, approved, run the buses but do not see or manage people, and the owner removes them; a syndicate approved with its routes and members; a temporary password only lets them choose their own, a change of password and the admin's new one sign the other devices out, signing out ends the key; ten wrong passwords stop a number; a forgotten password set again by SMS, and a code used up by wrong guesses. The old link and SMS sign-in tests were replaced; an owners file from before passwords still signs in, and the admin can give its people a number and a password | All pass |
| Browser | 21 tests. The owner tests now sign in on `/signin`: the admin adds an owner with a temporary password, who chooses their own; an owner, their staff and a syndicate sign up, wait, are approved in the admin panel (the nav counting them) and sign in; a forgotten password set again by SMS; the owner page's password change; the sign-in page in Bengali, the server's answers included; offline, the rider app never stands in for `/signin` | All pass |
| Bengali | A check that every text the sign-in and owner pages pass to `tr()` has a Bengali entry | None missing |
| Types | Strict TypeScript as before, and the phone app | No errors |
| By hand, on screenshots | The sign-in page and sign-up form on a phone, the waiting message, the temporary password step, the admin's waiting list and temporary password, the owner's account card | Fixed on the way: a failed sign-in no longer clears what was typed; the rider app's service worker leaves `/signin` alone |

**After version 0.3, 28 October 2026** (the dashboard, side menus and route search of 1.4), on the
same laptop.

| Area | How it was checked | Result |
|---|---|---|
| Shared logic | 70 tests (was 67): route numbers typed in any spacing or case or in Bengali digits, names, a stop, a landmark near stops, and nothing for nonsense | All pass |
| Backend API | 52 tests (was 51): the admin dashboard's numbers before and after a conductor's trip on an owner's bus, and its alert when the trip stops short | All pass |
| Browser | 21 tests (was 17). New: the admin dashboard with a live bus; the admin nav folding, and still folded and signed in after a reload; a direction built by clicking the road (a new stop) and next to a stop (picked), which riders then find by its number; the rider nav as a drawer on a phone (its sign-in links, Escape, Back) and beside the app on a wide screen (folding, names kept); routes found by a place; a route page with a conductor's bus placed between Esplanade and Park Street, and none the other way; the syndicates' sign-in without phone sign-in, linked both ways with the owners'. Two older tests now open the owners' part from the side nav | All pass |
| Types | Strict TypeScript as before, and the phone app | No errors |
| By hand, on screenshots | The dashboard with and without an owner's trip, the folded nav and the narrow rail, a new stop in the route editor; the rider app wide, folded, on a tablet and on a phone, the drawer, the route list and search, a route page in English and in Bengali | Fixed on the way: the 15-second refresh closed an open table and lost the keyboard focus; the trips chart had a 0.5 tick; the route map's last stop sat under the map credit |
| Android app | Not run again: no phone app code changed (the shared library gained route search and Bengali wording, and the app type-checks with it) | |

**Version 0.3, 28 October 2026**, on the same Windows laptop. The table after this one is version
0.2's and the owner dashboard's.

| Area | How it was checked | Result |
|---|---|---|
| Shared logic | 67 tests (was 48): learned travel times, riders' reports, coverage, journeys with the Metro and a ferry, line colours readable with their text, buses only for sharing and reports | All pass |
| Backend API | 51 tests against real servers (was 20): the GTFS feed read back with a zip reader written for the test and checked as a validator would (references, times, frequencies, calendars and diversions, shapes, quoting), phone sign-up and sign-in with codes, managers, approval, alerts, syndicates, an owners file from before managers, pushed live updates and their limits, follow links, reports, suggestions, recordings, learned times | All pass. The GTFS zip also opens in Windows' own `tar` |
| Tools | 9 tests (was 6), 3 of them the Bengali check: every text both apps pass to `tr()` has Bengali with the same `{parts}` | All pass |
| Browser | 17 tests (was 13): the new ones sign an owner up by phone, add a manager, see an alert, approve in the admin panel, set up a syndicate and open its view, check the conductor's remembered code, use the web app, the owners' dashboard and the follow page in Bengali | All pass. One found that the last positions and the end of a trip could be lost if the page closed at once (fixed with `keepalive`) |
| Types | Strict TypeScript for core, backend, web app, tools, browser tests and the phone app | No errors |
| Android app on an emulator | The 7 tests in `e2e/android/app.android.ts` on Android 16, with the new design and every new screen part (reports, the suggest link, the follow link, the remembered code), run with nothing else on the laptop | All pass. By hand: the splash screen and launcher icon, and the app in Bengali (home, a journey) and back to English |

Results on 27 October 2026, on a Windows laptop with Node 22.22 and Chrome.

| Area | How it was checked | Result |
|---|---|---|
| Shared logic: geometry, search, journey search, live tracking, trip tracking, validation | 48 automated tests (36 in 0.1, 45 in 0.2). Each new test failed on the 0.1 code and passes now; the 3 added for registered buses cover two phones on one bus, two buses whose plates end alike, and looking up a phone's bus | All pass |
| Backend API end to end: search, plans, live buses, conductor code, admin token, validation, page headers, web app files, files outside the app refused, `HEAD`, clock correction, low confidence | 12 tests against a real server with a temporary data file | All pass |
| Owner dashboard API end to end (28 October 2026): owners and keys, buses and plates, the bus's code making a conductor and keeping the trip, the trip's stops, distance, times and spreadsheet, carrying on across a server restart and a mistaken end, the return trip as a new trip, new codes, removed buses and owners, the wrong-code limit, deleting old days | 8 tests against real servers on a short test route | All pass |
| OpenStreetMap importer | 6 tests on a sample of Overpass data, and one import of all of Kolkata (6.13) | All pass |
| Web app, admin panel and owner dashboard in a browser | 13 tests in Chrome on a phone-sized screen, against a real server (below) | All pass |
| Types | Strict TypeScript for core, backend, web app, tools and tests | No errors |
| Phone app code | Type-check against the real React Native 0.88.1 types, and Metro release bundles for Android and iOS | No errors, after three fixes (below) |
| Load | 1,854 simulated phones sharing on 309 real route directions, with 200 arrival or journey requests a second | All 12,978 positions accepted, no errors; the server used about 14% of one core and 66 MB; a separate probe saw answers in 2 to 3 ms (worst 11 ms) |
| Planner results on the demo network | Checked by hand (appendix 14.4), and again by the browser tests | As expected |
| Android app build (28 October 2026) | Gradle 9.4.1, JDK 17, Android SDK 37, NDK 27.1, for x86_64 | The debug app builds with no errors on the first compile; one warning: the native module overrides a method React Native 0.88 has deprecated (6.8). A whole release APK was not built on that laptop: from its deep project folder the release C++ passes Windows' 260-character path limit. Its release-only steps passed one by one: the release C++ from a short path, and the JavaScript compiled to Hermes bytecode. Build releases from a short folder such as `C:\dev\wimb` (mobile/README.md) |
| Android app on an emulator | 7 tests on Android 16 (API 36, Google APIs), driven over adb against a real server (below); run again on 28 October 2026 after the owner dashboard | All pass |
| Native module, iOS (Objective-C) | Reviewed line by line | Not compiled: needs a Mac with Xcode; not needed yet |
| App on real phones | | Not run yet |

The browser tests: a rider finds stops by local name (Dharmatala), Banglish (Jadabpur) and Bengali
(হাওড়া) and gets D2 and D3 as one option; short trips offer walking; late at night the app says when
buses start; map picking; "Use my location", precise and approximate; offline after one visit; every
button has a name for screen readers, in light and dark mode; a simulated conductor's bus becomes the
"Live" wait and shows on the journey map; a rider's whole trip (next stop, the alarm 500 to 820 m
before the stop with vibration and a notification, "This is Park Street", the trip ending by itself
after the stop, the server seeing the shared bus and then dropping it); the conductor code, right
and wrong (since 1.6: a conductor signing in and sharing by plate, a wrong plate refused); and an
admin edit reaching riders with the next network version.

The owner dashboard test (`e2e/owner.e2e.ts`): the admin adds an owner and copies the sign-in
link; the owner opens it on a phone, is signed in, and the key leaves the address bar; they add a
bus and get its code, and are still signed in after a reload. A conductor then shares that bus in
the web app with the code, typed with a space, and is told before and during sharing that the owner,
named, sees its trips. While the conductor drives the route, the owner's page shows the bus on the
road, with its next stop and on the map. Once the conductor ends the trip, the page shows "Not
sharing now" and one trip from the first stop to the last, end to end, 1.2 km, in the 7-day table
and in the downloaded spreadsheet. Signing out forgets the key, and a wrong link is refused in plain
words. No page broke its security policy or logged an error. A second test opens the rider app
first, so its service worker is installed, then goes offline: `/owner` must fail to load rather
than show the rider app. It failed before the service worker was changed to leave `/owner` alone.

The phone app has the same notice for conductors (6.8), and the Android tests cover it (below).

The Android tests (`e2e/android/app.android.ts`) run the real app with its native module: it opens
offline on the network built into it; refusing location in Android's own dialog leaves search and
map picking working; local names find stops and parallel routes are one option (D1, D2 and D3
before 1 pm; D1's afternoon variant skips Park Street, so after 1 pm only D2 and D3); a simulated
conductor's bus becomes the "Live" wait; and a whole trip, with location allowed while in use and
notifications allowed: the location foreground service starts, its ongoing notification shows the
bus, the server sees the shared bus with its plate digits, positions keep reaching the server with
the app in the background and the screen off, the stop alarm notification arrives before Park
Street, and after the stop the trip ends by itself, the service stops and the bus leaves the server.
A seventh test, added with the owner dashboard: a conductor shares the bus with its own code, is
told on the trip screen which owner sees its trips, and the owner's dashboard shows the bus on the
road and then its trip from Esplanade. Its first runs found the standing-bus bug (1.2): when the
phone stopped moving, the server's bus drifted ahead on its estimate because no position came. With
the fix all 7 pass. The log shows no crash and no JavaScript error.

Testing found these problems, now fixed:

| Problem | Effect | Found by |
|---|---|---|
| On a route that doubles back, one noisy fix could snap to the far side | The trip ended as "passed your stop" before the alarm rang | Code review, then a test |
| A trip started while walking to the stop ended after 90 seconds | The alarm was gone before boarding | Code review, then a test |
| Any tracked bus set the wait, even one later than the usual wait | Tracked routes looked slower than untracked ones | Code review, then a test |
| Two phones on one bus that started apart stayed two buses | The same bus shown twice | Code review, then a test |
| Two conductors' phones near each other could be merged | One of two buses disappeared | A test |
| Riders walking to a stop counted as leaving the route | False diversion alerts at busy stops | Code review, then a test |
| A wrong phone clock made every position "stale" | Sharing silently did nothing | Code review, then a test |
| Pasting the whole plate kept the wrong digits ("1" in the web app, the first four in the phone app) | Two buses could not be told apart | A browser test |
| `tsconfig.json` extended a path React Native 0.88 no longer exports | The phone app could not be type-checked | Type-check against real types |
| An event listener type no longer accepted by React Native 0.88 | Type error | Type-check against real types |
| Every arrival scanned every tracked bus in the city | Slow with thousands of buses | Load test |

**Still to test, in this order:**

1. Build the iOS app on a Mac and fix any compile errors (Android: done on 28 October 2026).
2. Run a trip with the screen locked on several Android brands; the emulator passes, but phones from Xiaomi, Vivo, Oppo, Realme
   and Samsung are common in India, and some stop background services to save battery; the app may need
   to guide riders to exempt it from battery optimisation.
3. Battery use per hour of tracking, alarm reliability with the screen off, and detection of getting
   off at a real stop. For the web app: a conductor's phone on a charger with the screen on, for a shift.
4. Losing and regaining the internet during a trip.
5. Arrival-time accuracy on a real route, against a stopwatch.
6. The web app on low-end Android phones and on an iPhone, over a slow mobile network.
7. Load from separate machines: on one laptop the load generator slowed down long before the server.

## 10. Rollout plan

Durations are rough guesses for one or two developers and depend mostly on fieldwork.

| Phase | Goal | Main work | Done when | Rough duration |
|---|---|---|---|---|
| 0. Foundation | Working code base | Shared logic, backend, admin panel, phone app, native module, web app, simulator, importer, tests | Done | Done |
| 1. First release | Useful without live data | Check the name and decide whether to keep it. Import one corridor from OpenStreetMap and check it on the ground: add missing hubs, survey first and last buses and frequencies. Put the web app in testers' hands at once, over HTTPS. In parallel: build the iOS app (Android builds and passes on an emulator), rewrite the native module as a Turbo Native Module, device tests (section 9), then release journey search and the stop alarm in the phone app | Testers plan real trips; the alarm works with the screen locked in the phone app | 4 to 8 weeks; the web app from week 1 |
| 2. Conductor pilot | Reliable live buses on a few routes | Sign up owners or a route syndicate for 2 or 3 busy routes, each owner on the dashboard (6.14) with their buses added; have each conductor sign up with their owner's number and the owner approve them; give conductors a charger and a phone mount. Conductors can start with the web app, screen on, while the phone app goes through store review. Measure arrival-time error, and each phone's data and battery use, the problems Yatri Sathi's private-route trial reported | Most buses on pilot routes visible at peak; arrival times trusted by testers | 1 to 2 months |
| 3. Riders join in | More coverage, more routes | Family share link; "bus just passed" button; open rider sharing; add routes corridor by corridor | Rider sharing adds visible buses beyond the conductors' | 2 to 3 months |
| 4. Scale and data | Accuracy and reach | Trip history and learned travel times; Redis; ask the Transport Department for tracker data; other cities such as Siliguri, Durgapur and Asansol | Learned times beat the default estimate; state data in use or a clear answer | Ongoing |

**Roll out by route, not by city.** Ten thousand users spread over 400 routes is almost nothing on
any one route, so each corridor should reach good coverage before the next one starts.

**Test every change against simulated buses first.** The simulator runs conductor and rider phones
through the real API. Before a field test, run the browser tests and a simulated day on the
corridor's routes, so field time is spent on what only the field can show: GPS in real streets,
battery, phone makers' battery savers, and arrival-time error.

**Measure arrival-time error from the start.** The target below needs a record of predictions
against actual arrivals. A conductor's phone gives the actual arrival when its bus reaches each
stop; keep the arrival times predicted 10 and 5 minutes earlier, and report the error per route in
the admin panel. This is small to build and should be in place before phase 2 starts.

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
- [ ] `ADMIN_TOKEN` is set; the admin panel is only reachable over HTTPS.
- [ ] The Google Maps API key is restricted to the app.
- [ ] Monochrome notification icons replace the built-in Android ones in `TripNotifications.kt`.
- [ ] Play Console: the location foreground service is declared, explaining that it runs only while a
  rider has a trip on.
- [ ] App Store: the location background mode is explained in the review notes in the same way.
- [ ] A privacy policy covering location, and what owners see of their buses' trips, in English and
  Bengali, under the DPDP Act, 2023. Legal advice on whether conductors must consent to their
  bus's trips being kept for its owner, or the notice in the app is enough.
- [ ] Every account checked before it is approved, temporary passwords given in person or by phone,
  and the sign-in page and owner dashboard reachable only over HTTPS.
- [ ] Server monitoring, logs and daily backups of the network file, `owners.json` and the `trips`
  folder.
- [ ] The app name checked, since "Where Is My Bus" was the state's 2025 Yatri Sathi feature (and is a Kerala startup's
  name), checked with the icon against existing apps and trademarks. Rename the Android package
  and the Xcode project with it.
- [ ] The native module is a Turbo Native Module, or the legacy interop layer is confirmed in the
  React Native version shipped.
- [ ] Play Console: the app targets API 36 or later (required from 31 August 2026), and the location
  foreground service is declared as user-initiated location sharing, with the demo video.
- [ ] If the network comes from OpenStreetMap: OpenStreetMap credited in the app, and the network
  offered under the ODbL.
- [ ] Map tiles from a provider that allows an app of this size: OpenStreetMap's own tile servers
  do not.
- [ ] DPDP: notice and consent screens, a one-year log of security events, a 72-hour breach plan,
  and a decision on riders under 18, in place by May 2027.
- [ ] The web app served over HTTPS, with its offline copy tested after a release.

## 12. Roadmap after launch

Version 0.3 built every item of this roadmap except the last two. What each became, and what is left:

| Item | Status in version 0.3 |
|---|---|
| Learned travel times | Built (6.5, `packages/core/src/learn.ts`): learned from tracked buses by stretch, hour and kind of day, kept in a file behind a store interface. Still to do: keep trip positions in PostgreSQL with PostGIS for a full history (6.15) |
| Scaling the server | Built (6.15): PostgreSQL and Redis, live buses copied in every process through a Redis stream, a leader for saving, one process per core or several machines, Docker. Still to do: measure on the real servers |
| Family share link | Built |
| Reports without location | Built: a report counts once it agrees with another or with a tracked bus |
| Record-route mode | Built, in the admin panel; since 1.6 also for contributors in the phone app, who mark and name stops, checked and applied by the admin |
| Owner dashboard, next steps | Built: Bengali, phone sign-up with approval, alerts, managers, conductors the owner approves, syndicates (6.14). Still to do: alerts by SMS, Web Push |
| User corrections | Built: a review queue in the admin panel |
| Open data and multimodal journeys | Built: a GTFS export, and journeys with the Metro, trains and ferries in the project's own planner. OpenTripPlanner was not needed for the one-change journeys planned here; it is worth another look for longer multimodal journeys |
| Trust late tracked buses where coverage is high | Built (6.5.2) |
| Bengali interface | Built for every screen, with a switch (6.16). Still to do: a native speaker's review of the wording before the public launch, and server messages (errors from the API are in English) |
| Government data | Not started: waits on the state. With pilot results in hand, ask the West Bengal Transport Department for access to the AIS-140 tracker feed, which could cover every bus fitted with a working device. Given the device failures reported in 2025 and 2026, plan for that feed to cover only part of the fleet |
| Turbo Native Module | Not started: rewrite `wimb-location` with a typed TypeScript spec and codegen, so it no longer depends on React Native's interop layer for the legacy architecture |

Next, beyond this list: push for the phone app (React Native has no built-in event source, so it still asks every 10 seconds), and a GTFS-realtime feed of the tracked buses for other apps.

## 13. Risks and mitigations

| Risk | Effect | Mitigation |
|---|---|---|
| Too few phones on buses | Few live buses; the app feels empty | Launch features that need no live data first; conductors as the backbone; route-by-route rollout; usual times always available |
| Wrong arrival times | Riders stop trusting the app | Live and usual labelled; confidence levels; buses dropped after 10 minutes of silence; error measured per route |
| Wrong or outdated route data | Bad journeys | Validation before saving; diversion alerts; field surveys; user corrections (planned) |
| Conductors do not keep the app on | Gaps in the backbone | Value for owners (the dashboard, 6.14), chargers, a simple app, small incentives in the pilot |
| Conductors see the dashboard as surveillance, or owners use it against them | Conductors switch sharing off, or refuse it | It shows only trips the conductor shares, never the conductor outside a trip; conductors are told, naming the owner; a summary, not positions, kept for 90 days. Explain it to conductors and their unions before the pilot |
| A conductor's password is shared, or a former conductor keeps sharing | False trips on the owner's dashboard | Each conductor has their own account and password; the owner approves them and removes them when they leave, which ends their keys; wrong passwords are limited per number and per network; trips need one of the owner's own plates |
| Fake or malicious data | Phantom buses | Fake-GPS rejection, speed and accuracy checks, merging with other riders, signed-in conductors, rate limits |
| A contributor records a wrong route or names stops badly | Wrong paths or stop names for riders | Contributors are approved by the admin; nothing changes for riders until the admin checks a recording on the map and applies it; new stop names can be changed in the Stops tab |
| Phone makers' battery savers stop tracking | Alarm or sharing stops with the screen off | Test on common brands; guide riders to exempt the app; foreground service with a visible notification |
| Store policy on background location | Rejection or delay | No background permission; service started by the rider; clear declarations |
| Battery drain | Uninstalls | Updates every 10 s, only during a trip; trips end by themselves |
| Privacy concerns | Loss of trust, legal exposure | Anonymous trips, nothing stored after a trip, clear consent text, privacy policy |
| Competition from Yatri Sathi and Google Maps | Low adoption | Private and mini buses, offline search, Bengali and Banglish search, grouped routes, stop alarm, a web app with nothing to install (4.4) |
| Many users behind one mobile network address | Real users blocked by rate limits | Per-trip limits do the real work; per-address limits are generous |
| Server restart loses live buses | Short gap with one server | With several, the others carry on and a restarted one catches up from Redis |
| First native build fails | Delay | Android builds and passes on an emulator; iOS is still to build; the web app lets testing start meanwhile |
| The name clashes with the state's 2025 "Where Is My Bus" feature or the Kerala startup | Confusion, a trademark dispute, a forced rename after launch | Check the name, and decide, before any public release |
| Yatri Sathi brings back live buses, or adds private buses | Less reason for this app | Move fast on private and mini routes; offer the app or its data as a complement |
| React Native drops the interop layer for legacy modules | The native module stops working on upgrade | Rewrite it as a Turbo Native Module in phase 1 |
| OpenStreetMap data is wrong or incomplete | Bad journeys; missing hubs | Check each imported corridor on the ground; add hubs in the admin panel |
| ODbL share-alike is overlooked | Licence breach | Decide before importing into the live network; credit OpenStreetMap |
| Map tiles are blocked for heavy use | Blank maps | A tile provider before launch |
| The web app is used for the stop alarm with the screen off | The alarm does not ring | The web app keeps the screen on and says why; riders who need it locked use the phone app |

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
- Pathadisha's features and its use of crowdsourced reports (used in version 0.1; for its current
  state see the version 0.2 sources below):
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

Added in version 0.2, from research on 27 October 2026:

- Yatri Sathi's "Where Is My Bus" feature, May 2025 (not found in the app on 28 October 2026):
  [Wikipedia](https://en.wikipedia.org/wiki/Yatri_Sathi),
  [Millennium Post, launch](https://www.millenniumpost.in/bengal/where-is-my-bus-features-now-on-yatri-sathi-app-610149),
  [Millennium Post, private routes and operators' complaints](https://www.millenniumpost.in/bengal/state-to-improve-bus-tracking-on-yatri-sathi-apps-where-is-my-bus-feature-617432),
  [APAC News Network, 65 routes planned](https://apacnewsnetwork.com/2025/07/west-bengal-transport-department-to-bring-65-bus-routes-under-yatri-sathi/)
- Yatri Sathi sells WBTC bus tickets:
  [India Blooms](https://www.indiablooms.com/life/kolkata-yatri-sathi-app-launches-digital-ticket-booking-for-wbtc-buses/details)
- Pathadisha's last release and its removal from Google Play:
  [APKPure](https://apkpure.net/pathadisha/com.wbtransport.commuter),
  [AppBrain](https://www.appbrain.com/app/pathadisha/com.wbtransport.commuter)
- Trackers fitted, and failing:
  [The Statesman, 1.58 lakh vehicles](https://www.thestatesman.com/bengal/1-58l-vehicles-fitted-with-tracking-device-so-far-minister-1503369773.html),
  [The Statesman, nine makers blacklisted](https://www.thestatesman.com/bengal/transport-dept-blacklists-9-vltd-makers-1503441077.html),
  [Millennium Post, 48-hour deadline](https://www.millenniumpost.in/bengal/arjun-singh-directs-webel-to-resolve-vltd-issues-in-48-hours-668872)
- No Kolkata GTFS feed: [Mobility Database catalog](https://files.mobilitydatabase.org/feeds_v2.csv),
  [Transitland](https://www.transit.land/operators?search=kolkata)
- OpenStreetMap's Kolkata bus routes: [taginfo](https://taginfo.openstreetmap.org/api/4/key/values?key=network&filter=relations&query=Kolkata),
  counted again through the Overpass API for this version (408 relations; about 550 named bus stops)
- Android foreground service rules and Play's declaration:
  [Android developers, service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
  [Google Play help](https://support.google.com/googleplay/android-developer/answer/16965181),
  [target API level](https://developer.android.com/google/play/requirements/target-sdk)
- React Native's legacy architecture and interop layer:
  [0.82](https://reactnative.dev/blog/2025/10/08/react-native-0.82),
  [0.84](https://reactnative.dev/blog/2026/02/11/react-native-0.84),
  [0.88](https://reactnative.dev/blog/2026/10/19/react-native-0.88)
- DPDP Rules notified on 13 November 2025: [PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014)
- Location in web pages only while visible: [W3C Geolocation](https://www.w3.org/TR/geolocation/);
  Screen Wake Lock support: [caniuse](https://caniuse.com/wake-lock);
  notifications on iOS for Home Screen web apps: [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

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
