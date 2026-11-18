import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Icon, Note, RouteBoard, Screen, StatusItem } from '../components/ui';
import { plural, stopName } from '../format';
import { tr } from '../i18n';
import { endTrip, followLink, type EndReason } from '../services/trip';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

const ENDED: Record<EndReason, string> = {
  user: 'You ended the trip.',
  left_route: 'It looks like you got off, so the trip ended by itself.',
  passed_destination: 'You went past your stop, so the trip ended by itself.',
  location_stopped: 'The phone stopped sending locations, so the trip ended.',
  app_closed: 'The trip ended when the app was closed.',
};

export function TripScreen() {
  const app = useApp();
  const c = usePalette();
  const t = app.trip;
  const [link, setLink] = useState<{ note: string; problem: boolean } | null>(null);

  if (!t.active || !t.config) {
    return (
      <Screen title={tr('Trip')} onBack={app.pop}>
        <View style={styles.pad}>
          <Card raised>
            <View style={[styles.doneDot, { backgroundColor: c.blueSoft }]}>
              <Icon name="check" size={22} color={c.blue} />
            </View>
            <Text style={[font('bold'), styles.headline, { color: c.ink }]}>{tr('Trip ended')}</Text>
            {t.ended ? <Note>{tr(ENDED[t.ended.reason])}</Note> : null}
          </Card>
          <Button label={tr('Plan a journey')} icon="search" onPress={app.reset} />
        </View>
      </Screen>
    );
  }

  const cfg = t.config;
  const s = t.state;
  // Stop names in the app's language: the trip knows the stops by id.
  const nameAt = (id: string | null, fallback: string | null) => (id && app.net ? stopName(app.net, id) : fallback);
  let label: string | null = null;
  let headline: string;
  let detail: string | null = null;
  if (!s || s.status === 'waiting_for_fix') {
    headline = tr('Finding your position…');
  } else if (s.status === 'off_route') {
    headline = tr('You seem to be off route {route}', { route: cfg.routeNumber });
    detail = tr('If you have got off, the trip ends by itself in about a minute.');
  } else if (s.status === 'arrived') {
    const dest = nameAt(s.destStopId, s.destName);
    headline = dest ? tr('This is {stop}', { stop: dest }) : tr('This is your stop');
    detail = tr('Get off here.');
  } else {
    label = tr('Next stop');
    headline = nameAt(s.nextStopId, s.nextStopName) ?? tr('Last stop');
  }

  const toGo =
    cfg.destName && s && s.stopsToGo !== null && s.status === 'on_route'
      ? tr('{stop}: {stops} to go, about {min} min', { stop: cfg.destName, stops: plural(s.stopsToGo, 'stop', 'stops'), min: s.etaMin ?? 0 })
      : null;

  const alarm =
    s?.alarm === 'waiting'
      ? tr('The alarm rings about 800 m before {stop}.', { stop: cfg.destName ?? '' })
      : s?.alarm === 'done'
        ? tr('The stop alarm has rung.')
        : cfg.destName
          ? tr('The alarm rings about 800 m before {stop}.', { stop: cfg.destName })
          : null;

  const updates = plural(t.sent, 'update', 'updates');
  const sharing = !cfg.share
    ? tr('Not sharing. Only the stop alarm is on.')
    : t.online === false || !t.sharing
      ? tr('No internet right now. The bus position is saved and sent when you are back online.')
      : t.bus
        ? tr('Sharing bus {plate} as the conductor. {updates} sent.', { plate: t.bus.plate, updates })
        : t.role === 'conductor'
          ? tr("Sharing this bus's position as the conductor. {updates} sent.", { updates })
          : tr("Sharing this bus's position. {updates} sent.", { updates });
  // For family: a link showing the bus move and when it reaches the rider's stop.
  async function shareLink() {
    try {
      const url = await followLink();
      const r = await Share.share({ title: tr('Follow my bus'), message: `${tr('See where my bus is, and when it reaches my stop.')} ${url}` });
      if (r.action === Share.sharedAction) setLink({ note: tr('Anyone with this link sees the bus until your trip ends.'), problem: false });
    } catch (e) {
      setLink({ note: e instanceof Error ? tr(e.message) : tr('The link could not be made.'), problem: true });
    }
  }
  // The code was the bus's own, so its owner sees this trip: the conductor is told so.
  const owner =
    cfg.share && t.bus
      ? t.bus.owner
        ? tr('{owner}, its owner, sees where the bus is and the trips it runs.', { owner: t.bus.owner })
        : tr('Its owner sees where the bus is and the trips it runs.')
      : null;

  return (
    <Screen
      title={tr('Bus {route}', { route: cfg.routeNumber })}
      onBack={app.pop}
      footer={<Button kind="danger" icon="x" label={tr('End trip')} onPress={() => void endTrip('user')} />}
    >
      <ScrollView contentContainerStyle={styles.pad}>
        <Card raised style={styles.tripCard}>
          <View style={styles.route}>
            <RouteBoard number={cfg.routeNumber} operator={cfg.operator} size="lg" />
            <Text style={[font('medium'), styles.flex, { color: c.inkSoft, fontSize: 16 }]}>{tr('Towards {place}', { place: cfg.headsign })}</Text>
          </View>
          <View accessibilityLiveRegion="polite" style={styles.now}>
            {label ? <Text style={[font('semibold'), styles.label, { color: c.inkFaint }]}>{label}</Text> : null}
            <Text style={[font('bold'), styles.headline, { color: c.ink }]}>{headline}</Text>
            {detail ? <Note>{detail}</Note> : null}
          </View>
          {toGo ? (
            <View style={[styles.togo, { backgroundColor: c.blueSoft }]}>
              <Icon name="clock" size={18} color={c.blueStrong} />
              <Text style={[font('semibold'), styles.flex, { color: c.blueStrong, fontSize: 16 }]}>{toGo}</Text>
            </View>
          ) : null}
        </Card>
        <View style={styles.status}>
          {alarm ? <StatusItem icon="bell-ring">{alarm}</StatusItem> : null}
          <StatusItem icon={cfg.share ? 'radio-tower' : 'bell'}>{sharing}</StatusItem>
          {owner ? <StatusItem icon="eye">{owner}</StatusItem> : null}
          {cfg.share && t.role === 'rider' && t.onBus?.conductor ? (
            <StatusItem icon="bus-front">
              {t.onBus.plate
                ? tr('You are on the bus its conductor is sharing (number plate ending {plate}).', { plate: t.onBus.plate })
                : tr('You are on the bus its conductor is sharing.')}
            </StatusItem>
          ) : null}
        </View>
        {cfg.share && cfg.role === 'rider' && t.sharing ? (
          <Button kind="secondary" icon="link" label={tr('Share a link to follow this bus')} onPress={() => void shareLink()} />
        ) : null}
        {link ? <Note tone={link.problem ? 'danger' : 'soft'}>{link.note}</Note> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 16 },
  tripCard: { borderRadius: 22, padding: 18, gap: 14 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  now: { gap: 4, paddingTop: 4 },
  label: { fontSize: 14, letterSpacing: 0.3 },
  headline: { fontSize: 32, lineHeight: 40, letterSpacing: -0.4 },
  togo: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  status: { gap: 12, paddingHorizontal: 4 },
  doneDot: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
