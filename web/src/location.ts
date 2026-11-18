// Location in the browser. Browsers offer it only on secure pages (HTTPS, or localhost while
// developing), ask once per site, and after "Block" the page cannot ask again: only the
// browser's site settings can undo it. So the app asks only when someone taps a button that needs it.

import { tr } from './i18n.ts';

export type Fix = { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number; ts: number };

export type Permission = 'granted' | 'prompt' | 'denied' | 'unsupported';

export type FixError = 'denied' | 'unavailable' | 'timeout';

/** Browsers do not say "approximate"; it shows up as an accuracy circle this wide or wider. */
export const APPROXIMATE_M = 1000;

export async function permissionState(): Promise<Permission> {
  if (!('geolocation' in navigator) || !window.isSecureContext) return 'unsupported';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'prompt'; // Some browsers cannot say; asking shows the dialog or the answer.
  }
}

function toFix(p: GeolocationPosition): Fix {
  const c = p.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? c.accuracy : undefined,
    speed: c.speed !== null && Number.isFinite(c.speed) ? c.speed : undefined,
    heading: c.heading !== null && Number.isFinite(c.heading) ? c.heading : undefined,
    ts: p.timestamp,
  };
}

function toError(e: GeolocationPositionError): FixError {
  if (e.code === 1) return 'denied'; // PERMISSION_DENIED
  return e.code === 3 ? 'timeout' : 'unavailable';
}

/** One position. The first time, the browser shows its dialog. */
export function currentFix(timeoutMs = 15_000): Promise<{ fix: Fix } | { error: FixError | 'unsupported' }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      resolve({ error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: toFix(p) }),
      (e) => resolve({ error: toError(e) }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/**
 * The stop alarm has to know which stop the bus is at, so a trip needs a precise position.
 * Shows the browser's dialog if it has not been answered. Returns what is wrong, or null.
 */
export async function checkPreciseLocation(): Promise<string | null> {
  const permission = await permissionState();
  if (permission === 'unsupported') return tr('This browser cannot share your location on this page, so the trip cannot start.');
  if (permission === 'denied') {
    return tr('Location is blocked for this site. Allow it in this site’s settings in your browser to use the stop alarm.');
  }
  const r = await currentFix();
  if ('error' in r) {
    if (r.error === 'denied') return tr('The stop alarm needs your location while the trip is on.');
    if (r.error === 'timeout') return tr('Your location could not be found in time. Try again near a window.');
    return tr('Your phone’s location seems to be switched off. Turn it on and try again.');
  }
  if ((r.fix.accuracy ?? 0) > APPROXIMATE_M) {
    return tr('The stop alarm needs precise location. With approximate location it cannot tell which stop the bus is at.');
  }
  return null;
}

/** Positions as the phone moves, until the returned function is called. */
export function watchFixes(onFix: (f: Fix) => void, onError: (e: FixError) => void): () => void {
  const id = navigator.geolocation.watchPosition(
    (p) => onFix(toFix(p)),
    (e) => onError(toError(e)),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
