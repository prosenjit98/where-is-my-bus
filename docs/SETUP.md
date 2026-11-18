# Setting up Where Is My Bus on your computer

From a fresh clone to the server, the web app and the Android app running on your machine. Each
step says how to check that it worked before you move on.

Commands are for Windows PowerShell unless they say otherwise; on Linux or macOS use the same
commands in a terminal (and `export NAME=value` where PowerShell has `$env:NAME = "value"`).

| You want to | Do steps |
|---|---|
| Run the server and the rider web app | 1 to 5 |
| Use PostgreSQL and Redis, as production does | 1 to 5, with 3b |
| Run the tests | 1 to 6 |
| Work on the Android app | 1 to 5, then 7 |

---

## 1. Install the tools

| Tool | Version | Needed for |
|---|---|---|
| [Node.js](https://nodejs.org) | **22.18 or newer** (it runs the TypeScript directly) | everything |
| Git | any recent | cloning |
| Google Chrome | any recent | browser end-to-end tests only |
| PostgreSQL | 17 | optional, step 3b |
| Redis | 7 or 8 | optional, step 3b |
| Docker Desktop | any recent | optional: the easiest way to get PostgreSQL and Redis |
| JDK, Android Studio | JDK 17 or newer, Android SDK 37 | the Android app only, step 7 |

Check Node:

```powershell
node --version     # v22.18.0 or higher
```

## 2. Get the code

```powershell
git clone <internal repository URL> where-is-my-bus
cd where-is-my-bus
```

Use the team's internal git server (a host ending in `.amat.com`); company code must not go to or
come from GitHub, GitLab or Bitbucket.

If you will build the Android app on Windows, clone into a **short folder** such as
`C:\dev\wimb`. Native build paths grow past Windows' 260-character limit from deeper folders
(see [mobile/README.md](../mobile/README.md), last section).

Already have a clone? Update it with `git pull`, then run step 4 again: other people may have
added libraries.

## 3. Choose where the server keeps its data

The server runs in one of two ways. Pick one.

### 3a. Files (simplest; nothing else to install)

Without database settings the server keeps everything in files under `backend/data/`, and live
data in memory. Good for working on the app's screens and logic.

```powershell
Copy-Item backend\.env.example backend\.env
```

Then open `backend\.env` and put a `#` in front of the `DATABASE_URL=` and `REDIS_URL=` lines.

### 3b. PostgreSQL and Redis (as in production)

Needed to work on storage, several servers, or to run the database tests.

**With Docker** (any OS), two containers:

```powershell
docker run -d --name wimb-postgres -e POSTGRES_USER=wimb -e POSTGRES_PASSWORD=wimb -e POSTGRES_DB=wimb -p 5432:5432 -v wimb-pg:/var/lib/postgresql/data postgres:17
docker run -d --name wimb-redis -p 6379:6379 -v wimb-redis:/data redis:8 redis-server --appendonly yes
```

After a reboot, start them again with `docker start wimb-postgres wimb-redis`.

**Without Docker:**

- PostgreSQL 17: the installer from postgresql.org (Windows, macOS) or `apt install postgresql`
  (Linux). Then make the app's user and database, in `psql` as the `postgres` user:

  ```sql
  CREATE ROLE wimb LOGIN PASSWORD 'wimb';
  CREATE DATABASE wimb OWNER wimb;
  ```

- Redis: `apt install redis-server` (Linux), `brew install redis` (macOS). Redis publishes no
  Windows version: on Windows use Docker, WSL, or a Windows build of Redis (Memurai, or an MSYS2
  build of Redis).

Then:

```powershell
Copy-Item backend\.env.example backend\.env
```

and set the two addresses in `backend\.env` (with the password you chose):

```properties
DATABASE_URL=postgres://wimb:wimb@localhost:5432/wimb
REDIS_URL=redis://localhost:6379
```

You do not create any tables. The server creates and updates them itself when it starts.

### The routes it starts with (both ways)

`backend\.env` has `SEED_FILE=../data/seed-kolkata.json`: the network of 274 Kolkata routes that a
new server or an empty database starts from. **That file is not in git** (it is built from
OpenStreetMap data, and its licence is still to be settled), so either:

- get `seed-kolkata.json` from a teammate and put it in the `data` folder, or
- put a `#` in front of the `SEED_FILE=` line: the server then starts from the small demo network
  in git (`data/demo-network.json`, a few routes around Esplanade and Jadavpur).

With the line there and the file missing, the server stops at its first start with a "file not
found" error.

## 4. Install the libraries

The server has two libraries (the PostgreSQL and Redis clients); the other folders only have
TypeScript and its types, for checking the code. From the top folder:

```powershell
npm install --prefix backend
npm install --prefix packages/core
npm install --prefix web
npm install --prefix tools
npm install --prefix e2e
```

The server alone needs only the first line. On a network that inspects HTTPS with its own
certificate, npm may fail with `SELF_SIGNED_CERT_IN_CHAIN`: point npm at the company's root
certificate with `npm config set cafile <path to the .pem file>`.

## 5. Start the server

```powershell
cd backend
$env:ADMIN_TOKEN = "choose-a-long-secret"
npm start
```

It prints its address (`http://localhost:8080`) and the network it loaded, with its number of
stops and routes and where it keeps it (a file, or PostgreSQL). Without `ADMIN_TOKEN` it makes a new token each start and prints it. Use `npm run dev`
instead to restart it whenever a file changes.

Then open:

| Address | What |
|---|---|
| http://localhost:8080 | Rider web app. Try a journey from Esplanade to Jadavpur 8B. |
| http://localhost:8080/admin | Admin panel. Sign in with the `ADMIN_TOKEN`. |
| http://localhost:8080/signin | Sign-in and sign-up for owners, their staff and conductors, syndicates and contributors. |
| http://localhost:8080/owner | Bus owners' dashboard, once an owner signs in. |
| http://localhost:8080/api/health | `ok: true` when the server is up, and whether it uses files or PostgreSQL and Redis. |

**See live buses without riding one.** In a second terminal, from the top folder:

```powershell
npm run simulate
```

Planned journeys now show "Live" waits from the simulated buses.

**Accounts to try things with.** Sign up as an owner at `/signin`, then approve the owner in the
admin panel under **Bus owners**. The owner adds a bus on their dashboard. Sign up a conductor
with that owner's mobile number; the owner approves them on the dashboard. To see one-time SMS
codes without an SMS gateway, start the server with `$env:SMS_TO_LOG = "1"`; the codes then
appear in its log.

**Loading the Kolkata routes later.** If the server already started with the demo network, load
the seed (from `backend`, server running or not):

```powershell
npm run seed -- ../data/seed-kolkata.json --replace
```

It saves a copy of the old network in `backend/data/` first. Owners, buses and trips are kept.

**Stopping and starting over.** `Ctrl+C` stops the server. To start again from nothing: in file
mode delete `backend/data/`; with PostgreSQL drop and recreate the `wimb` database (or remove the
Docker containers and their volumes).

## 6. Run the tests

From the top folder:

```powershell
npm test             # shared logic, the server's API, the tools: about a minute
npm run typecheck    # TypeScript check of every folder
npm run test:e2e     # the web app and admin panel in a real Chrome
```

The database tests are skipped unless PostgreSQL and Redis are set up (step 3b). To run them:

```powershell
cd backend
npm run test:db
```

They work in a schema of their own and do not touch the app's data. The browser tests use the
Chrome installed on your computer; if it is somewhere unusual, set `CHROME_PATH` to `chrome.exe`.

## 7. The Android app

Full detail is in [mobile/README.md](../mobile/README.md). In short:

1. **Install** JDK 17 or newer and Android Studio. In Android Studio's SDK Manager install
   Android SDK Platform 37, Build-Tools 37.0.0 and NDK 27.1.12297006. Set `ANDROID_HOME` to the
   SDK folder (usually `%LOCALAPPDATA%\Android\Sdk`) and add its `platform-tools` to `PATH`, so
   that `adb` works.
2. **Google Maps key** (the maps stay blank without one; everything else works). Add this line
   to `%USERPROFILE%\.gradle\gradle.properties`, not to the project:

   ```properties
   MAPS_API_KEY=your-google-maps-key
   ```

3. **Libraries:**

   ```powershell
   cd mobile
   npm install
   ```

4. **A device:** an emulator from Android Studio's Device Manager (a "Google APIs" image), or a
   phone on USB with Developer options and USB debugging on. `adb devices` should list it.
5. **Run.** With the server running (step 5), in `mobile`:

   ```powershell
   adb reverse tcp:8080 tcp:8080    # the app reaches your server as localhost:8080
   npm start                        # Metro, in its own terminal
   npm run android                  # builds, installs and opens the app
   ```

   Run `adb reverse` again each time the phone is plugged in again. The first build takes a long
   time (it compiles native code); later ones are quick.

If Gradle fails with **"PKIX path building failed"** (the company network inspects HTTPS), run
`$env:JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStoreType=Windows-ROOT"`, then
`android\gradlew --stop`, and build again. If it fails with **"Filename longer than 260
characters"**, move the project to a short folder (step 2).

The phone tests (`e2e/android`) and building for iOS are covered in the mobile README.

## Where things are

| Folder | What |
|---|---|
| `backend` | The server: API, live tracking, admin panel, owners' dashboard. Settings in `backend/.env`. |
| `packages/core` | Logic shared by the server, the web app and the phone app: journey planning, live tracking, Bengali text. |
| `web` | The rider web app, served by the backend as it is (no build step). |
| `mobile` | The React Native app for Android and iOS. |
| `tools` | Bus simulator, OpenStreetMap importer, load test. |
| `e2e` | End-to-end tests: browser (`*.e2e.ts`) and Android (`android/`). |
| `data` | The demo network; the Kolkata seed and route drafts when you have them (not in git). |
| `docs` | This guide and the project plan. |

The [README](../README.md) explains how it all works and every server setting, and
[Deploy with Docker](../README.md#deploy-with-docker) covers running it on a Linux server.

## Never commit

These are kept out of git by `.gitignore`. Keep it that way:

- `backend/.env` and `deploy.env`: your settings and passwords.
- `backend/data/`: the server's own data, including its `secret.key`.
- `data/seed-kolkata.json`, `data/draft-routes-*.json` and `data/osm-*.json`: OpenStreetMap
  data, until its licence is settled.
- Release keystores, `mobile/android/local.properties` and build folders.
