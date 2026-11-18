import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import { CUSTOM_FONTS } from './config';
import type { OperatorType } from './core';

// Kolkata's civic blue, and the painted route boards on its buses: slate boards with yellow
// numbers. Cards on a soft background; the board is the one loud element. The same colours as the
// web app (web/app.css), with dark mode as its own steps of them, not an inversion.
export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  line: string;
  blue: string;
  blueStrong: string;
  blueSoft: string;
  blueInk: string;
  board: string;
  paint: string;
  live: string;
  liveSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  hero: string;
  heroInk: string;
  /** Raised a little (cards) and more (the From and To card, the trip card). */
  shadow1: ViewStyle;
  shadow2: ViewStyle;
  operator: Record<OperatorType, string>;
};

const operator: Record<OperatorType, string> = {
  private: '#F4C430',
  govt: '#5AA9E6',
  mini: '#4CAF7A',
  other: '#A0AAB4',
};

const light: Palette = {
  bg: '#F1F4F8',
  surface: '#FFFFFF',
  surface2: '#F6F8FB',
  ink: '#132033',
  inkSoft: '#586A7E',
  inkFaint: '#8796A8',
  line: '#E0E6EE',
  blue: '#1F66B1',
  blueStrong: '#164F8C',
  blueSoft: '#E6EFFA',
  blueInk: '#FFFFFF',
  board: '#1E2833',
  paint: '#F4C430',
  live: '#137A51',
  liveSoft: '#E1F3EA',
  warn: '#9A6700',
  warnSoft: '#FFF4DB',
  danger: '#C0392B',
  dangerSoft: '#FCEBE9',
  hero: '#1F66B1',
  heroInk: '#FFFFFF',
  shadow1: { boxShadow: '0px 1px 3px rgba(19, 32, 51, 0.10)' },
  shadow2: { boxShadow: '0px 8px 24px rgba(19, 32, 51, 0.14)' },
  operator,
};

const dark: Palette = {
  bg: '#0C1218',
  surface: '#151E28',
  surface2: '#1B2632',
  ink: '#E8EEF4',
  inkSoft: '#9EABBA',
  inkFaint: '#74839A',
  line: '#263341',
  blue: '#6CAAEE',
  blueStrong: '#93C2F4',
  blueSoft: '#19304A',
  blueInk: '#0C1218',
  board: '#0A1016',
  paint: '#F4C430',
  live: '#5ACF96',
  liveSoft: '#123326',
  warn: '#F0C062',
  warnSoft: '#33270F',
  danger: '#F2A9A2',
  dangerSoft: '#3A1E1B',
  hero: '#163F6C',
  heroInk: '#FFFFFF',
  shadow1: { boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.45)' },
  shadow2: { boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.55)' },
  operator,
};

/** Light or dark as the phone is set (system), or always one of them: chosen in the app's settings. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'wimb.theme.v1';
let theme: ThemeChoice = 'system';
const themeListeners = new Set<() => void>();

/** The choice saved on the phone, read once at start. */
export async function loadTheme(): Promise<void> {
  const saved = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  if (saved === 'light' || saved === 'dark' || saved === 'system') setThemeChoice(saved, false);
}

export function setThemeChoice(next: ThemeChoice, save = true) {
  if (save) void AsyncStorage.setItem(THEME_KEY, next).catch(() => undefined);
  if (next === theme) return;
  theme = next;
  themeListeners.forEach((l) => l());
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore((l) => {
    themeListeners.add(l);
    return () => {
      themeListeners.delete(l);
    };
  }, () => theme);
}

/** Whether the app is dark now: the choice, or the phone's own setting. */
export function useDark(): boolean {
  const phone = useColorScheme();
  const choice = useThemeChoice();
  return choice === 'system' ? phone === 'dark' : choice === 'dark';
}

export function usePalette(): Palette {
  return useDark() ? dark : light;
}

export type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

const FACE: Record<Weight, string> = {
  regular: 'HindSiliguri-Regular',
  medium: 'HindSiliguri-Medium',
  semibold: 'HindSiliguri-SemiBold',
  bold: 'HindSiliguri-Bold',
};

const WEIGHT: Record<Weight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

/** Hind Siliguri when installed (it was designed for Bengali and Latin together), else the system font. */
export function font(weight: Weight = 'regular'): TextStyle {
  return CUSTOM_FONTS ? { fontFamily: FACE[weight] } : { fontWeight: WEIGHT[weight] };
}

/** Route numbers: tall and condensed like a painted route board. */
export function boardFont(): TextStyle {
  if (CUSTOM_FONTS) return { fontFamily: 'Teko-SemiBold' };
  return Platform.select<TextStyle>({
    ios: { fontFamily: 'AvenirNextCondensed-Bold' },
    android: { fontFamily: 'sans-serif-condensed', fontWeight: '700' },
    default: { fontWeight: '700' },
  });
}
