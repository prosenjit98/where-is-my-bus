import { ICONS, type IconName } from './icon-data.ts';

// Line icons (Lucide, ISC licence; the shapes are in icon-data.ts, made by tools/brand/make-brand.ts).
// Drawn in the text colour, so they follow light and dark mode. Decorative unless given a label.

const SVG_NS = 'http://www.w3.org/2000/svg';
const parser = new DOMParser();
const cache = new Map<IconName, SVGElement>();

export type { IconName };

export function icon(name: IconName, opts: { size?: number; label?: string; class?: string } = {}): SVGElement {
  let base = cache.get(name);
  if (!base) {
    // Parsed as SVG, never as HTML, from shapes checked when the table was made.
    const doc = parser.parseFromString(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">${ICONS[name]}</svg>`, 'image/svg+xml');
    base = doc.documentElement as unknown as SVGElement;
    cache.set(name, base);
  }
  const svg = document.importNode(base, true);
  const size = String(opts.size ?? 20);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', opts.class ? `icon ${opts.class}` : 'icon');
  svg.setAttribute('focusable', 'false');
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}
