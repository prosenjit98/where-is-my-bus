// Where Is My Bus admin panel. Served as its own file so the page can refuse inline scripts.
'use strict';

// The side nav: each part of the panel, with its icon (Lucide, ISC licence, as in the apps).
const NAV = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['stops', 'Stops', 'map-pin'],
  ['routes', 'Routes', 'route'],
  ['record', 'Record a route', 'circle-dot'],
  ['alerts', 'Diversions', 'triangle-alert'],
  ['suggestions', 'Suggestions', 'message-square-warning'],
  ['accuracy', 'Accuracy', 'timer'],
  ['owners', 'Bus owners', 'bus-front'],
  ['data', 'Import and export', 'download'],
];
const ICONS = {
  'layout-dashboard': [["rect", {width:"7",height:"9",x:"3",y:"3",rx:"1"}], ["rect", {width:"7",height:"5",x:"14",y:"3",rx:"1"}], ["rect", {width:"7",height:"9",x:"14",y:"12",rx:"1"}], ["rect", {width:"7",height:"5",x:"3",y:"16",rx:"1"}]],
  'map-pin': [["path", {d:"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}], ["circle", {cx:"12",cy:"10",r:"3"}]],
  route: [["circle", {cx:"6",cy:"19",r:"3"}], ["path", {d:"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}], ["circle", {cx:"18",cy:"5",r:"3"}]],
  'circle-dot': [["circle", {cx:"12",cy:"12",r:"1"}], ["circle", {cx:"12",cy:"12",r:"10"}]],
  'triangle-alert': [["path", {d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}], ["path", {d:"M12 9v4"}], ["path", {d:"M12 17h.01"}]],
  'message-square-warning': [["path", {d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"}], ["path", {d:"M12 15h.01"}], ["path", {d:"M12 7v4"}]],
  timer: [["line", {"x1":"10","x2":"14","y1":"2","y2":"2"}], ["line", {"x1":"12","x2":"15","y1":"14","y2":"11"}], ["circle", {cx:"12",cy:"14",r:"8"}]],
  'bus-front': [["path", {d:"M4 6 2 7"}], ["path", {d:"M10 6h4"}], ["path", {d:"m22 7-2-1"}], ["rect", {width:"16",height:"16",x:"4",y:"3",rx:"2"}], ["path", {d:"M4 11h16"}], ["path", {d:"M8 15h.01"}], ["path", {d:"M16 15h.01"}], ["path", {d:"M6 19v2"}], ["path", {d:"M18 21v-2"}]],
  download: [["path", {d:"M12 15V3"}], ["path", {d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}], ["path", {d:"m7 10 5 5 5-5"}]],
  'log-out': [["path", {d:"m16 17 5-5-5-5"}], ["path", {d:"M21 12H9"}], ["path", {d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],
  'panel-left-close': [["rect", {width:"18",height:"18",x:"3",y:"3",rx:"2"}], ["path", {d:"M9 3v18"}], ["path", {d:"m16 15-3-3 3-3"}]],
  'panel-left-open': [["rect", {width:"18",height:"18",x:"3",y:"3",rx:"2"}], ["path", {d:"M9 3v18"}], ["path", {d:"m14 9 3 3-3 3"}]],
  map: [["path", {d:"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}], ["path", {d:"M15 5.764v15"}], ["path", {d:"M9 3.236v15"}]],
  'user-round': [["circle", {cx:"12",cy:"8",r:"5"}], ["path", {d:"M20 21a8 8 0 0 0-16 0"}]],
  menu: [["path", {d:"M4 5h16"}], ["path", {d:"M4 12h16"}], ["path", {d:"M4 19h16"}]],
  x: [["path", {d:"M18 6 6 18"}], ["path", {d:"m6 6 12 12"}]],
  plus: [["path", {d:"M5 12h14"}], ["path", {d:"M12 5v14"}]],
};
const TOKEN_STORE = 'wimb.admin.token';
const NAV_STORE = 'wimb.admin.nav';
const DASHBOARD_REFRESH_MS = 15_000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const REC_SEND_MS = 15_000;
const KIND_LABEL = { stop: 'A stop', route: 'A route', times: 'Times', other: 'Something else' };
const OPERATORS = [['private', 'Private'], ['govt', 'Government'], ['mini', 'Mini bus'], ['other', 'Other']];
const MODES = [['bus', 'Bus'], ['metro', 'Metro'], ['train', 'Local train'], ['ferry', 'Ferry']];
// The same colours as LINE_HEX in packages/core/src/network.ts.
const LINE_HEX = { blue: '#1565C0', green: '#2E7D32', purple: '#6A1B9A', orange: '#C24A00', pink: '#C2185B', yellow: '#F9A825', red: '#C62828', teal: '#00796B' };

const state = {
  token: storedToken(),
  roadSnapping: false,
  network: null,
  tab: 'dashboard',
  /** The side nav shows icons only. */
  navCollapsed: navStartsCollapsed(),
  /** What the dashboard shows (GET /api/admin/dashboard), and why it could not load. */
  dashboard: null,
  dashboardError: null,
  /** The main map has been fitted to the stops once. */
  mapFitted: false,
  /** Building a direction: where the admin clicked to add a new stop. */
  newStopAt: null,
  mode: 'idle', // idle | add-stop | pick-stops
  stopQuery: '',
  routeQuery: '',
  stopDraft: null,
  routeDraft: null,
  patternIndex: 0,
  message: null,
  alerts: null,
  owners: null,
  /** People who record routes with the phone app (GET /api/admin/contributors). */
  contributors: null,
  /** A temporary password just made, shown once: { name, phone, password }. */
  tempPassword: null,
  accountsLoading: false,
  suggestions: null,
  suggestionFilter: 'new',
  recordings: null,
  /** The recording drawn on the map, with its path and halts. */
  recShown: null,
  /** Which recording's "Use for a route" form is open. */
  recUse: null,
  /** A recording in progress on this phone: { id, name, watch, buffer, count, metres, startedAt, last, timer, lock }. */
  recorder: null,
  accuracy: null,
};

// ---------- helpers ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function uniqueId(base, existing) {
  const taken = new Set(existing);
  const root = base || 'item';
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

function stopById() {
  return new Map((state.network ? state.network.stops : []).map((s) => [s.id, s]));
}

function stopUsage() {
  const used = new Map();
  for (const r of state.network.routes) {
    for (const p of r.patterns) {
      for (const id of p.stopIds) {
        if (!used.has(id)) used.set(id, new Set());
        used.get(id).add(r.number);
      }
    }
  }
  return used;
}

function board(route) {
  const mode = route.mode || 'bus';
  if (mode !== 'bus') {
    // A Metro line or ferry in its own colour, as the apps show it.
    const color = route.color || 'blue';
    const label = MODES.find(([v]) => v === mode)[1];
    return h('span', { class: `board line${color === 'yellow' ? ' on-light' : ''}`, style: `background:${LINE_HEX[color]}`, 'aria-label': `${label} ${route.number}` }, route.number || '?');
  }
  return h('span', { class: `board ${route.operator}`, 'aria-label': `Route ${route.number}` }, route.number || '?');
}

function field(label, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

function setMessage(kind, text, details) {
  state.message = kind ? { kind, text, details: Array.isArray(details) ? details : null } : null;
}

// ---------- API ----------

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = opts.token === undefined ? state.token : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `The server answered ${res.status}.`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

async function loadNetwork() {
  state.network = await api('/api/network', { token: '' });
}

// ---------- map ----------

let map = null;
let stopLayer = null;
let routeLayer = null;
let draftLayer = null;
let recLayer = null;

function initMap() {
  const el = document.getElementById('map');
  if (!window.L) {
    el.append(h('div', { class: 'map-missing' },
      h('h2', {}, 'The map did not load'),
      h('p', {}, 'Check the internet connection and reload. You can still edit stops and routes in the panel.')));
    return;
  }
  map = L.map(el).setView([22.55, 88.37], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  draftLayer = L.layerGroup().addTo(map);
  recLayer = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    if (state.mode === 'pick-stops' && currentPattern()) {
      pickAt(e.latlng);
      return;
    }
    if (state.mode !== 'add-stop') return;
    state.mode = 'idle';
    state.stopDraft = {
      isNew: true, idTouched: false, id: '', name: '', nameBn: '', aliasesText: '',
      lat: round6(e.latlng.lat), lng: round6(e.latlng.lng),
    };
    render();
  });
}

function fitToStops() {
  if (!map || !state.network || !state.network.stops.length) return;
  map.fitBounds(state.network.stops.map((s) => [s.lat, s.lng]), { padding: [30, 30] });
}

function currentPattern() {
  const d = state.routeDraft;
  return d && state.tab === 'routes' ? d.patterns[state.patternIndex] || null : null;
}

function drawMap() {
  if (!map) return;
  const el = document.getElementById('map');
  el.classList.toggle('picking', state.mode === 'pick-stops');
  el.classList.toggle('adding', state.mode === 'add-stop');
  stopLayer.clearLayers();
  routeLayer.clearLayers();
  draftLayer.clearLayers();
  recLayer.clearLayers();
  if (!state.network) return;

  // A recording being checked: its path, and its halts (blue: a stop is there; red: a new stop).
  // Stops the contributor marked have a thicker ring.
  const rec = state.tab === 'record' ? state.recShown : null;
  if (rec && rec.path && rec.path.length > 1) {
    L.polyline(rec.path, { color: cssVar('--danger'), weight: 4, opacity: 0.8, interactive: false }).addTo(recLayer);
    for (const halt of rec.halts || []) {
      L.circleMarker([halt.lat, halt.lng], { radius: halt.marked ? 9 : 8, color: cssVar('--ink'), weight: halt.marked ? 4 : 2, fillColor: halt.stop ? cssVar('--blue') : cssVar('--danger'), fillOpacity: 1 })
        .bindTooltip(h('span', {}, haltText(halt)), { direction: 'top', offset: [0, -6] })
        .addTo(recLayer);
    }
  }

  const pattern = currentPattern();
  const inPattern = new Set(pattern ? pattern.stopIds : []);
  for (const s of state.network.stops) {
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: inPattern.has(s.id) ? 7 : 5,
      color: cssVar('--ink'),
      weight: 2,
      fillColor: inPattern.has(s.id) ? cssVar('--paint') : cssVar('--surface'),
      fillOpacity: 1,
      bubblingMouseEvents: false,
    });
    marker.bindTooltip(h('span', {}, s.name), { direction: 'top', offset: [0, -6] });
    marker.on('click', () => onStopClick(s.id));
    stopLayer.addLayer(marker);
  }

  if (pattern) {
    const byId = stopById();
    const stops = pattern.stopIds.map((id) => byId.get(id)).filter(Boolean);
    const hasShape = Array.isArray(pattern.shape) && pattern.shape.length >= 2;
    const path = hasShape ? pattern.shape : stops.map((s) => [s.lat, s.lng]);
    if (path.length >= 2) {
      // Dashed means "straight lines between stops": a rough path.
      L.polyline(path, { color: cssVar('--blue'), weight: 5, opacity: 0.85, dashArray: hasShape ? null : '8 8', interactive: false }).addTo(routeLayer);
    }
    stops.forEach((s, i) => {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: 'seq', html: String(i + 1), iconSize: [22, 22], iconAnchor: [11, 30] }),
        interactive: false,
        keyboard: false,
      }).addTo(routeLayer);
    });
  }

  // Where a new stop goes while a direction is built.
  const at = state.tab === 'routes' && state.mode === 'pick-stops' ? state.newStopAt : null;
  if (at) L.marker([at.lat, at.lng], { icon: L.divIcon({ className: 'pin', iconSize: [22, 22] }), interactive: false, keyboard: false }).addTo(draftLayer);

  const d = state.tab === 'stops' ? state.stopDraft : null;
  if (d && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng))) {
    const pin = L.marker([Number(d.lat), Number(d.lng)], {
      draggable: true,
      icon: L.divIcon({ className: 'pin', iconSize: [22, 22] }),
      title: 'Drag to move the stop',
    }).addTo(draftLayer);
    pin.on('dragend', () => {
      const ll = pin.getLatLng();
      d.lat = round6(ll.lat);
      d.lng = round6(ll.lng);
      render();
    });
  }
}

function onStopClick(id) {
  const pattern = currentPattern();
  if (state.mode === 'pick-stops' && pattern) {
    if (pattern.stopIds[pattern.stopIds.length - 1] !== id) {
      pattern.stopIds.push(id);
      pattern.shape = undefined; // the old road path no longer matches the stops
    }
    render();
    return;
  }
  if (state.mode !== 'idle') return;
  openStop(id);
}

function openStop(id) {
  const s = state.network.stops.find((x) => x.id === id);
  if (!s) return;
  state.tab = 'stops';
  state.stopDraft = { isNew: false, id: s.id, name: s.name, nameBn: s.nameBn || '', aliasesText: (s.aliases || []).join(', '), lat: s.lat, lng: s.lng };
  setMessage(null);
  render();
  if (map) map.panTo([s.lat, s.lng]);
}

// ---------- views ----------

function messageView() {
  const m = state.message;
  if (!m) return null;
  return h('div', { class: `msg ${m.kind}`, role: m.kind === 'error' ? 'alert' : 'status' },
    m.text,
    m.details ? h('ul', {}, m.details.slice(0, 12).map((d) => h('li', {}, d))) : null);
}

function loginView() {
  const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Paste the admin token' });
  return h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/admin/whoami', { token: input.value.trim() });
        state.token = input.value.trim();
        keepToken(state.token);
        state.roadSnapping = !!r.roadSnapping;
        state.tab = 'dashboard';
        void loadDashboard();
        setMessage(null);
      } catch (err) {
        setMessage('error', err.status === 401 ? 'That token is not right. Copy it again from the server console.' : err.message);
      }
      render();
    },
  },
  h('h2', {}, 'Sign in'),
  h('p', { class: 'soft' }, 'The server prints an admin token when it starts. Set ADMIN_TOKEN on the server to keep the same one.'),
  field('Admin token', input),
  h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'));
}

function stopListView() {
  const usage = stopUsage();
  const list = h('ul', { class: 'list' });
  const fill = () => {
    const q = state.stopQuery.trim().toLowerCase();
    const stops = [...state.network.stops]
      .filter((s) => !q || [s.name, s.nameBn, ...(s.aliases || [])].some((t) => t && t.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...stops.map((s) => {
      const routes = [...(usage.get(s.id) || [])];
      return h('li', {}, h('button', { class: 'item', type: 'button', onclick: () => openStop(s.id) },
        h('div', {},
          h('div', { class: 'name' }, s.name, s.nameBn ? h('span', { class: 'bn' }, '  ', s.nameBn) : null),
          h('div', { class: 'meta' }, routes.length ? `Routes ${routes.join(', ')}` : 'No route uses this stop yet'))));
    }));
    if (!stops.length) list.replaceChildren(h('li', { class: 'soft' }, 'No stop matches. Check the spelling, or add the stop.'));
  };
  fill();
  return h('div', {},
    state.mode === 'add-stop'
      ? h('div', { class: 'banner', role: 'status' }, 'Click the map where the new stop is.',
          h('button', { class: 'btn small', type: 'button', onclick: () => { state.mode = 'idle'; render(); } }, 'Cancel'))
      : null,
    h('div', { class: 'row spread' },
      h('h2', {}, `${state.network.stops.length} stops`),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { state.mode = 'add-stop'; setMessage(null); render(); } }, 'Add stop')),
    h('input', {
      type: 'search', placeholder: 'Find a stop in English or Bengali', 'aria-label': 'Find a stop', value: state.stopQuery,
      oninput: (e) => { state.stopQuery = e.target.value; fill(); },
    }),
    list);
}

function stopEditorView() {
  const d = state.stopDraft;
  const idInput = h('input', {
    value: d.id, readonly: !d.isNew,
    oninput: (e) => { d.id = e.target.value.trim(); d.idTouched = true; },
  });
  const nameInput = h('input', {
    value: d.name, required: true,
    oninput: (e) => {
      d.name = e.target.value;
      if (d.isNew && !d.idTouched) {
        d.id = uniqueId(slug(d.name), state.network.stops.map((s) => s.id));
        idInput.value = d.id;
      }
    },
  });
  const coord = (key) => h('input', { type: 'number', step: '0.000001', value: d[key], oninput: (e) => { d[key] = e.target.value; } });
  return h('form', {
    onsubmit: (e) => { e.preventDefault(); saveStop(); },
  },
  h('h2', {}, d.isNew ? 'New stop' : d.name),
  field('Name in English', nameInput),
  field('Name in Bengali', h('input', { value: d.nameBn, lang: 'bn', oninput: (e) => { d.nameBn = e.target.value; } })),
  field('Other names people use',
    h('textarea', { value: d.aliasesText, oninput: (e) => { d.aliasesText = e.target.value; } }),
    'Separate with commas. Local names, spellings and nearby landmarks: Dharmatala, Dharmatolla.'),
  h('div', { class: 'grid2' }, field('Latitude', coord('lat')), field('Longitude', coord('lng'))),
  h('p', { class: 'hint' }, 'Drag the yellow pin on the map to fine-tune the position.'),
  field('Stop id', idInput, d.isNew ? 'Used in links and route lists. It cannot change after saving.' : null),
  h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'submit' }, 'Save stop'),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.stopDraft = null; setMessage(null); render(); } }, 'Cancel'),
    d.isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: deleteStop }, 'Delete stop')));
}

