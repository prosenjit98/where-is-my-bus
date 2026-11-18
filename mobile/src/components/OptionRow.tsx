import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isBusLeg, laterTrackedText, waitText, type PlanOption, type PreparedNetwork } from '../core';
import { plural, stopName as nameOfStop } from '../format';
import { getLang, tr } from '../i18n';
import { font, usePalette } from '../theme';
import { Icon, LiveTag, RouteBoard } from './ui';

/** One journey option, as a card: how long, which buses between which stops, and the wait. */
export function OptionRow({ option, net, onPress }: { option: PlanOption; net: PreparedNetwork; onPress: () => void }) {
  const c = usePalette();
  const stopName = (id: string) => nameOfStop(net, id);
  const legs = option.legs.filter(isBusLeg);
  const summary =
    option.id === 'walk' ? tr('Walk') : option.transfers === 0 ? tr('Direct') : plural(option.transfers, 'change', 'changes');
  const later = legs[0] ? laterTrackedText(legs[0], getLang()) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={tr('Shows the journey on the map')}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, transform: [{ scale: pressed ? 0.99 : 1 }] }, pressed ? c.shadow2 : c.shadow1]}
    >
      <View style={styles.top}>
        <Text style={[font('bold'), { fontSize: 26, color: c.ink, letterSpacing: -0.3 }]}>{tr('{min} min', { min: option.totalMin })}</Text>
        <View style={styles.kind}>
          <Icon name={option.id === 'walk' ? 'footprints' : option.transfers === 0 ? 'route' : 'repeat'} size={16} color={c.inkFaint} />
          <Text style={[font('semibold'), { color: c.inkSoft, fontSize: 13 }]}>{summary}</Text>
          <Icon name="chevron-right" size={18} color={c.inkFaint} />
        </View>
      </View>
      {legs.map((leg, i) => (
        <View key={`${leg.boardStopId}-${i}`} style={styles.leg}>
          <View style={styles.boards}>
            {leg.choices.slice(0, 4).map((ch) => (
              <RouteBoard key={ch.routeId} number={ch.routeNumber} operator={ch.operator} size="sm" mode={ch.mode} color={ch.color} />
            ))}
            {leg.choices.length > 4 ? (
              <Text style={[font('semibold'), { color: c.inkSoft }]}>+{leg.choices.length - 4}</Text>
            ) : null}
          </View>
          <Text numberOfLines={2} style={[font(), styles.flex, { color: c.inkSoft, fontSize: 15 }]}>
            {tr('{from} to {to}', { from: stopName(leg.boardStopId), to: stopName(leg.alightStopId) })}
          </Text>
        </View>
      ))}
      {option.walkMin > 0 && option.id !== 'walk' ? (
        <View style={styles.walk}>
          <Icon name="footprints" size={16} color={c.inkFaint} />
          <Text style={[font(), { color: c.inkSoft, fontSize: 13 }]}>{tr('{min} min walking in total', { min: option.walkMin })}</Text>
        </View>
      ) : null}
      {legs[0] ? (
        <View style={[styles.wait, { borderTopColor: c.line }]}>
          <LiveTag live={legs[0].waitIsLive} />
          <Text style={[font('medium'), styles.flex, { color: c.ink, fontSize: 15 }]}>{waitText(legs[0], stopName, getLang())}</Text>
        </View>
      ) : null}
      {later ? <Text style={[font(), { color: c.inkSoft, fontSize: 13 }]}>{later}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  boards: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
});
