import { api, ApiError, type Me } from './api.ts';
import { readJson, writeJson } from './storage.ts';

// Conductors sign in on /signin (backend/public/signin.js), on this same site, with their mobile
// number and password; their owner approves their account first. That page keeps the sign-in key
// in localStorage as plain text, and this app uses the same key to share a bus as its conductor.
// Riders never sign in. Who the key signs in is asked once per visit, and kept for when the phone
// is offline.

const KEY_STORE = 'wimb.owner.key';
const ME_STORE = 'wimb.me.v1';
const PLATE_STORE = 'wimb.conductor.plate.v1';

/** The accounts that can share a bus as its conductor: the owner's staff, and the owner. */
const CONDUCTING = new Set<Me['kind']>(['conductor', 'owner', 'manager']);

export function signInKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

let asked: Promise<Me | null> | null = null;
let known: Me | null | undefined;

/** Who is signed in on this phone, or null. Offline, the answer from the last time. */
export function whoAmI(): Promise<Me | null> {
  const key = signInKey();
  if (!key) return Promise.resolve((known = null));
  asked ??= api.me(key).then(
    (me) => {
      writeJson(ME_STORE, { key, me });
      return (known = me);
    },
    (e) => {
      asked = null;
      if (e instanceof ApiError && e.status === 401) {
        // Signed out elsewhere, or a new password: the key no longer works.
        writeJson(ME_STORE, null);
        return (known = null);
      }
      const saved = readJson<{ key: string; me: Me }>(ME_STORE);
      return (known = saved && saved.key === key ? saved.me : null);
    },
  );
  return asked;
}

/** The answer of whoAmI() if it has come; undefined until then. */
export const signedInNow = (): Me | null | undefined => (signInKey() ? known : null);

export const canConduct = (me: Me | null | undefined): me is Me => !!me && CONDUCTING.has(me.kind);

/** Signs out on this phone: the key stops working on the server too. */
export async function signOut(): Promise<void> {
  const key = signInKey();
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    // Storage switched off: there was no key kept anyway.
  }
  writeJson(ME_STORE, null);
  asked = null;
  known = null;
  if (key) await api.signOut(key).catch(() => undefined);
}

/** The number plate a conductor typed last, for their next trip on the same bus. */
export const lastPlate = (): string => readJson<string>(PLATE_STORE) ?? '';
export const rememberPlate = (plate: string) => writeJson(PLATE_STORE, plate.trim() || null);
