import * as app from '../app.ts';
import { note, routeRow, shell, type View } from '../components.ts';
import { searchRoutes, type PreparedNetwork, type Route } from '../core.ts';
import { fill, h } from '../dom.ts';
import { tr } from '../i18n.ts';
import { icon } from '../icon.ts';

// Finding a bus by its route rather than by a journey: by the number painted on it, by its name,
// or by a place it goes to (core routes.ts). With nothing typed, every route, buses first.

const byNumber = (a: Route, b: Route) => a.number.localeCompare(b.number, undefined, { numeric: true });

export function routesScreen(): View {
  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder: tr('Route number, or a place it goes to'),
    'aria-label': tr('Search for a route'),
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  const content = h('div');
  const el = shell({
    title: tr('Find a route'),
    onBack: app.pop,
    body: [h('div', { class: 'search-box', role: 'search' }, h('div', { class: 'input-wrap' }, icon('search'), input)), content],
    flush: true,
  });
  const open = (r: Route) => app.push({ name: 'route', routeId: r.id });

  function list(net: PreparedNetwork, title: string, routes: Route[]) {
    return routes.length ? [h('h2', { class: 'section' }, title), h('ul', { class: 'rows' }, routes.map((r) => routeRow(net, r, () => open(r))))] : null;
  }

  function render() {
    const net = app.state.net;
    if (!net) {
      fill(content, h('div', { class: 'pad' }, note(app.state.loadError ? tr(app.state.loadError) : tr('Loading routes…'))));
      return;
    }
    const query = input.value.trim();
    if (!query) {
      const all = [...net.network.routes].sort(byNumber);
      fill(
        content,
        list(net, tr('All bus routes'), all.filter((r) => (r.mode ?? 'bus') === 'bus')),
        list(net, tr('Metro, trains and ferries'), all.filter((r) => (r.mode ?? 'bus') !== 'bus')),
      );
      return;
    }
    const hits = searchRoutes(net, query, 20);
    fill(
      content,
      hits.length
        ? h('ul', { class: 'rows', 'aria-label': tr('Matching routes') }, hits.map((hit) => routeRow(net, hit.route, () => open(hit.route), hit.via)))
        : h(
            'div',
            { class: 'pad' },
            note(tr('No route matches “{query}”. Try the number painted on the bus, like D2, or a place it goes to.', { query })),
            h(
              'button',
              { class: 'link', type: 'button', onclick: () => app.push({ name: 'suggest', kind: 'route', text: `${tr('Missing route:')} ${query}` }) },
              icon('message-square-warning', { size: 18 }),
              tr('Is a route missing? Tell us'),
            ),
          ),
    );
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !app.state.net) return;
    const first = searchRoutes(app.state.net, input.value, 1)[0];
    if (first) open(first.route);
  });
  render();
  requestAnimationFrame(() => input.focus());
  return { el, update: render };
}
