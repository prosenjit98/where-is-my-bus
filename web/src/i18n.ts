import { countText, localDigits, translate, type Lang } from './core.ts';
import { readJson, writeJson } from './storage.ts';

// The app in English or Bengali (core i18n.ts, wording in core bn.ts). The choice is made on the
// home screen and kept on this phone; until then, Bengali if the browser's language is Bengali.

const KEY = 'wimb.lang.v1';

function initial(): Lang {
  const saved = readJson<Lang>(KEY);
  if (saved === 'en' || saved === 'bn') return saved;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => /^bn\b/i.test(l)) ? 'bn' : 'en';
}

export const lang: Lang = initial();

/** Every screen is built in one language, so a change starts the app again, where it was. */
export function setLang(next: Lang) {
  writeJson(KEY, next);
  location.reload();
}

export const tr = (en: string, vars?: Record<string, string | number>) => translate(lang, en, vars);
export const count = (n: number, one: string, many: string) => countText(lang, n, one, many);
/** Times and other numbers that come as text, in the language's digits. */
export const digits = (s: string) => localDigits(lang, s);
/** A stop's or landmark's name: in Bengali script, when Bengali is on and the network has it. */
export const nameOf = (p: { name: string; nameBn?: string }) => (lang === 'bn' && p.nameBn ? p.nameBn : p.name);
