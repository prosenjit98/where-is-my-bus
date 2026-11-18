import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { api, ApiError, type AccountKind, type Me } from '../api';

// Signing in on the phone: conductors, to share their owner's buses as the conductor, and
// contributors, to record routes. The same accounts and passwords as /signin on the website; the
// phone keeps only its own sign-in key (the server keeps a hash of it), and who it signs in.

const KEY = 'wimb.account.v1';

export type Account = Me & { key: string };

let current: Account | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function keep(next: Account | null) {
  current = next;
  if (next) await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  else await AsyncStorage.removeItem(KEY).catch(() => undefined);
  emit();
}

export const getAccount = () => current;

export function useAccount(): Account | null {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, getAccount);
}

/** Whether this account may share a bus as its conductor: an owner's people. */
export const canConduct = (a: Account | null): a is Account => !!a && (a.kind === 'conductor' || a.kind === 'owner' || a.kind === 'manager');

/** The account saved on the phone, read once at start and checked with the server when online. */
export async function loadAccount(): Promise<void> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as Account | null;
    if (!saved?.key) return;
    current = saved;
    emit();
    const me = await api.me(saved.key);
    await keep({ ...me, key: saved.key });
  } catch (e) {
    // A key the server no longer takes (a new password, removed by the owner): signed out.
    if (e instanceof ApiError && e.status === 401) await keep(null);
  }
}

export type SignInResult = { done: true; kind: AccountKind } | { done: false; changeToken: string };

/** With a temporary password from the admin, the person chooses their own next (choosePassword). */
export async function signIn(phone: string, password: string): Promise<SignInResult> {
  const r = await api.signIn(phone, password);
  if (r.mustChange && r.changeToken) return { done: false, changeToken: r.changeToken };
  if (!r.key) throw new Error('The server did not sign you in.');
  await keep({ ...(await api.me(r.key)), key: r.key });
  return { done: true, kind: r.kind };
}

export async function choosePassword(changeToken: string, password: string): Promise<AccountKind> {
  const r = await api.choosePassword(changeToken, password);
  await keep({ ...(await api.me(r.key)), key: r.key });
  return r.kind;
}

export async function signOut(): Promise<void> {
  const key = current?.key;
  await keep(null);
  if (key) await api.signOut(key).catch(() => undefined);
}
