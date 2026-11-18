import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api } from '../api';
import { Button, Icon, LiveTag, modeName, Note, Notice, RouteBoard, Screen, StatusItem, SwitchRow } from '../components/ui';
import { VEHICLES_REFRESH_MS } from '../config';
import {
  isBusLeg,
  laterTrackedText,
  LINE_HEX,
  reportedText,
  sliceLine,
  waitText,
  type Arrival,
  type BusLeg,
  type PlanOption,
  type VehicleView,
  type WalkLeg,
} from '../core';
import { formatDistance, plural, stopName as nameOfStop, towards } from '../format';
import { getLang, nameOf, tr } from '../i18n';
import type { IconName } from '../icon-data';
import {
  askForPrecise,
  checkAccess,
  ensureNotificationPermission,
  openAppSettings,
  openLocationSettings,
  requestAccess,
} from '../native/location';
import { canConduct, useAccount } from '../services/account';
import { deviceId } from '../services/device';
import { startTrip } from '../services/trip';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

export function OptionScreen({ option }: { option: PlanOption }) {
  const app = useApp();
  const c = usePalette();
  const net = app.net;
  const mapRef = useRef<MapView>(null);
  const [vehicles, setVehicles] = useState<VehicleView[]>([]);
  const [arrivals, setArrivals] = useState<Record<string, Arrival[]>>({});
  const [openLeg, setOpenLeg] = useState<number | null>(null);
  const busLegs = useMemo(() => option.legs.filter(isBusLeg), [option]);
  const stopName = (id: string) => nameOfStop(net, id);

  const paths = useMemo(() => {
    if (!net) return [];
    return busLegs.map((leg) => {
      const pp = net.patterns.get(leg.choices[0].patternId);
      if (!pp) return [];
      const b = pp.pattern.stopIds.indexOf(leg.boardStopId);
      const a = pp.pattern.stopIds.indexOf(leg.alightStopId, b + 1);
      if (b < 0 || a < 0) return [];
      return sliceLine(pp.line, pp.stopAlong[b], pp.stopAlong[a]).map((p) => ({ latitude: p.lat, longitude: p.lng }));
    });
  }, [net, busLegs]);

  // Only buses are tracked; the Metro and ferries come at their usual frequency.
  const patternKey = useMemo(
    () =>
      [...new Set(busLegs.flatMap((l) => l.choices.filter((ch) => ch.mode === 'bus').map((ch) => ch.patternId)))]
        .slice(0, 6)
        .join(','),
    [busLegs],
  );
  const boardKey = useMemo(() => [...new Set(busLegs.map((l) => l.boardStopId))].join(','), [busLegs]);

  // Buses being tracked right now on these routes, and what riders reported at earlier stops. The
  // web app gets these pushed; React Native has no EventSource, so the app asks every 10 seconds.
  useEffect(() => {
    if (!patternKey) return;
    let alive = true;
    const load = () => {
      Promise.all(patternKey.split(',').map((id) => api.vehicles(id))).then(
        (lists) => {
          if (alive) setVehicles(lists.flat());
        },
        () => undefined,
      );
      api.arrivals(boardKey.split(',')).then(
        (a) => {
          if (alive) setArrivals(a);
        },
        () => undefined,
      );
    };
    load();
    const timer = setInterval(load, VEHICLES_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [patternKey, boardKey]);

  const fit = () => {
    const coords = paths.flat();
    if (coords.length > 1) {
      mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
    }
  };

  const lastLeg = option.legs[option.legs.length - 1];
  const destination = lastLeg.kind === 'walk' ? lastLeg.toLabel : stopName(lastLeg.alightStopId);
  const first = paths.find((p) => p.length)?.[0];
  const center = first ?? { latitude: net?.center.lat ?? 22.5726, longitude: net?.center.lng ?? 88.3639 };
  let busIndex = -1;

  return (
    <Screen title={tr('{min} min to {place}', { min: option.totalMin, place: destination })} onBack={app.pop}>
      {busLegs.length ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          toolbarEnabled={false}
          onMapReady={fit}
          initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        >
          {paths.map((coords, i) => {
            if (coords.length < 2) return null;
            // A Metro or ferry leg in its line's colour; buses in blue, then ink.
            const ch = busLegs[i].choices[0];
            const color = ch.mode !== 'bus' ? LINE_HEX[ch.color ?? 'blue'] : i === 0 ? c.blue : c.ink;
            return <Polyline key={`path-${i}`} coordinates={coords} strokeColor={color} strokeWidth={5} />;
          })}
          {busLegs.map((leg, i) => {
            const b = net?.stops.get(leg.boardStopId);
            const a = net?.stops.get(leg.alightStopId);
            return [
              b ? (
                <Marker key={`b-${i}`} coordinate={{ latitude: b.lat, longitude: b.lng }} title={tr('Get on at {stop}', { stop: nameOf(b) })} pinColor={c.blue} />
              ) : null,
              a ? (
                <Marker key={`a-${i}`} coordinate={{ latitude: a.lat, longitude: a.lng }} title={tr('Get off at {stop}', { stop: nameOf(a) })} pinColor={c.ink} />
              ) : null,
            ];
          })}
          {vehicles.map((v) => (
            <Marker
              key={v.id}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={tr('Bus {route} towards {place}', { route: v.routeNumber, place: towards(net, v.patternId, v.headsign) })}
              description={
                v.source === 'conductor'
                  ? tr('Shared by the conductor')
                  : tr('{riders} sharing, seen {sec} s ago', { riders: plural(v.riders, 'rider', 'riders'), sec: v.lastSeenSec })
              }
            >
              <RouteBoard number={v.routeNumber} operator={v.operator} size="sm" />
            </Marker>
          ))}
        </MapView>
      ) : null}

      <ScrollView contentContainerStyle={styles.steps} keyboardShouldPersistTaps="handled">
        {option.legs.map((leg, i) => {
          if (leg.kind === 'walk') return <WalkStep key={`w-${i}`} leg={leg} />;
          busIndex += 1;
          const index = busIndex;
          return (
            <BusStep
              key={`b-${i}`}
              leg={leg}
              stopName={stopName}
              arrivals={arrivals[leg.boardStopId]}
              open={openLeg === index}
              onToggle={() => setOpenLeg(openLeg === index ? null : index)}
              onStarted={() => app.push({ name: 'trip' })}
            />
          );
        })}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            app.push({
              name: 'suggest',
              routeIds: [...new Set(busLegs.flatMap((l) => l.choices.map((ch) => ch.routeId)))],
              stopId: busLegs[0]?.boardStopId,
            })
          }
          style={styles.linkRow}
        >
          <Icon name="message-square-warning" size={18} color={c.blue} />
          <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Something wrong with this journey? Suggest a fix')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/** One step of the journey on the timeline: its dot and line, and its card. */
function Step({ icon, walk, children }: { icon: IconName; walk?: boolean; children: React.ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <View style={[styles.stepDot, walk ? { backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1 } : { backgroundColor: c.blueSoft }]}>
          <Icon name={icon} size={18} color={walk ? c.inkSoft : c.blue} />
        </View>
        <View style={[styles.stepLine, { backgroundColor: c.line }]} />
      </View>
      <View style={[styles.flex, walk ? styles.walkCard : [styles.stepCard, { backgroundColor: c.surface }, c.shadow1]]}>{children}</View>
    </View>
  );
}

function WalkStep({ leg }: { leg: WalkLeg }) {
  const c = usePalette();
  return (
    <Step icon="footprints" walk>
      <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Walk {min} min to {place}', { min: leg.minutes, place: leg.toLabel })}</Text>
      <Note>{formatDistance(leg.meters)}</Note>
    </Step>
  );
}

function BusStep({
  leg,
  stopName,
  arrivals,
  open,
  onToggle,
  onStarted,
}: {
  leg: BusLeg;
  stopName: (id: string) => string;
  arrivals: Arrival[] | undefined;
  open: boolean;
  onToggle: () => void;
  onStarted: () => void;
}) {
  const c = usePalette();
  const { net } = useApp();
  const main = leg.choices[0];
  // Only buses are tracked and shared; the Metro, trains and ferries come at their usual frequency.
  const isBus = main.mode === 'bus';
  const seen = reportedText(leg, arrivals, stopName, getLang());
  return (
    <Step icon={isBus ? 'bus' : main.mode === 'ferry' ? 'ship' : 'train-front'}>
      <View style={styles.boards}>
        {leg.choices.map((ch) => (
          <RouteBoard key={ch.routeId} number={ch.routeNumber} operator={ch.operator} mode={ch.mode} color={ch.color} />
        ))}
      </View>
      <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>
        {leg.choices.length > 1
          ? tr('Take whichever comes first')
          : tr('{mode} {route} towards {place}', {
              mode: isBus ? tr('Bus') : modeName(main.mode),
              route: main.routeNumber,
              place: towards(net, main.patternId, main.headsign),
            })}
      </Text>
      <Text style={[font(), { color: c.inkSoft, fontSize: 15 }]}>
        {tr('From {from} to {to}', { from: stopName(leg.boardStopId), to: stopName(leg.alightStopId) })}
      </Text>
      <Note>{tr('{stops}, about {min} min', { stops: plural(main.stopsCount, 'stop', 'stops'), min: Math.max(1, Math.round(leg.rideMin)) })}</Note>
      <View style={[styles.wait, { borderTopColor: c.line }]}>
        <LiveTag live={leg.waitIsLive} />
        <Text style={[font('medium'), styles.flex, { color: c.ink }]}>{waitText(leg, stopName, getLang())}</Text>
      </View>
      {laterTrackedText(leg, getLang()) ? <Note>{laterTrackedText(leg, getLang())}</Note> : null}
      {seen ? <StatusItem icon="megaphone">{seen}</StatusItem> : null}
      {!isBus ? null : open ? (
        <StartPanel leg={leg} stopName={stopName} onStarted={onStarted} />
      ) : (
        <Button kind="secondary" icon="bus-front" label={tr("I'm on this bus")} onPress={onToggle} />
      )}
      {isBus ? <ReportPanel leg={leg} stopName={stopName} /> : null}
    </Step>
  );
}

/** For people waiting without location: a bus that just left is worth telling the stops further on. */
function ReportPanel({ leg, stopName }: { leg: BusLeg; stopName: (id: string) => string }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const board = stopName(leg.boardStopId);

  async function send(patternId: string) {
    try {
      const r = await api.report(patternId, leg.boardStopId, await deviceId());
      setResult(
        r.repeat
          ? tr('You already said so. Thank you.')
          : r.agreed
            ? tr('Thank you. Another rider saw it too, so people further along now see it.')
            : tr('Thank you. When another rider says the same, people further along will see it.'),
      );
      setOpen(false);
    } catch (e) {
      setResult(e instanceof Error ? e.message : tr('The report could not be sent.'));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {open ? (
        <View style={styles.panel}>
          <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{tr('Which bus just left {stop}?', { stop: board })}</Text>
          <View style={styles.boards}>
            {leg.choices.map((ch) => (
              <Pressable
                key={ch.patternId}
                accessibilityRole="button"
                accessibilityLabel={tr('{route} just left {stop}', { route: ch.routeNumber, stop: board })}
                onPress={() => void send(ch.patternId)}
                style={[styles.pick, { borderColor: c.line }]}
              >
                <RouteBoard number={ch.routeNumber} operator={ch.operator} />
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
            <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.linkRow}>
          <Icon name="megaphone" size={18} color={c.blue} />
          <Text style={[font('semibold'), styles.flex, { color: c.blue, fontSize: 15 }]}>{tr('Did one just leave {stop}? Tell others', { stop: board })}</Text>
        </Pressable>
      )}
      {result ? <Note>{result}</Note> : null}
    </View>
  );
}

function StartPanel({ leg, stopName, onStarted }: { leg: BusLeg; stopName: (id: string) => string; onStarted: () => void }) {
  const app = useApp();
  const c = usePalette();
  const account = useAccount();
  // A conductor signed in shares as the conductor; their owner and managers may too.
  const mayConduct = canConduct(account);
  const [patternId, setPatternId] = useState(leg.choices[0].patternId);
  const [share, setShare] = useState(true);
  const [busPlate, setBusPlate] = useState('');
  const [conductor, setConductor] = useState(account?.kind === 'conductor');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const asConductor = share && mayConduct && conductor;

  async function start() {
    const net = app.net;
    if (!net) return;
    if (asConductor && !busPlate.trim()) {
      setProblem({ text: tr('Type the bus’s number plate, for example WB 19 A 1234.') });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // The stop alarm has to know which stop the bus is at, so it needs precise location.
      let access = await checkAccess();
      if (access === 'unknown' || access === 'denied') access = await requestAccess();
      if (access === 'approximate') access = await askForPrecise();
      if (access === 'blocked') {
        setProblem({
          text: tr('Location is turned off for this app. Turn it on in Settings to use the stop alarm.'),
          action: { label: tr('Open settings'), run: openAppSettings },
        });
        return;
      }
      if (access === 'off') {
        setProblem({
          text: tr('Location is switched off on this phone.'),
          action: { label: tr('Turn on location'), run: () => void openLocationSettings() },
        });
        return;
      }
      if (access === 'approximate') {
        setProblem({
          text: tr('The stop alarm needs precise location. With approximate location it cannot tell which stop the bus is at.'),
          action: { label: tr('Open settings'), run: openAppSettings },
        });
        return;
      }
      if (access !== 'precise') {
        setProblem({ text: tr('The stop alarm needs your location while the trip is on.') });
        return;
      }
      await ensureNotificationPermission().catch(() => false);
      const choice = leg.choices.find((ch) => ch.patternId === patternId) ?? leg.choices[0];
      await startTrip(net, {
        patternId: choice.patternId,
        routeNumber: choice.routeNumber,
        operator: choice.operator,
        headsign: towards(net, choice.patternId, choice.headsign),
        destStopId: leg.alightStopId,
        destName: stopName(leg.alightStopId),
        share,
        role: asConductor ? 'conductor' : 'rider',
        // A rider types nothing about the bus: the server puts them on it by where they are.
        plate: asConductor ? busPlate.trim() : undefined,
      });
      onStarted();
    } catch (e) {
      setProblem({ text: e instanceof Error ? e.message : tr('The trip could not start.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      {leg.choices.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{tr('Which bus did you get on?')}</Text>
          <View style={styles.boards}>
            {leg.choices.map((ch) => {
              const selected = ch.patternId === patternId;
              return (
                <Pressable
                  key={ch.patternId}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setPatternId(ch.patternId)}
                  style={[styles.pick, { borderColor: selected ? c.blue : 'transparent', backgroundColor: selected ? c.blueSoft : 'transparent' }]}
                >
                  <RouteBoard number={ch.routeNumber} operator={ch.operator} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <SwitchRow
        label={tr('Share where this bus is')}
        hint={tr('People waiting at stops see the bus coming. Only the bus position is sent, not who you are, and it stops when you get off.')}
        value={share}
        onChange={setShare}
      />
      {share && mayConduct ? (
        <SwitchRow
          label={tr("I'm the conductor")}
          hint={account.owner ? tr('Signed in as {name}, for {owner}', { name: account.name, owner: account.owner }) : undefined}
          value={conductor}
          onChange={setConductor}
        />
      ) : null}
      {asConductor ? (
        <TextInput
          value={busPlate}
          onChangeText={(t) => setBusPlate(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={tr('Number plate of the bus, for example WB 19 A 1234')}
          placeholderTextColor={c.inkSoft}
          accessibilityLabel={tr('Number plate of the bus')}
          style={[font(), styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface2 }]}
        />
      ) : null}
      {asConductor ? (
        <Notice icon="eye">{tr('Its owner sees where the bus is and the trips it runs.')}</Notice>
      ) : share && !mayConduct ? (
        <Pressable accessibilityRole="button" onPress={() => app.push({ name: 'more' })} style={styles.linkRow}>
          <Icon name="user-round" size={18} color={c.blue} />
          <Text style={[font('semibold'), styles.flex, { color: c.blue, fontSize: 15 }]}>{tr('Conductor? Sign in to share as the conductor')}</Text>
        </Pressable>
      ) : null}
      {problem ? (
        <View style={{ gap: 6 }}>
          <Notice icon="triangle-alert" tone="danger">{problem.text}</Notice>
          {problem.action ? (
            <Pressable accessibilityRole="button" onPress={problem.action.run}>
              <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{problem.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Button label={share ? tr('Start trip and share') : tr('Start stop alarm')} icon={share ? 'radio-tower' : 'bell-ring'} onPress={start} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: '38%' },
  steps: { padding: 16, paddingBottom: 40 },
  step: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 36 },
  stepDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 2, flex: 1, marginVertical: 4, minHeight: 12 },
  stepCard: { borderRadius: 18, padding: 14, gap: 6, marginBottom: 12 },
  walkCard: { paddingTop: 8, paddingBottom: 14, gap: 4 },
  boards: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  panel: { gap: 10, marginTop: 4 },
  pick: { borderWidth: 2, borderRadius: 8, padding: 3 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
});
