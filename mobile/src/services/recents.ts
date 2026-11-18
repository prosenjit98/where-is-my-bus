import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Place } from '../state/AppState';

const KEY = 'wimb.recents.v1';

const keyOf = (p: Place) => (p.kind === 'stop' ? `s:${p.stopId}` : `p:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`);

export async function loadRecents(): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Place[]) : [];
  } catch {
    return [];
  }
}

export async function addRecent(place: Place): Promise<void> {
  if (place.kind === 'point' && place.name === 'Your location') return;
  const list = (await loadRecents()).filter((p) => keyOf(p) !== keyOf(place));
  await AsyncStorage.setItem(KEY, JSON.stringify([place, ...list].slice(0, 8))).catch(() => undefined);
}
