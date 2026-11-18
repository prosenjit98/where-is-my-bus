# Where Is My Bus: the app

Bare React Native app for Android and iOS, in English or Bengali. It plans journeys on the phone,
so search works offline, shows live buses from the server, and runs the "I'm on this bus" trip:
a stop alarm, and, if the rider agrees, pseudonymous sharing of the bus position. Riders can also
send family a link to follow the bus, tell others a bus just left their stop, and suggest fixes;
conductors' phones remember their bus's code between shifts.

This folder holds the app's code, a small native module in `native/wimb-location` for
location, the trip foreground service and the stop alarm, and the `android` and `ios`
projects. These were generated with the React Native 0.88.1 template (target API 36,
Kotlin 2.2, Gradle 9.4) and already have the setup below applied: the libraries and the
native module in `package.json`, the Google Maps key placeholder, and the iOS location keys.

## Set up (once)

You need Node 22.18 or newer, JDK 17 or newer and Android Studio with the Android SDK. For
iOS you also need a Mac with Xcode and CocoaPods.

**1. Install.**

```sh
npm install
```

Autolinking adds the native module to both apps, so there is nothing to add by hand to
`MainApplication` or the Xcode project. Its permissions and its foreground service are
merged into the Android manifest automatically.

**2. Android: give the build a Google Maps key.** The manifest reads it from the
`MAPS_API_KEY` Gradle property or environment variable, so the key never goes into the
repository. Put it in `~/.gradle/gradle.properties`:

```properties
MAPS_API_KEY=your-google-maps-key
```

**3. iOS: install pods.** The location descriptions and the `location` background mode are
already in `ios/WhereIsMyBus/Info.plist`.

```sh
cd ios && bundle install && bundle exec pod install && cd ..
```

iOS uses Apple Maps, so it needs no map key.

The project is named `WhereIsMyBus` everywhere (`app.json`, the Android package
`com.whereismybus`, the Xcode project). Rename it together with the app's new name.

**5. Run.** Start the backend first (see the main README), then:

```sh
npm start
npm run android    # or: npm run ios
```

The app reaches the backend at `http://localhost:8080`. On Android, a phone on USB and the
emulator alike, forward that port to your computer once each time the phone is connected:

```sh
adb reverse tcp:8080 tcp:8080
```

The iOS simulator shares your computer's localhost. To use a phone over Wi-Fi instead, change
`DEV_API_URL` in `src/config.ts` to your computer's address, such as `http://192.168.1.20:8080`.

## Test it on a phone or an emulator

Two files drive the real app over adb, against a real server they start themselves (23 tests):

- `e2e/android/app.android.ts`: refusing location, journey search, a simulated conductor's bus
  becoming the "Live" wait, a whole trip with the foreground service, the ongoing notification,
  tracking with the app in the background and the screen off, the stop alarm and the trip ending
  by itself after the stop, and a conductor who signs in on the phone sharing their owner's bus by
  its number plate, seen by the owner.
