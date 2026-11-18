import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BN, BN_COUNT } from '../../packages/core/src/bn.ts';
import { bnDigits, countText, translate } from '../../packages/core/src/index.ts';

// The apps in Bengali: every text the web app and the phone app pass to tr() has a Bengali entry,
// with the same {parts}; numbers come in Bengali digits, names and route numbers as given.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f.startsWith('.')) return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/icon-data|bn\.ts$/.test(f) ? [p] : [];
  });
}

/** The English text given to tr('…') or translate(lang, '…') as a literal. */
function keysIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const keys: string[] = [];
  for (const re of [/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g, /translate\(\s*lang\s*,\s*(['"])((?:\\.|(?!\1).)*)\1/g]) {
    for (const m of src.matchAll(re)) keys.push(m[2].replace(/\\(['"])/g, '$1'));
  }
  return keys;
}

const parts = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every text the apps show has Bengali', () => {
  const files = [...sources(path.join(root, 'web/src')), ...sources(path.join(root, 'mobile/src')), path.join(root, 'mobile/App.tsx'), ...sources(path.join(root, 'packages/core/src'))];
  const missing = new Set<string>();
  let seen = 0;
  for (const f of files) {
    for (const k of keysIn(f)) {
      seen++;
      if (!(k in BN)) missing.add(`${path.relative(root, f)}: ${k}`);
    }
  }
  assert.ok(seen > 300, `found ${seen} texts`);
  assert.deepEqual([...missing], []);
});

test('Bengali entries keep every {part} of the English', () => {
  for (const [en, bn] of Object.entries(BN)) assert.deepEqual(parts(bn), parts(en), en);
  for (const [en, bn] of Object.entries(BN_COUNT)) assert.deepEqual(parts(bn), ['n'], en);
});

test('numbers in Bengali digits; names, times given as text and route numbers as they are', () => {
  assert.equal(bnDigits('10:45'), '১০:৪৫');
  assert.equal(translate('bn', '{route} reaches {stop} in {min} min', { route: '12C/2', stop: 'Esplanade', min: 7 }), '12C/2 ৭ মিনিটে Esplanade-এ পৌঁছবে');
  assert.equal(translate('en', '{route} reaches {stop} in {min} min', { route: '12C/2', stop: 'Esplanade', min: 7 }), '12C/2 reaches Esplanade in 7 min');
  // Text without an entry is shown in English rather than not at all.
  assert.equal(translate('bn', 'Not in the table {n}', { n: 3 }), 'Not in the table ৩');
  assert.equal(countText('bn', 3, 'stop', 'stops'), '৩টি স্টপ');
  assert.equal(countText('bn', 1, 'stop', 'stops'), '১টি স্টপ');
  assert.equal(countText('en', 1, 'stop', 'stops'), '1 stop');
});
