import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { Button, Icon, Notice } from '../components/ui';
import { tr } from '../i18n';
import type { IconName } from '../icon-data';
import { choosePassword, signIn } from '../services/account';
import { useApp } from '../state/AppState';
import { font, usePalette } from '../theme';

// Signing in, and signing up as a conductor (their bus owner approves them) or as a contributor
// (the Where Is My Bus team approves them). The same accounts as /signin on the website.

type Mode = 'signin' | 'conductor' | 'contributor';

const TABS: [Mode, string, IconName][] = [
  ['signin', 'Sign in', 'log-in'],
  ['conductor', 'Conductor', 'bus-front'],
  ['contributor', 'Contributor', 'map-pinned'],
];

const HEAD: Record<Mode, [string, string]> = {
  signin: ['Welcome back', 'Sign in to share your owner’s buses as the conductor, or to record routes.'],
  conductor: ['Join as a conductor', 'Share your owner’s buses live, so riders know when they come. Your owner approves you.'],
  contributor: ['Become a contributor', 'Help map the city’s buses from inside them. The Where Is My Bus team approves contributors.'],
};

const PERKS: Record<Exclude<Mode, 'signin'>, [IconName, string][]> = {
  conductor: [
    ['bus-front', 'At each trip, type only the bus’s number plate'],
    ['eye', 'Your owner sees where the bus is and its trips'],
    ['radio-tower', 'Riders waiting at stops see your bus coming'],
  ],
  contributor: [
    ['route', 'The phone records the road as you ride'],
    ['map-pin', 'Tap “Stop here” at each stop, and name it'],
    ['shield-check', 'The team checks it before riders see it'],
  ],
};

