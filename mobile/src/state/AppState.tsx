import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { BackHandler } from 'react-native';
import { prepareNetwork, type Network, type PlanOption, type PreparedNetwork } from '../core';
import { loadLocalNetwork, syncNetwork, type NetworkSource } from '../services/networkStore';
import { getTripSnapshot, restoreTrip, subscribeTrip, type TripSnapshot } from '../services/trip';

export type Place =
  | { kind: 'stop'; stopId: string; name: string }
  | { kind: 'point'; lat: number; lng: number; name: string };

export type Field = 'from' | 'to';

export type Screen =
  | { name: 'plan' }
  | { name: 'search'; field: Field }
  | { name: 'map'; field: Field }
  | { name: 'option'; option: PlanOption }
  | { name: 'trip' }
  | { name: 'suggest'; routeIds?: string[]; stopId?: string; kind?: 'stop' | 'route' | 'times' | 'other'; text?: string }
  | { name: 'routes' }
  | { name: 'route'; routeId: string }
  | { name: 'more' }
  | { name: 'account'; mode: 'signin' | 'conductor' | 'contributor' }
  | { name: 'record' };

export type NetInfo = { version: number; source: NetworkSource; syncing: boolean; offline: boolean };

type AppValue = {
  net: PreparedNetwork | null;
  netInfo: NetInfo | null;
  refreshNetwork: () => Promise<void>;
  from: Place | null;
  to: Place | null;
  setPlace: (field: Field, place: Place) => void;
  swap: () => void;
  screen: Screen;
  push: (s: Screen) => void;
  pop: () => void;
  reset: () => void;
  trip: TripSnapshot;
};

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

const PLACES_KEY = 'wimb.places.v1';

export function AppProvider({ children }: { children: ReactNode }) {
  const [net, setNet] = useState<PreparedNetwork | null>(null);
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null);
  const [places, setPlaces] = useState<{ from: Place | null; to: Place | null }>({ from: null, to: null });
  const [stack, setStack] = useState<Screen[]>([{ name: 'plan' }]);
  const trip = useSyncExternalStore(subscribeTrip, getTripSnapshot);
  const versionRef = useRef(0);
  const restoredTrip = useRef(false);

  const apply = useCallback((network: Network, source: NetworkSource) => {
    versionRef.current = network.version;
    setNet(prepareNetwork(network));
    setNetInfo((info) => ({ version: network.version, source, syncing: info?.syncing ?? false, offline: info?.offline ?? false }));
  }, []);

  const refreshNetwork = useCallback(async () => {
    setNetInfo((info) => (info ? { ...info, syncing: true } : info));
    const r = await syncNetwork(versionRef.current);
    if (r.network) apply(r.network, 'server');
    setNetInfo((info) => (info ? { ...info, syncing: false, offline: r.offline } : info));
  }, [apply]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await loadLocalNetwork();
      if (!alive) return;
      apply(local.network, local.source);
      const saved = await AsyncStorage.getItem(PLACES_KEY).catch(() => null);
      if (saved && alive) {
        try {
          setPlaces(JSON.parse(saved) as { from: Place | null; to: Place | null });
        } catch {
          // Ignore a damaged copy.
        }
      }
      void refreshNetwork();
    })();
    return () => {
      alive = false;
    };
  }, [apply, refreshNetwork]);

  useEffect(() => {
    if (!net || restoredTrip.current) return;
    restoredTrip.current = true;
    void restoreTrip(net).then((active) => {
      if (active) setStack((s) => [...s, { name: 'trip' }]);
    });
  }, [net]);

  const savePlaces = useCallback((next: { from: Place | null; to: Place | null }) => {
    setPlaces(next);
    void AsyncStorage.setItem(PLACES_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const setPlace = useCallback(
    (field: Field, place: Place) => savePlaces({ ...places, [field]: place }),
    [places, savePlaces],
  );
  const swap = useCallback(() => savePlaces({ from: places.to, to: places.from }), [places, savePlaces]);

  const push = useCallback((s: Screen) => setStack((st) => [...st, s]), []);
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);
  const reset = useCallback(() => setStack([{ name: 'plan' }]), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const value = useMemo<AppValue>(
    () => ({
      net,
      netInfo,
      refreshNetwork,
      from: places.from,
      to: places.to,
      setPlace,
      swap,
      screen: stack[stack.length - 1],
      push,
      pop,
      reset,
      trip,
    }),
    [net, netInfo, refreshNetwork, places, setPlace, swap, stack, push, pop, reset, trip],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
