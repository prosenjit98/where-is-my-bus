import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, Note, RouteBoard, Screen } from '../components/ui';
import { searchRoutes, type PreparedNetwork, type Route } from '../core';
import { routeTitle, runningText, serviceKind } from '../format';
import { nameOf, tr } from '../i18n';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

// Finding a bus by its route rather than by a journey: by the number painted on it, by its name,
// or by a place it goes to (core routes.ts), as in the web app (web/src/screens/routes.ts). With
// nothing typed, every route, buses first.

const byNumber = (a: Route, b: Route) => a.number.localeCompare(b.number, undefined, { numeric: true });

type Item = { kind: 'heading'; title: string } | { kind: 'route'; route: Route; via?: { name: string; nameBn?: string } };

export function RoutesScreen() {
  const app = useApp();
  const c = usePalette();
  const [query, setQuery] = useState('');
  const net = app.net;

  const items: Item[] = useMemo(() => {
    if (!net) return [];
    const q = query.trim();
    if (q) return searchRoutes(net, q, 20).map((h) => ({ kind: 'route', route: h.route, via: h.via }));
    const all = [...net.network.routes].sort(byNumber);
    const buses = all.filter((r) => (r.mode ?? 'bus') === 'bus');
    const others = all.filter((r) => (r.mode ?? 'bus') !== 'bus');
    return [
      ...(buses.length ? [{ kind: 'heading', title: tr('All bus routes') } as Item, ...buses.map((route): Item => ({ kind: 'route', route }))] : []),
      ...(others.length ? [{ kind: 'heading', title: tr('Metro, trains and ferries') } as Item, ...others.map((route): Item => ({ kind: 'route', route }))] : []),
    ];
  }, [net, query]);

  const open = (r: Route) => app.push({ name: 'route', routeId: r.id });
  const q = query.trim();

  return (
    <Screen title={tr('Find a route')} onBack={app.pop}>
      <View style={styles.box}>
        <View style={styles.searchIcon} pointerEvents="none">
          <Icon name="search" size={20} color={c.inkFaint} />
        </View>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={tr('Route number, or a place it goes to')}
          placeholderTextColor={c.inkSoft}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
          accessibilityLabel={tr('Search for a route')}
          onSubmitEditing={() => {
            const first = items.find((i) => i.kind === 'route');
            if (first && first.kind === 'route') open(first.route);
          }}
          style={[font(), styles.input, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }, c.shadow1]}
        />
      </View>
      {!net ? (
        <View style={styles.pad}>
          <Note>{tr('Loading routes…')}</Note>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i, n) => (i.kind === 'route' ? `r:${i.route.id}` : `h:${n}`)}
          keyboardShouldPersistTaps="handled"
          accessibilityLabel={q ? tr('Matching routes') : undefined}
          renderItem={({ item }) =>
            item.kind === 'heading' ? (
              <Text style={[font('semibold'), styles.section, { color: c.inkSoft }]}>{item.title}</Text>
            ) : (
              <RouteRow net={net} route={item.route} via={item.via} onPress={() => open(item.route)} />
            )
          }
          ListEmptyComponent={
            q ? (
              <View style={[styles.pad, { gap: 10 }]}>
                <Note>{tr('No route matches “{query}”. Try the number painted on the bus, like D2, or a place it goes to.', { query: q })}</Note>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => app.push({ name: 'suggest', kind: 'route', text: `${tr('Missing route:')} ${q}` })}
                  style={styles.link}
                >
                  <Icon name="message-square-warning" size={18} color={c.blue} />
                  <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Is a route missing? Tell us')}</Text>
                </Pressable>
              </View>
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}

/** A route in a list: its board, where it runs, what runs it and how often, now. `via`: the stop it was found by. */
export function RouteRow({ net, route, via, onPress }: { net: PreparedNetwork; route: Route; via?: { name: string; nameBn?: string }; onPress: () => void }) {
  const c = usePalette();
  const sub = [via ? tr('Stops at {stop}', { stop: nameOf(via) }) : null, serviceKind(route), route.name, runningText(route)].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.line, backgroundColor: pressed ? c.surface2 : c.surface }]}
    >
      <RouteBoard number={route.number} operator={route.operator} mode={route.mode} color={route.color} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>
          {routeTitle(net, route)}
        </Text>
        <Text numberOfLines={2} style={[font(), { color: c.inkSoft, fontSize: 14 }]}>
          {sub}
        </Text>
      </View>
      <Icon name="chevron-right" size={18} color={c.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, paddingBottom: 12 },
  searchIcon: { position: 'absolute', left: 30, top: 0, bottom: 4, justifyContent: 'center', zIndex: 1 },
  input: { borderWidth: 1, borderRadius: 14, paddingLeft: 44, paddingRight: 14, paddingVertical: 12, fontSize: 17 },
  pad: { paddingHorizontal: 16, paddingVertical: 12 },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
});
