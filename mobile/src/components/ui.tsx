import React, { type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LINE_HEX, type LineColor, type OperatorType, type TransitMode } from '../core';
import { ICONS, type IconName } from '../icon-data';
import { tr } from '../i18n';
import { boardFont, font, usePalette } from '../theme';

/**
 * A line icon (Lucide, ISC licence), drawn in any colour: the images are black and tinted here
 * (made by tools/brand/make-brand.ts, so the app needs no icon library). Always decoration: the
 * text or label beside it says what it means.
 */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Image
      source={ICONS[name]}
      style={{ width: size, height: size, tintColor: color }}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

export function Screen({
  title,
  onBack,
  children,
  footer,
}: {
  title?: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const c = usePalette();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {title || onBack ? (
        <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.line }]}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('Back')}
              onPress={onBack}
              hitSlop={8}
              style={({ pressed }) => [styles.back, { backgroundColor: pressed ? c.surface2 : 'transparent' }]}
            >
              <Icon name="arrow-left" size={22} color={c.ink} />
            </Pressable>
          ) : null}
          {title ? (
            <Text accessibilityRole="header" numberOfLines={1} style={[font('semibold'), styles.title, { color: c.ink }]}>
              {title}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.fill}>{children}</View>
      {footer ? (
        <SafeAreaView edges={['bottom']} style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.line }]}>
          {footer}
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

/** A raised white card. */
export function Card({ children, style, raised }: { children: ReactNode; style?: StyleProp<ViewStyle>; raised?: boolean }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface }, raised ? c.shadow2 : c.shadow1, style]}>{children}</View>;
}

const BOARD = {
  sm: { minWidth: 40, height: 26, px: 6, size: 18, stripe: 3, radius: 4 },
  md: { minWidth: 50, height: 32, px: 8, size: 22, stripe: 4, radius: 4 },
  lg: { minWidth: 80, height: 50, px: 12, size: 34, stripe: 6, radius: 6 },
};

const MODE_EN: Record<TransitMode, string> = { bus: 'Route', metro: 'Metro', train: 'Train', ferry: 'Ferry' };
/** "Metro", in the app's language. */
export const modeName = (mode: TransitMode) => tr(MODE_EN[mode]);

/**
 * The route number as a painted board; the left stripe tells private, government and mini buses
 * apart. The Metro, trains and ferries have their line's own colour and an icon instead.
 */
export function RouteBoard({
  number,
  operator,
  size = 'md',
  mode = 'bus',
  color,
}: {
  number: string;
  operator: OperatorType;
  size?: 'sm' | 'md' | 'lg';
  mode?: TransitMode;
  color?: LineColor;
}) {
  const c = usePalette();
  const s = BOARD[size];
  if (mode !== 'bus') {
    const line = color ?? 'blue';
    const ink = line === 'yellow' ? '#1E2833' : '#FFFFFF';
    return (
      <View
        accessible
        accessibilityLabel={`${modeName(mode)} ${number}`}
        style={[styles.line, { backgroundColor: LINE_HEX[line], height: s.height, paddingHorizontal: s.px + 2 }]}
      >
        <Icon name={mode === 'ferry' ? 'ship' : 'train-front'} size={size === 'lg' ? 24 : 15} color={ink} />
        <Text numberOfLines={1} style={[font('bold'), { color: ink, fontSize: size === 'lg' ? 22 : size === 'md' ? 15 : 13 }]}>
          {number}
        </Text>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={tr('Route {route}', { route: number })}
      style={{
        backgroundColor: c.board,
        borderLeftColor: c.operator[operator],
        borderLeftWidth: s.stripe,
        borderRadius: s.radius,
        minWidth: s.minWidth,
        height: s.height,
        paddingHorizontal: s.px,
        paddingTop: 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text numberOfLines={1} style={[boardFont(), { color: c.paint, fontSize: s.size, includeFontPadding: false }]}>
        {number}
      </Text>
    </View>
  );
}

/** Live = a tracked bus. Usual = estimated from how often the route runs. Always a word, never colour alone. */
export function LiveTag({ live }: { live: boolean }) {
  const c = usePalette();
  return (
    <View
      style={[
        styles.tag,
        live ? { backgroundColor: c.liveSoft, borderColor: 'transparent' } : { backgroundColor: c.surface2, borderColor: c.line },
      ]}
    >
      <View style={[styles.tagDot, { backgroundColor: live ? c.live : c.inkFaint }]} />
      <Text style={[font('semibold'), { fontSize: 13, color: live ? c.live : c.inkSoft }]}>{live ? tr('Live') : tr('Usual')}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
}) {
  const c = usePalette();
  const fg = kind === 'primary' ? c.blueInk : kind === 'danger' ? c.danger : c.blueStrong;
  const bg = kind === 'primary' ? c.blue : kind === 'danger' ? c.dangerSoft : c.blueSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        kind === 'primary' ? { boxShadow: '0px 6px 16px rgba(31, 102, 177, 0.30)' } : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={fg} /> : null}
          <Text style={[font('semibold'), { color: fg, fontSize: 16 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = usePalette();
  return (
    <View style={styles.switchRow}>
      <View style={styles.fill}>
        <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{label}</Text>
        {hint ? <Text style={[font(), { color: c.inkSoft, fontSize: 13, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.blue, false: c.line }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export function Note({ children, tone = 'soft' }: { children: ReactNode; tone?: 'soft' | 'danger' }) {
  const c = usePalette();
  return (
    <Text style={[font(), { color: tone === 'danger' ? c.danger : c.inkSoft, fontSize: 14, lineHeight: 20 }]}>{children}</Text>
  );
}

/** A note that stands out: offline, a problem, something to do. */
export function Notice({ children, icon = 'info', tone = 'info' }: { children: ReactNode; icon?: IconName; tone?: 'info' | 'warn' | 'danger' }) {
  const c = usePalette();
  const bg = tone === 'warn' ? c.warnSoft : tone === 'danger' ? c.dangerSoft : c.surface;
  const ic = tone === 'warn' ? c.warn : tone === 'danger' ? c.danger : c.blue;
  const fg = tone === 'danger' ? c.danger : tone === 'warn' ? c.ink : c.inkSoft;
  return (
    <View style={[styles.notice, { backgroundColor: bg }, tone === 'info' ? c.shadow1 : null]}>
      <Icon name={icon} size={20} color={ic} />
      <Text style={[font(), styles.fill, { color: fg, fontSize: 14, lineHeight: 20 }]}>{children}</Text>
    </View>
  );
}

/** One line of a status list, as on the trip screen. */
export function StatusItem({ children, icon, danger }: { children: ReactNode; icon: IconName; danger?: boolean }) {
  const c = usePalette();
  return (
    <View style={styles.status}>
      <Icon name={icon} size={18} color={danger ? c.danger : c.blue} />
      <Text style={[font(), styles.fill, { color: danger ? c.danger : c.inkSoft, fontSize: 14, lineHeight: 20 }]}>{children}</Text>
    </View>
  );
}

/** The icon at the start of a list row: tinted blue for actions, grey for places. */
export function IconTile({ name, strong }: { name: IconName; strong?: boolean }) {
  const c = usePalette();
  return (
    <View style={[styles.tile, { backgroundColor: strong ? c.blueSoft : c.surface2 }]}>
      <Icon name={name} size={20} color={strong ? c.blue : c.inkSoft} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  card: { borderRadius: 18, padding: 16, gap: 10 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 2 },
  tagDot: { width: 8, height: 8, borderRadius: 4 },
  button: { borderRadius: 14, minHeight: 50, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
