import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type RecordingInfo } from '../api';
import { Button, Card, Icon, Note, Notice, Screen, StatusItem } from '../components/ui';
import { digits, tr } from '../i18n';
import { askForPrecise, checkAccess, ensureNotificationPermission, requestAccess } from '../native/location';
import { useAccount } from '../services/account';
import { cancelRecording, finishRecording, markStop, resetRecording, startRecording, useRecording } from '../services/recording';
import { plural } from '../format';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

// A contributor records a route from inside the bus (services/recording.ts): the road, and each
// stop they mark as the bus reaches it. The team checks it in the admin panel before riders see it.

export function RecordScreen() {
  const app = useApp();
  const c = usePalette();
  const account = useAccount();
  const rec = useRecording();
  const [name, setName] = useState('');
  const [stopName, setStopName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [past, setPast] = useState<RecordingInfo[]>([]);

  useEffect(() => {
    if (account?.kind === 'contributor' && rec.status !== 'recording') void api.recordings(account.key).then(setPast, () => undefined);
  }, [account, rec.status]);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await job();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : tr('Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      let access = await checkAccess();
      if (access === 'unknown' || access === 'denied') access = await requestAccess();
      if (access === 'approximate') access = await askForPrecise();
      if (access !== 'precise') throw new Error(tr('Recording a route needs precise location while you record.'));
      await ensureNotificationPermission().catch(() => false);
      await startRecording(name);
      setName('');
    });

  if (account?.kind !== 'contributor') {
    return (
      <Screen title={tr('Record a route')} onBack={app.pop}>
        <View style={styles.pad}>
          <Note>{tr('Only contributors record routes. Sign up as a contributor first.')}</Note>
          <Button label={tr('Become a contributor')} icon="map-pinned" onPress={() => app.push({ name: 'account', mode: 'contributor' })} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={rec.status === 'recording' ? tr('Recording a route') : tr('Record a route')} onBack={app.pop}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        {rec.status === 'idle' ? (
          <>
            <Note>{tr('Get on the bus at its first stop and start. At each stop, tap “Stop here” as the bus stands there; add the stop’s name if you know it. Finish at the last stop.')}</Note>
            <View style={{ gap: 6 }}>
              <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{tr('Which route and direction?')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={tr('For example: 8B towards Jadavpur')}
                placeholderTextColor={c.inkSoft}
                accessibilityLabel={tr('Which route and direction?')}
                style={[font(), styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
              />
            </View>
            {problem ? <Notice icon="triangle-alert" tone="danger">{problem}</Notice> : null}
            <Button label={tr('Start recording')} icon="radio-tower" onPress={() => void start()} busy={busy} />
            {past.length ? (
              <View style={{ gap: 8 }}>
                <Text accessibilityRole="header" style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Your recordings')}</Text>
                {past.map((r) => (
                  <StatusItem key={r.id} icon={r.finishedAt ? 'check' : 'clock'}>
                    {`${r.name} · ${plural(r.marks, 'stop', 'stops')} · ${r.finishedAt ? tr('Sent to the team') : tr('Not finished')}`}
                  </StatusItem>
                ))}
              </View>
            ) : null}
          </>
        ) : rec.status === 'recording' ? (
          <>
            <Card raised style={{ gap: 10 }}>
              <Text style={[font('bold'), { color: c.ink, fontSize: 20 }]}>{rec.name}</Text>
              <StatusItem icon="radio-tower">
                {rec.hasFix ? tr('{n} positions sent.', { n: digits(String(rec.sent)) }) : tr('Waiting for your position…')}
              </StatusItem>
              {!rec.online ? <StatusItem icon="wifi-off">{tr('No internet right now. The positions are kept and sent when you are back online.')}</StatusItem> : null}
              <StatusItem icon="map-pin">{plural(rec.marks.length, 'stop', 'stops')}</StatusItem>
            </Card>

            <View style={{ gap: 6 }}>
              <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{tr('Name of this stop (optional)')}</Text>
              <TextInput
                value={stopName}
                onChangeText={setStopName}
                placeholder={tr('For example: Gariahat More')}
                placeholderTextColor={c.inkSoft}
                accessibilityLabel={tr('Name of this stop (optional)')}
                style={[font(), styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
              />
            </View>
            <Button
              label={tr('Stop here')}
              icon="map-pin"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  await markStop(stopName);
                  setStopName('');
                })
              }
            />
            {problem ? <Notice icon="triangle-alert" tone="danger">{problem}</Notice> : null}

            {rec.marks.length ? (
              <View style={{ gap: 6 }}>
                {rec.marks.map((m, i) => (
                  <View key={`${m.ts}-${i}`} style={styles.mark}>
                    <View style={[styles.num, { backgroundColor: c.blueSoft }]}>
                      <Text style={[font('semibold'), { color: c.blue, fontSize: 13 }]}>{digits(String(i + 1))}</Text>
                    </View>
                    <Text style={[font('medium'), { color: c.ink, fontSize: 15 }]}>{m.name || tr('Stop {n}', { n: digits(String(i + 1)) })}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Button label={tr('Finish and send to the team')} icon="send" kind="secondary" busy={busy} onPress={() => void run(finishRecording)} />
            <Button label={tr('Stop without sending')} icon="x" kind="danger" onPress={() => void run(cancelRecording)} />
          </>
        ) : (
          <>
            <Card raised style={{ gap: 10 }}>
              <View style={[styles.done, { backgroundColor: c.blueSoft }]}>
                <Icon name="check" size={22} color={c.blue} />
              </View>
              <Text style={[font('bold'), { color: c.ink, fontSize: 22 }]}>{tr('Sent to the team')}</Text>
              <Text style={[font('medium'), { color: c.ink, fontSize: 16 }]}>{rec.name}</Text>
              <Note>
                {tr('{km} km, about {min} min, {stops}.', { km: digits(String(rec.km)), min: digits(String(rec.minutes)), stops: plural(rec.stops, 'stop', 'stops') })}
              </Note>
              <Note>{tr('The team checks it before anything changes for riders. Thank you.')}</Note>
            </Card>
            <Button label={tr('Record another')} icon="route" onPress={resetRecording} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 14, paddingBottom: 40 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  done: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
