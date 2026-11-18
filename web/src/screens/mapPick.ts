import * as app from '../app.ts';
import type { Field, Place } from '../app.ts';
import { button, formatDistance, note, shell, type View } from '../components.ts';
import { nearestStops } from '../core.ts';
import { fill, h } from '../dom.ts';
import { nameOf, tr } from '../i18n.ts';
import { createMap, cssVar, stopDot } from '../map.ts';

// For people who keep location off: tap the place instead.
export function mapPickScreen(field: Field): View {
  const net = app.state.net;
  const mapEl = h('div', { class: 'map tall', role: 'application', 'aria-label': tr('Map. Tap where you are or where you are going.') });
  const footer = h('div', { class: 'panel' });
  const el = shell({ title: tr('Pick on the map'), onBack: app.pop, body: mapEl, footer, flush: true });
  const center = net?.center ?? { lat: 22.5726, lng: 88.3639 };
  const handle = createMap(mapEl, center, 12);
  let pin: { lat: number; lng: number } | null = null;

  const choose = (p: Place) => {
    app.setPlace(field, p);
    app.reset();
  };

  function render() {
    const near = net && pin ? nearestStops(net, pin, 3) : [];
    if (handle) {
      handle.layer.clearLayers();
      if (pin) L.marker([pin.lat, pin.lng], { title: tr('Pinned place'), alt: tr('Pinned place') }).addTo(handle.layer);
      for (const n of near) stopDot(n.stop, nameOf(n.stop), cssVar('--blue')).addTo(handle.layer);
    }
    const p = pin;
    fill(
      footer,
      p
        ? [
            h('p', { class: 'strong' }, tr('Nearest stops')),
            h(
              'div',
              { class: 'chips' },
              near.map((n) =>
                h(
                  'button',
                  { class: 'chip', type: 'button', onclick: () => choose({ kind: 'stop', stopId: n.stop.id, name: n.stop.name }) },
                  h('span', { class: 'row-title' }, nameOf(n.stop)),
                  h('span', { class: 'row-sub' }, ` ${formatDistance(n.distM)}`),
                ),
              ),
            ),
            button(tr('Use this spot'), () => choose({ kind: 'point', lat: p.lat, lng: p.lng, name: 'Pinned place' })),
          ]
        : note(tr('Tap the map where you are or where you are going.')),
    );
  }

  handle?.map.on('click', (e: L.LeafletMouseEvent) => {
    pin = { lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 };
    render();
  });
  render();
  return { el, destroy: () => handle?.destroy() };
}
