import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { Button, Icon, Note, Notice, RouteBoard, Screen } from '../components/ui';
import type { IconName } from '../icon-data';
import { nameOf, tr } from '../i18n';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

// Riders tell the people who keep the routes right what is wrong: a stop in the wrong place, a
// route that stops somewhere else, times that are off. It goes to the admins' review queue, as
// from the web app (web/src/screens/suggest.ts).

type Kind = 'stop' | 'route' | 'times' | 'other';

const KINDS: [Kind, string, IconName, string][] = [
  ['stop', 'A stop', 'map-pin', 'For example: the 8B stop is across the road, by the petrol pump.'],
  ['route', 'A route', 'route', 'For example: D2 also stops at Lake Mall.'],
  ['times', 'Times', 'clock', 'For example: the last D2 is at 22:30, not 21:00.'],
  ['other', 'Something else', 'message-square-warning', 'What should we fix?'],
];

export function SuggestScreen({ routeIds = [], stopId, kind: firstKind, text: firstText = '' }: { routeIds?: string[]; stopId?: string; kind?: Kind; text?: string }) {
  const app = useApp();
  const c = usePalette();
  const [kind, setKind] = useState<Kind>(firstKind ?? (routeIds.length ? 'route' : 'stop'));
  const [routeId, setRouteId] = useState(routeIds[0] ?? '');
  const [text, setText] = useState(firstText);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stop = stopId ? app.net?.stops.get(stopId) : undefined;
  const routes = routeIds.flatMap((id) => {
    const r = app.net?.routes.get(id);
    return r ? [r] : [];
  });

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      await api.suggest({ kind, text, routeId: kind !== 'stop' && routeId ? routeId : undefined, stopId: stop?.id });
      setSent(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : tr('The suggestion could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen title={tr('Suggest a fix')} onBack={app.pop}>
        <View style={styles.pad}>
          <Notice icon="check">{tr('Thank you. The people who keep the routes right will look at it.')}</Notice>
          <Button kind="secondary" label={tr('Back')} onPress={app.pop} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={tr('Suggest a fix')} onBack={app.pop}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Note>{tr('Nothing changes at once: the people who keep the routes right check it first.')}</Note>
        <Text style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('What is it about?')}</Text>
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {KINDS.map(([k, label, icon]) => {
            const selected = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setKind(k)}
                style={[styles.choice, { borderColor: selected ? c.blue : c.line, backgroundColor: selected ? c.blueSoft : c.surface }]}
              >
                <Icon name={icon} size={20} color={selected ? c.blue : c.inkSoft} />
                <Text style={[font(selected ? 'semibold' : 'medium'), { color: c.ink, fontSize: 16 }]}>{tr(label)}</Text>
              </Pressable>
            );
          })}
        </View>
        {routes.length && kind !== 'stop' ? (
          <View style={{ gap: 8 }}>
            <Text style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('Which route?')}</Text>
            <View accessibilityRole="radiogroup" style={styles.boards}>
              {routes.map((r) => {
                const selected = routeId === r.id;
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={tr('Route {route}', { route: r.number })}
                    onPress={() => setRouteId(r.id)}
                    style={[styles.pick, { borderColor: selected ? c.blue : 'transparent', backgroundColor: selected ? c.blueSoft : 'transparent' }]}
                  >
                    <RouteBoard number={r.number} operator={r.operator} mode={r.mode} color={r.color} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {stop ? <Note>{tr('About {stop}', { stop: nameOf(stop) })}</Note> : null}
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          maxLength={600}
          placeholder={tr(KINDS.find((k) => k[0] === kind)?.[3] ?? '')}
          placeholderTextColor={c.inkSoft}
          accessibilityLabel={tr('What should we fix?')}
          style={[font(), styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface2 }]}
        />
        {problem ? <Notice icon="triangle-alert" tone="danger">{problem}</Notice> : null}
        <Button label={tr('Send')} icon="send" onPress={send} busy={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 14 },
  heading: { fontSize: 16 },
  choices: { gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  boards: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  pick: { borderWidth: 2, borderRadius: 8, padding: 3 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 110, textAlignVertical: 'top' },
});