async function saveStop() {
  const d = state.stopDraft;
  if (!d.id) d.id = uniqueId(slug(d.name) || 'stop', state.network.stops.map((s) => s.id));
  const body = { name: d.name.trim(), nameBn: d.nameBn.trim(), aliases: splitList(d.aliasesText), lat: Number(d.lat), lng: Number(d.lng) };
  try {
    const r = await api(`/api/admin/stops/${encodeURIComponent(d.id)}`, { method: 'PUT', body });
    await loadNetwork();
    state.stopDraft = null;
    setMessage('ok', `Saved ${body.name}. The network is now version ${r.version}.`);
  } catch (e) {
    setMessage('error', e.message, e.details);
  }
  render();
}

async function deleteStop() {
  const d = state.stopDraft;
  if (!confirm(`Delete the stop ${d.name}?`)) return;
  try {
    const r = await api(`/api/admin/stops/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
    await loadNetwork();
    state.stopDraft = null;
    setMessage('ok', `Deleted ${d.name}. The network is now version ${r.version}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

function routeListView() {
  const list = h('ul', { class: 'list' });
  const fill = () => {
    const q = state.routeQuery.trim().toLowerCase();
    const byId = stopById();
    const routes = [...state.network.routes]
      .filter((r) => !q || `${r.number} ${r.name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    list.replaceChildren(...routes.map((r) => {
      const main = r.patterns[0];
      const ends = main ? `${(byId.get(main.stopIds[0]) || {}).name || '?'} to ${(byId.get(main.stopIds[main.stopIds.length - 1]) || {}).name || '?'}` : 'No directions yet';
      const directions = r.patterns.length === 1 ? '1 direction' : `${r.patterns.length} directions`;
      return h('li', {}, h('button', { class: 'item', type: 'button', onclick: () => openRoute(r.id) },
        board(r),
        h('div', {},
          h('div', { class: 'name' }, ends),
          h('div', { class: 'meta' }, `${r.firstBus} to ${r.lastBus}, every ${r.defaultHeadwayMin} min, ${directions}`))));
    }));
    if (!routes.length) list.replaceChildren(h('li', { class: 'soft' }, 'No route matches.'));
  };
  fill();
  return h('div', {},
    h('div', { class: 'row spread' },
      h('h2', {}, `${state.network.routes.length} routes`),
      h('button', { class: 'btn primary', type: 'button', onclick: newRoute }, 'Add route')),
    h('input', {
      type: 'search', placeholder: 'Find a route number', 'aria-label': 'Find a route', value: state.routeQuery,
      oninput: (e) => { state.routeQuery = e.target.value; fill(); },
    }),
    list);
}

function emptyPattern(direction) {
  return { id: '', direction, headsign: '', stopIds: [], activeText: '', validFrom: '', validTo: '', replaces: '' };
}

function newRoute() {
  state.routeDraft = {
    isNew: true, idTouched: false, id: '', number: '', name: '', operator: 'private', mode: 'bus', color: '',
    firstBus: '06:00', lastBus: '21:00', defaultHeadwayMin: 12, headwaysText: '',
    patterns: [emptyPattern('UP')],
  };
  state.patternIndex = 0;
  state.mode = 'pick-stops';
  setMessage(null);
  render();
}

function openRoute(id) {
  const r = state.network.routes.find((x) => x.id === id);
  if (!r) return;
  const copy = JSON.parse(JSON.stringify(r));
  state.routeDraft = {
    ...copy,
    isNew: false,
    name: copy.name || '',
    headwaysText: (copy.headways || []).map((b) => `${b.from}-${b.to} ${b.minutes}`).join('\n'),
    patterns: copy.patterns.map((p) => ({
      ...p,
      activeText: (p.activeWindows || []).map((w) => `${w.from}-${w.to}`).join(', '),
      validFrom: p.validFrom || '',
      validTo: p.validTo || '',
      replaces: p.replaces || '',
    })),
  };
  state.patternIndex = 0;
  state.mode = 'idle';
  setMessage(null);
  render();
}

function patternLabel(p) {
  const byId = stopById();
  const last = byId.get(p.stopIds[p.stopIds.length - 1]);
  const base = `Towards ${p.headsign || (last && last.name) || 'new direction'}`;
  // Variants share a destination, so say when each one runs.
  const windows = p.activeText !== undefined
    ? p.activeText
    : (p.activeWindows || []).map((w) => `${w.from}-${w.to}`).join(', ');
  if (p.validFrom || p.validTo) return `${base}, diversion ${p.validFrom || '…'} to ${p.validTo || '…'}`;
  if (windows) return `${base}, ${windows}`;
  return base;
}

function routeEditorView() {
  const d = state.routeDraft;
  const p = d.patterns[state.patternIndex];
  const byId = stopById();
  const set = (key) => (e) => { d[key] = e.target.value; };

  const numberInput = h('input', { value: d.number, required: true, oninput: (e) => { d.number = e.target.value; } });
  const operator = h('select', { onchange: set('operator') }, OPERATORS.map(([v, label]) => h('option', { value: v, selected: d.operator === v }, label)));
  const mode = h('select', { onchange: (e) => { d.mode = e.target.value; render(); } }, MODES.map(([v, label]) => h('option', { value: v, selected: (d.mode || 'bus') === v }, label)));
  const color = h('select', { onchange: (e) => { d.color = e.target.value; render(); } },
    h('option', { value: '', selected: !d.color }, 'None'),
    Object.keys(LINE_HEX).map((c) => h('option', { value: c, selected: d.color === c }, c[0].toUpperCase() + c.slice(1))));

  const seq = h('ol', { class: 'seq-list', 'aria-label': 'Stops in order' }, p.stopIds.map((id, i) => {
    const s = byId.get(id);
    const move = (delta) => () => {
      const j = i + delta;
      if (j < 0 || j >= p.stopIds.length) return;
      [p.stopIds[i], p.stopIds[j]] = [p.stopIds[j], p.stopIds[i]];
      p.shape = undefined;
      render();
    };
    return h('li', {},
      h('span', { class: 'grow' }, s ? s.name : `Missing stop ${id}`),
      h('button', { class: 'btn small', type: 'button', 'aria-label': `Move ${s ? s.name : id} earlier`, disabled: i === 0, onclick: move(-1) }, '↑'),
      h('button', { class: 'btn small', type: 'button', 'aria-label': `Move ${s ? s.name : id} later`, disabled: i === p.stopIds.length - 1, onclick: move(1) }, '↓'),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => { p.stopIds.splice(i, 1); p.shape = undefined; render(); } }, 'Remove'));
  }));

  const hasShape = Array.isArray(p.shape) && p.shape.length >= 2;
  const others = d.patterns.filter((q, i) => i !== state.patternIndex && q.id);

  return h('form', { onsubmit: (e) => { e.preventDefault(); saveRoute(); } },
    h('div', { class: 'row', style: 'margin-bottom:14px' }, board(d), h('h2', { style: 'margin:0' }, d.isNew ? 'New route' : `Route ${d.number}`)),
    h('div', { class: 'grid2' },
      field('Route number', numberInput, 'As painted on the bus.'),
      field('Operator', operator)),
    h('div', { class: 'grid2' },
      field('Runs as', mode, 'Buses are tracked and shared. The Metro, trains and ferries are planned from how often they run.'),
      field('Line colour', color, 'Shown on Metro and ferry boards.')),
    field('Name (optional)', h('input', { value: d.name, oninput: set('name'), placeholder: 'AC express' })),
    h('div', { class: 'grid2' },
      field('First bus', h('input', { type: 'time', value: d.firstBus, oninput: set('firstBus') })),
      field('Last bus', h('input', { type: 'time', value: d.lastBus, oninput: set('lastBus') }))),
    field('Usual minutes between buses', h('input', { type: 'number', min: '1', value: d.defaultHeadwayMin, oninput: set('defaultHeadwayMin') })),
    field('Busy-hour frequencies', h('textarea', { value: d.headwaysText, placeholder: '08:00-11:00 8\n17:00-20:30 8', oninput: set('headwaysText') }),
      'One per line: start-end, then minutes between buses. Leave empty if the frequency never changes.'),

    h('hr', { class: 'divider' }),
    h('h3', {}, 'Directions'),
    h('div', { class: 'pattern-tabs', role: 'tablist' },
      d.patterns.map((q, i) => h('button', {
        class: 'btn small', type: 'button', role: 'tab', 'aria-selected': String(i === state.patternIndex), 'aria-pressed': String(i === state.patternIndex),
        onclick: () => { state.patternIndex = i; render(); },
      }, patternLabel(q))),
      h('button', { class: 'btn small', type: 'button', onclick: () => { d.patterns.push(emptyPattern('UP')); state.patternIndex = d.patterns.length - 1; state.mode = 'pick-stops'; render(); } }, 'Add direction'),
      p.stopIds.length >= 2 ? h('button', {
        class: 'btn small', type: 'button',
        onclick: () => {
          const back = emptyPattern(p.direction === 'UP' ? 'DOWN' : 'UP');
          back.stopIds = [...p.stopIds].reverse();
          d.patterns.push(back);
          state.patternIndex = d.patterns.length - 1;
          render();
        },
      }, 'Add return direction') : null),

    state.mode === 'pick-stops'
      ? h('div', { class: 'banner', role: 'status' },
          h('span', {}, 'Click the stops on the map in the order the bus reaches them. Where there is no stop yet, click the road to add one there.'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { state.mode = 'idle'; state.newStopAt = null; render(); } }, 'Done'))
      : h('button', { class: 'btn', type: 'button', onclick: () => { state.mode = 'pick-stops'; render(); } }, 'Pick stops on the map'),
    state.mode === 'pick-stops' && state.newStopAt ? newStopForm(p) : null,
    p.stopIds.length ? seq : h('p', { class: 'soft' }, 'No stops yet.'),

    h('div', { class: 'grid2' },
      field('Heading towards', h('input', { value: p.headsign, placeholder: (byId.get(p.stopIds[p.stopIds.length - 1]) || {}).name || 'Last stop', oninput: (e) => { p.headsign = e.target.value; } })),
      field('Direction', h('select', { onchange: (e) => { p.direction = e.target.value; } },
        h('option', { value: 'UP', selected: p.direction === 'UP' }, 'Up'),
        h('option', { value: 'DOWN', selected: p.direction === 'DOWN' }, 'Down')))),

    h('h3', {}, 'Road path'),
    h('p', { class: 'soft' }, hasShape
      ? `Follows the road (${p.shape.length} points).`
      : 'Straight lines between stops. Arrival times are rougher until the road path is added.'),
    h('div', { class: 'row' },
      state.roadSnapping
        ? h('button', { class: 'btn', type: 'button', disabled: p.stopIds.length < 2, onclick: snapPattern }, 'Snap to roads')
        : h('p', { class: 'hint' }, 'Set OSRM_URL on the server to draw road paths automatically.'),
      hasShape ? h('button', { class: 'btn', type: 'button', onclick: () => { p.shape = undefined; render(); } }, 'Use straight lines') : null),

    h('h3', {}, 'When this direction runs'),
    field('Only at these times', h('input', { value: p.activeText, placeholder: '05:00-13:00', oninput: (e) => { p.activeText = e.target.value; } }),
      'Leave empty if it runs all day. Use it for roads whose one-way direction changes during the day.'),
    h('div', { class: 'grid2' },
      field('Diversion from', h('input', { type: 'date', value: p.validFrom, oninput: (e) => { p.validFrom = e.target.value; } })),
      field('Diversion until', h('input', { type: 'date', value: p.validTo, oninput: (e) => { p.validTo = e.target.value; } }))),
    field('Replaces during the diversion', h('select', { onchange: (e) => { p.replaces = e.target.value; } },
      h('option', { value: '' }, 'Nothing: it is an extra direction'),
      others.map((q) => h('option', { value: q.id, selected: p.replaces === q.id }, patternLabel(q)))),
      'For temporary changes such as Durga Puja closures. The normal direction switches off between these dates.'),
    d.patterns.length > 1
      ? h('button', { class: 'btn danger', type: 'button', onclick: () => { d.patterns.splice(state.patternIndex, 1); state.patternIndex = 0; render(); } }, 'Remove this direction')
      : null,

    h('hr', { class: 'divider' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save route'),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.routeDraft = null; state.mode = 'idle'; setMessage(null); render(); } }, 'Cancel'),
      d.isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: deleteRoute }, 'Delete route')));
}

function parseHeadways(text) {
  const out = [];
  String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(\d+(?:\.\d+)?)$/.exec(line);
    if (!m) throw new Error(`Busy-hour frequency line ${i + 1} should look like 08:00-11:00 8.`);
    out.push({ from: m[1].padStart(5, '0'), to: m[2].padStart(5, '0'), minutes: Number(m[3]) });
  });
  return out;
}

function parseWindows(text) {
  return splitList(text).map((part) => {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(part);
    if (!m) throw new Error(`"${part}" should look like 05:00-13:00.`);
    return { from: m[1].padStart(5, '0'), to: m[2].padStart(5, '0') };
  });
}

async function saveRoute() {
  const d = state.routeDraft;
  const byId = stopById();
  let route;
  try {
    if (!d.id) d.id = uniqueId(slug(d.number) || 'route', state.network.routes.map((r) => r.id));
    const takenPatternIds = state.network.routes.filter((r) => r.id !== d.id).flatMap((r) => r.patterns.map((p) => p.id));
    const patterns = d.patterns.map((p) => {
      const id = p.id || uniqueId(`${slug(d.number).toUpperCase() || d.id}-${p.direction}`, takenPatternIds);
      takenPatternIds.push(id);
      p.id = id;
      const last = byId.get(p.stopIds[p.stopIds.length - 1]);
      const out = { id, direction: p.direction, headsign: p.headsign.trim() || (last ? last.name : ''), stopIds: p.stopIds };
      if (Array.isArray(p.shape) && p.shape.length >= 2) out.shape = p.shape;
      const windows = parseWindows(p.activeText);
      if (windows.length) out.activeWindows = windows;
      if (p.validFrom) out.validFrom = p.validFrom;
      if (p.validTo) out.validTo = p.validTo;
      if (p.replaces) out.replaces = p.replaces;
      return out;
    });
    route = {
      number: d.number.trim(),
      name: d.name.trim(),
      operator: d.operator,
      mode: d.mode || 'bus',
      color: d.color || '',
      firstBus: d.firstBus,
      lastBus: d.lastBus,
      defaultHeadwayMin: Number(d.defaultHeadwayMin),
      headways: parseHeadways(d.headwaysText),
      patterns,
    };
  } catch (e) {
    setMessage('error', e.message);
    render();
    return;
  }
  try {
    const r = await api(`/api/admin/routes/${encodeURIComponent(d.id)}`, { method: 'PUT', body: route });
    await loadNetwork();
    state.routeDraft = null;
    state.mode = 'idle';
    setMessage('ok', `Saved route ${route.number}. The network is now version ${r.version}.`);
  } catch (e) {
    setMessage('error', e.message, e.details);
  }
  render();
}

async function deleteRoute() {
  const d = state.routeDraft;
  if (!confirm(`Delete route ${d.number}? Riders will stop seeing it after their next update.`)) return;
  try {
    const r = await api(`/api/admin/routes/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
    await loadNetwork();
    state.routeDraft = null;
    setMessage('ok', `Deleted route ${d.number}. The network is now version ${r.version}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function snapPattern() {
  const p = state.routeDraft.patterns[state.patternIndex];
  const byId = stopById();
  const points = p.stopIds.map((id) => byId.get(id)).filter(Boolean).map((s) => [s.lat, s.lng]);
  try {
    const r = await api('/api/admin/snap', { method: 'POST', body: { points } });
    p.shape = r.shape;
    setMessage('ok', `Road path added with ${r.shape.length} points. Save the route to keep it.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

function alertsView() {
  if (state.alerts === null) {
    api('/api/admin/alerts')
      .then((r) => { state.alerts = r.diversions; render(); })
      .catch((e) => { state.alerts = []; setMessage('error', e.message); render(); });
    return h('p', { class: 'soft' }, 'Checking recent trips…');
  }
  return h('div', {},
    h('div', { class: 'row spread' },
      h('h2', {}, 'Likely diversions'),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.alerts = null; render(); } }, 'Check again')),
    h('p', { class: 'soft' }, 'When several riders on one route leave its path at the same place within 30 minutes, the bus has probably been diverted. Add a diversion to the route so arrival times stay right.'),
    state.alerts.length
      ? h('ul', { class: 'list' }, state.alerts.map((a) => {
          const route = state.network.routes.find((r) => r.patterns.some((p) => p.id === a.patternId));
          return h('li', {}, h('button', {
            class: 'item', type: 'button',
            onclick: () => { if (map) map.setView([a.lat, a.lng], 16); },
          },
          route ? board(route) : null,
          h('div', {},
            h('div', { class: 'name' }, `${a.sessions} riders left the route towards ${a.headsign}`),
            h('div', { class: 'meta' }, `Last seen ${new Date(a.lastSeen).toLocaleTimeString()}. Show on map.`))));
        }))
      : h('p', {}, 'No likely diversions right now.'));
}

// ---------- record a route ----------

const metresBetween = (a, b) => {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
};

async function sendRecorded() {
  const r = state.recorder;
  if (!r || !r.buffer.length) return;
  const points = r.buffer.splice(0, 300);
  try {
    await api(`/api/admin/recordings/${encodeURIComponent(r.id)}/points`, { method: 'POST', body: { points } });
  } catch (e) {
    r.buffer.unshift(...points); // kept for the next try
    setMessage('error', `Positions not sent yet: ${e.message}`);
    render();
  }
}

async function startRecording(name) {
  if (!navigator.geolocation) {
    setMessage('error', 'This browser cannot give its location here. Use a phone, over HTTPS.');
    render();
    return;
  }
  try {
    const { recording } = await api('/api/admin/recordings', { method: 'POST', body: { name } });
    const r = { id: recording.id, name: recording.name, buffer: [], count: 0, metres: 0, startedAt: Date.now(), last: null, lock: null };
    r.watch = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, ts: pos.timestamp };
        if (r.last) r.metres += metresBetween(r.last, p);
        r.last = p;
        r.buffer.push(p);
        r.count++;
        if (state.tab === 'record') render();
      },
      (err) => { setMessage('error', err.code === 1 ? 'Location is blocked for this site. Allow it to record.' : 'No location yet. Keep the phone in the open.'); render(); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    r.timer = setInterval(() => void sendRecorded(), REC_SEND_MS);
    // Browsers stop location when the screen goes off, so it stays on while recording.
    if (navigator.wakeLock) r.lock = await navigator.wakeLock.request('screen').catch(() => null);
    state.recorder = r;
    setMessage('ok', `Recording ${r.name}. Keep this screen on until the end of the route.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function stopRecording() {
  const r = state.recorder;
  if (!r) return;
  navigator.geolocation.clearWatch(r.watch);
  clearInterval(r.timer);
  if (r.lock) r.lock.release().catch(() => undefined);
  while (r.buffer.length) {
    const before = r.buffer.length;
    await sendRecorded();
    if (r.buffer.length >= before) break;
  }
  state.recorder = null;
  try {
    const { recording } = await api(`/api/admin/recordings/${encodeURIComponent(r.id)}/finish`, { method: 'POST' });
    state.recShown = recording;
    setMessage('ok', `Saved ${recording.name}: ${(recording.lengthM / 1000).toFixed(1)} km, ${recording.halts.length} halts. Check it on the map.`);
    showRecording(recording);
  } catch (e) {
    setMessage('error', e.message);
  }
  state.recordings = null;
  render();
}

/** A halt of a recording, on the map and in its list: marked by the contributor, or found where the bus stood. */
function haltText(halt) {
  const what = halt.marked
    ? `Marked${halt.name ? ` as “${halt.name}”` : ', no name typed'}`
    : `Stood ${halt.seconds} s`;
  return `${what} · ${halt.stop ? `${halt.stop.name}, ${halt.stop.distM} m away` : 'no stop here yet'}`;
}

/** The recording on the map: who made it, and the stops they marked. */
function recordingDetail(rec) {
  const marked = (rec.halts || []).filter((x) => x.marked);
  return h('section', { class: 'msg', 'aria-label': `Recording ${rec.name}` },
    h('p', { class: 'strong-line' }, `On the map: ${rec.name}`),
    h('p', { class: 'hint' }, [
      rec.by ? `Recorded by ${rec.by.name}` : 'Recorded on this panel',
      rec.halts ? count(rec.halts.length, 'halt', 'halts') : null,
      count(marked.length, 'marked stop', 'marked stops'),
    ].filter(Boolean).join(' · ')),
    marked.length
      ? h('ol', { class: 'list compact', 'aria-label': 'Marked stops' }, marked.map((x) => h('li', { class: 'entry' },
          h('span', { class: 'name' }, x.name || 'No name typed'),
          h('span', { class: 'meta' }, x.stop
            ? `The stop ${x.stop.name} is ${x.stop.distM} m away`
            : x.name ? 'No stop here yet: a new stop gets this name' : 'No stop here yet: a new stop needs a name'))))
      : null,
    marked.length ? h('p', { class: 'hint' }, 'Stops that are new get the name the contributor typed. You can change them in the Stops tab.') : null);
}

function showRecording(rec) {
  state.recShown = rec;
  if (map && rec.path && rec.path.length > 1) map.fitBounds(rec.path, { padding: [30, 30] });
}

async function openRecording(id) {
  try {
    const { recording } = await api(`/api/admin/recordings/${encodeURIComponent(id)}`);
    if (!recording.path) {
      setMessage('error', 'This recording has not finished. Finish it first.');
    } else {
      showRecording(recording);
      setMessage(null);
    }
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function finishRecording(id) {
  try {
    const { recording } = await api(`/api/admin/recordings/${encodeURIComponent(id)}/finish`, { method: 'POST' });
    state.recordings = null;
    showRecording(recording);
    setMessage('ok', `Finished ${recording.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function deleteRecording(rec) {
  if (!confirm(`Delete the recording ${rec.name}?`)) return;
  try {
    await api(`/api/admin/recordings/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
    if (state.recShown && state.recShown.id === rec.id) state.recShown = null;
    state.recordings = null;
    setMessage('ok', `Deleted ${rec.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

function useRecordingForm(rec) {
  const routes = [...state.network.routes].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const route = h('select', {}, routes.map((r) => h('option', { value: r.id }, `Route ${r.number}${r.name ? ` (${r.name})` : ''}`)));
  const direction = h('select', {});
  const fillDirections = () => {
    const r = routes.find((x) => x.id === route.value);
    direction.replaceChildren(...(r ? r.patterns.map((p) => h('option', { value: p.id }, patternLabel(p))) : []));
  };
  route.addEventListener('change', fillDirections);
  fillDirections();
  const stops = h('input', { type: 'checkbox' });
  return h('form', {
    class: 'msg',
    onsubmit: async (e) => {
      e.preventDefault();
      if (stops.checked && !confirm('Replace this direction’s stops with the halts of the recording?')) return;
      try {
        const r = await api(`/api/admin/recordings/${encodeURIComponent(rec.id)}/apply`, { method: 'POST', body: { routeId: route.value, patternId: direction.value, stops: stops.checked } });
        await loadNetwork();
        state.recUse = null;
        setMessage('ok', `Saved: the road path${stops.checked ? ' and stops' : ''} come from ${rec.name}. ${r.newStops ? `${r.newStops} new stops need names in the Stops tab. ` : ''}The network is now version ${r.version}.`);
      } catch (err) {
        setMessage('error', err.message, err.details);
      }
      render();
    },
  },
  field('Route', route),
  field('Direction', direction),
  h('label', { class: 'row' }, stops, ' Also make its stops from the halts (a stop already there is used when one is within 80 m)'),
  h('div', { class: 'row' },
    h('button', { class: 'btn small primary', type: 'submit' }, 'Use for this direction'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { state.recUse = null; render(); } }, 'Cancel')));
}

function recordView() {
  const r = state.recorder;
  if (state.recordings === null) {
    api('/api/admin/recordings')
      .then((res) => { state.recordings = res.recordings; render(); })
      .catch((e) => { state.recordings = []; setMessage('error', e.message); render(); });
  }
  const name = h('input', { placeholder: 'For example D2 towards Garia', maxlength: '80' });
  return h('div', {},
    h('h2', {}, 'Record a route'),
    h('p', { class: 'soft' }, 'Ride the route once with this page open on a phone. Its road path comes from your positions, and the places where the bus stood still become suggested stops. Contributors record routes the same way with the phone app, and mark each stop as the bus reaches it; their recordings come here too. Nothing changes for riders until you use a recording for a route below.'),
    r
      ? h('div', { class: 'banner', role: 'status' },
          `Recording: ${r.count} positions, ${(r.metres / 1000).toFixed(1)} km, ${Math.round((Date.now() - r.startedAt) / 60000)} min`,
          h('button', { class: 'btn small', type: 'button', onclick: () => void stopRecording() }, 'Stop and save'))
      : h('form', { onsubmit: (e) => { e.preventDefault(); void startRecording(name.value); } },
          field('Name', name, 'Keep this screen on during the ride: browsers stop location when the screen goes off.'),
          h('button', { class: 'btn primary', type: 'submit' }, 'Start recording')),
    state.recShown ? recordingDetail(state.recShown) : null,
    h('h3', {}, 'Recordings'),
    state.recordings === null
      ? h('p', { class: 'soft' }, 'Loading recordings…')
      : state.recordings.length
        ? h('ul', { class: 'list', 'aria-label': 'Recordings' }, state.recordings.map((rec) => h('li', { class: 'entry' },
            h('div', { class: 'name' }, rec.name, rec.by ? h('span', { class: 'chip' }, `by ${rec.by.name}`) : null),
            h('div', { class: 'meta' }, [
              new Date(rec.startedAt).toLocaleString(),
              ...(rec.finishedAt
                ? [`${(rec.lengthM / 1000).toFixed(1)} km`, `${rec.minutes} min`, count(rec.halts, 'halt', 'halts')]
                : [`not finished, ${count(rec.points, 'position', 'positions')}`]),
              rec.marks ? count(rec.marks, 'marked stop', 'marked stops') : null,
            ].filter(Boolean).join(' · ')),
            h('div', { class: 'row' },
              rec.finishedAt
                ? [
                    h('button', { class: 'btn small', type: 'button', onclick: () => void openRecording(rec.id) }, 'Show on map'),
                    h('button', { class: 'btn small', type: 'button', onclick: () => { state.recUse = rec.id; void openRecording(rec.id); } }, 'Use for a route'),
                  ]
                : h('button', { class: 'btn small', type: 'button', onclick: () => void finishRecording(rec.id) }, 'Finish'),
              h('button', { class: 'btn small danger', type: 'button', onclick: () => void deleteRecording(rec) }, 'Delete')),
            state.recUse === rec.id ? useRecordingForm(rec) : null)))
        : h('p', { class: 'soft' }, 'No recordings yet.'));
}

// ---------- accuracy ----------

function accuracyView() {
  if (state.accuracy === null) {
    api('/api/admin/accuracy')
      .then((r) => { state.accuracy = r; render(); })
      .catch((e) => { state.accuracy = { days: 7, routes: [], learnedStretchHours: 0 }; setMessage('error', e.message); render(); });
    return h('p', { class: 'soft' }, 'Loading…');
  }
  const a = state.accuracy;
  const cell = (x) => (x.predictions ? `${x.typicalErrorMin} min, ${Math.round(x.within2MinShare * 100)}% within 2 min` : 'none yet');
  return h('div', {},
    h('h2', {}, 'How close the arrival times are'),
    h('p', { class: 'soft' }, `For conductors' buses in the last ${a.days} days: the arrival time predicted 10 and 5 minutes before each stop, against when the bus got there. The pilot's target is within 2 minutes most of the time, 10 minutes ahead.`),
    a.routes.length
      ? h('table', { class: 'acc' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Route'), h('th', { scope: 'col' }, '10 min ahead'), h('th', { scope: 'col' }, '5 min ahead'), h('th', { scope: 'col' }, 'Buses came'))),
          h('tbody', {}, a.routes.map((r) => {
            const route = state.network.routes.find((x) => x.id === r.routeId);
            const bias = r.horizons['10'].lateBiasMin;
            return h('tr', {},
              h('th', { scope: 'row' }, route ? board(route) : r.routeNumber),
              h('td', {}, cell(r.horizons['10']), h('div', { class: 'meta' }, `${r.horizons['10'].predictions} predictions`)),
              h('td', {}, cell(r.horizons['5']), h('div', { class: 'meta' }, `${r.horizons['5'].predictions} predictions`)),
              h('td', {}, bias === null ? '' : bias > 0.2 ? `${bias} min late on average` : bias < -0.2 ? `${-bias} min early on average` : 'on time on average'));
          })))
      : h('p', {}, 'No conductor’s bus has been checked yet. Times are checked once conductors share their buses.'),
    h('h3', {}, 'Learned travel times'),
    h('p', { class: 'soft' }, `${a.learnedStretchHours} stretch-hours have enough trips (3 or more) to replace the flat 14 km/h estimate. Every tracked bus adds to them.`),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.accuracy = null; render(); } }, 'Check again'));
}

async function reviewSuggestion(c, status) {
  try {
    await api(`/api/admin/corrections/${encodeURIComponent(c.id)}`, { method: 'PUT', body: { status } });
    state.suggestions = null;
    setMessage('ok', status === 'new' ? 'Moved back to new suggestions.' : status === 'done' ? 'Marked as done.' : 'Dismissed.');
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

function suggestionsView() {
  if (state.suggestions === null) {
    api(`/api/admin/corrections?status=${state.suggestionFilter}`)
      .then((r) => { state.suggestions = r; render(); })
      .catch((e) => { state.suggestions = { corrections: [], counts: { new: 0, all: 0 } }; setMessage('error', e.message); render(); });
    return h('p', { class: 'soft' }, 'Loading suggestions…');
  }
  const { corrections, counts } = state.suggestions;
  const byStop = stopById();
  const filter = (value, label) => h('button', {
    class: 'btn small', type: 'button', 'aria-pressed': String(state.suggestionFilter === value),
    onclick: () => { state.suggestionFilter = value; state.suggestions = null; render(); },
  }, label);
  return h('div', {},
    h('h2', {}, counts.new === 1 ? '1 new suggestion' : `${counts.new} new suggestions`),
    h('p', { class: 'soft' }, 'Riders’ suggested fixes. Nothing changes until you change the stop or route; then mark the suggestion done.'),
    h('div', { class: 'row' }, filter('new', 'New'), filter('done', 'Done'), filter('dismissed', 'Dismissed')),
    corrections.length
      ? h('ul', { class: 'list', 'aria-label': 'Suggestions' }, corrections.map((c) => {
          const route = c.routeId ? state.network.routes.find((r) => r.id === c.routeId) : null;
          const stop = c.stopId ? byStop.get(c.stopId) : null;
          return h('li', { class: 'entry' },
            h('div', { class: 'row' },
              route ? h('button', { class: 'btn small', type: 'button', onclick: () => { state.tab = 'routes'; openRoute(route.id); } }, board(route), ' Open route') : null,
              stop ? h('button', { class: 'btn small', type: 'button', onclick: () => openStop(stop.id) }, `Open ${stop.name}`) : null,
              h('span', { class: 'meta' }, `${KIND_LABEL[c.kind] || 'Something else'} · ${new Date(c.createdAt).toLocaleString()}`)),
            h('p', { class: 'name' }, c.text),
            c.note ? h('p', { class: 'meta' }, `Note: ${c.note}`) : null,
            h('div', { class: 'row' },
              c.status === 'new'
                ? [
                    h('button', { class: 'btn small primary', type: 'button', onclick: () => void reviewSuggestion(c, 'done') }, 'Mark done'),
                    h('button', { class: 'btn small', type: 'button', onclick: () => void reviewSuggestion(c, 'dismissed') }, 'Dismiss'),
                  ]
                : h('button', { class: 'btn small', type: 'button', onclick: () => void reviewSuggestion(c, 'new') }, 'Reopen')));
        }))
      : h('p', { class: 'soft' }, state.suggestionFilter === 'new' ? 'No new suggestions.' : 'None here.'));
}

// ---------- bus owners, their staff and route syndicates ----------

// Everyone who signs in on /signin does so with their mobile number and a password, once the admin
// has approved them. The admin sees the number in full, to call and check who it is.

const KIND_WORDS = { owner: 'Bus owner', manager: 'Manager', conductor: 'Conductor', syndicate: 'Route syndicate', contributor: 'Contributor' };
const signInPage = () => `${location.origin}/signin`;
const since = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
/** "+919830012345" as "+91 98300 12345", to read out and call. */
const showPhone = (phone) => (phone ? phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2') : phone);

/** A temporary password just made, shown once: { name, phone, password }. */
function tempPasswordView() {
  const t = state.tempPassword;
  const input = h('input', { readonly: true, value: t.password, class: 'temp-password', spellcheck: 'false', onfocus: (e) => e.target.select() });
  return h('div', { class: 'msg ok', role: 'status' },
    h('p', { class: 'strong-line' }, `Temporary password for ${t.name}`),
    h('p', { class: 'hint' }, `Give it to them yourself, for example on the phone. They sign in at ${signInPage()} with ${showPhone(t.phone)} and this password, then choose their own. It is shown only this once.`),
    field('Temporary password', input),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn small', type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(t.password);
            setMessage('ok', `Copied the temporary password for ${t.name}.`);
          } catch {
            input.focus();
            setMessage('ok', 'Copy the selected password.');
          }
          render();
        },
      }, 'Copy password'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { state.tempPassword = null; render(); } }, 'Done')));
}

/** After a change: the lists, and the counts in the nav and on the dashboard. */
function accountsChanged() {
  state.owners = null;
  state.syndicates = null;
  state.contributors = null;
  void loadDashboard();
}

async function addOwner(name, phone) {
  try {
    const r = await api('/api/admin/owners', { method: 'POST', body: { name, phone } });
    state.tempPassword = { name: r.owner.name, phone: r.owner.people[0].phone, password: r.password };
    accountsChanged();
    setMessage(null);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

/** A new temporary password: they are signed out everywhere until they sign in with it. */
async function newPassword(path, name, phone) {
  if (!confirm(`Set a new temporary password for ${name}? They are signed out on every device until they sign in with it.`)) return;
  let number = phone;
  if (!number) {
    number = prompt(`${name} has no mobile number to sign in with yet. Their mobile number:`);
    if (!number) return;
  }
  try {
    const r = await api(path, { method: 'POST', body: phone ? {} : { phone: number } });
    state.tempPassword = { name, phone: phone || number, password: r.password };
    accountsChanged();
    setMessage(null);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function renameOwner(o) {
  const name = prompt('New name', o.name);
  if (name === null || name.trim() === o.name) return;
  try {
    await api(`/api/admin/owners/${encodeURIComponent(o.id)}`, { method: 'PUT', body: { name } });
    state.owners = null;
    setMessage('ok', `Renamed ${o.name} to ${name.trim()}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function removeOwner(o, pending) {
  const buses = o.buses.length ? ` Their ${count(o.buses.length, 'bus is', 'buses are')} removed too.` : '';
  const question = pending ? `Turn down ${o.name}? Their sign-up is removed.` : `Remove ${o.name}? They and their staff, conductors too, can no longer sign in.${buses}`;
  if (!confirm(question)) return;
  try {
    await api(`/api/admin/owners/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
    accountsChanged();
    setMessage('ok', pending ? `Turned down ${o.name}.` : `Removed ${o.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function approveOwner(o) {
  try {
    await api(`/api/admin/owners/${encodeURIComponent(o.id)}/approve`, { method: 'POST' });
    accountsChanged();
    setMessage('ok', `Approved ${o.name}. They can sign in now, and add their buses.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

const personPath = (o, p) => `/api/admin/owners/${encodeURIComponent(o.id)}/people/${encodeURIComponent(p.id)}`;

async function approvePerson(o, p) {
  try {
    await api(`${personPath(o, p)}/approve`, { method: 'POST' });
    accountsChanged();
    setMessage('ok', `Approved ${p.name}. They can sign in for ${o.name} now.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function removePerson(o, p) {
  const question = p.pending ? `Turn down ${p.name}, who asked to sign in for ${o.name}?` : `Remove ${p.name}? They can no longer sign in for ${o.name}.`;
  if (!confirm(question)) return;
  try {
    await api(personPath(o, p), { method: 'DELETE' });
    accountsChanged();
    setMessage('ok', p.pending ? `Turned down ${p.name}.` : `Removed ${p.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

const PASSWORD_WORDS = { set: 'password set', temporary: 'temporary password, not used yet', none: 'no password yet' };

/** How someone signs in: their number in full, and whether they have a password. */
const loginLine = (l) => [showPhone(l.phone) || 'no mobile number yet', PASSWORD_WORDS[l.password], l.devices ? `signed in on ${count(l.devices, 'device', 'devices')}` : null].filter(Boolean).join(' · ');

/** Everyone who signed up on /signin and waits: owners, their staff, syndicates. */
function waitingView() {
  const items = [];
  for (const o of state.owners) {
    const main = o.people.find((p) => p.role === 'owner') || o.people[0];
    if (o.pending) {
      items.push(h('li', { class: 'entry' },
        h('div', { class: 'name' }, o.name, h('span', { class: 'chip warn' }, KIND_WORDS.owner)),
        h('div', { class: 'meta' }, `${main ? loginLine(main) : ''} · signed up ${since(o.createdAt)}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => void approveOwner(o) }, `Approve ${o.name}`),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeOwner(o, true) }, 'Turn down'))));
    }
    for (const p of o.people.filter((x) => x.pending)) {
      const role = p.role === 'conductor' ? 'Conductor' : 'Manager';
      items.push(h('li', { class: 'entry' },
        h('div', { class: 'name' }, p.name, h('span', { class: 'chip warn' }, `${role} for ${o.name}`)),
        h('div', { class: 'meta' }, `${loginLine(p)} · asked to sign in for ${o.name}${main && main.phone ? `, whose number is ${showPhone(main.phone)}` : ''}${p.role === 'conductor' ? ' · the owner can approve them on their own page too' : ''}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => void approvePerson(o, p) }, `Approve ${p.name}`),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => void removePerson(o, p) }, 'Turn down'))));
    }
  }
  for (const s of state.syndicates.filter((x) => x.pending)) {
    items.push(h('li', { class: 'entry' },
      h('div', { class: 'name' }, s.name, h('span', { class: 'chip warn' }, KIND_WORDS.syndicate)),
      h('div', { class: 'meta' }, `${s.contactName || ''} · ${loginLine(s)} · signed up ${since(s.createdAt)}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => { state.syndicateForm = { id: s.id, name: s.name, routeIds: new Set(s.routeIds), ownerIds: new Set(s.ownerIds), approve: true }; render(); } }, `Choose routes and approve ${s.name}`),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeSyndicate(s, true) }, 'Turn down'))));
  }
  for (const c of (state.contributors || []).filter((x) => x.pending)) {
    items.push(h('li', { class: 'entry' },
      h('div', { class: 'name' }, c.name, h('span', { class: 'chip warn' }, KIND_WORDS.contributor)),
      h('div', { class: 'meta' }, `${loginLine(c)} · signed up ${since(c.createdAt)}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn small primary', type: 'button', onclick: () => void approveContributor(c) }, `Approve ${c.name}`),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeContributor(c) }, 'Turn down'))));
  }
  if (!items.length) return null;
  return h('section', { class: 'waiting' },
    h('h2', {}, items.length === 1 ? '1 account waits for you' : `${items.length} accounts wait for you`),
    h('p', { class: 'hint' }, 'They signed up on the sign-in page. Check who they are before approving, for example by calling the number: managers and syndicates see owners’ buses, a conductor’s phone is trusted on their owner’s buses, and contributors’ recordings can become routes.'),
    h('ul', { class: 'list', 'aria-label': 'Waiting for approval' }, items));
}

function ownersView() {
  if (state.owners === null || state.syndicates === null || state.syndicates === undefined || !state.contributors) {
    if (!state.accountsLoading) {
      state.accountsLoading = true;
      Promise.all([api('/api/admin/owners'), api('/api/admin/syndicates'), api('/api/admin/contributors')])
        .then(([o, s, c]) => { state.owners = o.owners; state.syndicates = s.syndicates; state.contributors = c.contributors; })
        .catch((e) => {
          state.owners = state.owners || [];
          state.syndicates = state.syndicates || [];
          state.contributors = state.contributors || [];
          setMessage('error', e.message);
        })
        .finally(() => { state.accountsLoading = false; render(); });
    }
    return h('p', { class: 'soft' }, 'Loading bus owners…');
  }
  const name = h('input', { required: true, autocomplete: 'off', maxlength: '80', placeholder: 'For example Sen Transport' });
  const phone = h('input', { type: 'tel', required: true, autocomplete: 'off', maxlength: '20', placeholder: '98300 12345' });
  const approved = state.owners.filter((o) => !o.pending);
  return h('div', {},
    state.tempPassword ? tempPasswordView() : null,
    waitingView(),
    h('h2', {}, approved.length === 1 ? '1 bus owner' : `${approved.length} bus owners`),
    h('p', { class: 'soft' }, `Owners see where their buses are and the trips they run, on their own page. They sign in at ${signInPage()} with their mobile number and a password: they sign up there, or you add them here with a temporary password. Their staff sign up there with the owner’s number: you approve managers; owners approve their own conductors, who then only type a bus’s number plate when they share it.`),
    h('form', { onsubmit: (e) => { e.preventDefault(); void addOwner(name.value, phone.value); } },
      field('Owner’s name', name, 'A person or a company, as they would like to see it.'),
      field('Owner’s mobile number', phone, 'They sign in with it.'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Add owner')),
    approved.length
      ? h('ul', { class: 'list', 'aria-label': 'Bus owners' }, approved.map((o) => h('li', { class: 'entry' },
          h('div', { class: 'name' }, o.name),
          h('div', { class: 'meta' }, o.buses.length
            ? `${o.buses.length === 1 ? '1 bus' : `${o.buses.length} buses`}: ${o.buses.map((b) => b.plate).join(', ')}`
            : 'No buses yet'),
          h('ul', { class: 'people-list', 'aria-label': `People who sign in for ${o.name}` }, o.people.filter((p) => !p.pending).map((p) => h('li', {},
            h('span', { class: 'grow' }, h('span', { class: 'person-name' }, `${p.name} (${(KIND_WORDS[p.role] || 'staff').toLowerCase()})`), h('span', { class: 'meta' }, loginLine(p))),
            h('button', { class: 'btn small', type: 'button', onclick: () => void newPassword(`${personPath(o, p)}/password`, p.name, p.phone) }, 'New password'),
            p.role !== 'owner' ? h('button', { class: 'btn small danger', type: 'button', onclick: () => void removePerson(o, p) }, 'Remove') : null))),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => void renameOwner(o) }, 'Rename'),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeOwner(o, false) }, `Remove ${o.name}`)))))
      : h('p', { class: 'soft' }, 'No bus owners yet.'),
    syndicatesView(),
    contributorsView());
}

// ---------- contributors ----------

const contributorPath = (c) => `/api/admin/contributors/${encodeURIComponent(c.id)}`;

/** People who record routes from inside buses with the phone app. Their recordings come to "Record a route". */
function contributorsView() {
  const list = state.contributors || [];
  return h('section', {},
    h('h2', {}, 'Contributors'),
    h('p', { class: 'soft' }, 'Contributors record routes from inside buses with the phone app, marking each stop as the bus reaches it. They sign up on the sign-in page and you approve them. Their recordings come to “Record a route”, where you check them and use them for a route; nothing changes for riders before that.'),
    list.length
      ? h('ul', { class: 'list', 'aria-label': 'Contributors' }, list.map((c) => h('li', { class: 'entry' },
          h('div', { class: 'name' }, c.name, c.pending ? h('span', { class: 'chip warn' }, 'Waiting') : null),
          h('div', { class: 'meta' }, [
            loginLine(c),
            c.recordings ? count(c.recordings, 'recording', 'recordings') : 'no recordings yet',
            `signed up ${since(c.createdAt)}`,
          ].join(' · ')),
          h('div', { class: 'row' },
            c.pending ? h('button', { class: 'btn small primary', type: 'button', onclick: () => void approveContributor(c) }, `Approve ${c.name}`) : null,
            h('button', { class: 'btn small', type: 'button', onclick: () => void newPassword(`${contributorPath(c)}/password`, c.name, c.phone) }, 'New password'),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeContributor(c) }, c.pending ? 'Turn down' : 'Remove')))))
      : h('p', { class: 'soft' }, 'No contributors yet.'));
}

async function approveContributor(c) {
  try {
    await api(`${contributorPath(c)}/approve`, { method: 'POST' });
    accountsChanged();
    setMessage('ok', `Approved ${c.name}. They can sign in on the phone app now and record routes.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function removeContributor(c) {
  const question = c.pending
    ? `Turn down ${c.name}? Their sign-up is removed.`
    : `Remove ${c.name}? They can no longer sign in or record routes. Their recordings so far stay.`;
  if (!confirm(question)) return;
  try {
    await api(contributorPath(c), { method: 'DELETE' });
    accountsChanged();
    setMessage('ok', c.pending ? `Turned down ${c.name}.` : `Removed ${c.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

// ---------- route syndicates ----------

/** A syndicate's read-only view of its members' buses on its routes; one person signs in for it. */
function syndicatesView() {
  const f = state.syndicateForm;
  const shown = state.syndicates.filter((s) => !s.pending);
  return h('section', {},
    h('hr', { class: 'divider' }),
    h('h2', {}, 'Route syndicates'),
    h('p', { class: 'soft' }, 'A syndicate sees its members’ buses on its routes, and their trips: read-only. One person signs in for it, with their mobile number and a password.'),
    shown.length
      ? h('ul', { class: 'list', 'aria-label': 'Route syndicates' }, shown.map((s) => h('li', { class: 'entry' },
          h('div', { class: 'name' }, s.name),
          h('div', { class: 'meta' }, `Routes ${s.routeIds.map((id) => (state.network.routes.find((r) => r.id === id) || { number: id }).number).join(', ')}`),
          h('div', { class: 'meta' }, `Members: ${s.ownerIds.map((id) => (state.owners.find((o) => o.id === id) || { name: id }).name).join(', ') || 'none'}`),
          h('div', { class: 'meta' }, `Signs in: ${s.contactName ? `${s.contactName}, ` : ''}${loginLine(s)}`),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { state.syndicateForm = { id: s.id, name: s.name, routeIds: new Set(s.routeIds), ownerIds: new Set(s.ownerIds) }; render(); } }, 'Change'),
            h('button', { class: 'btn small', type: 'button', onclick: () => void newPassword(`/api/admin/syndicates/${encodeURIComponent(s.id)}/password`, s.contactName || s.name, s.phone) }, 'New password'),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => void removeSyndicate(s, false) }, 'Remove')))))
      : h('p', { class: 'soft' }, 'No syndicates yet.'),
    f ? syndicateForm(f) : h('button', { class: 'btn', type: 'button', onclick: () => { state.syndicateForm = { id: '', name: '', routeIds: new Set(), ownerIds: new Set(), contactName: '', phone: '' }; render(); } }, 'Add a syndicate'));
}

function checkList(label, items, chosen) {
  return h('fieldset', { class: 'checks' },
    h('legend', {}, label),
    items.map(([id, text]) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: chosen.has(id), onchange: (e) => { if (e.target.checked) chosen.add(id); else chosen.delete(id); } }),
      text)));
}

function syndicateForm(f) {
  const name = h('input', { value: f.name, required: true, maxlength: '80', placeholder: 'For example Route 12C/2 syndicate', oninput: (e) => { f.name = e.target.value; } });
  const routes = [...state.network.routes]
    .filter((r) => (r.mode || 'bus') === 'bus')
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const isNew = !f.id;
  const contact = isNew ? h('input', { value: f.contactName, required: true, maxlength: '60', placeholder: 'For example Bijoy Saha', oninput: (e) => { f.contactName = e.target.value; } }) : null;
  const phone = isNew ? h('input', { type: 'tel', value: f.phone, required: true, maxlength: '20', placeholder: '98300 12345', oninput: (e) => { f.phone = e.target.value; } }) : null;
  return h('form', { class: 'card-form', onsubmit: (e) => { e.preventDefault(); void saveSyndicate(f); } },
    h('h3', {}, f.approve ? `Approve ${f.name}` : isNew ? 'New syndicate' : `Change ${f.name}`),
    f.approve ? h('p', { class: 'hint' }, 'Choose the routes and the member owners whose buses it sees.') : null,
    field('Name', name),
    checkList('Its routes', routes.map((r) => [r.id, `${r.number}${r.name ? ` (${r.name})` : ''}`]), f.routeIds),
    checkList('Its members', state.owners.filter((o) => !o.pending).map((o) => [o.id, o.name]), f.ownerIds),
    isNew ? field('Who signs in for it', contact) : null,
    isNew ? field('Their mobile number', phone, 'They sign in with it, with a temporary password at first.') : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, f.approve ? 'Approve' : isNew ? 'Add syndicate' : 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.syndicateForm = null; render(); } }, 'Cancel')));
}

async function saveSyndicate(f) {
  const body = { name: f.name, routeIds: [...f.routeIds], ownerIds: [...f.ownerIds] };
  try {
    if (f.approve) {
      await api(`/api/admin/syndicates/${encodeURIComponent(f.id)}/approve`, { method: 'POST', body });
      setMessage('ok', `Approved ${f.name}. It can sign in now.`);
    } else if (f.id) {
      await api(`/api/admin/syndicates/${encodeURIComponent(f.id)}`, { method: 'PUT', body });
      setMessage('ok', `Saved ${f.name}.`);
    } else {
      const r = await api('/api/admin/syndicates', { method: 'POST', body: { ...body, contactName: f.contactName, phone: f.phone } });
      state.tempPassword = { name: `${r.syndicate.contactName} (${r.syndicate.name})`, phone: r.syndicate.phone, password: r.password };
      setMessage(null);
    }
    state.syndicateForm = null;
    accountsChanged();
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

async function removeSyndicate(s, pending) {
  const question = pending ? `Turn down ${s.name}? Its sign-up is removed.` : `Remove ${s.name}? It can no longer sign in. Its members and their buses stay.`;
  if (!confirm(question)) return;
  try {
    await api(`/api/admin/syndicates/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    accountsChanged();
    setMessage('ok', pending ? `Turned down ${s.name}.` : `Removed ${s.name}.`);
  } catch (e) {
    setMessage('error', e.message);
  }
  render();
}

function dataView() {
  const n = state.network;
  const patterns = n.routes.reduce((sum, r) => sum + r.patterns.length, 0);
  const file = h('input', { type: 'file', accept: 'application/json,.json' });
  return h('div', {},
    h('h2', {}, `Network version ${n.version}`),
    h('p', { class: 'soft' }, `${n.stops.length} stops, ${n.routes.length} routes, ${patterns} directions. Last changed ${new Date(n.updatedAt).toLocaleString()}.`),
    n.notice ? h('div', { class: 'msg' }, n.notice) : null,
    h('h3', {}, 'Export'),
    h('p', { class: 'soft' }, 'Download everything as one JSON file, for backups or to edit in bulk.'),
    h('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        const blob = new Blob([JSON.stringify(n, null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `network-v${n.version}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    }, 'Download network file'),
    h('p', { class: 'soft' }, 'The same network as a GTFS feed, the format journey planners and map apps read. Anyone can download it from /api/gtfs.zip. Buses have no timetable, so trips are given by how often they come, with travel times learned from tracked buses where known.'),
    h('a', { class: 'btn', href: '/api/gtfs.zip', download: `gtfs-v${n.version}.zip` }, 'Download GTFS feed'),
    h('h3', {}, 'Import'),
    h('p', { class: 'soft' }, 'Replace the whole network with a file. It is checked first, and nothing changes if it has problems.'),
    field('Network file', file),
    h('button', {
      class: 'btn primary', type: 'button',
      onclick: async () => {
        const f = file.files && file.files[0];
        if (!f) { setMessage('error', 'Choose a network file first.'); render(); return; }
        if (!confirm('Replace the whole network with this file?')) return;
        try {
          const body = JSON.parse(await f.text());
          const r = await api('/api/admin/network', { method: 'PUT', body });
          await loadNetwork();
          setMessage('ok', `Imported. The network is now version ${r.version}.`);
          fitToStops();
        } catch (e) {
          setMessage('error', e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message, e.details);
        }
        render();
      },
    }, 'Replace network'));
}

// ---------- icons, sign-in and the side nav ----------

/** An icon as inline SVG, built with DOM methods. Decoration: the text beside it says what it means. */
function svgIcon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  for (const [tag, a] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** The token stays for this browser tab, so a reload keeps the admin signed in; closing the tab forgets it. */
function storedToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORE) || '';
  } catch {
    return '';
  }
}

function keepToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORE, token);
    else sessionStorage.removeItem(TOKEN_STORE);
  } catch {
    // Storage switched off: the admin signs in again after a reload.
  }
}

