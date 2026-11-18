import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Vibration } from 'react-native';

// JavaScript side of the wimb-location native module (mobile/native/wimb-location).
// No cell-tower tricks: phones only give tower data with the same permission as GPS.

/** What the app may do with location right now. */
export type Access =
  | 'precise' // GPS: nearest stop, stop alarm, sharing
  | 'approximate' // user chose approximate: about 3 km², enough to pick the area
  | 'off' // permission is fine but Location is switched off on the phone
  | 'denied' // said no, may ask again
  | 'blocked' // said no and the system will not ask again: only Settings can change it
  | 'unknown'; // never asked

export type NativeFix = {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  ts: number;
  mock?: boolean;
};

type NativeStatus = {
  servicesEnabled: boolean;
  authorization: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always';
  precise: boolean;
};

type WimbLocationModule = {
  getStatus(): Promise<NativeStatus>;
  requestPermission(): Promise<NativeStatus>;
  requestTemporaryPrecise(): Promise<NativeStatus>;
  getCurrentPosition(highAccuracy: boolean): Promise<NativeFix | null>;
  startTrip(options: { title: string; text: string; intervalMs: number; minDistanceM: number }): Promise<boolean>;
  stopTrip(): Promise<boolean>;
  isTripRunning(): Promise<boolean>;
  updateTripNotification(title: string, text: string): Promise<boolean>;
  notify(title: string, text: string, loud: boolean): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  openLocationSettings(): Promise<boolean>;
};

const Native = NativeModules.WimbLocation as WimbLocationModule | undefined;
const emitter = Native ? new NativeEventEmitter(NativeModules.WimbLocation) : null;

/** False until the native module is linked; the planner still works without it. */
export const nativeReady = Native !== undefined;

const BLOCKED_KEY = 'wimb.location.blocked';
const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

function fromIos(s: NativeStatus): Access {
  if (!s.servicesEnabled) return 'off';
  if (s.authorization === 'notDetermined') return 'unknown';
  if (s.authorization === 'denied' || s.authorization === 'restricted') return 'blocked'; // iOS asks only once
  return s.precise ? 'precise' : 'approximate';
}

async function androidGranted(): Promise<Access | null> {
  const fine = await PermissionsAndroid.check(FINE);
  const coarse = fine || (await PermissionsAndroid.check(COARSE));
  if (!coarse) return null;
  await AsyncStorage.removeItem(BLOCKED_KEY).catch(() => undefined);
  const status = Native ? await Native.getStatus().catch(() => null) : null;
  if (status && !status.servicesEnabled) return 'off';
  return fine ? 'precise' : 'approximate';
}

export async function checkAccess(): Promise<Access> {
  if (Platform.OS === 'android') {
    const granted = await androidGranted();
    if (granted) return granted;
    const blocked = await AsyncStorage.getItem(BLOCKED_KEY).catch(() => null);
    return blocked ? 'blocked' : 'unknown';
  }
  if (!Native) return 'unknown';
  return fromIos(await Native.getStatus());
}

/** Shows the system permission dialog. Android 12+ lets the user pick precise or approximate. */
export async function requestAccess(): Promise<Access> {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.requestMultiple([FINE, COARSE]);
    const granted = await androidGranted();
    if (granted) return granted;
    // Android stops showing the dialog after a second "Don't allow".
    if (res[FINE] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || res[COARSE] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      await AsyncStorage.setItem(BLOCKED_KEY, '1').catch(() => undefined);
      return 'blocked';
    }
    return 'denied';
  }
  if (!Native) return 'unknown';
  const access = fromIos(await Native.requestPermission());
  return access === 'unknown' ? 'denied' : access;
}

/** For someone who chose approximate: Android shows its "use precise location" dialog, iOS asks for this trip only. */
export async function askForPrecise(): Promise<Access> {
  if (Platform.OS === 'android') return requestAccess();
  if (!Native) return 'unknown';
  return fromIos(await Native.requestTemporaryPrecise());
}

export async function currentFix(timeoutMs = 10_000): Promise<NativeFix | null> {
  if (!Native) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([Native.getCurrentPosition(true).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Android shows Google's "turn on location" dialog; iOS can only open Settings. */
export async function openLocationSettings(): Promise<void> {
  if (Native) {
    const ok = await Native.openLocationSettings().catch(() => false);
    if (ok) return;
  }
  await Linking.openSettings();
}

export function openAppSettings(): void {
  void Linking.openSettings();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 33) return true;
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }
  return Native ? Native.requestNotificationPermission() : false;
}

export async function startNativeTrip(notification: { title: string; text: string }): Promise<void> {
  if (!Native) throw new Error('Trip tracking is not built into this version of the app. See mobile/README.md.');
  // No minimum distance: a bus waiting at a stop, at the terminus or in a jam must keep reporting.
  // Positions are sent only when a new one arrives (timers stop in the background), so with a
  // minimum distance a bus standing still went silent and looked lost to riders and its owner.
  await Native.startTrip({ ...notification, intervalMs: 10_000, minDistanceM: 0 });
}

export async function stopNativeTrip(): Promise<void> {
  await Native?.stopTrip();
}

export async function isNativeTripRunning(): Promise<boolean> {
  return Native ? Native.isTripRunning() : false;
}

export function setTripNotification(title: string, text: string): void {
  void Native?.updateTripNotification(title, text).catch(() => undefined);
}

/** Loud = the stop alarm: vibrates and uses the high-priority channel. */
export function notifyUser(title: string, text: string, loud: boolean): void {
  if (loud) Vibration.vibrate([0, 600, 300, 600, 300, 600]);
  void Native?.notify(title, text, loud).catch(() => undefined);
}

// Event payloads arrive untyped; their shape is set by the native module.
export function onTripLocation(fn: (fix: NativeFix) => void): () => void {
  const sub = emitter?.addListener('WimbLocation:location', (e) => fn(e as NativeFix));
  return () => sub?.remove();
}

export function onTripError(fn: (message: string) => void): () => void {
  const sub = emitter?.addListener('WimbLocation:error', (e) => fn((e as { message?: string } | undefined)?.message ?? 'Location stopped.'));
  return () => sub?.remove();
}
