import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import type { TravelTable } from '../core';

// Learned travel times for this hour (core learn.ts), kept on the phone so planning offline uses
// the last ones too. The web app does the same (web/src/app.ts).

const KEY = 'wimb.travel.v1';

export async function loadTravelTimes(): Promise<TravelTable | null> {
  try {
    const table = await api.travelTimes();
    await AsyncStorage.setItem(KEY, JSON.stringify(table)).catch(() => undefined);
    return table;
  } catch {
    try {
      return JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as TravelTable | null;
    } catch {
      return null;
    }
  }
}