/** Collapsed to icons when chosen so, and at first on narrow screens. */
function navStartsCollapsed() {
  try {
    const v = localStorage.getItem(NAV_STORE);
    if (v) return v === 'collapsed';
  } catch {
    // No saved choice.
  }
  return window.matchMedia('(max-width: 900px)').matches;
}

const narrow = () => window.matchMedia('(max-width: 900px)').matches;

function setNavCollapsed(collapsed) {
  state.navCollapsed = collapsed;
  try {
    localStorage.setItem(NAV_STORE, collapsed ? 'collapsed' : 'open');
  } catch {
    // The choice lasts until the page is reloaded.
  }
  render();
  // The map's box changed size.
  requestAnimationFrame(() => {
    if (map) map.invalidateSize();
    if (dashMap) dashMap.invalidateSize();
  });
}

function selectTab(id) {
  const fromDashboard = state.tab === 'dashboard';
  state.tab = id;
  state.mode = 'idle';
  state.newStopAt = null;
  if (id === 'alerts') state.alerts = null;
  if (id === 'owners') {
    state.owners = null;
    state.syndicates = null;
    state.contributors = null;
    state.syndicateForm = null;
  }
  if (id === 'suggestions') state.suggestions = null;
  if (id === 'record') state.recordings = null;
  if (id === 'accuracy') state.accuracy = null;
  if (id === 'dashboard') void loadDashboard();
  state.tempPassword = null;
  setMessage(null);
  // On a narrow screen the open menu covers the page: close it once a part is chosen.
  if (narrow() && !state.navCollapsed) state.navCollapsed = true;
  render();
  if (fromDashboard && id !== 'dashboard' && map) {
    // The main map was hidden behind the dashboard: it learns its size again, and fits the stops once.
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (!state.mapFitted) {
        state.mapFitted = true;
        fitToStops();
      }
    });
  }
}

