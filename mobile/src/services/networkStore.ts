import AsyncStorage from '@react-native-async-storage/async-storage';
import bundledNetwork from '../../../data/demo-network.json';
import { api } from '../api';
import type { Network } from '../core';

export type NetworkSource = 'bundled' | 'saved' | 'server';

const KEY = 'wimb.network.v1';
// Built into the app so route search works on first launch with no internet.
const BUNDLED = bundledNetwork as unknown as Network;

export async function loadLocalNetwork(): Promise<{ network: Network; source: NetworkSource }> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Network;
      if (Array.isArray(saved.stops) && Array.isArray(saved.routes)) return { network: saved, source: 'saved' };
    }
  } catch {
    // A damaged copy is replaced by the built-in one below.
  }
  return { network: BUNDLED, source: 'bundled' };
}

/** Downloads the network only when the server has a different version. */
export async function syncNetwork(currentVersion: number): Promise<{ network?: Network; offline: boolean }> {
  try {
    const res = await api.network(currentVersion);
    if (res === 'unchanged') return { offline: false };
    await AsyncStorage.setItem(KEY, JSON.stringify(res));
    return { network: res, offline: false };
  } catch {
    return { offline: true };
  }
}