- `e2e/android/features.android.ts`: working offline with the built-in routes, Bengali, "Use my
  location", recent places, picking on the map, telling others a bus just left (agreed with a
  second rider and shown further along), a suggested fix reaching the admins, the stop alarm
  without sharing, a follow link the server opens, finding a route by its number, the dark and
  light themes (checked from the screen's pixels), a conductor signing up in the app and their owner
  approving them, and a contributor recording a route with named stops that reaches the admins.

1. Connect one device. An emulator with Google APIs (for example `android-36` `google_apis`
   `x86_64`), or a phone on USB with USB debugging on, Android 12 or later. On a phone the tests
   move its location with Android's test location providers and give it back at the end; Realme
   and Oppo phones allow that (and clearing the app's data) only with "Disable permission
   monitoring" on in Developer options.
2. Build and install the debug app for that device only, which is much faster:
   `cd android && ./gradlew installDebug -PreactNativeArchitectures=x86_64 -PMAPS_API_KEY=<key>`
   (`arm64-v8a` for most phones). Without a real key the maps stay blank, and the rest still works.
3. Start Metro: `npm start`. Make sure nothing else uses port 8080.
4. From the top folder:
   `node --test --test-concurrency=1 e2e/android/app.android.ts e2e/android/features.android.ts`.
   Set `E2E_SCREENSHOTS` to a folder to keep screenshots. Do not touch the device while they run
   (about 16 minutes): a tap on a permission dialog changes what the tests see.

## Accounts on the phone

The menu on the home screen (Settings and account) has the theme (as the phone is set, light or
dark) and signing in, with the same accounts as `/signin` on the website:

- **Conductors** sign up with their bus owner's mobile number, and the owner approves them in the
  owners' dashboard. Signed in, they plan the journey, tap "I'm on this bus" and type only the
  bus's number plate: it must be one of their owner's buses, and the owner sees its trips. There
  are no conductor codes any more.
- **Contributors** sign up and are approved by the Where Is My Bus team. They record a route from
  inside the bus ("Record a route"): the phone records the road while they ride, and they tap
  "Stop here" at each stop, naming it if they know it. It goes to the admin panel, where the team
  checks it and applies it to a route direction; riders see nothing until then.

## Try a trip without riding a bus

Plan Esplanade to Jadavpur 8B, open the journey, tap "I'm on this bus", then move the
simulated location along the route. On the Android emulator use Extended controls,
Location, Routes; in the iOS simulator use Features, Location, Custom Location, or a GPX
file in the Xcode scheme. A second emulator sharing the same route shows up as a second
rider on the same bus. The demo routes are straight lines between approximate stops, so
real roads will not match them exactly.

## How location works

| The person allows | What the app does |
|---|---|
| Precise location | Finds the nearest stops, runs the stop alarm, can share the bus position |
| Approximate location only | Lists stops in the area so they can pick theirs. For a trip, asks for precise location (on iOS, for that trip only) |
| Nothing, or Location switched off | Search by name or landmark, recent places and picking on the map all still work. The trip features explain what they need and link to Settings |

The app asks for location only when someone taps "Use my location" or "I'm on this bus",
never at launch. Android stops showing the dialog after two refusals, and iOS asks only
once, so an early request would waste the only chance.

It never asks for background location. On Android, trip tracking runs in a foreground
service the rider starts by tapping a button, which Android counts as while-in-use
access. On iOS it uses the location background mode only while a trip is on. Either way,
tracking stops when the rider gets off, passes their stop, ends the trip, or (on Android)
swipes the app away.

It does not read cell towers. Both platforms only give tower data with the same
permission as GPS, and the system location service already uses towers and Wi-Fi.

## Fonts

The app uses two typefaces from Google Fonts, both under the SIL Open Font License: Hind Siliguri
(designed for Bengali and Latin together) for text, and Teko for route numbers. They are in
`assets/fonts` and copied into `android/app/src/main/assets/fonts`, so Android uses them
(`CUSTOM_FONTS` in `src/config.ts` is on for Android). For iOS, on a Mac: run
`npx react-native-asset` (it adds the fonts to the Xcode project and `Info.plist`), then turn
`CUSTOM_FONTS` on for iOS too. Until then iOS uses the system font, which also shows Bengali.

## Icons and splash screen

Made from `assets/brand/logo.svg` by `npm run brand` in the top folder (it uses the Chrome installed
on the computer). Android has an adaptive icon in vectors (`mipmap-anydpi-v26`) with a monochrome
layer for themed icons, PNG icons for older Android, and the Android 12 splash screen API
(`androidx.core:core-splashscreen`, `Theme.App.Starting`, `installSplashScreen()` in
`MainActivity.kt`), which also gives older Android the same splash. iOS has a 1024 px app icon
in `Images.xcassets` and a launch screen storyboard with the logo; check both on a Mac.

## Languages

Every screen is in English or Bengali, with a button on the first screen; the choice is kept on
the phone, and until it is made the app follows the phone's language. The Bengali wording is in
`packages/core/src/bn.ts`, shared with the web app; `npm test` in the top folder fails if any text
lacks it. Stop names are shown in Bengali script where the network has them.

## Live updates

The web app gets bus positions pushed by the server. React Native has no built-in event source,
so the app asks for the buses on a journey every 10 seconds and for arrivals every 20 seconds, and
fetches the learned travel times every 10 minutes (kept on the phone for planning offline).

## Before you publish

- Set `RELEASE_API_URL` in `src/config.ts` to your HTTPS server.
- Replace the built-in Android notification icons in `TripNotifications.kt` with your own
  monochrome icon.
- Google Play: declare the location foreground service in Play Console, under App content,
  as user-initiated location sharing that runs only while a rider has a trip on, with the
  demo video Play asks for.
- App Store: explain the location background mode in the review notes in the same way.
- Publish a privacy policy that covers location, as India's DPDP Act, 2023 requires.

## What has been tested, and what has not

- The app's TypeScript is checked against the real React Native 0.88.1, react-native-maps,
  AsyncStorage 3 and safe-area-context types: `npx tsc -p tsconfig.json` gives no errors.
- Metro builds release JavaScript bundles for Android and iOS
  (`npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output out.js`),
  so every import resolves, including the shared core and the built-in network.
- The shared logic the app relies on has 67 passing tests, the Bengali check covers every text in
  the app, and the same screens and trip rules run end to end in the web app (see the main README).
- **Android, version 0.3 (28 October 2026):** with the new design, the Bengali screens and the new
  features, the 7 tests pass again on the emulator; the splash screen, the launcher icon and the
  app in Bengali were checked by hand.
- **Android (28 October 2026):** the debug app builds with Gradle 9.4.1, JDK 17, Android SDK 37
  and NDK 27.1, and passes the 7 tests in `e2e/android/app.android.ts` on an Android 16 emulator,
  including a whole trip with the app in the background and the screen off. The Kotlin module
  compiled with no errors. Its one warning: `WimbLocationPackage` overrides `createNativeModules`,
  which React Native 0.88 has deprecated.
- **Conductors sharing with a bus's own code** (from its owner's dashboard) are told before they
  start, and on the trip screen, that the owner sees the bus's trips. The seventh Android test
  checks that, and that the owner's dashboard shows the bus and its trip. It found that a bus
  standing still stopped reporting: the trip service asked for a position only after 20 m, and
  positions are sent only when a new one arrives. The service now reports every 10 s, moving or not.
- **A whole release APK was not built on that laptop**, because of where the project sat (next
  section). Its release-only steps passed one by one: the release C++ compiled from a short path,
  and the release JavaScript bundle compiled to Hermes bytecode. Code shrinking (R8) is off in
  the template (`enableProguardInReleaseBuilds = false`), so it does not run.
- **iOS has not been built**: it needs a Mac with Xcode.
- **Real phones have not been tried.** Phone makers' battery savers can stop a foreground service;
  test on the brands common in India before release.
- The module is a classic native module, which React Native 0.82 and later run only through the
  interop layer for the legacy architecture. That layer is still in 0.88, but plan to rewrite the
  module as a Turbo Native Module (a typed spec in TypeScript, with codegen) in phase 1.

## If Gradle cannot download: "PKIX path building failed"

On a network that inspects encrypted traffic with its own certificate, Java does not trust that
certificate and Gradle cannot download anything. Have Java use the Windows certificate store,
which does, before building:

```sh
set JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT
```

Stop any running Gradle daemon first (`gradlew --stop`), so the new setting is used.

## If a Windows build stops with "Filename longer than 260 characters"

The libraries' C++ is compiled into files whose paths include the whole project folder, and
Windows tools refuse paths over 260 characters. CMake shortens such paths only while the build
folder leaves room, so the debug build fitted from `C:\Users\<you>\s_project\personal\where-is-my-bus`
and the release build ("RelWithDebInfo" in the path) did not. Either:

- put the project in a short folder, such as `C:\dev\wimb`, or
- turn on Windows long paths (needs admin rights).

A drive alias does not work: with `subst W: …` the C++ compiles, but Metro then fails to bundle
the JavaScript, because Node turns `W:` paths back into `C:` paths. Setting
`CMAKE_OBJECT_PATH_MAX` lower makes it worse: CMake stops shortening altogether.