function signOut() {
  state.token = '';
  keepToken('');
  state.tab = 'dashboard';
  state.dashboard = null;
  state.stopDraft = null;
  state.routeDraft = null;
  state.mode = 'idle';
  setMessage(null);
  render();
}

function renderNav() {
  const d = state.dashboard;
  // What waits for the admin, as a count beside the part of the panel that deals with it.
  const waiting = d ? { suggestions: d.suggestions, owners: d.owners.waiting.length, alerts: d.live.possibleDiversions } : {};
  const tip = (label) => (state.navCollapsed ? label : null);
  document.getElementById('nav-items').replaceChildren(...(state.token ? NAV : []).map(([id, label, iconName]) => {
    const count = waiting[id] || 0;
    return h('li', {},
      h('button', {
        class: 'nav-item', type: 'button',
        'aria-current': state.tab === id ? 'page' : null,
        'aria-label': count ? `${label}, ${count} waiting` : label,
        title: tip(label),
        'data-focus': `nav-${id}`,
        onclick: () => selectTab(id),
      }, svgIcon(iconName), h('span', { class: 'label' }, label), count ? h('span', { class: 'badge', 'aria-hidden': 'true' }, String(count)) : null));
  }));
  document.getElementById('nav-foot').replaceChildren(
    h('a', { class: 'nav-item', href: '/', 'aria-label': 'Rider app', title: tip('Rider app'), 'data-focus': 'nav-rider-app' }, svgIcon('map'), h('span', { class: 'label' }, 'Rider app')),
    h('a', { class: 'nav-item', href: '/owner', 'aria-label': 'Owners’ page', title: tip('Owners’ page'), 'data-focus': 'nav-owners-page' }, svgIcon('user-round'), h('span', { class: 'label' }, 'Owners’ page')),
    state.token
      ? h('button', { class: 'nav-item', type: 'button', 'aria-label': 'Sign out', title: tip('Sign out'), 'data-focus': 'nav-sign-out', onclick: signOut }, svgIcon('log-out'), h('span', { class: 'label' }, 'Sign out'))
      : null);
  const toggle = document.getElementById('nav-toggle');
  toggle.replaceChildren(svgIcon(state.navCollapsed ? 'panel-left-open' : 'panel-left-close'));
  toggle.setAttribute('aria-expanded', String(!state.navCollapsed));
  toggle.setAttribute('aria-label', state.navCollapsed ? 'Show the menu' : 'Hide the menu');
  toggle.title = state.navCollapsed ? 'Show the menu' : 'Hide the menu';
}

