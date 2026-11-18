import type { Landmark, Stop } from './types.ts';

export type Place = {
  kind: 'stop' | 'landmark';
  id: string;
  name: string;
  nameBn?: string;
  lat: number;
  lng: number;
};

export type SearchHit = { place: Place; score: number; matched: string };

type Entry = { place: Place; text: string; norm: string; key: string; grams: Set<string> };

export type SearchIndex = { entries: Entry[] };

// Separators include the Bengali danda. Everything else (any script, combining marks) is kept,
// which matters for Bengali where vowel signs are combining marks.
const SEPARATORS = /[\s,.;:!?'"`()[\]{}/\\|_+&@#*=<>~^%$।-]+/g;

/** Lower-case, strip Latin accents and punctuation. Safe for Bengali text. */
export function normalizeText(s: string): string {
  let t = typeof s.normalize === 'function' ? s.normalize('NFKD') : s;
  t = t.replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return t.replace(SEPARATORS, ' ').trim();
}

// Collapses the common ways Bengali place names get spelled in English:
// Shyambazar/Shyambajar, Jadavpur/Jadabpur, Dhakuria/Dhakuriya, Sealdah/Shealdah.
const PHONETIC: [RegExp, string][] = [
  [/chh/g, 'c'],
  [/ch/g, 'c'],
  [/sh/g, 's'],
  [/th/g, 't'],
  [/dh/g, 'd'],
  [/kh/g, 'k'],
  [/gh/g, 'g'],
  [/jh/g, 'j'],
  [/bh/g, 'b'],
  [/ph/g, 'f'],
  [/z/g, 'j'],
  [/v/g, 'b'],
  [/y/g, 'i'],
  [/ee/g, 'i'],
  [/oo/g, 'u'],
  [/q/g, 'k'],
];

export function phoneticKey(norm: string): string {
  let s = norm;
  for (const [re, to] of PHONETIC) s = s.replace(re, to);
  return s.replace(/([a-z])\1+/g, '$1');
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(' ')) {
    if (!w) continue;
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function buildSearchIndex(stops: Stop[], landmarks: Landmark[] = []): SearchIndex {
  const entries: Entry[] = [];
  const add = (place: Place, text: string | undefined) => {
    if (!text || !text.trim()) return;
    const norm = normalizeText(text);
    if (!norm) return;
    const key = phoneticKey(norm);
    entries.push({ place, text, norm, key, grams: trigrams(key) });
  };
  const addAll = (kind: Place['kind'], item: Stop | Landmark) => {
    const place: Place = { kind, id: item.id, name: item.name, nameBn: item.nameBn, lat: item.lat, lng: item.lng };
    add(place, item.name);
    add(place, item.nameBn);
    for (const a of item.aliases ?? []) add(place, a);
  };
  for (const s of stops) addAll('stop', s);
  for (const l of landmarks) addAll('landmark', l);
  return { entries };
}

function scoreEntry(norm: string, key: string, queryGrams: Set<string>, e: Entry): number {
  if (e.norm === norm || e.key === key) return 1;
  if (e.norm.startsWith(norm) || e.key.startsWith(key)) {
    return 0.95 - Math.min(0.08, (e.norm.length - norm.length) / 250);
  }
  if (e.norm.split(' ').some((w) => w.startsWith(norm)) || e.key.split(' ').some((w) => w.startsWith(key))) {
    return 0.88;
  }
  if (norm.length >= 3 && (e.norm.includes(norm) || e.key.includes(key))) return 0.8;
  let shared = 0;
  for (const g of queryGrams) if (e.grams.has(g)) shared++;
  if (!shared) return 0;
  const dice = (2 * shared) / (queryGrams.size + e.grams.size);
  const containment = shared / queryGrams.size;
  return Math.min(0.78, 0.55 * dice + 0.35 * containment);
}

/** Best matches for what the user typed. Stops win ties against landmarks. */
export function search(index: SearchIndex, query: string, limit = 8): SearchHit[] {
  const norm = normalizeText(query);
  if (!norm) return [];
  const key = phoneticKey(norm);
  const queryGrams = trigrams(key);
  const best = new Map<string, SearchHit>();
  for (const e of index.entries) {
    const raw = scoreEntry(norm, key, queryGrams, e);
    if (raw < 0.34) continue;
    const score = raw + (e.place.kind === 'stop' ? 0.005 : 0);
    const id = `${e.place.kind}:${e.place.id}`;
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { place: e.place, score, matched: e.text });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit);
}
