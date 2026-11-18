import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Icon, Note, Screen } from '../components/ui';
import { setLang, tr, useLang } from '../i18n';
import type { IconName } from '../icon-data';
import { signOut, useAccount, type Account } from '../services/account';
import { useRecording } from '../services/recording';
import { useApp } from '../state/AppState';
import { font, setThemeChoice, usePalette, useThemeChoice, type ThemeChoice } from '../theme';

// Settings and account: the language, the theme, signing in (conductors share their owner's buses
// as the conductor; contributors record routes), and becoming a contributor.

const THEMES: [ThemeChoice, string, IconName][] = [
  ['system', 'Same as the phone', 'smartphone'],
  ['light', 'Light', 'sparkles'],
  ['dark', 'Dark', 'star'],
];

function who(a: Account): string {
  if (a.kind === 'conductor') return tr('Conductor for {owner}', { owner: a.owner ?? '' });
  if (a.kind === 'manager') return tr('Manager for {owner}', { owner: a.owner ?? '' });
  if (a.kind === 'owner') return tr('Bus owner: {owner}', { owner: a.owner ?? '' });
  if (a.kind === 'contributor') return tr('Contributor: you record routes for the team to check');
  return tr('Route syndicate');
}

export function MoreScreen() {
  const app = useApp();
  const c = usePalette();
  const account = useAccount();
  const theme = useThemeChoice();
  const lang = useLang();
  const recording = useRecording();
  const credits = app.net?.network.attribution ?? [];

  return (
    <Screen title={tr('Settings and account')} onBack={app.pop}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Text accessibilityRole="header" style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('Account')}</Text>
        {account ? (
          <Card raised style={{ gap: 12 }}>
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: c.blueSoft }]}>
                <Icon name="user-round" size={22} color={c.blue} />
              </View>
              <View style={styles.flex}>
                <Text style={[font('bold'), { color: c.ink, fontSize: 17 }]}>{account.name}</Text>
                <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>{who(account)}</Text>
              </View>
            </View>
            {account.kind === 'conductor' ? <Note>{tr('When you get on your bus, plan the journey, tap “I’m on this bus” and type the bus’s number plate.')}</Note> : null}
            {account.kind === 'contributor' ? (
              <Button label={recording.status === 'recording' ? tr('Recording a route') : tr('Record a route')} icon="route" onPress={() => app.push({ name: 'record' })} />
            ) : null}
            <Button kind="secondary" icon="log-out" label={tr('Sign out')} onPress={() => void signOut()} />
          </Card>
        ) : (
          <Card raised style={{ gap: 12 }}>
            <Note>{tr('Conductors sign in to share their owner’s buses as the conductor. Contributors sign in to record routes.')}</Note>
            <Button icon="log-in" label={tr('Sign in')} onPress={() => app.push({ name: 'account', mode: 'signin' })} />
            <Button kind="secondary" icon="bus-front" label={tr('Sign up as a conductor')} onPress={() => app.push({ name: 'account', mode: 'conductor' })} />
          </Card>
        )}

        {!account ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => app.push({ name: 'account', mode: 'contributor' })}
            style={({ pressed }) => [styles.contribute, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.line }]}
          >
            <View style={[styles.avatar, { backgroundColor: c.liveSoft }]}>
              <Icon name="map-pinned" size={22} color={c.live} />
            </View>
            <View style={styles.flex}>
              <Text style={[font('semibold'), { color: c.ink, fontSize: 16 }]}>{tr('Become a contributor')}</Text>
              <Text style={[font(), { color: c.inkSoft, fontSize: 14 }]}>
                {tr('Record routes from inside the bus: the road it takes and where it stops. The team checks them before riders see them.')}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color={c.inkFaint} />
          </Pressable>
        ) : null}

        <Text accessibilityRole="header" style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('Language')}</Text>
        {/* Each language named in its own script, so whoever reads only that one finds it. */}
        <View accessibilityRole="radiogroup" style={styles.pair}>
          {(
            [
              ['en', 'English', 'en-IN'],
              ['bn', 'বাংলা', 'bn-IN'],
            ] as const
          ).map(([value, label, code]) => {
            const on = lang === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLanguage={code}
                onPress={() => setLang(value)}
                style={[styles.choice, styles.flex, { borderColor: on ? c.blue : c.line, backgroundColor: on ? c.blueSoft : c.surface }]}
              >
                <Icon name="languages" size={20} color={on ? c.blue : c.inkSoft} />
                <Text style={[font(on ? 'semibold' : 'medium'), styles.flex, { color: c.ink, fontSize: 16 }]}>{label}</Text>
                {on ? <Icon name="check" size={20} color={c.blue} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text accessibilityRole="header" style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('Theme')}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {THEMES.map(([value, label, icon]) => {
            const on = theme === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setThemeChoice(value)}
                style={[styles.choice, { borderColor: on ? c.blue : c.line, backgroundColor: on ? c.blueSoft : c.surface }]}
              >
                <Icon name={icon} size={20} color={on ? c.blue : c.inkSoft} />
                <Text style={[font(on ? 'semibold' : 'medium'), styles.flex, { color: c.ink, fontSize: 16 }]}>{tr(label)}</Text>
                {on ? <Icon name="check" size={20} color={c.blue} /> : null}
              </Pressable>
            );
          })}
        </View>

        {credits.length ? (
          <>
            <Text accessibilityRole="header" style={[font('semibold'), styles.heading, { color: c.ink }]}>{tr('Data sources')}</Text>
            {/* The credits the route data's licences require, each opening its licence or source. */}
            <Card style={{ gap: 10 }}>
              {credits.map((a) => (
                <Pressable
                  key={a.text}
                  accessibilityRole={a.url ? 'link' : 'text'}
                  disabled={!a.url}
                  onPress={() => (a.url ? void Linking.openURL(a.url) : undefined)}
                  style={styles.row}
                >
                  <Icon name={a.url ? 'link' : 'info'} size={18} color={a.url ? c.blue : c.inkSoft} />
                  <Text style={[font(a.url ? 'medium' : 'regular'), styles.flex, { color: a.url ? c.blue : c.inkSoft, fontSize: 14 }]}>{a.text}</Text>
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 14, paddingBottom: 40 },
  heading: { fontSize: 16, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  contribute: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  pair: { flexDirection: 'row', gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
});