// ---------- dashboard ----------

let dashMap = null;
let dashMapEl = null;
/** The dashboard's "Show as a table" sections left open, so a refresh does not close them. */
const openTables = new Set();

function asTable(key, ...table) {
  return h('details', {
    class: 'as-table',
    open: openTables.has(key),
    ontoggle: (e) => {
      if (e.currentTarget.open) openTables.add(key);
      else openTables.delete(key);
    },
  }, h('summary', { 'data-focus': `table-${key}` }, 'Show as a table'), ...table);
}
let dashLayer = null;
let dashTimer = null;
let dashLoading = null;

function loadDashboard() {
  if (!state.token) return Promise.resolve();
  if (!dashLoading) {
    dashLoading = api('/api/admin/dashboard')
      .then((d) => { state.dashboard = d; state.dashboardError = null; }, (e) => { state.dashboardError = e.message; })
      .finally(() => { dashLoading = null; render(); });
  }
  return dashLoading;
}

/** While the dashboard is open, it is fetched again every 15 seconds; the last numbers stay meanwhile. */
function watchDashboard() {
  if (dashTimer) return;
  dashTimer = setInterval(() => {
    if (state.token && state.tab === 'dashboard' && document.visibilityState === 'visible') void loadDashboard();
  }, DASHBOARD_REFRESH_MS);
}

