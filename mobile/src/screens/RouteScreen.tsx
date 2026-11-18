import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api } from '../api';
import { Card, Icon, modeName, Note, Notice, RouteBoard, Screen } from '../components/ui';
import { VEHICLES_REFRESH_MS } from '../config';
import { isPatternActive, isRouteRunning, istNow, LINE_HEX, parseClock, sliceLine, type PreparedPattern, type Route, type VehicleView } from '../core';
import { plural, routeTitle, runningText, serviceKind, stopName, towards } from '../format';
import { digits, getLang, nameOf, tr } from '../i18n';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

// A route's own page, as in the web app (web/src/screens/route.ts): where it runs and when, each
// direction's stops in order, and the buses being tracked on it now, asked for every 10 seconds
// (React Native has no EventSource). The Metro, trains and ferries are not tracked, so their page
// has the timetable only.

/** The directions in use today: not a diversion outside its dates, nor one a diversion replaces. */
function todaysPatterns(route: Route, minute: number, dateISO: string) {
  return route.patterns.filter((p) => isPatternActive(route, p, p.activeWindows?.length ? parseClock(p.activeWindows[0].from) : minute, dateISO));
}

export function RouteScreen({ routeId }: { routeId: string }) {
  const app = useApp();
  const c = usePalette();
  const net = app.net;
  const route = net?.routes.get(routeId);
  const mapRef = useRef<MapView>(null);
  const { minute, dateISO } = istNow();
  const patterns = useMemo(() => (route ? todaysPatterns(route, minute, dateISO) : []), [route, minute, dateISO]);
  const running = route ? isRouteRunning(route, minute) : false;
  const runsNow = (p: Route['patterns'][number]) => !!route && running && isPatternActive(route, p, minute, dateISO);
  const [patternId, setPatternId] = useState(() => (patterns.find(runsNow) ?? patterns[0] ?? route?.patterns[0])?.id ?? '');
  const [vehicles, setVehicles] = useState<VehicleView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [liveDown, setLiveDown] = useState(false);
  const mode = route?.mode ?? 'bus';
  const tracked = mode === 'bus';
  const pp: PreparedPattern | undefined = net?.patterns.get(patternId);

  useEffect(() => {
    setVehicles([]);
    setLoaded(false);
    if (!tracked || !patternId) return;
    let alive = true;
    const load = () =>
      api.vehicles(patternId).then(
        (list) => {
          if (!alive) return;
          setVehicles(list.filter((v) => v.patternId === patternId));
          setLoaded(true);
          setLiveDown(false);
        },
        () => {
          if (alive) setLiveDown(true);
        },
      );
    void load();
    const timer = setInterval(load, VEHICLES_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [patternId, tracked]);

  const line = useMemo(() => (pp ? sliceLine(pp.line, 0, pp.line.length).map((p) => ({ latitude: p.lat, longitude: p.lng })) : []), [pp]);
  const fit = () => {
    if (line.length > 1) mapRef.current?.fitToCoordinates(line, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
  };
  useEffect(fit, [line]);

  if (!net || !route) {
    return (
      <Screen title={tr('Find a route')} onBack={app.pop}>
        <View style={styles.pad}>
          <Note>{tr('This route is no longer in the network.')}</Note>
        </View>
      </Screen>
    );
  }

  const color = tracked ? c.blue : LINE_HEX[route.color ?? 'blue'];
  const ids = pp?.pattern.stopIds ?? [];
  /** The buses after this stop and before the next: where each is on the list. */
  const busesAfter = (i: number) => {
    if (!pp) return [];
    const next = i + 1 < pp.stopAlong.length ? pp.stopAlong[i + 1] : Number.POSITIVE_INFINITY;
    return vehicles.filter((v) => v.alongM < next && (i === 0 || v.alongM >= pp.stopAlong[i]));
  };
  const center = line[0] ?? { latitude: net.center.lat, longitude: net.center.lng };

  return (
    <Screen title={mode === 'bus' ? tr('Route {route}', { route: route.number }) : `${modeName(mode)} ${route.number}`} onBack={app.pop}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Card raised style={styles.head}>
          <View style={styles.headRow}>
            <RouteBoard number={route.number} operator={route.operator} size="lg" mode={route.mode} color={route.color} />
            <View style={styles.flex}>
              <Text style={[font('bold'), { color: c.ink, fontSize: 18 }]}>{routeTitle(net, route)}</Text>
              <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{[serviceKind(route), route.name].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          <View style={styles.facts}>
            <View style={[styles.runState, { backgroundColor: running ? c.liveSoft : c.surface2 }]}>
              <View style={[styles.dot, { backgroundColor: running ? c.live : c.inkFaint }]} />
              <Text style={[font('semibold'), { color: running ? c.live : c.inkSoft, fontSize: 13 }]}>{runningText(route, minute)}</Text>
            </View>
            <View style={styles.fact}>
              <Icon name="clock" size={16} color={c.inkSoft} />
              <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{tr('Runs from {first} to {last}', { first: digits(route.firstBus), last: digits(route.lastBus) })}</Text>
            </View>
          </View>
        </Card>

        {patterns.length > 1 ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Which way?')}</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {patterns.map((p) => {
                const on = p.id === patternId;
                const place = towards(net, p.id, p.headsign);
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setPatternId(p.id)}
                    style={[styles.choice, { borderColor: on ? c.blue : c.line, backgroundColor: on ? c.blueSoft : c.surface }]}
                  >
                    <Icon name={on ? 'circle-dot' : 'navigation'} size={20} color={on ? c.blue : c.inkSoft} />
                    <View style={styles.flex}>
                      <Text style={[font(on ? 'semibold' : 'medium'), { color: c.ink, fontSize: 15 }]}>
                        {runsNow(p) ? tr('Towards {place}', { place }) : tr('Towards {place} (not running now)', { place })}
                      </Text>
                      {p.activeWindows?.length ? (
                        <Text style={[font(), { color: c.inkSoft, fontSize: 13 }]}>{digits(p.activeWindows.map((w) => `${w.from}–${w.to}`).join(', '))}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={[styles.mapBox, { borderColor: c.line }]} accessibilityLabel={tr('Map of the route and tracked buses')}>
          {/* The map sits in a page that scrolls: a finger dragging on it scrolls the page (found on a
              phone: otherwise the stops below are hard to reach). It is fitted to the route; pinching still zooms. */}
          <MapView
            ref={mapRef}
            style={styles.map}
            toolbarEnabled={false}
            scrollEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            onMapReady={fit}
            initialRegion={{ ...center, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
          >
            {line.length > 1 ? <Polyline coordinates={line} strokeColor={color} strokeWidth={5} /> : null}
            {ids.map((id, i) => {
              const s = net.stops.get(id);
              if (!s || (i !== 0 && i !== ids.length - 1)) return null;
              return <Marker key={id} coordinate={{ latitude: s.lat, longitude: s.lng }} title={nameOf(s)} pinColor={i === 0 ? c.blue : c.ink} />;
            })}
            {vehicles.map((v) => (
              <Marker key={v.id} coordinate={{ latitude: v.lat, longitude: v.lng }} anchor={{ x: 0.5, y: 0.5 }}>
                <RouteBoard number={v.routeNumber} operator={v.operator} size="sm" />
              </Marker>
            ))}
          </MapView>
        </View>

        <View accessibilityLiveRegion="polite">
          {!tracked ? (
            <Notice icon="info">{tr('The Metro, trains and ferries are not tracked live. Times come from how often they run.')}</Notice>
          ) : liveDown ? (
            <Notice icon="wifi-off" tone="warn">{tr('Live bus positions are not available right now.')}</Notice>
          ) : !loaded ? (
            <Notice icon="radio-tower">{tr('Checking for live buses…')}</Notice>
          ) : (
            <Notice icon="radio-tower">
              {vehicles.length
                ? tr('{buses} tracked on this direction right now.', { buses: plural(vehicles.length, 'bus', 'buses') })
                : tr('No bus on this direction is being tracked right now.')}
            </Notice>
          )}
        </View>

        <Card>
          <View style={styles.stopsHead}>
            <Text accessibilityRole="header" style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Stops')}</Text>
            <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{plural(ids.length, 'stop', 'stops')}</Text>
          </View>
          {ids.map((id, i) => {
            const s = net.stops.get(id);
            const end = i === 0 || i === ids.length - 1;
            const other = s ? (getLang() === 'bn' ? (s.nameBn ? s.name : null) : (s.nameBn ?? null)) : null;
            return (
              <View key={`${id}-${i}`} style={styles.stopRow}>
                <View style={styles.rail}>
                  <View style={[styles.stopDot, { borderColor: end ? color : c.inkFaint, backgroundColor: end ? color : c.surface }]} />
                  {i < ids.length - 1 ? <View style={[styles.railLine, { backgroundColor: c.line }]} /> : null}
                </View>
                <View style={[styles.flex, { paddingBottom: 14 }]}>
                  <Text style={[font(end ? 'semibold' : 'medium'), { color: c.ink, fontSize: 15 }]}>{s ? nameOf(s) : id}</Text>
                  {other ? <Text style={[font(), { color: c.inkFaint, fontSize: 13 }]}>{other}</Text> : null}
                  {tracked
                    ? busesAfter(i).map((v) => (
                        <View key={v.id} style={styles.busHere}>
                          <RouteBoard number={v.routeNumber} operator={v.operator} size="sm" />
                          <Text style={[font(), styles.flex, { color: c.inkSoft, fontSize: 13 }]}>
                            {i === ids.length - 1
                              ? tr('Near {stop}, seen {sec} s ago', { stop: stopName(net, id), sec: v.lastSeenSec })
                              : tr('Between {from} and {to}, seen {sec} s ago', { from: stopName(net, id), to: stopName(net, ids[i + 1]), sec: v.lastSeenSec })}
                          </Text>
                        </View>
                      ))
                    : null}
                </View>
              </View>
            );
          })}
        </Card>

        <Pressable accessibilityRole="button" onPress={() => app.push({ name: 'suggest', kind: 'route', routeIds: [route.id] })} style={styles.link}>
          <Icon name="message-square-warning" size={18} color={c.blue} />
          <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Something wrong with this route? Tell us')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, gap: 16, paddingBottom: 40 },
  head: { gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  facts: { gap: 10 },
  runState: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  mapBox: { height: 220, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  map: { flex: 1 },
  stopsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  stopRow: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 14 },
  stopDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginTop: 3 },
  railLine: { width: 2, flex: 1, marginTop: 2 },
  busHere: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
});
