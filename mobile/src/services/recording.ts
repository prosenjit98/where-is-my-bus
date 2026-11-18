import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { tr } from '../i18n';
import { isNativeTripRunning, onTripError, onTripLocation, startNativeTrip, stopNativeTrip, type NativeFix } from '../native/location';
import { getAccount } from './account';

// A contributor recording a route from inside the bus: the phone's position every few seconds (the
// same foreground service as a trip, so it carries on with the screen off), sent to the server in
// batches, and the stops they mark as the bus reaches them ("Stop here"), with a name if they give
// one. When they finish, the server makes the road path and the stops; the admins check it before
// anything changes for riders (backend recordings.ts).

const KEY = 'wimb.recording.v1';
const SEND_EVERY_MS = 15_000;

export type MarkedStop = { name: string; ts: number };
export type RecordingState =
  | { status: 'idle' }
  | { status: 'recording'; id: string; name: string; startedAt: number; sent: number; marks: MarkedStop[]; hasFix: boolean; online: boolean }
  | { status: 'finished'; name: string; km: number; minutes: number; stops: number };

let state: RecordingState = { status: 'idle' };
const listeners = new Set<() => void>();
let queue: NativeFix[] = [];
let lastFix: NativeFix | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribers: (() => void)[] = [];
let sending: Promise<boolean> | null = null;
let sentAt = 0;

function set(next: RecordingState) {
  state = next;
  listeners.forEach((l) => l());
  if (next.status === 'recording') void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  else void AsyncStorage.removeItem(KEY).catch(() => undefined);
}

export const getRecording = () => state;
export const isRecording = () => state.status === 'recording';

export function useRecording(): RecordingState {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, getRecording);
}

function keyOrThrow(): string {
  const a = getAccount();
  if (!a || a.kind !== 'contributor') throw new Error(tr('Only contributors record routes. Sign up as a contributor first.'));
  return a.key;
}

function listen() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [
    onTripLocation((fix) => {
      lastFix = fix;
      queue.push(fix);
      if (state.status === 'recording' && !state.hasFix) set({ ...state, hasFix: true });
      // Timers stop with the app in the background; a new position still arrives, and sends.
      if (Date.now() - sentAt >= SEND_EVERY_MS) void send();
    }),
    onTripError(() => undefined),
  ];
  if (timer) clearInterval(timer);
  timer = setInterval(() => void send(), SEND_EVERY_MS);
}

function stopListening() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Positions not sent yet, in batches; kept for the next try when the phone is offline. One send at
 * a time: a call while one runs gets that one. Whether it ended with everything sent.
 */
function send(): Promise<boolean> {
  if (sending) return sending;
  if (state.status !== 'recording' || !queue.length) return Promise.resolve(queue.length === 0);
  sentAt = Date.now();
  const s = state;
  sending = (async () => {
    try {
      while (queue.length) {
        const batch = queue.slice(0, 300);
        await api.addRecordingPoints(keyOrThrow(), s.id, batch.map((f) => ({ lat: f.lat, lng: f.lng, accuracy: f.accuracy, ts: f.ts })));
        queue.splice(0, batch.length);
        if (state.status === 'recording') set({ ...state, sent: state.sent + batch.length, online: true });
      }
      return true;
    } catch {
      if (state.status === 'recording') set({ ...state, online: false });
      return false;
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

export async function startRecording(name: string): Promise<void> {
  const key = keyOrThrow();
  // One thing at a time uses the phone's tracking: a trip, or a recording.
  if (await isNativeTripRunning()) throw new Error(tr('End your trip first.'));
  const r = await api.createRecording(key, name);
  try {
    await startNativeTrip({ title: tr('Recording a route'), text: r.name });
  } catch (e) {
    await api.deleteRecording(key, r.id).catch(() => undefined);
    throw e;
  }
  queue = [];
  lastFix = null;
  set({ status: 'recording', id: r.id, name: r.name, startedAt: r.startedAt, sent: 0, marks: [], hasFix: false, online: true });
  listen();
}

/** "Stop here": where the bus is now. */
export async function markStop(name: string): Promise<void> {
  if (state.status !== 'recording') return;
  if (!lastFix) throw new Error(tr('Waiting for your position…'));
  const clean = name.trim();
  const mark = { lat: lastFix.lat, lng: lastFix.lng, ts: lastFix.ts, ...(clean ? { name: clean } : {}) };
  await api.markStop(keyOrThrow(), state.id, mark);
  if (state.status === 'recording') set({ ...state, marks: [...state.marks, { name: clean, ts: mark.ts }] });
}

export async function finishRecording(): Promise<void> {
  if (state.status !== 'recording') return;
  // No new positions from here, so what is waiting can all be sent: after any send already
  // running, the rest. Recording carries on if the phone is offline after all.
  stopListening();
  await send();
  if (!(await send())) {
    listen();
    throw new Error(tr('No internet right now. The positions are kept: finish again when you are back online.'));
  }
  const s = state;
  let done;
  try {
    done = await api.finishRecording(keyOrThrow(), s.id);
  } catch (e) {
    listen();
    throw e;
  }
  await stopNativeTrip().catch(() => undefined);
  set({ status: 'finished', name: s.name, km: Math.round((done.lengthM ?? 0) / 100) / 10, minutes: done.minutes ?? 0, stops: done.halts.length });
}

/** Stops without sending it to the team: the recording is deleted. */
export async function cancelRecording(): Promise<void> {
  if (state.status !== 'recording') return;
  const id = state.id;
  stopListening();
  await stopNativeTrip().catch(() => undefined);
  set({ status: 'idle' });
  await api.deleteRecording(keyOrThrow(), id).catch(() => undefined);
}

export function resetRecording() {
  if (state.status === 'finished') set({ status: 'idle' });
}

/** After the app was closed while recording: carries on if the phone's tracking still runs. */
export async function restoreRecording(): Promise<void> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as RecordingState | null;
    if (saved?.status !== 'recording') return;
    if (!(await isNativeTripRunning())) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    state = { ...saved, hasFix: false };
    listen();
    listeners.forEach((l) => l());
  } catch {
    // Nothing to carry on.
  }
}
