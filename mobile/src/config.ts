import { Platform } from 'react-native';

// Where the backend runs while developing: the computer's port 8080, as localhost. An Android phone
// on USB or an emulator reaches it after `adb reverse tcp:8080 tcp:8080` (run it again whenever the
// phone is plugged in again; react-native run-android does the same for Metro's port 8081 itself).
// The iOS simulator shares the computer's localhost. Over Wi-Fi instead, use the computer's address,
// e.g. http://192.168.1.20:8080.
const DEV_API_URL = 'http://localhost:8080';

// Release builds must use HTTPS: Android blocks plain HTTP outside debug builds.
const RELEASE_API_URL = 'https://api.example.com';

export const API_URL: string = __DEV__ ? DEV_API_URL : RELEASE_API_URL;

// Hind Siliguri and Teko are in assets/fonts and copied into the Android project. iOS needs them
// added to the Xcode project first (see mobile/README.md, "Fonts"); until then iOS uses the system
// font, which also renders Bengali.
export const CUSTOM_FONTS = Platform.OS === 'android';

export const ARRIVALS_REFRESH_MS = 20_000;
export const VEHICLES_REFRESH_MS = 10_000;
export const PING_FLUSH_MS = 15_000;
export const TRAVEL_REFRESH_MS = 10 * 60_000;