export function AccountScreen({ mode: firstMode }: { mode: Mode }) {
  const app = useApp();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(firstMode);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changeToken, setChangeToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  const switchTo = (next: Mode) => {
    setMode(next);
    setProblem(null);
    setWaiting(null);
    setPassword('');
  };

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

  const signInNow = () =>
    run(async () => {
      const r = await signIn(phone, password);
      if (!r.done) {
        setChangeToken(r.changeToken);
        return;
      }
      app.pop();
    });

  const chooseNow = () =>
    run(async () => {
      await choosePassword(changeToken as string, newPassword);
      app.pop();
    });

  const signUpNow = () =>
    run(async () => {
      if (mode === 'signin') return;
      const r = await api.signUp({ kind: mode, name, phone, password, ownerPhone: mode === 'conductor' ? ownerPhone : undefined });
      setWaiting(
        mode === 'conductor'
          ? tr('Done. {owner} approves you in their dashboard; then sign in here.', { owner: r.ownerName ?? tr('Your bus owner') })
          : tr('Done. The Where Is My Bus team checks new contributors. Once they approve you, sign in here to record routes.'),
      );
    });

  const [title, subtitle] = changeToken ? ['Choose your password', 'You signed in with a temporary password. Choose your own to carry on.'] : HEAD[mode];

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: c.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { backgroundColor: c.hero, paddingTop: insets.top + 10 }]}>
          <View style={styles.glowBig} />
          <View style={styles.glowSmall} />
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Back')} onPress={app.pop} hitSlop={10} style={styles.back}>
            <Icon name="arrow-left" size={22} color={c.heroInk} />
          </Pressable>
          <Image source={require('../../assets/brand/logo-mark.png')} style={styles.mark} accessible={false} />
          <Text accessibilityRole="header" style={[font('bold'), styles.title, { color: c.heroInk }]}>
            {tr(title)}
          </Text>
          <Text style={[font(), styles.subtitle, { color: c.heroInk }]}>{tr(subtitle)}</Text>
        </View>

        <View style={styles.body}>
          {!changeToken && !waiting ? (
            <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.surface }, c.shadow2]}>
              {TABS.map(([value, label, icon]) => {
                const on = mode === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => switchTo(value)}
                    style={[styles.tab, on ? { backgroundColor: c.blue } : null]}
                  >
                    <Icon name={icon} size={18} color={on ? c.blueInk : c.inkSoft} />
                    <Text numberOfLines={1} style={[font(on ? 'semibold' : 'medium'), { color: on ? c.blueInk : c.inkSoft, fontSize: 13 }]}>
                      {tr(label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: c.surface }, c.shadow2]}>
            {waiting ? (
              <View style={styles.done}>
                <View style={[styles.doneBadge, { backgroundColor: c.liveSoft }]}>
                  <Icon name="check" size={30} color={c.live} />
                </View>
                <Text style={[font('bold'), { color: c.ink, fontSize: 20, textAlign: 'center' }]}>{tr('You are signed up')}</Text>
                <Text style={[font(), { color: c.inkSoft, fontSize: 15, textAlign: 'center', lineHeight: 22 }]}>{waiting}</Text>
                <Button label={tr('Sign in')} icon="log-in" onPress={() => switchTo('signin')} />
              </View>
            ) : changeToken ? (
              <>
                <Field icon="key-round" label={tr('Your new password')} value={newPassword} onChange={setNewPassword} secure={!showPassword} onToggleSecure={() => setShowPassword((v) => !v)} />
                <Text style={[font(), styles.hint, { color: c.inkSoft }]}>{tr('At least 8 characters. Not your mobile number.')}</Text>
                {problem ? <Notice icon="triangle-alert" tone="danger">{problem}</Notice> : null}
                <Button label={tr('Save and sign in')} icon="key-round" onPress={() => void chooseNow()} busy={busy} />
              </>
            ) : (
              <>
                {mode !== 'signin' ? <Field icon="user-round" label={tr('Your name')} value={name} onChange={setName} capitalize="words" /> : null}
                <Field icon="smartphone" label={tr('Mobile number')} value={phone} onChange={setPhone} keyboard="phone-pad" placeholder="98300 12345" />
                {mode === 'conductor' ? (
                  <Field icon="users" label={tr('Your bus owner’s mobile number')} value={ownerPhone} onChange={setOwnerPhone} keyboard="phone-pad" placeholder="98300 54321" />
                ) : null}
                <Field icon="key-round" label={tr('Password')} value={password} onChange={setPassword} secure={!showPassword} onToggleSecure={() => setShowPassword((v) => !v)} />
                {mode !== 'signin' ? <Text style={[font(), styles.hint, { color: c.inkSoft }]}>{tr('At least 8 characters. Not your mobile number.')}</Text> : null}
                {problem ? <Notice icon="triangle-alert" tone="danger">{problem}</Notice> : null}
                {mode === 'signin' ? (
                  <Button label={tr('Sign in')} icon="log-in" onPress={() => void signInNow()} busy={busy} />
                ) : (
                  <Button label={tr('Sign up')} icon="user-round" onPress={() => void signUpNow()} busy={busy} />
                )}
              </>
            )}
          </View>

          {!changeToken && !waiting && mode !== 'signin' ? (
            <View style={styles.perks}>
              {PERKS[mode].map(([icon, text]) => (
                <View key={text} style={styles.perk}>
                  <View style={[styles.perkIcon, { backgroundColor: c.blueSoft }]}>
                    <Icon name={icon} size={18} color={c.blue} />
                  </View>
                  <Text style={[font('medium'), styles.fill, { color: c.ink, fontSize: 15 }]}>{tr(text)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {!changeToken && !waiting && mode === 'signin' ? (
            <View style={styles.newHere}>
              <Text style={[font(), { color: c.inkSoft, fontSize: 15 }]}>{tr('New here?')}</Text>
              <Pressable accessibilityRole="button" onPress={() => switchTo('conductor')} hitSlop={6}>
                <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Sign up as a conductor')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => switchTo('contributor')} hitSlop={6}>
                <Text style={[font('semibold'), { color: c.blue, fontSize: 15 }]}>{tr('Become a contributor')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A labelled field with its icon; it shows where the typing goes, and a password can be shown. */
function Field({
  icon,
  label,
  value,
  onChange,
  keyboard,
  placeholder,
  capitalize = 'none',
  secure,
  onToggleSecure,
}: {
  icon: IconName;
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboard?: 'phone-pad' | 'default';
  placeholder?: string;
  capitalize?: 'none' | 'words';
  secure?: boolean;
  onToggleSecure?: () => void;
}) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[font('semibold'), { color: c.inkSoft, fontSize: 13, letterSpacing: 0.2 }]}>{label}</Text>
      <View style={[styles.field, { borderColor: focused ? c.blue : c.line, backgroundColor: c.surface2 }]}>
        <Icon name={icon} size={20} color={focused ? c.blue : c.inkFaint} />
        <TextInput
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={c.inkFaint}
          keyboardType={keyboard ?? 'default'}
          autoCapitalize={capitalize}
          autoCorrect={false}
          secureTextEntry={secure}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[font(), styles.input, { color: c.ink }]}
        />
        {onToggleSecure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={secure ? tr('Show password') : tr('Hide password')} onPress={onToggleSecure} hitSlop={10}>
            <Icon name="eye" size={20} color={secure ? c.inkFaint : c.blue} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { paddingHorizontal: 22, paddingBottom: 64, overflow: 'hidden', gap: 6 },
  glowBig: { position: 'absolute', right: -70, top: -50, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  glowSmall: { position: 'absolute', left: -40, bottom: -60, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginBottom: 8 },
  mark: { width: 44, height: 55, marginBottom: 6 },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 22, opacity: 0.88 },
  body: { paddingHorizontal: 16, marginTop: -40, gap: 14 },
  tabs: { flexDirection: 'row', borderRadius: 16, padding: 5, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4 },
  card: { borderRadius: 22, padding: 18, gap: 16 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  hint: { fontSize: 13, marginTop: -8 },
  done: { alignItems: 'stretch', gap: 12 },
  doneBadge: { alignSelf: 'center', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  perks: { gap: 12, paddingHorizontal: 4, paddingTop: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perkIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  newHere: { alignItems: 'center', gap: 8, paddingTop: 8 },
});