const MODE_WORDS = { bus: ['bus route', 'bus routes'], metro: ['Metro line', 'Metro lines'], train: ['train line', 'train lines'], ferry: ['ferry', 'ferries'] };
const count = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const clockAt = (ts) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(ts));

function tile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('p', { class: 'tile-label' }, label),
    h('p', { class: 'tile-value' }, typeof value === 'number' ? value.toLocaleString('en-IN') : value),
    sub ? h('p', { class: 'tile-sub' }, sub) : null);
}

function card(title, ...body) {
  const wide = body.length && body[body.length - 1] === 'wide';
  return h('section', { class: wide ? 'card wide' : 'card' }, h('h3', {}, title), ...(wide ? body.slice(0, -1) : body));
}

function dashboardView() {
  const d = state.dashboard;
  if (!d) {
    if (!dashLoading) void loadDashboard();
    return h('p', { class: 'soft' }, state.dashboardError || 'Loading the dashboard…');
  }
  watchDashboard();
  const n = d.network;
  const modes = Object.entries(n.modes).filter(([, c]) => c).map(([m, c]) => count(c, ...MODE_WORDS[m])).join(', ');
  const byRiders = d.live.buses - d.live.byConductors;
  return h('div', { class: 'dash' },
    h('div', { class: 'dash-head' },
      h('h2', {}, 'Dashboard'),
      h('p', { class: 'soft' }, `${n.region} · network version ${n.version} · updated ${clockAt(d.at)}`)),
    h('div', { class: 'tiles' },
      tile('Buses on the road', d.live.buses, d.live.buses ? `${d.live.byConductors} by conductors, ${byRiders} by riders` : 'None tracked right now'),
      tile('Phones sharing', d.live.sharing, 'Riders and conductors'),
      tile('Owners’ trips today', d.today.trips, `${count(d.today.busesRan, 'bus', 'buses')} · ${d.today.km} km · ${d.today.wholeRoute} end to end`),
      tile('Routes', n.routes, `${count(n.directions, 'direction', 'directions')} · ${modes || 'none yet'}`),
      tile('Stops', n.stops, count(n.landmarks, 'landmark', 'landmarks')),
      tile('Bus owners', d.owners.owners, `${count(d.owners.buses, 'bus', 'buses')} · ${count(d.owners.syndicates, 'syndicate', 'syndicates')}`)),
    h('div', { class: 'dash-grid' },
      card('Buses on the road now', liveMapBlock(d), liveByRoute(d), 'wide'),
      card('Things to look at', attentionList(d)),
      card('Owners’ trips today, by the hour they started', hourChart(d.today.byHour)),
      card('Arrival times, last 7 days', accuracyBlock(d.accuracy)),
      card('The network', networkDetails(d))));
}

