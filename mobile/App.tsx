import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountScreen } from './src/screens/AccountScreen';
import { MapPickScreen } from './src/screens/MapPickScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { OptionScreen } from './src/screens/OptionScreen';
import { PlaceSearchScreen } from './src/screens/PlaceSearchScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { RecordScreen } from './src/screens/RecordScreen';
import { RouteScreen } from './src/screens/RouteScreen';
import { RoutesScreen } from './src/screens/RoutesScreen';
import { SuggestScreen } from './src/screens/SuggestScreen';
import { TripScreen } from './src/screens/TripScreen';
import { loadLang, useLang } from './src/i18n';
import { loadAccount } from './src/services/account';
import { restoreRecording } from './src/services/recording';
import { loadTheme, useDark } from './src/theme';
import { AppProvider, useApp } from './src/state/AppState';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemedStatusBar />
      <AppProvider>
        <Router />
      </AppProvider>
    </SafeAreaProvider>
  );
}

// An eleven-screen app does not need a navigation library: a stack in state plus the
// Android back button (handled in AppState) is enough.
void loadLang();
void loadTheme();
void loadAccount();
void restoreRecording();

function ThemedStatusBar() {
  return <StatusBar barStyle={useDark() ? 'light-content' : 'dark-content'} />;
}

function Router() {
  const { screen } = useApp();
  // Every screen is built again in the new language when it changes; the app's state stays.
  const lang = useLang();
  return <React.Fragment key={lang}>{screenFor(screen)}</React.Fragment>;
}

function screenFor(screen: ReturnType<typeof useApp>['screen']) {
  switch (screen.name) {
    case 'search':
      return <PlaceSearchScreen field={screen.field} />;
    case 'map':
      return <MapPickScreen field={screen.field} />;
    case 'option':
      return <OptionScreen option={screen.option} />;
    case 'trip':
      return <TripScreen />;
    case 'suggest':
      return <SuggestScreen routeIds={screen.routeIds} stopId={screen.stopId} kind={screen.kind} text={screen.text} />;
    case 'routes':
      return <RoutesScreen />;
    case 'route':
      return <RouteScreen routeId={screen.routeId} />;
    case 'more':
      return <MoreScreen />;
    case 'account':
      return <AccountScreen mode={screen.mode} />;
    case 'record':
      return <RecordScreen />;
    default:
      return <PlanScreen />;
  }
}
