# Draft Kolkata bus routes: sources and report

Prepared 17 November 2026 for the project admins. This draft is not ready for riders. It is a starting point to check and correct.

Files:

- `data/draft-routes-kolkata.json`: the draft network, in the app's own format (region "Kolkata").
- `data/draft-routes-kolkata.sources.json`: where each route's stops, road path, timings and operator came from, with the licence of each source.
- `data/draft-routes-kolkata.md`: this report.
- `data/draft-routes-kolkata-all.json`, `data/draft-routes-kolkata-all.sources.json` and `data/draft-routes-kolkata.unplaced.json`: the complete draft. It adds the left-out routes so admins can fix them in the admin panel (see "The complete draft" below).

## In short

- **33 routes** came out (46 directions, 284 stops). Every direction has a real road path, and every stop has coordinates from OpenStreetMap.
- **Published timings: 0 routes. Default timings: all 33 routes.** None of the open sources gives first bus, last bus or frequency for any Kolkata route. Every route uses the placeholder times: first bus 06:00, last bus 21:00, a bus every 15 minutes. Every route needs real timings before launch.
- Operators: 15 private, 13 govt, 5 "other" (operator not confirmed by any open source).
- 23 of the 33 routes have **only one direction**, because only one direction is mapped well enough in OpenStreetMap. The return direction was not made up by reversing the stops, because many Kolkata roads are one-way.
- `validateNetwork` finds no problems. All ids are lowercase, using only letters, digits, dots, dashes and underscores.

## Where the data came from

The stops and road paths come from OpenStreetMap, read through the repo's own importer (`tools/import-osm.ts`, function `fromOverpass`). Wikipedia was used only to decide whether a route is a government route.

OpenStreetMap data was not fetched through Overpass (see the sources table below). Instead, the Geofabrik extract for India's Eastern Zone (OpenStreetMap data as of 16 November 2026) was downloaded once. The bus route relations lying mostly inside Greater Kolkata (22.33 to 22.90 N, 88.15 to 88.58 E) were taken out of it into the same JSON shape that Overpass returns, and passed to `fromOverpass` unchanged. That found 451 bus route relations, which the importer grouped into 236 routes.

Three things were corrected on top of the importer's output:

1. **Rail, Metro, tram and ferry stops removed.** The importer treats any named `public_transport=platform` or `stop_position` near the bus's road as a bus stop. In Kolkata that pulled in 228 tram stops, Metro and railway platforms (for example "Esplanade (Line 1)" and "Howrah Junction") and ferry ghats. These were removed unless they are also tagged `highway=bus_stop` or `bus=yes`.
2. **Operator.** OpenStreetMap tags almost every Kolkata route, state routes included, as network "Kolkata Private Bus", so the importer marks AC-, S- and E- routes as private. A route is marked govt here when Wikipedia lists it as a state route (the CSTC route list, or the WBTC late-night list), or when its OpenStreetMap network is WBSTC (a former state operator, now part of WBTC; the importer does not recognise that name). Routes that only look like state numbers, with nothing to confirm them, are marked "other".
3. **Direction.** The importer marks a route's directions UP, DOWN, UP, DOWN in the order the relations happen to be listed. Here a direction is UP when its ends match the first direction's ends, so variants of the same direction share UP or DOWN (route 239 has two of each).

Quality rules: only directions that pass every rule were kept, and a route was kept if at least one of its directions passed:

- at least 8 named stops;
- a road path of at least 3 km, with no gaps;
- no more than 4 km between two stops in a row;
- at least 0.6 stops per km;
- a named stop within 2 km of each end of the route.

Most Kolkata route relations in OpenStreetMap list only the roads, not the stops. For those, the importer takes the named bus stops within 30 m of the road path, in the order the bus passes them. This applies to almost every route in this draft. The stop positions are real, but the stop lists are inferred: a bus may not actually stop at every one, and on flyovers a stop on the road underneath may have been picked up.

## Every source looked at