function liveMapBlock(d) {
  if (!dashMapEl) dashMapEl = h('div', { class: 'dash-map', role: 'region', 'aria-label': 'Map of the buses on the road now' });
  requestAnimationFrame(() => drawDashMap(d));
  return dashMapEl;
}

function drawDashMap(d) {
  if (!window.L || !dashMapEl.isConnected) return;
  if (!dashMap) {
    dashMap = L.map(dashMapEl);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(dashMap);
    dashLayer = L.layerGroup().addTo(dashMap);
    const stops = state.network.stops.map((s) => [s.lat, s.lng]);
    if (stops.length) dashMap.fitBounds(stops, { padding: [24, 24] });
    else dashMap.setView([22.55, 88.37], 12);
  }
  dashMap.invalidateSize();
  dashLayer.clearLayers();
  for (const s of state.network.stops) {
    L.circleMarker([s.lat, s.lng], { radius: 3, color: cssVar('--ink-soft'), weight: 1, fillColor: cssVar('--surface'), fillOpacity: 1, interactive: false }).addTo(dashLayer);
  }
  for (const v of d.live.vehicles) {
    const label = `${v.routeNumber} towards ${v.headsign}, shared by ${v.source === 'conductor' ? 'the conductor' : 'riders'}, ${v.lastSeenSec} s ago`;
    const pin = h('span', { class: 'bus-pin' }, board({ number: v.routeNumber, operator: v.operator, mode: 'bus' }));
    pin.firstChild.classList.add('sm');
    L.marker([v.lat, v.lng], { icon: L.divIcon({ html: pin, className: 'bus-icon', iconSize: null }), title: label, alt: label, keyboard: false }).addTo(dashLayer);
  }
}

function liveByRoute(d) {
  if (!d.live.routes.length) {
    return h('p', { class: 'soft' }, 'No bus is being tracked right now. Buses appear here as soon as a conductor or a rider shares one.');
  }
  return h('ul', { class: 'list compact' }, d.live.routes.map((r) => h('li', { class: 'route-row' },
    board({ number: r.routeNumber, operator: r.operator, mode: 'bus' }),
    h('span', { class: 'grow' }, count(r.buses, 'bus', 'buses')),
    h('span', { class: 'soft' }, r.byConductors === r.buses ? 'all by conductors' : r.byConductors ? `${r.byConductors} by conductors` : 'by riders'))));
}

function attentionList(d) {
  const n = d.network;
  const items = [];
  const go = (tab, label) => h('button', { class: 'link', type: 'button', 'data-focus': `go-${tab}`, onclick: () => selectTab(tab) }, label);
  if (d.owners.waiting.length) {
    const who = (w) =>
      w.kind === 'manager' ? `${w.name} (manager for ${w.of})`
        : w.kind === 'conductor' ? `${w.name} (conductor for ${w.of})`
          : `${w.name} (${w.kind === 'syndicate' ? 'route syndicate' : w.kind === 'contributor' ? 'contributor' : 'bus owner'})`;
    items.push([`${count(d.owners.waiting.length, 'account waits', 'accounts wait')} for you to approve: ${d.owners.waiting.map(who).join(', ')}.`, go('owners', 'Bus owners')]);
  }
  if (d.suggestions) items.push([`${count(d.suggestions, 'suggestion', 'suggestions')} from riders to read.`, go('suggestions', 'Suggestions')]);
  if (d.live.possibleDiversions) items.push([`${count(d.live.possibleDiversions, 'possible diversion', 'possible diversions')}: riders left a route at the same place.`, go('alerts', 'Diversions')]);
  for (const a of d.today.alerts.slice(0, 5)) {
    const what = a.kind === 'quiet' ? 'has sent no position for a while' : a.ended === 'no_signal' ? 'lost its signal' : 'stopped sharing';
    items.push([`${a.plate} on ${a.routeNumber} ${what} at ${clockAt(a.at)}, after ${a.afterStop} (${a.stops} of ${a.stopCount} stops).`, null]);
  }
  if (n.unusedStops.count) {
    items.push([`${count(n.unusedStops.count, 'stop is', 'stops are')} on no route: ${n.unusedStops.first.map((s) => s.name).join(', ')}${n.unusedStops.count > n.unusedStops.first.length ? '…' : ''}`, go('stops', 'Stops')]);
  }
  const noPath = n.directions - n.roadPaths;
  if (noPath) items.push([`${count(noPath, 'direction has', 'directions have')} no road path yet, so arrival times there are rougher.`, go('routes', 'Routes')]);
  if (!items.length) return h('p', { class: 'all-good' }, 'Nothing needs looking at right now.');
  return h('ul', { class: 'attention' }, items.map(([text, action]) => h('li', {}, h('span', { class: 'grow' }, text), action)));
}

