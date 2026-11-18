import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { countText, localDigits, translate, type Lang } from './core';

// The app in English or Bengali (core i18n.ts, wording in core bn.ts, shared with the web app).
// The choice is made on the home screen and kept on the phone; until then, Bengali if the phone's
// language is Bengali. Screens are built again when it changes (App.tsx).

const KEY = 'wimb.lang.v1';
const listeners = new Set<() => void>();

function phoneLang(): Lang {
  try {
    return /^bn\b/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = phoneLang();

function change(next: Lang) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

/** The choice saved on the phone, read once at start. */
export async function loadLang(): Promise<void> {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (saved === 'en' || saved === 'bn') change(saved);
}

export function setLang(next: Lang) {
  void AsyncStorage.setItem(KEY, next).catch(() => undefined);
  change(next);
}

export const getLang = () => current;

export function useLang(): Lang {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, getLang);
}

export const tr = (en: string, vars?: Record<string, string | number>) => translate(current, en, vars);
export const count = (n: number, one: string, many: string) => countText(current, n, one, many);
/** Times and other numbers that come as text, in the language's digits. */
export const digits = (s: string) => localDigits(current, s);
/** A stop's or landmark's name: in Bengali script, when Bengali is on and the network has it. */
export const nameOf = (p: { name: string; nameBn?: string }) => (current === 'bn' && p.nameBn ? p.nameBn : p.name);
