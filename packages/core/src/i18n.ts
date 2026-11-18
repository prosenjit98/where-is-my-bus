import { BN, BN_COUNT } from './bn.ts';

// The apps in English or Bengali. Text is looked up by its English wording (bn.ts), so English
// needs no table and a missing Bengali entry shows English rather than nothing. Numbers given as
// numbers are written in Bengali digits; route numbers and names are passed as text and stay as
// painted on the bus.

export type Lang = 'en' | 'bn';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** "10:45" as "১০:৪৫". */
export const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

/** Digits in the language's own script: for times and other numbers that come as text. */
export const localDigits = (lang: Lang, s: string) => (lang === 'bn' ? bnDigits(s) : s);

/** The text in the language, with {name} filled in from `vars`. */
export function translate(lang: Lang, en: string, vars: Record<string, string | number> = {}): string {
  const template = lang === 'bn' ? (BN[en] ?? en) : en;
  return template.replace(/\{(\w+)\}/g, (whole: string, key: string) => {
    const v = vars[key];
    if (v === undefined) return whole;
    return typeof v === 'number' ? localDigits(lang, String(v)) : v;
  });
}

/** "1 stop", "3 stops"; in Bengali "১টি স্টপ", "৩টি স্টপ" (bn.ts BN_COUNT). */
export function countText(lang: Lang, n: number, one: string, many: string): string {
  if (lang !== 'bn') return `${n} ${n === 1 ? one : many}`;
  const template = BN_COUNT[many];
  return template ? template.replace('{n}', bnDigits(String(n))) : `${bnDigits(String(n))} ${BN[many] ?? many}`;
}