| Source | Licence or terms | robots.txt | Used? |
|---|---|---|---|
| OpenStreetMap data, through the Geofabrik extract https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf (data as of 2026-11-16) | ODbL 1.0, © OpenStreetMap contributors. Geofabrik offers its extracts as free downloads | No robots.txt (404) | **Used** for all stops, road paths and route numbers, and for the operator where OpenStreetMap gives one. Downloaded once (248 MB) |
| Overpass API, https://overpass-api.de/api/interpreter (the importer's default) | FOSSGIS usage policy allows scripted use: one connection, a real User-Agent, OpenStreetMap attribution | `Disallow: /api/` for all user agents | **Not used**, because robots.txt disallows `/api/`. The admins may decide this rule is meant for search crawlers rather than API clients (see "Decisions for the admins") |
| Overpass API, https://overpass.private.coffee (formerly overpass.kumi.systems) | "Free and unlimited", no sign-up, commercial use allowed | No robots.txt (404) | **Not used**: its home page loaded, but the API timed out every time from this network |
| Wikipedia, "Calcutta State Transport Corporation", https://en.wikipedia.org/wiki/Calcutta_State_Transport_Corporation (route list section) | CC BY-SA 4.0 | `/wiki/` pages allowed (the `/w/` API is disallowed, so it was not used) | **Used** only to decide govt operator (12 routes) and to compare end points. Its 87 routes give end points and "via" places but no stop coordinates and no timings |
| Wikipedia, "West Bengal Transport Corporation", https://en.wikipedia.org/wiki/West_Bengal_Transport_Corporation | CC BY-SA 4.0 | allowed | **Used** only for its list of WBTC late-night route numbers (to confirm govt operator). It gives no times |
| Wikipedia, "Transport in Kolkata" (https://en.wikipedia.org/wiki/Buses_in_Kolkata redirects there) | CC BY-SA 4.0 | allowed | Looked at; **not used**: no route list |
| WBTC official site, City Bus Routes page https://wbtconline.in/wbtc-city-bus-routes, and its PDF https://wbtconline.in/assets/pdf/INTRA_CITY_RTS_Latest-small.pdf | The terms page (https://wbtconline.in/terms-conditions) covers only online ticket booking. The footer says "Copyright © 2026. All Rights Reserved". No licence or permission to reuse is given | Empty (allows everything) | **Not used, terms unclear.** It lists 57 WBTC city routes with their stops in order, but no times. This is the best official source; see "Decisions for the admins" |
| West Bengal Transport Department, https://transport.wb.gov.in | | `Disallow: /` for all user agents (only Google and Bing allowed) | **Not used**: robots.txt forbids it. Only robots.txt was fetched |
| Open Government Data portal, https://data.gov.in (Government Open Data License – India) | GODL-India | `Disallow: /` for all user agents | **Not used**: robots.txt forbids it. The API (api.data.gov.in) needs a registered key, and logging in was not allowed |
| Kolkata Municipal Corporation, https://www.kmcgov.in | | No robots.txt | Looked at; **not used**: only a landing page, with no bus routes or timetables. KMC does not run buses |
| OpenStreetMap wiki, "India/Transport/Kolkata", https://wiki.openstreetmap.org/wiki/India/Transport/Kolkata | CC BY-SA 2.0 | `/wiki/` allowed | Looked at; **not used**: an old status table of a few relations, no route data |
| redBus, Goibibo, MakeMyTrip, Moovit, Chalo, Google Maps, Justdial | Commercial; their terms forbid scraping | | **Not used** and not visited. redBus, Goibibo and MakeMyTrip turned up in web search results |
| housing.com (a news article giving first and last bus for route 217) | Commercial property portal; no open licence | | **Not used**, not visited: not a reuse-friendly source |
| Scribd document "Kolkata Bus Routes" | User upload, rights unclear | | **Not used**, not visited: terms unclear |
| calcuttatramways.com (appeared in search results) | Enthusiast site; terms not checked | | **Not used**, not visited: terms unclear |

How the fetching was done: a generic User-Agent ("WhereIsMyBus-research/0.1"), at most one request every 1.5 seconds per site, and every page cached so that none was fetched twice. Nominatim was not used. All coordinates come from OpenStreetMap.

## Routes in the draft

The number in brackets is the number of stops in that direction. "Check" lists what an admin should look at.

| Route | Operator | Name in OSM | Directions (stops) | Check |
|---|---|---|---|---|
| 1 | private | Mukundapur - Ramnagar | UP to Ramnagar (23); DOWN to Mukundapur (21) |  |
| 1A | private | Mukundapur - Ramnagar | UP to Ramnagar (26); DOWN to Mukundapur (25) |  |
| 3C/1 | private | Anandapur - Nagerbazar | UP to Nagerbazar (46) | one direction only |
| 3C/2 | private | Anandapur - Nagerbazar | UP to Nagerbazar (46) | one direction only |
| 3D | private | Sakher Bazar - Milk Colony | UP to Milk Colony (24) | one direction only |
| 21/1 | private | Barisha - Sealdah Station | UP to Sealdah Station (28); DOWN to Barisha (29) |  |
| 45 | private | Airport Gate 1 - Baishnabghata | UP to Baishnabghata (55); DOWN to Airport Gate 1 (52) |  |
| 47/1 | private | Tollygunge - Rajabazar | UP to Rajabazar (18) | one direction only |
| 202 | private | Nagerbazar - Science City | UP to Science City (22); DOWN to Nagerbazar (20) |  |
| 221 | private | Nagerbazar - Golpark | UP to Golpark (43); DOWN to Nagerbazar (42) |  |
| 239 | private | Bikash Bhawan - Babughat | UP to Babughat (21); UP to Babughat (42); DOWN to Bikash Bhawan (22); DOWN to Shapoorji (47) |  |
| 240 | private | Bagbazar - Golf Green | UP to Golf Green (14) | one direction only |
| 240/1 | private | Bagbazar - Garia Station | UP to Garia Station (24); DOWN to Bagbazar (25) |  |
| 260 | private | Alipore Zoo - Shirish Calla Bus Stand | UP to Shirish Calla Bus Stand (22) | one direction only |
| AC-9 | govt | Salt Lake Karunamoyee - Jadavpur | UP to Jadavpur (39) | one direction only |
| AC-30S | govt | Ecospace - Bidhannagar Station | UP to Bidhannagar Station (23) | termini differ from Wikipedia (Ultadanga - Ecospace); the route may have been changed, check; one direction only |
| AC-31 | govt | Behala Chowrasta - Jadavpur | UP to Jadavpur (11) | one direction only |
| AC-38 | other | Dum Dum Station - Salt Lake Karunamoyee | UP to Salt Lake Karunamoyee (32) | towards Salt Lake Karunamoyee: road path is 5.1 times the straight-line distance; check for loops or detours; OSM says private, but the number looks like a WBTC series: set to "other"; one direction only |
| AC-47 | govt | Shapoorji -Kudghat | UP to Kudghat (66) | one direction only |
| MB-2 | govt | (none) | UP to Karunamoyee 1 (17) | OSM network is WBSTC (now part of WBTC): set to govt; one direction only |
| RT57 | other | (none) | UP to Karunamoyee 4 (18); UP to Karunamoyee 3 (8); DOWN to Hudco (10) | no operator or network in OSM: set to "other" |
| S-4 | govt | Salt Lake Karunamoyee - Parnasree | UP to Parnasree (60) | one direction only |
| S-6 | other | Esplanade - Botanical Garden | UP to Botanical Garden (12) | dropped direction(s): towards Esplanade: no named stop within 2 km of the end of the route; OSM says private, but the number looks like a WBTC series: set to "other"; one direction only |
| S-6A | other | Esplanade - Danish Sheikh Lake | UP to Danish Sheikh Lake (14) | dropped direction(s): towards Esplanade: no named stop within 2 km of the end of the route; OSM says private, but the number looks like a WBTC series: set to "other"; one direction only |
| S-14 | govt | Salt Lake Karunamoyee - Garia | UP to Garia (30) | one direction only |
| S-21 | govt | Bagabzar - Garia | UP to Garia (25) | termini differ from Wikipedia (Bagbazar - Garia); the route may have been changed, check; one direction only |
| S-30 | govt | Ecospace - Bidhannagar Station | UP to Bidhannagar Station (23) | termini differ from Wikipedia (Ultadanga - Ecospace); the route may have been changed, check; one direction only |
| S-30A | govt | Bidhannagar Road Station - Bidhannagar Road Station | UP to Bidhannagar Road Station (19) | termini differ from Wikipedia (Ultadanga - Salt Lake Sector-V); the route may have been changed, check; one direction only |
| S-31 | govt | Behala Chowrasta - Jadavpur | UP to Jadavpur (11) | one direction only |
| S-37A | govt | Airport Gate 1 - Garia | UP to Garia (37) | one direction only |
| S-45 | govt | Shakuntala Park - Kolkata Station | UP to Kolkata Station (23) | one direction only |
| S-62 | other | Anandapur - Bichali Ghat | UP to Bichali Ghat (42) | OSM says private, but the number looks like a WBTC series: set to "other"; one direction only |
| S-178 | private | Behala 14 No - Rajabazar | UP to Rajabazar (14); DOWN to Behala 14 No (15) |  |

## Routes left out, and why

The routes below were left out because their **stops could not be placed** from a reliable source. Each number is listed once, under the first rule it failed. In almost every case the route is in OpenStreetMap, but too few of its bus stops are mapped and named.

- **A few or no named bus stops mapped along it** (54): 12, 12A, 12AD, 13A, 14A, 17, 24/1, 30A, 34B, 34C, 42A, 43, 204/1, 213, 213A, 214A, 259, AS-1, AS-2, AS-2a, AS-3, E-4, IC-21, L30B, RT-1, RT-2, RT-10, RT-11A, RT-26, RT-31, RT-32, S-8, S-11, S-12, S-12E, S-12G, S-47, S-59, S-63, S-125, S-126, S-139, S-158, S-161, S-164, S-165, S-166, S-167, S-180, S-185, V-20, V1, V2, V9
- **Long stretches (over 4 km) with no mapped stop** (26): 1B, 3B, 13, 21, 30C, 32A, 42B, 47B, 211 White Board, 211 Yellow Board, 211A, 211B, 214, 218, 222, 228, 234/1, 237, AC-14, RT-20A, RT-42, S-3A, S-3B, S-9A, S-17A, S-58
- **No mapped stop within 2 km of one end of the route** (102): 7A, 12C/1, 12C/1A, 12C/2, 13C, 18A, 18B/1, 18C, 18D, 24, 24A/1, 24B, 28, 30B, 30C/1, 30D, 37, 37A, 39A/2, 40B, 41, 41B, 44, 44/1, 44A, 45A, 45B, 46, 46B, 205, 205A, 208, 212, 215, 215/1, 215A/1, 217, 217B, 219, 219/1, 223, 227, 230, 234, 235, AC-1, AC-5, AC-7, AC-12, AC-12D, AC-23A, AC-24, AC-24A, AC-36, AC-37, AC-37A, AC-37C, AC-39, AC-50, AC-50A, AC-55, AC-59, E-1, RT-1A, RT-5, RT-21, RT-24, RT-29, S-2, S-2N, S-4C, S-5, S-5/N, S-7, S-7/N, S-10A, S-12D, S-13A, S-23, S-23A, S-24, S-37, S-46, S-101, S-102, S-104, S-106, S-107/1, S-108, S-109, S-112, S-117, S-121, S-131, S-135, S-151, S-152, S-168, S-172, S-173, S-184, S-186
- **Too few stops for its length (under 0.6 per km)** (10): 12C, 12C/1B, 40A, AC-4, AC-52, L238, S-47A, S-110, S-113, S-175
- **Road path under 3 km (incomplete in OSM)** (8): 71, 171, 201, 210, 215A, DN8, RT5, RT29
- **Road path has gaps** (1): S-9
- **Fewer than two named stops in OSM, so the importer skipped it** (50): 12 Shuttle, 12B, 18/C, 39, 107, 173, AC-2, AC-6, AC-9B, AC-20, AC-41, AC-43, AC-49, AC-54, AS-4, Barasat Baruipur, C-18, Dhamakhali Barasat, DN-16, GLS-11, JM-2, ref, RT-3, RT-007, RT-18, RT-25, RT-27, RT-27A, RT-30, RT-38, RT-39, RT-239, RT-S/4, S-3W, S-4D, S-9C, S-22, S-32, S-32A, S-57, S-101/1, S-107, S-123, S-124, S-128, S-163, S-176, S-189, V-10, VS2
- **Listed on Wikipedia as state routes, but not mapped in OpenStreetMap at all** (27): AC4A, AC4B, AC30, AC40, AC54B, AC57, AC58, AC60, M14, S2B, S8B, S10, S11B, S15G, S16, S21A, S30P, S33A, S34B, S39A, S50B, S61, S66, S67, S68, S70, S71

The 57 routes on WBTC's own City Bus Routes page were not used (see the sources table). Three OpenStreetMap relations without a route number were also skipped.

## The complete draft (routes to fix in the admin panel)

`data/draft-routes-kolkata-all.json` holds **274 routes** (430 directions, 439 stops):

- the **33 strict routes**, unchanged;
- **241 routes marked "needs-review"**. These are routes left out of the strict draft that could still be placed without inventing any coordinates.

It passes `validateNetwork` and `prepareNetwork`. It uses the same OpenStreetMap extract and the same sources, so nothing new was fetched. Every route still uses the placeholder timings (06:00 to 21:00, every 15 min), marked as defaults in the sources file.

**How to find the routes to fix:** in `data/draft-routes-kolkata-all.sources.json`, every route has a `quality` field:

- `"ok"` for the 33 strict routes;
- `"needs-review"` for the rest. These also have a `reasons` list, and a `checks` list that says exactly what to look at.

Needs-review routes per reason. A route can have more than one reason; 140 routes have just one.

| Reason | Routes |
|---|---|
| No mapped stop within 2 km of one end of the route | 169 |
| Fewer than two named stops in OSM | 87 |
| Too few stops for its length (under 0.6 per km) | 62 |
| Few or no named bus stops mapped along it | 46 |
| Long stretches (over 4 km) with no mapped stop | 39 |
| Road path under 3 km (incomplete in OSM) | 8 |
| Listed on Wikipedia as state routes but not mapped in OpenStreetMap at all | 8 |

What to know when fixing them:

- **Placeholder end stops.** Where OpenStreetMap had fewer than two named stops on a route, a stop was put at each real end of its road path, using the path's own coordinates. These stops are named like "Route 12A: start" and "Route 12A: end", and there are 73 of them. Ends within 50 m of each other are one shared stop; 27 stops are shared, and the other routes' names are kept as other names. One stop is shared by 25 routes ("Route 230: end", almost certainly a major terminus). Rename these stops to the real place, or move them. Named bus stops within 30 m of the path are kept between the two ends.
- **Straight lines.** 84 directions have no road path, because the path in OpenStreetMap has gaps, so straight lines are drawn between their stops.
- **One direction only.** 125 routes have only one direction.
- **Possible duplicates.** Four route numbers appear twice, from different OpenStreetMap networks (3C/1, 201, 210, 215A). The second copy has an id ending in `_2`. Probably one is a duplicate or an old relation.
- **Stop positions.** Stops shared with the strict draft keep the strict draft's positions.

**Wikipedia-only state routes:** 27 routes on Wikipedia's CSTC list are not in OpenStreetMap at all.

- **8 were placed** (AC4A, AC4B, M14, S15G, S33A, S39A, S50B, S71). Each terminus name matched a stop already in the draft, or a named OpenStreetMap bus station or place. The sources file names the OpenStreetMap element each terminus matched.
  - Only the two termini are placed, joined by a straight line in each direction.
  - In 7 of these routes, at least one terminus matched the general point for an area (for example the suburb "Behala" or the town "Baruipur"). Move it to the real bus stand.
  - Route numbers are written as Wikipedia lists them (for example "AC4A", where WBTC writes "AC-4A").
- **19 could not be placed**, because at least one terminus name matched nothing: for example "Howrah Station", "Barrackpore Court" and "Salt Lake Karunamoyee" have no OpenStreetMap stop, bus station or place with exactly that name. They are listed in `data/draft-routes-kolkata.unplaced.json`, with the termini as listed, the unmatched names and the source URL.

**Also not in the complete draft** (also in the unplaced file):

- 12 route numbers whose OpenStreetMap relations have no road path and fewer than two named stops, so not even their ends can be placed: 173, AS-4, Barasat Baruipur, C-18, Dhamakhali Barasat, DN-16, GLS-11, JM-2, RT-007, RT-239, RT-S/4, S-9.
- 9 route numbers where every direction has gaps in its road path: 14A, AS-3, IC-21, L30B, S-12, S-12E, S-12G, S-59, S-167. "Road path has gaps" was not one of the reasons to include. These could go in with straight lines between their mapped stops, if the admins want them.

## Attribution the app must show

For the data in this draft, wherever the network is shown or offered for download (map screen, an About or Credits page, and the app store listings):

> Bus stops and routes © OpenStreetMap contributors, available under the Open Database License (ODbL). https://www.openstreetmap.org/copyright

Also, because Wikipedia was used to mark some routes as government routes:

> Operator information for some routes from Wikipedia (CC BY-SA 4.0).

Both networks now carry these credits in their `attribution` field, which the apps, admin import and GTFS feed show or keep:

- the OpenStreetMap credit, linking to https://www.openstreetmap.org/copyright;
- one Wikipedia credit for each page actually used: https://en.wikipedia.org/wiki/Calcutta_State_Transport_Corporation and https://en.wikipedia.org/wiki/West_Bengal_Transport_Corporation.

In the complete draft, the first Wikipedia credit reads "Some routes and operator information", because the 8 Wikipedia-only routes come from that page. The `notice` field (still marked DRAFT) also says the timings are placeholders.

## Should the draft files stay out of git?

**Yes. Treat `draft-routes-kolkata.json` and `draft-routes-kolkata.sources.json` like `data/osm-*.json`, and keep them out of git until the licensing decision is made.** Almost all of their content comes from OpenStreetMap, so they are covered by the ODbL, exactly like the `osm-*.json` imports. The current `.gitignore` pattern `data/osm-*.json` does **not** match these names, so an admin would need to add a line such as `data/draft-routes-*.json`. That line also covers the complete draft (`draft-routes-kolkata-all.json`, `draft-routes-kolkata-all.sources.json`) and `draft-routes-kolkata.unplaced.json`, which should be treated the same way. `.gitignore` has not been changed. This report (`.md`) holds no map data and can be committed.

(The project folder is not a git repository at the moment, so nothing has been committed or pushed.)

## Decisions for the admins

1. **ODbL.** If this data goes into the live network, the network the app downloads is a database built from OpenStreetMap. It must credit OpenStreetMap, and it must be offered under the ODbL (share-alike). This includes any later admin edits that are mixed into it. Decide whether that is acceptable before importing.
2. **Timings.** No route has real timings. Ask WBTC and the private bus syndicates for timetables, or survey them.
3. **Ask WBTC for permission.** WBTC's City Bus Routes page is the best official stop list for government routes, but it gives no permission to reuse. Write to WBTC (the helpline and email are on wbtconline.in) and ask for permission to reuse its route list, and for timetables. If they agree, the 57 routes can be checked against it.
4. **Overpass.** The importer's default server (overpass-api.de) disallows `/api/` in its robots.txt, although its operator's usage policy explicitly allows scripted use. Decide whether the importer may keep using it. The Geofabrik extract is a fully clean alternative.
5. **Operators marked "other"** (AC-38, RT57, S-6, S-6A, S-62): confirm who runs them.
6. **One-direction routes**: add the return directions in the admin panel, or map them in OpenStreetMap.
7. **Improve OpenStreetMap.** Most routes were left out because Kolkata's bus stops are thinly mapped and named in OpenStreetMap. Adding named stops there, which anyone can do, would let the importer place many more routes.

## Possible improvements to `tools/import-osm.ts` (not made)

These problems showed up while building the draft. The tool itself was not changed.

- When picking stops along the road, skip rail, Metro, tram and ferry stops (see correction 1 above).
- Recognise WBSTC and CSTC as government operators.
- Set UP and DOWN from the geometry, not from the order of the relations.
- OpenStreetMap's "Kolkata Private Bus" network tag is not reliable for telling private and government routes apart.

## How the draft was built

The scripts are in a temporary scratch folder outside the repo. They are throwaway and were not added to `tools/`:

- `pbf_to_overpass_fast.py` (Python with pyosmium) turns the Geofabrik extract into Overpass-style JSON.
- `build.ts` (Node) runs `fromOverpass`, applies the corrections and quality rules, and writes the network and the sources file.
- `validate.ts` (Node) runs `validateNetwork` from `packages/core/src/index.ts`.
- `pbf_places.py` lists the named OpenStreetMap places, bus stations and stops in the same extract.
- `build-all.ts` builds the complete draft, its sources file and the unplaced list.
- `attribution.cjs` adds the `attribution` credits to a network, based on its sources file.

The scratch folder may be cleared, so ask if these should be kept.

## Bengali stop names

Every stop in both drafts now has a Bengali name (`nameBn`), which the apps show when Bengali is on.
`data/draft-routes-kolkata.bengali-names.json` lists each one with where it came from, the ones to
check first at the top:

| Where the Bengali name came from | Stops | What to do |
|---|---|---|
| Written by Claude from the English name ("machine") | 349 | Checked by the project owner on 17 November 2026: correct |
| Placeholder for a stop at the end of a road path ("রুট X: শুরু" / "রুট X: শেষ") | 73 | Rename along with the English name |
| Another OpenStreetMap feature with the same English name, such as the locality | 11 | Checked: correct |
| The stop's own `name:bn` in OpenStreetMap | 6 | None |

Route numbers and letters stay as painted ("11A বাস স্টেশন"); "More" is মোড়, "Bus Stop" is বাস স্টপ.
Fix a name in the admin panel (the stop's Bengali name field), or in the draft before importing it.
