import { api } from '../api.ts';
import * as app from '../app.ts';
import { button, note, notice, routeBoard, shell, type View } from '../components.ts';
import type { PreparedNetwork } from '../core.ts';
import { fill, h } from '../dom.ts';
import { nameOf, tr } from '../i18n.ts';
import { icon, type IconName } from '../icon.ts';

// Riders tell the people who keep the routes right what is wrong: a stop in the wrong place, a
// route that stops somewhere else, times that are off. It goes to the admins' review queue.

export type SuggestKind = 'stop' | 'route' | 'times' | 'other';

const KINDS: [SuggestKind, string, IconName, string][] = [
  ['stop', 'A stop', 'map-pin', 'For example: the 8B stop is across the road, by the petrol pump.'],
  ['route', 'A route', 'route', 'For example: D2 also stops at Lake Mall.'],
  ['times', 'Times', 'clock', 'For example: the last D2 is at 22:30, not 21:00.'],
  ['other', 'Something else', 'message-square-warning', 'What should we fix?'],
];

export function suggestScreen(opts: { kind?: SuggestKind; routeIds?: string[]; stopId?: string; text?: string }): View {
  const net = app.state.net as PreparedNetwork | null;
  let kind: SuggestKind = opts.kind ?? (opts.routeIds?.length ? 'route' : 'stop');
  let routeId = opts.routeIds?.[0] ?? '';
  let sent = false;
  const text = h('textarea', { class: 'input', rows: '4', 'aria-label': tr('What should we fix?'), maxlength: '600' });
  if (opts.text) text.value = opts.text;
  const problem = h('div');
  const content = h('div', { class: 'panel' });
  const el = shell({ title: tr('Suggest a fix'), onBack: app.pop, body: content });
  const stop = opts.stopId ? net?.stops.get(opts.stopId) : undefined;
  const routes = (opts.routeIds ?? []).map((id) => net?.routes.get(id)).filter((r) => r !== undefined);

  async function send(btn: HTMLButtonElement) {
    btn.disabled = true;
    fill(problem);
    try {
      await api.suggest({ kind, text: text.value, routeId: routeId || undefined, stopId: stop?.id });
      sent = true;
      render();
    } catch (e) {
      fill(problem, note(e instanceof Error ? e.message : tr('The suggestion could not be sent.'), 'danger'));
      btn.disabled = false;
    }
  }

  function render() {
    if (sent) {
      fill(content, notice(tr('Thank you. The people who keep the routes right will look at it.'), 'check'), button(tr('Back'), app.pop, 'secondary'));
      return;
    }
    const sendBtn = button(tr('Send'), () => void send(sendBtn), 'primary', 'send');
    text.setAttribute('placeholder', tr(KINDS.find((k) => k[0] === kind)?.[3] ?? ''));
    fill(
      content,
      note(tr('Nothing changes at once: the people who keep the routes right check it first.')),
      h('p', { class: 'strong', id: 'kind' }, tr('What is it about?')),
      h(
        'div',
        { class: 'panel', role: 'radiogroup', 'aria-labelledby': 'kind' },
        KINDS.map(([k, label, ic]) =>
          h(
            'button',
            { class: 'choice', type: 'button', role: 'radio', 'aria-checked': String(kind === k), onclick: () => { kind = k; render(); } },
            icon(ic),
            h('span', {}, tr(label)),
          ),
        ),
      ),
      routes.length && kind !== 'stop'
        ? [
            h('p', { class: 'strong', id: 'which-route' }, tr('Which route?')),
            h(
              'div',
              { class: 'boards', role: 'radiogroup', 'aria-labelledby': 'which-route' },
              routes.map((r) =>
                h(
                  'button',
                  { class: 'pick', type: 'button', role: 'radio', 'aria-checked': String(routeId === r.id), 'aria-label': tr('Route {route}', { route: r.number }), onclick: () => { routeId = r.id; render(); } },
                  routeBoard(r.number, r.operator),
                ),
              ),
            ),
          ]
        : null,
      stop ? note(tr('About {stop}', { stop: nameOf(stop) })) : null,
      text,
      problem,
      sendBtn,
    );
  }

  render();
  return { el };
}
