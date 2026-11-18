import * as app from './app.ts';
import type { View } from './components.ts';
import { conductorScreen } from './screens/conductor.ts';
import { mapPickScreen } from './screens/mapPick.ts';
import { optionScreen } from './screens/option.ts';
import { planScreen } from './screens/plan.ts';
import { routeScreen } from './screens/route.ts';
import { routesScreen } from './screens/routes.ts';
import { searchScreen } from './screens/search.ts';
import { suggestScreen } from './screens/suggest.ts';
import { tripScreen } from './screens/trip.ts';
import { restoreTrip, subscribeTrip } from './trip.ts';
import { lang } from './i18n.ts';
import { mountNav, updateNav } from './nav.ts';

// Screen readers read the page in its language, and Bengali text gets the Bengali font.
document.documentElement.lang = lang;
const root = document.getElementById('app') as HTMLElement;
mountNav(document.getElementById('layout') as HTMLElement, root);
let current: { screen: app.Screen; view: View } | null = null;
// A conductor who signs in on /signin is sent here, to share their bus: /#conductor.
const openConductor = location.hash === '#conductor';
if (openConductor) history.replaceState({ depth: 0 }, '', location.pathname + location.search);

function mount(s: app.Screen): View {
  switch (s.name) {
    case 'search':
      return searchScreen(s.field);
    case 'map':
      return mapPickScreen(s.field);
    case 'option':
      return optionScreen(s.option);
    case 'trip':
      return tripScreen();
    case 'conductor':
      return conductorScreen();
    case 'routes':
      return routesScreen();
    case 'route':
      return routeScreen(s.routeId);
    case 'suggest':
      return suggestScreen(s);
    default:
      return planScreen();
  }
}

function render() {
  updateNav();
  const s = app.top();
  if (current && current.screen === s) {
    current.view.update?.();
    return;
  }
  current?.view.destroy?.();
  const view = mount(s);
  root.replaceChildren(view.el);
  current = { screen: s, view };
  // Screen readers and keyboards start at the new screen's heading.
  view.el.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

app.subscribe(render);
subscribeTrip(render);
render();

void app.loadNetwork().then(() => {
  // A reload during a trip carries on with it.
  if (app.state.net && restoreTrip(app.state.net)) app.push({ name: 'trip' });
  else if (app.state.net && openConductor) app.push({ name: 'conductor' });
});
// Learned travel times change with the hour.
void app.loadTravelTimes();
setInterval(() => void app.loadTravelTimes(), 10 * 60_000);

// With the service worker, the app opens and plans journeys without internet.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
