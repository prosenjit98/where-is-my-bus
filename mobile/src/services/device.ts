import AsyncStorage from '@react-native-async-storage/async-storage';

// A random id for this phone, so two reports of a bus are known to come from two people. It says
// nothing about who the person is, and it is sent only with those reports.

const KEY = 'wimb.device.v1';
let cached: string | null = null;

export async function deviceId(): Promise<string> {
  if (cached) return cached;
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (saved) return (cached = saved);
  // No secret rides on it, so Math.random is enough here.
  const id = Array.from({ length: 3 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('');
  cached = id;
  await AsyncStorage.setItem(KEY, id).catch(() => undefined);
  return id;
}
