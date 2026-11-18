// Builds every app icon, splash image and interface icon from two sources:
//   assets/brand/logo.svg      the logo, on the 108 x 108 canvas of an Android adaptive icon
//   assets/icons/lucide/*.svg  the interface icons (Lucide, ISC licence)
// Run after changing either:  npm run brand
// It renders with the Chrome installed on this computer, through playwright-core from e2e/
// (run `npm install` there once). The Android adaptive icon itself is vector XML in
// mobile/android/app/src/main/res/drawable, drawn by hand from the same shapes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The little of playwright-core used here, so the tools need no install of their own.
type Page = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  screenshot(opts: { omitBackground: boolean; clip: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
};
type Browser = { newPage(opts: { deviceScaleFactor: number }): Promise<Page>; close(): Promise<void> };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = (...p: string[]) => path.join(root, ...p);
const requireE2e = createRequire(at('e2e', 'package.json'));
const { chromium } = requireE2e('playwright-core') as { chromium: { launch(opts: { executablePath?: string; channel?: string }): Promise<Browser> } };

// ---- the logo ----

const logo = readFileSync(at('assets', 'brand', 'logo.svg'), 'utf8');
const defs = /<defs>[\s\S]*?<\/defs>/.exec(logo)?.[0] ?? '';
const foreground = /<g id="foreground">([\s\S]*?)<\/g>/.exec(logo)?.[1] ?? '';
if (!foreground.trim()) throw new Error('assets/brand/logo.svg has no <g id="foreground">.');

/** The foreground made larger about the centre, for icons that no launcher mask will crop. */
const grow = (k: number) => `<g transform="translate(54 54) scale(${k}) translate(-54 -54)">${foreground}</g>`;
const svg = (body: string, viewBox = '0 0 108 108') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs}${body}</svg>`;

/** Square to the edges: the system cuts the shape (iOS, Google Play, maskable web icons). */
const square = (k: number) => svg(`<rect width="108" height="108" fill="url(#sky)"/>${grow(k)}`);
/** A rounded square, for places that show the icon as it is (old Android launchers, browser tabs). */
const rounded = svg(`<rect width="108" height="108" rx="24" fill="url(#sky)"/>${grow(1.25)}`);
const round = svg(`<circle cx="54" cy="54" r="54" fill="url(#sky)"/>${grow(1.2)}`);
/** The pin on its own, cropped to it, for splash screens and the app's start screen. */
const mark = svg(foreground, '28 21 52 65');

// ---- the interface icons ----

const ICON_DIR = at('assets', 'icons', 'lucide');
const ALLOWED = /^<(path|circle|line|rect|polygon|polyline|ellipse)\b[^<>]*\/>$/;

/** An icon's drawing only: its shapes, with no scripts, styles or links, whatever the file holds. */
function iconBody(file: string): string {
  const text = readFileSync(path.join(ICON_DIR, file), 'utf8');
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(text)?.[1] ?? '';
  const shapes = inner.match(/<[a-z]+\b[^<>]*\/>/g) ?? [];
  const safe = shapes.map((s) => s.replace(/\s+/g, ' ').replace(' />', '/>')).filter((s) => ALLOWED.test(s) && !/\son\w+=|href|style=/i.test(s));
  if (!safe.length) throw new Error(`${file} has no shapes.`);
  return safe.join('');
}

const iconNames = readdirSync(ICON_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort();
const icons = new Map(iconNames.map((n) => [n, iconBody(`${n}.svg`)]));
const lineIcon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// ---- rendering ----

async function render(page: Page, image: string, width: number, height = width): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${image}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

function write(file: string, data: Buffer | string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

async function main() {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    let count = 0;
    const out = async (file: string, image: string, width: number, height = width) => {
      write(file, await render(page, image, width, height));
      count++;
    };

    // Android launchers before Android 8; later ones use the adaptive icon (vector XML).
    const res = at('mobile', 'android', 'app', 'src', 'main', 'res');
    for (const [density, px] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]] as const) {
      await out(path.join(res, `mipmap-${density}`, 'ic_launcher.png'), rounded, px);
      await out(path.join(res, `mipmap-${density}`, 'ic_launcher_round.png'), round, px);
    }

    // iOS: one 1024-pixel icon (Xcode 14 and later make the other sizes), and the launch screen's logo.
    const assets = at('mobile', 'ios', 'WhereIsMyBus', 'Images.xcassets');
    await out(path.join(assets, 'AppIcon.appiconset', 'AppIcon-1024.png'), square(1.25), 1024);
    write(
      path.join(assets, 'AppIcon.appiconset', 'Contents.json'),
      `${JSON.stringify({ images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
    );
    const splash: { filename: string; idiom: string; scale: string }[] = [];
    for (const scale of [1, 2, 3]) {
      const filename = scale === 1 ? 'SplashLogo.png' : `SplashLogo@${scale}x.png`;
      await out(path.join(assets, 'SplashLogo.imageset', filename), mark, 80 * scale, 100 * scale);
      splash.push({ filename, idiom: 'universal', scale: `${scale}x` });
    }
    write(path.join(assets, 'SplashLogo.imageset', 'Contents.json'), `${JSON.stringify({ images: splash, info: { author: 'xcode', version: 1 } }, null, 2)}\n`);

    // Google Play's store listing.
    await out(at('assets', 'brand', 'play-store-icon-512.png'), square(1.25), 512);

    // The web app: tab icon, home-screen icons, the icon Android crops to its own shape, and the
    // logo on the home screen.
    write(at('web', 'icon.svg'), `${rounded}\n`);
    write(at('web', 'icons', 'logo-mark.svg'), `${mark}\n`);
    await out(at('web', 'icons', 'icon-192.png'), rounded, 192);
    await out(at('web', 'icons', 'icon-512.png'), rounded, 512);
    await out(at('web', 'icons', 'maskable-512.png'), square(1.1), 512);
    await out(at('web', 'icons', 'apple-touch-icon.png'), square(1.25), 180);

    // The phone app: the start screen's logo, and the interface icons in black for tinting.
    for (const scale of [1, 2, 3]) {
      const suffix = scale === 1 ? '' : `@${scale}x`;
      await out(at('mobile', 'assets', 'brand', `logo-mark${suffix}.png`), mark, 80 * scale, 100 * scale);
      for (const [name, body] of icons) await out(at('mobile', 'assets', 'icons', `${name}${suffix}.png`), lineIcon(body), 24 * scale);
    }

    // Icon tables for the code: SVG shapes for the web, images for the phone app.
    const header = '// Made by tools/brand/make-brand.ts from assets/icons/lucide (Lucide, ISC licence). Do not edit.\n';
    write(
      at('web', 'src', 'icon-data.ts'),
      `${header}\nexport const ICONS = {\n${[...icons].map(([n, b]) => `  '${n}': '${b.replace(/'/g, "\\'")}',`).join('\n')}\n} as const;\n\nexport type IconName = keyof typeof ICONS;\n`,
    );
    write(
      at('mobile', 'src', 'icon-data.ts'),
      `${header}\nexport const ICONS = {\n${iconNames.map((n) => `  '${n}': require('../assets/icons/${n}.png'),`).join('\n')}\n} as const;\n\nexport type IconName = keyof typeof ICONS;\n`,
    );
    console.log(`Wrote ${count} images and the icon tables (${icons.size} icons).`);
  } finally {
    await browser?.close();
  }
}

await main();
