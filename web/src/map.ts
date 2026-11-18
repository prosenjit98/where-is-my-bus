import type { LatLng } from './core.ts';
import { h } from './dom.ts';
import { tr } from './i18n.ts';

// Leaflet with OpenStreetMap tiles. Leaflet itself is served with the app, so the map still
// draws routes and buses offline; only the street background needs the internet.

export type MapHandle = { map: L.Map; layer: L.LayerGroup; destroy: () => void };

/** `onSized` runs once the map is on the page and has its real size, which fitting it to a route needs. */
export function createMap(el: HTMLElement, center: LatLng, zoom = 13, onSized?: (map: L.Map) => void): MapHandle | null {
  const Leaflet = (globalThis as { L?: typeof L }).L;
  if (!Leaflet) {
    el.append(h('p', { class: 'map-missing' }, tr('The map could not load. Everything else works without it.')));
    return null;
  }
  const map = Leaflet.map(el, { zoomControl: true }).setView([center.lat, center.lng], zoom);
  Leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  const layer = Leaflet.layerGroup().addTo(map);
  // The screen is built before it is put on the page, so the map learns its size a frame later.
  requestAnimationFrame(() => {
    map.invalidateSize();
    onSized?.(map);
  });
  return { map, layer, destroy: () => map.remove() };
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function stopDot(p: LatLng, label: string, color: string): L.CircleMarker {
  return L.circleMarker([p.lat, p.lng], {
    radius: 7,
    color: cssVar('--ink'),
    weight: 2,
    fillColor: color,
    fillOpacity: 1,
  }).bindTooltip(label);
}

/** A bus on the map is its route board. */
export function busMarker(p: LatLng, board: HTMLElement, label: string): L.Marker {
  return L.marker([p.lat, p.lng], {
    icon: L.divIcon({ html: board, className: 'bus-icon', iconSize: undefined }),
    title: label,
    alt: label,
    keyboard: false,
  });
}
