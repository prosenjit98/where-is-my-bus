// Keeping the screen on, and ringing the stop alarm. Browsers stop sending location when the
// screen goes off or the tab is hidden, so a web trip keeps the screen on (a conductor's phone
// on a charger is fine). For the alarm with the screen locked, riders need the phone app.

let wakeLock: WakeLockSentinel | null = null;
let wantScreenOn = false;
let audio: AudioContext | null = null;

async function takeWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
  try {
    const lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
    wakeLock = lock;
    return true;
  } catch {
    return false; // Battery saver, or the browser does not allow it.
  }
}

// The browser lets go of the screen when the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (wantScreenOn && !wakeLock && document.visibilityState === 'visible') void takeWakeLock();
});

export async function keepScreenOn(on: boolean): Promise<boolean> {
  wantScreenOn = on;
  if (on) return wakeLock !== null || takeWakeLock();
  const lock = wakeLock;
  wakeLock = null;
  await lock?.release().catch(() => undefined);
  return false;
}

export const isScreenKeptOn = () => wakeLock !== null;

/** Call at the very start of the tap that starts a trip: browsers allow sound only after one. */
export function unlockSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audio) audio = new Ctx();
    void audio?.resume().catch(() => undefined);
  } catch {
    audio = null;
  }
}

/** Asked after location, so the two browser dialogs do not pile up. Without it the alarm still shows and sounds. */
export async function askToNotify(): Promise<void> {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => 'denied');
  }
}

function beep() {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const start = t0 + i * 0.9;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.62);
  }
}

/** Loud = the stop alarm: sound, vibration, and a notification that stays until tapped. */
export async function ring(title: string, body: string, loud: boolean): Promise<void> {
  if (loud) {
    navigator.vibrate?.([600, 300, 600, 300, 600]);
    beep();
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: '/web/icon.svg',
    tag: loud ? 'wimb-stop-alarm' : 'wimb-trip',
    requireInteraction: loud,
    renotify: loud,
    vibrate: loud ? [600, 300, 600, 300, 600] : undefined,
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // The alarm on the screen still shows.
  }
}
