// Elements are built with DOM methods only, never from HTML strings, so no stop name or
// server message can ever become markup. No inline styles either: the page's policy forbids them.

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as unknown as HTMLInputElement).checked = v === true;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replaces everything inside `el`. */
export function fill(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

/** Bengali text marked as such, so screen readers pronounce it and the right font is used. */
export function bn(text: string | undefined): HTMLElement | null {
  return text ? h('span', { lang: 'bn' }, text) : null;
}