/** A whole number at or above x that reads well on an axis: 1, 2, 5, 10, 20, 50… */
function niceCeil(x) {
  if (x <= 5) return Math.max(1, Math.ceil(x));
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** One series of columns, one per hour: 4px rounded tops, a 2px gap, a hairline grid; values on hover and in a table. */
function hourChart(byHour) {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return h('p', { class: 'soft' }, 'No trips by owners’ buses yet today.');
  const W = 560;
  const H = 190;
  const m = { top: 10, right: 6, bottom: 24, left: 30 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const max = niceCeil(Math.max(...byHour));
  const slot = plotW / 24;
  const barW = Math.min(24, slot - 2);
  const y = (v) => m.top + plotH - (v / max) * plotH;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Owners’ trips today by the hour they started: ${total} in all. The table below has every hour.` });
  // Trips are counted, so the grid has whole numbers only.
  for (const t of [0, max / 2, max].filter((v, i, a) => Number.isInteger(v) && a.indexOf(v) === i)) {
    svg.append(svgEl('line', { x1: m.left, x2: W - m.right, y1: y(t), y2: y(t), class: 'grid' }));
    const label = svgEl('text', { x: m.left - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = Number.isInteger(t) ? String(t) : t.toFixed(1);
    svg.append(label);
  }
  const wrap = h('div', { class: 'chart-wrap' });
  const tipEl = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  byHour.forEach((v, hr) => {
    const x = m.left + hr * slot + (slot - barW) / 2;
    let bar = null;
    if (v > 0) {
      const top = y(v);
      const r = Math.min(4, barW / 2, m.top + plotH - top);
      const base = m.top + plotH;
      bar = svgEl('path', { d: `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`, class: 'bar' });
      svg.append(bar);
    }
    if (hr % 3 === 0) {
      const label = svgEl('text', { x: m.left + hr * slot + slot / 2, y: H - 6, class: 'tick', 'text-anchor': 'middle' });
      label.textContent = String(hr).padStart(2, '0');
      svg.append(label);
    }
    // The hit area is the whole hour, not only the painted bar.
    const span = `${String(hr).padStart(2, '0')}:00–${String((hr + 1) % 24).padStart(2, '0')}:00`;
    const hit = svgEl('rect', { x: m.left + hr * slot, y: m.top, width: slot, height: plotH, class: 'hit', tabindex: 0, 'data-focus': `hour-${hr}`, 'aria-label': `${span}: ${v} ${v === 1 ? 'trip' : 'trips'}` });
    const show = () => {
      tipEl.replaceChildren(h('strong', {}, `${v} ${v === 1 ? 'trip' : 'trips'}`), h('span', {}, span));
      tipEl.hidden = false;
      tipEl.style.left = `${((m.left + hr * slot + slot / 2) / W) * 100}%`;
      if (bar) bar.classList.add('hover');
    };
    const hide = () => {
      tipEl.hidden = true;
      if (bar) bar.classList.remove('hover');
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    svg.append(hit);
  });
  svg.append(svgEl('line', { x1: m.left, x2: W - m.right, y1: m.top + plotH, y2: m.top + plotH, class: 'axis' }));
  wrap.append(svg, tipEl);
  const rows = byHour.map((v, hr) => [hr, v]).filter(([, v]) => v);
  return [
    wrap,
    asTable('hours',
      h('table', { class: 'acc' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Hour'), h('th', { scope: 'col' }, 'Trips'))),
        h('tbody', {}, rows.map(([hr, v]) => h('tr', {}, h('td', {}, `${String(hr).padStart(2, '0')}:00–${String((hr + 1) % 24).padStart(2, '0')}:00`), h('td', {}, String(v))))))),
  ];
}

/** Each route's typical error 10 minutes ahead, as bars with the value at the tip; the rest in a table. */
function accuracyBlock(routes) {
  if (!routes.length) {
    return h('p', { class: 'soft' }, 'Nothing yet: this fills in as conductors’ buses reach stops their arrival time was given for.');
  }
  const rows = [...routes].filter((r) => r.typicalErrorMin !== null).sort((a, b) => a.typicalErrorMin - b.typicalErrorMin);
  const max = Math.max(1, ...rows.map((r) => r.typicalErrorMin));
  return [
    h('p', { class: 'hint' }, 'How far off the arrival time was 10 minutes before the bus came, typically. Shorter is better.'),
    h('ul', { class: 'hbars' }, rows.map((r) => {
      const bar = h('span', { class: 'hbar' });
      bar.style.width = `${Math.max(2, Math.round((r.typicalErrorMin / max) * 100))}%`;
      return h('li', {},
        h('span', { class: 'hbar-label' }, r.routeNumber),
        h('span', { class: 'hbar-track' }, bar),
        h('span', { class: 'hbar-value' }, `${r.typicalErrorMin.toFixed(1)} min`));
    })),
    asTable('accuracy',
      h('table', { class: 'acc' },
        h('thead', {}, h('tr', {}, ['Route', 'Typical error', 'Within 2 min', 'Late on average', 'Predictions'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, r.routeNumber),
          h('td', {}, `${r.typicalErrorMin.toFixed(1)} min`),
          h('td', {}, r.within2MinShare === null ? '–' : `${Math.round(r.within2MinShare * 100)}%`),
          h('td', {}, r.lateBiasMin === null ? '–' : `${r.lateBiasMin.toFixed(1)} min`),
          h('td', {}, String(r.predictions))))))),
  ];
}

function networkDetails(d) {
  const n = d.network;
  const rows = [
    ['Region', n.region],
    ['Version', `${n.version}, changed ${new Date(n.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`],
    ['Routes', Object.entries(n.modes).filter(([, c]) => c).map(([mode, c]) => count(c, ...MODE_WORDS[mode])).join(', ') || 'none yet'],
    ['Directions', `${n.directions}, ${n.roadPaths} with a road path`],
    ['Stops and landmarks', `${n.stops} stops, ${n.landmarks} landmarks`],
    ['Learned travel times', count(n.learnedStretchHours, 'stretch-hour', 'stretch-hours')],
    ['People signing in for owners', String(d.owners.people)],
  ];
  return h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

// ---------- adding a stop while building a direction ----------

/**
 * Building a direction: a click near a stop adds that stop (the circles are small, so near counts),
 * and a click where there is no stop yet puts a new stop there, named in the panel.
 */
function pickAt(latlng) {
  const at = map.latLngToContainerPoint(latlng);
  let nearest = null;
  for (const s of state.network.stops) {
    const px = at.distanceTo(map.latLngToContainerPoint([s.lat, s.lng]));
    if (px <= 18 && (!nearest || px < nearest.px)) nearest = { id: s.id, px };
  }
  if (nearest) {
    onStopClick(nearest.id);
    return;
  }
  state.newStopAt = { lat: round6(latlng.lat), lng: round6(latlng.lng) };
  render();
  const input = document.getElementById('new-stop-name');
  if (input) input.focus();
}

function newStopForm(p) {
  const at = state.newStopAt;
  const name = h('input', { id: 'new-stop-name', required: true, maxlength: '80', autocomplete: 'off', placeholder: 'For example Sodepur More' });
  const nameBn = h('input', { maxlength: '80', autocomplete: 'off', lang: 'bn', placeholder: 'বাংলায় নাম' });
  return h('form', { class: 'card-form', onsubmit: (e) => { e.preventDefault(); void addStopHere(p, at, name.value, nameBn.value); } },
    h('p', { class: 'strong-line' }, 'A new stop where you clicked'),
    h('p', { class: 'hint' }, `At ${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}. It is saved as a stop and added to this direction after its last stop.`),
    field('Stop name', name),
    field('Name in Bengali (optional)', nameBn),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Add this stop'),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.newStopAt = null; render(); } }, 'Cancel')));
}

async function addStopHere(p, at, name, nameBn) {
  const clean = name.trim();
  if (!clean) {
    setMessage('error', 'Give the stop a name.');
    render();
    return;
  }
  const id = uniqueId(slug(clean) || 'stop', state.network.stops.map((s) => s.id));
  try {
    const r = await api(`/api/admin/stops/${encodeURIComponent(id)}`, { method: 'PUT', body: { name: clean, nameBn: nameBn.trim(), aliases: [], lat: at.lat, lng: at.lng } });
    await loadNetwork();
    p.stopIds.push(id);
    p.shape = undefined; // the old road path no longer matches the stops
    state.newStopAt = null;
    setMessage('ok', `Added the stop ${clean} (network version ${r.version}) and put it in this direction. Save the route to keep the direction.`);
  } catch (e) {
    setMessage('error', e.message, e.details);
  }
  render();
}

// ---------- shell ----------

function render() {
  // The dashboard is rebuilt every 15 seconds: the keyboard focus goes back where it was.
  const active = document.activeElement;
  const focusKey = active instanceof Element ? active.getAttribute('data-focus') : null;
  const n = state.network;
  document.getElementById('subtitle').textContent = n ? `${n.region} · network version ${n.version}` : 'Route admin';
  renderNav();
  const app = document.getElementById('app');
  const dashboard = Boolean(state.token && n && state.tab === 'dashboard');
  app.classList.toggle('wide', dashboard);
  app.classList.toggle('nav-collapsed', state.navCollapsed);

  const panel = document.getElementById('panel');
  let view;
  if (!state.token) view = loginView();
  else if (!n) view = h('p', { class: 'soft' }, 'Loading the network…');
  else if (state.tab === 'dashboard') view = dashboardView();
  else if (state.tab === 'stops') view = state.stopDraft ? stopEditorView() : stopListView();
  else if (state.tab === 'routes') view = state.routeDraft ? routeEditorView() : routeListView();
  else if (state.tab === 'alerts') view = alertsView();
  else if (state.tab === 'owners') view = ownersView();
  else if (state.tab === 'suggestions') view = suggestionsView();
  else if (state.tab === 'record') view = recordView();
  else if (state.tab === 'accuracy') view = accuracyView();
  else view = dataView();
  panel.replaceChildren(...[messageView(), view].filter(Boolean));
  if (!dashboard) drawMap();
  if (focusKey && !active.isConnected) {
    const again = document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.mode !== 'idle') {
    state.mode = 'idle';
    state.newStopAt = null;
    render();
  } else if (e.key === 'Escape' && narrow() && !state.navCollapsed) {
    setNavCollapsed(true);
  }
});

document.getElementById('nav-toggle').addEventListener('click', () => setNavCollapsed(!state.navCollapsed));
// On a narrow screen the open menu lies over the page: a tap beside it closes it.
document.addEventListener('pointerdown', (e) => {
  if (narrow() && !state.navCollapsed && !e.target.closest('.nav')) setNavCollapsed(true);
});

initMap();
render();
loadNetwork()
  .then(async () => {
    // A token kept from earlier in this tab is checked again; a replaced one signs the admin out.
    if (state.token) {
      try {
        const r = await api('/api/admin/whoami');
        state.roadSnapping = !!r.roadSnapping;
        void loadDashboard();
      } catch {
        state.token = '';
        keepToken('');
      }
    }
    render();
    if (state.tab !== 'dashboard' || !state.token) {
      state.mapFitted = true;
      fitToStops();
    }
  })
  .catch((e) => { setMessage('error', `Could not load the network: ${e.message}`); render(); });
