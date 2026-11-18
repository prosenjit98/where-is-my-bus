import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { OptionRow } from '../components/OptionRow';
import { Icon, Note, Notice, RouteBoard } from '../components/ui';
import { ARRIVALS_REFRESH_MS, TRAVEL_REFRESH_MS } from '../config';
import { coverageFrom, liveEtasFrom, plan, rideTimeFromTable, type Arrival, type Endpoint, type PlanResult, type TravelTable } from '../core';
import { useApp, type Field, type Place } from '../state/AppState';
import { loadTravelTimes } from '../services/travelTimes';
import { placeName, stopName } from '../format';
import { digits, tr } from '../i18n';
import { font, usePalette } from '../theme';

export function toEndpoint(p: Place): Endpoint {
  return p.kind === 'stop'
    ? { kind: 'stop', stopId: p.stopId, label: p.name }
    : { kind: 'point', lat: p.lat, lng: p.lng, label: p.name };
}

export function PlanScreen() {
  const app = useApp();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { net, from, to, netInfo, trip } = app;
  const [arrivals, setArrivals] = useState<Record<string, Arrival[]> | null>(null);
  const [liveDown, setLiveDown] = useState(false);
  const [travel, setTravel] = useState<TravelTable | null>(null);

  // Learned travel times for the hour, from tracked buses; the last ones stay in use offline.
  useEffect(() => {
    let alive = true;
    const load = () => void loadTravelTimes().then((t) => alive && t && setTravel(t));
    load();
    const timer = setInterval(load, TRAVEL_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const rideTimeMin = useMemo(() => rideTimeFromTable(travel), [travel]);

  // Planned on the phone first, so results appear instantly and work offline.
  const base = useMemo(() => (net && from && to ? plan(net, toEndpoint(from), toEndpoint(to), { rideTimeMin }) : null), [net, from, to, rideTimeMin]);
  const originKey = base ? base.originStopIds.slice(0, 20).join(',') : '';

  useEffect(() => {
    setArrivals(null);
    if (!originKey) return;
    let alive = true;
    const load = () =>
      api.arrivals(originKey.split(',')).then(
        (a) => {
          if (!alive) return;
          setArrivals(a);
          setLiveDown(false);
        },
        () => {
          if (alive) setLiveDown(true);
        },
      );
    void load();
    const timer = setInterval(load, ARRIVALS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [originKey]);

  // Then re-ranked with tracked buses, when the server has any.
  const result: PlanResult | null = useMemo(() => {
    if (!net || !from || !to || !base) return null;
    if (!arrivals) return base;
    // Coverage: where nearly every bus of a route is tracked, a late tracked bus is the next one.
    return plan(net, toEndpoint(from), toEndpoint(to), {
      liveEtas: liveEtasFrom((stopId) => arrivals[stopId]),
      coverage: coverageFrom(arrivals),
      rideTimeMin,
    });
  }, [net, from, to, base, arrivals, rideTimeMin]);

  const status = !netInfo
    ? tr('Loading routes…')
    : netInfo.offline
      ? netInfo.source === 'bundled'
        ? tr('Offline. Using the routes built into the app.')
        : tr('Offline. Using saved routes.')
      : null;

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      {/* The hero is blue up to the top of the screen, so the status bar's icons are white here. */}
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { backgroundColor: c.hero, paddingTop: insets.top + 18 }]}>
          <View style={styles.glow} />
          <View style={styles.heroRow}>
            <Image source={require('../../assets/brand/logo-mark.png')} style={styles.mark} accessible={false} />
            <View style={styles.flex}>
              <Text accessibilityRole="header" style={[font('bold'), styles.brand, { color: c.heroInk }]}>
                Where Is My Bus
              </Text>
              <Text style={[font(), styles.heroSub, { color: c.heroInk }]}>{tr('Which bus to take in Kolkata, and when it comes')}</Text>
            </View>
            <View style={styles.heroButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('Settings and account')}
                onPress={() => app.push({ name: 'more' })}
                hitSlop={8}
                style={({ pressed }) => [styles.lang, styles.menu, { backgroundColor: pressed ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.14)' }]}
              >
                <Icon name="menu" size={18} color={c.heroInk} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <Ticket from={from} to={to} onPick={(field) => app.push({ name: 'search', field })} onSwap={app.swap} />

          <Pressable
            accessibilityRole="button"
            onPress={() => app.push({ name: 'routes' })}
            style={({ pressed }) => [styles.quick, { backgroundColor: pressed ? c.surface2 : c.surface }, c.shadow1]}
          >
            <View style={[styles.quickIcon, { backgroundColor: c.blueSoft }]}>
              <Icon name="bus" size={20} color={c.blue} />
            </View>
            <View style={styles.flex}>
              <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Find a route')}</Text>
              <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{tr('By its number, like D2, or a place it goes to')}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={c.inkFaint} />
          </Pressable>

          {trip.active && trip.config ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => app.push({ name: 'trip' })}
              style={[styles.tripBanner, { backgroundColor: c.board }, c.shadow2]}
            >
              <RouteBoard number={trip.config.routeNumber} operator={trip.config.operator} size="sm" />
              <Text numberOfLines={1} style={[font('semibold'), styles.flex, { color: '#FFFFFF' }]}>
                {trip.state?.nextStopId ? tr('Next stop {stop}', { stop: stopName(net, trip.state.nextStopId) }) : tr('Trip in progress')}
              </Text>
              <Text style={[font('semibold'), { color: c.paint }]}>{tr('Open')}</Text>
              <Icon name="chevron-right" size={18} color={c.paint} />
            </Pressable>
          ) : null}

          {status ? (
            <Notice icon={netInfo?.offline ? 'wifi-off' : 'refresh-cw'} tone={netInfo?.offline ? 'warn' : 'info'}>
              {status}
            </Notice>
          ) : null}

          {!net ? null : !from || !to ? (
            <View style={styles.hint}>
              <Note>{!from ? tr('Choose where you are starting from.') : tr('Choose where you are going.')}</Note>
            </View>
          ) : result && result.options.length === 0 ? (
            <NoOptions result={result} />
          ) : result ? (
            <View style={styles.options}>
              {result.options.map((o) => (
                <OptionRow key={o.id} option={o} net={net} onPress={() => app.push({ name: 'option', option: o })} />
              ))}
              <View style={styles.hint}>
                <Note>
                  {liveDown
                    ? tr('Live bus positions are not available right now, so times are based on how often buses usually run.')
                    : arrivals
                      ? tr('Live times refresh every 20 seconds.')
                      : tr('Checking for live buses…')}
                </Note>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function NoOptions({ result }: { result: PlanResult }) {
  const c = usePalette();
  if (result.notRunning.length) {
    return (
      <View style={styles.hint}>
        <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('No bus runs between these places right now.')}</Text>
        {result.notRunning.map((r) => (
          <Note key={r.routeId}>{tr('{route} runs from {first} to {last}.', { route: r.routeNumber, first: digits(r.firstBus), last: digits(r.lastBus) })}</Note>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.hint}>
      <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('No bus connects these places with one change or less.')}</Text>
      <Note>{tr('Try a stop nearby, or pick the exact place on the map.')}</Note>
    </View>
  );
}

function Ticket({
  from,
  to,
  onPick,
  onSwap,
}: {
  from: Place | null;
  to: Place | null;
  onPick: (field: Field) => void;
  onSwap: () => void;
}) {
  const c = usePalette();
  return (
    <View style={[styles.ticket, { backgroundColor: c.surface }, c.shadow2]}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: c.blue, borderColor: c.blueSoft, borderWidth: 3 }]} />
        <View style={[styles.railLine, { backgroundColor: c.line }]} />
        <View style={[styles.dot, { borderColor: c.ink, borderWidth: 3 }]} />
      </View>
      <View style={styles.flex}>
        <PlaceField label={tr('From')} place={from} placeholder={tr('Where are you starting?')} onPress={() => onPick('from')} />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }} />
        <PlaceField label={tr('To')} place={to} placeholder={tr('Where are you going?')} onPress={() => onPick('to')} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('Swap start and destination')}
        onPress={onSwap}
        hitSlop={10}
        style={[styles.swap, { backgroundColor: c.surface, borderColor: c.line }, c.shadow1]}
      >
        <Icon name="arrow-up-down" size={20} color={c.blue} />
      </Pressable>
    </View>
  );
}

function PlaceField({ label, place, placeholder, onPress }: { label: string; place: Place | null; placeholder: string; onPress: () => void }) {
  const c = usePalette();
  const { net } = useApp();
  const name = place ? placeName(net, place) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr('{field}: {place}', { field: label, place: name ?? tr('not chosen') })}
      onPress={onPress}
      style={styles.field}
    >
      <Text style={[font('semibold'), styles.fieldLabel, { color: c.inkFaint }]}>{label.toUpperCase()}</Text>
      <Text numberOfLines={1} style={[font(place ? 'semibold' : 'regular'), { color: place ? c.ink : c.inkSoft, fontSize: 17 }]}>
        {name ?? placeholder}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heroButtons: { gap: 8, alignItems: 'flex-end', alignSelf: 'flex-start' },
  menu: { paddingHorizontal: 10 },
  lang: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', paddingHorizontal: 12, paddingVertical: 6 },
  hero: { paddingHorizontal: 20, paddingBottom: 58, overflow: 'hidden' },
  glow: { position: 'absolute', right: -60, top: -40, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 40, height: 50 },
  brand: { fontSize: 25, letterSpacing: -0.3, lineHeight: 30 },
  heroSub: { fontSize: 14, opacity: 0.88, marginTop: 2 },
  content: { paddingHorizontal: 16, gap: 14, marginTop: -40 },
  tripBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  ticket: { flexDirection: 'row', borderRadius: 20, paddingVertical: 6, paddingLeft: 16, paddingRight: 10 },
  rail: { alignItems: 'center', paddingVertical: 24, marginRight: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  railLine: { width: 2, flex: 1, marginVertical: 6 },
  field: { paddingVertical: 12, paddingRight: 8 },
  fieldLabel: { fontSize: 12, letterSpacing: 0.6 },
  swap: { alignSelf: 'center', width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  options: { gap: 12 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingVertical: 8, gap: 6 },
});
