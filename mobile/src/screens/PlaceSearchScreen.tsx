import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, IconTile, Note, Screen } from '../components/ui';
import type { IconName } from '../icon-data';
import { nearbyStops, routeKey, search, searchRoutes, type SearchHit } from '../core';
import { RouteRow } from './RoutesScreen';
import { formatDistance, placeName } from '../format';
import { getLang, nameOf, tr } from '../i18n';
import { checkAccess, currentFix, openAppSettings, openLocationSettings, requestAccess } from '../native/location';
import { addRecent, loadRecents } from '../services/recents';
import { useApp, type Field, type Place } from '../state/AppState';
import { font, usePalette } from '../theme';

type LocUi =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'approx'; stops: { id: string; name: string; label: string; distM: number }[] }
  | { kind: 'message'; text: string; action?: { label: string; run: () => void } };

export function PlaceSearchScreen({ field }: { field: Field }) {
  const app = useApp();
  const c = usePalette();
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<Place[]>([]);
  const [loc, setLoc] = useState<LocUi>({ kind: 'idle' });

  useEffect(() => {
    void loadRecents().then(setRecents);
  }, []);

  const hits = useMemo(() => (app.net && query.trim() ? search(app.net.searchIndex, query, 15) : []), [app.net, query]);
  // Someone who types a route number, like D2, here is looking for the bus: its routes come first.
  const routeHits = useMemo(() => {
    if (!app.net || !routeKey(query)) return [];
    return searchRoutes(app.net, query, 4).filter((h) => !h.via && h.score >= 0.8);
  }, [app.net, query]);

  const choose = (p: Place) => {
    app.setPlace(field, p);
    void addRecent(p);
    app.pop();
  };

  const chooseHit = (h: SearchHit) =>
    choose(
      h.place.kind === 'stop'
        ? { kind: 'stop', stopId: h.place.id, name: h.place.name }
        : { kind: 'point', lat: h.place.lat, lng: h.place.lng, name: nameOf(h.place) },
    );

  // Precise location picks the spot; approximate narrows it to the area; none falls back to search and the map.
  async function useMyLocation() {
    const net = app.net;
    if (!net) return;
    setLoc({ kind: 'busy' });
    let access = await checkAccess();
    if (access === 'unknown' || access === 'denied') access = await requestAccess();
    if (access === 'blocked') {
      setLoc({
        kind: 'message',
        text: tr('Location is turned off for this app. You can still search for your stop or pick it on the map.'),
        action: { label: tr('Open settings'), run: openAppSettings },
      });
      return;
    }
    if (access === 'denied' || access === 'unknown') {
      setLoc({ kind: 'message', text: tr('Without location, search for your stop or pick it on the map.') });
      return;
    }
    if (access === 'off') {
      setLoc({
        kind: 'message',
        text: tr('Location is switched off on this phone.'),
        action: {
          label: Platform.OS === 'android' ? tr('Turn on location') : tr('Open settings'),
          run: () => void openLocationSettings(),
        },
      });
      return;
    }
    const fix = await currentFix();
    if (!fix) {
      setLoc({ kind: 'message', text: tr('Your location could not be found. Search for your stop, or try again near a window.') });
      return;
    }
    if (access === 'approximate' || (fix.accuracy ?? 0) > 1000) {
      const stops = nearbyStops(net, fix, 2500)
        .slice(0, 8)
        .map((n) => ({ id: n.stop.id, name: n.stop.name, label: nameOf(n.stop), distM: n.distM }));
      setLoc(
        stops.length
          ? { kind: 'approx', stops }
          : { kind: 'message', text: tr('There are no stops near your approximate location. Search for your stop instead.') },
      );
      return;
    }
    setLoc({ kind: 'idle' });
    choose({ kind: 'point', lat: fix.lat, lng: fix.lng, name: 'Your location' });
  }

  return (
    <Screen title={field === 'from' ? tr('Starting from') : tr('Going to')} onBack={app.pop}>
      <View style={styles.box}>
        <View style={styles.searchIcon} pointerEvents="none">
          <Icon name="search" size={20} color={c.inkFaint} />
        </View>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={tr('Stop, area or landmark, in English or বাংলা')}
          placeholderTextColor={c.inkSoft}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={tr('Search for a stop or landmark')}
          style={[font(), styles.input, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }, c.shadow1]}
        />
      </View>
      {query.trim() ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => `${h.place.kind}:${h.place.id}`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            routeHits.length && app.net ? (
              <View accessibilityLabel={tr('Matching routes')}>
                {routeHits.map((h) => (
                  <RouteRow key={h.route.id} net={app.net!} route={h.route} onPress={() => app.push({ name: 'route', routeId: h.route.id })} />
                ))}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Row
              icon={item.place.kind === 'landmark' ? 'map-pinned' : 'bus'}
              title={nameOf(item.place)}
              subtitle={[item.place.kind === 'landmark' ? tr('Landmark') : null, getLang() === 'bn' ? (item.place.nameBn ? item.place.name : null) : item.place.nameBn]
                .filter(Boolean)
                .join(', ')}
              onPress={() => chooseHit(item)}
            />
          )}
          ListEmptyComponent={
            routeHits.length ? undefined : <View style={styles.pad}>
              <Note>{tr('Nothing matches “{query}”. Try another spelling, or pick the place on the map.', { query: query.trim() })}</Note>
            </View>
          }
        />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {field === 'from' ? <Row icon="locate-fixed" title={tr('Use my location')} subtitle={tr('Find the stops near you')} onPress={useMyLocation} strong /> : null}
          <Row icon="map" title={tr('Pick on the map')} subtitle={tr('Tap the exact place')} onPress={() => app.push({ name: 'map', field })} strong />
          {loc.kind === 'busy' ? (
            <View style={[styles.pad, styles.inline]}>
              <ActivityIndicator color={c.blue} />
              <Note>{tr('Finding your location…')}</Note>
            </View>
          ) : null}
          {loc.kind === 'message' ? (
            <View style={[styles.pad, { gap: 8 }]}>
              <Note>{loc.text}</Note>
              {loc.action ? (
                <Pressable accessibilityRole="button" onPress={loc.action.run}>
                  <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{loc.action.label}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {loc.kind === 'approx' ? (
            <View>
              <View style={styles.pad}>
                <Note>{tr('Your phone shares only an approximate location. Which stop are you near?')}</Note>
              </View>
              {loc.stops.map((s) => (
                <Row
                  key={s.id}
                  icon="bus"
                  title={s.label}
                  subtitle={tr('About {distance} away', { distance: formatDistance(s.distM) })}
                  onPress={() => choose({ kind: 'stop', stopId: s.id, name: s.name })}
                />
              ))}
            </View>
          ) : null}
          {recents.length ? (
            <View>
              <Text style={[font('semibold'), styles.section, { color: c.inkSoft }]}>{tr('Recent places')}</Text>
              {recents.map((p) => (
                <Row
                  key={p.kind === 'stop' ? p.stopId : `${p.lat},${p.lng}`}
                  icon="history"
                  title={placeName(app.net, p)}
                  subtitle={p.kind === 'stop' ? tr('Stop') : tr('Place on the map')}
                  onPress={() => choose(p)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function Row({ icon, title, subtitle, onPress, strong }: { icon: IconName; title: string; subtitle?: string; onPress: () => void; strong?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.line, backgroundColor: pressed ? c.surface2 : c.surface }]}
    >
      <IconTile name={icon} strong={strong} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[font('semibold'), { color: strong ? c.blueStrong : c.ink, fontSize: 16 }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, paddingBottom: 12 },
  searchIcon: { position: 'absolute', left: 30, top: 0, bottom: 4, justifyContent: 'center', zIndex: 1 },
  input: { borderWidth: 1, borderRadius: 14, paddingLeft: 44, paddingRight: 14, paddingVertical: 12, fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 1 },
  pad: { paddingHorizontal: 16, paddingVertical: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4, fontSize: 14 },
});
