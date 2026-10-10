import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { householdOf, todayIn, type AskIntent, type AskKind, type CopyKey } from '@mada/shared';
import { Button, LinkButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { DemoSheet } from '@/components/booking/DemoSheet';
import { FlightFlow, type Cta } from '@/components/booking/FlightFlow';
import { EsimFlow, PlanFlow, StayFlow } from '@/components/booking/OtherFlows';
import { ChipWrap, Notice } from '@/components/booking/parts';
import { RequestFlow } from '@/components/booking/Requests';
import { ApiError } from '@/lib/api';
import { bookingApi, useDemo } from '@/lib/booking';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors, font, ff } from '@/theme';

/*
 * Ask: one composer for flights, stays, plans and anything a person at Mada does by hand (FLOWS.md §2–4). What was typed
 * is read on the server (POST /ask/parse), then one question at a time, then the results with the one action at the
 * bottom. Opened by the sun orb, Today's shortcuts, or with ?prefill= / ?intent= from anywhere.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const PROMPT: Partial<Record<AskKind, CopyKey>> = { flight: 'ask.prompt.flight', stay: 'ask.prompt.stay', visa: 'ask.prompt.visa', umrah: 'ask.prompt.umrah', car: 'ask.prompt.car', food: 'ask.prompt.food', todo: 'ask.prompt.todo', esim: 'ask.prompt.esim' };

export default function Ask() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prefill?: string; intent?: string }>();
  const bottom = useBottomInset();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const people = usePeople();
  const offline = useDemo((s) => s.on.has('offline'));
  const today = todayIn();
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<AskIntent | null>(null);
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState('');
  const [cta, setCta] = useState<Cta>(null);
  const [parsing, setParsing] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const selfName = user?.name ?? '';
  const household = people.data ?? [];

  const submit = async (text: string, kindHint?: AskKind) => {
    const v = text.trim();
    if (!v) return;
    buzz('tap');
    setQuery(v); setCta(null); setDraft('');
    if (status !== 'signedIn') { setNeedsSignIn(true); return; }
    setParsing(true);
    try {
      const { intent: it } = await bookingApi.parse(v);
      setIntent(kindHint ? { ...it, kind: kindHint } : it);
      setRound((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') {
        // Offline: requests can still be written and saved; searching waits for a connection.
        setIntent({ kind: kindHint ?? 'general', destination: null, destinationName: null, from: null, depart: null, return: null, tripType: null, monthOnly: null, cabin: null, cabinNote: null, travellerIds: null, travellerCount: null, infants: 0, needs: {}, needsMentioned: [], answers: {}, ask: null, source: 'rules' });
        setRound((r) => r + 1);
      } else toast(e instanceof Error ? e.message : t('error.internal'));
    } finally { setParsing(false); }
  };

  useEffect(() => {
    if (params.prefill) void submit(String(params.prefill));
    else if (params.intent && PROMPT[params.intent as AskKind]) void submit(t(PROMPT[params.intent as AskKind]!), params.intent as AskKind);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = intent?.kind;
  let body: React.ReactNode;
  if (!intent) body = parsing ? null : <Start onPick={(x) => submit(x)} people={household} today={today} />;
  else if (offline && (kind === 'flight' || kind === 'stay')) body = <Notice icon="wifiOff" title={t('ask.offline.title')}><T v="small">{t('ask.offline.body')}</T></Notice>;
  else if (kind === 'flight') body = <FlightFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} />;
  else if (kind === 'stay') body = <StayFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} />;
  else if (kind === 'plan') body = <PlanFlow key={round} query={query} people={household} today={today} />;
  else if (kind === 'esim') body = <EsimFlow key={round} />;
  else body = <RequestFlow key={round} kind={kind as 'visa'} query={query} intent={intent} people={household} selfName={selfName} />;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar onBack={() => router.back()} backLabel={t('ask.close')} right={SHOW_DEMO_HINTS ? (
          <Pressable accessibilityRole="button" onPress={() => setDemoOpen(true)} style={styles.demo} testID="ask-demo"><T v="caption" color={colors.goldInk}>{t('ask.demo.open')}</T></Pressable>
        ) : undefined} />
        <T v="tiny" style={{ marginHorizontal: 24, marginBottom: 8 }}>{t('ask.disclosure')}</T>
        <Animated.ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: 170 + bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {query ? <Animated.View entering={rise(0)} style={styles.bubble}><T style={[font('body', colors.mist), { fontSize: 16, lineHeight: 22 }]}>{query}</T></Animated.View> : null}
          {body}
        </Animated.ScrollView>
        <View style={[styles.act, { paddingBottom: 24 + bottom }]} pointerEvents="box-none">
          {cta && !offline ? (
            <>
              <Button label={cta.label} disabled={cta.disabled} onPress={cta.onPress} testID={cta.testID ?? 'ask-cta'} />
              <View style={{ alignSelf: 'center' }}><LinkButton label={t('ask.somethingElse')} size={13} onPress={() => setCta(null)} /></View>
            </>
          ) : (
            <View style={styles.composer}>
              <TextInput value={draft} onChangeText={setDraft} placeholder={intent ? t('ask.composerMore') : t('ask.composer')} placeholderTextColor={colors.muted} accessibilityLabel={t('ask.a11y.input')}
                onSubmitEditing={() => submit(draft)} returnKeyType="send" style={[styles.input, webNoOutline]} testID="ask-input" />
              <Pressable accessibilityRole="button" accessibilityLabel={draft ? t('ask.a11y.send') : t('ask.a11y.talk')} onPress={() => (draft ? submit(draft) : toast(t('ask.voice')))} style={styles.send} testID="ask-send">
                <Icon name={draft ? 'up' : 'mic'} color={colors.mist} size={20} />
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      <DemoSheet visible={demoOpen} onClose={() => setDemoOpen(false)} />
      <Sheet visible={needsSignIn} label={t('ask.signin.title')} onClose={() => { setNeedsSignIn(false); router.back(); }}>
        <T v="h2">{t('ask.signin.title')}</T>
        <T v="body">{t('ask.signin.body')}</T>
        <Button label={t('ask.signin.go')} onPress={() => { setNeedsSignIn(false); router.replace('/signin'); }} />
        <Button variant="ghost" label={t('common.notNow')} onPress={() => { setNeedsSignIn(false); router.back(); }} />
      </Sheet>
    </Screen>
  );
}

function Start({ onPick, people, today }: { onPick: (x: string) => void; people: ReturnType<typeof usePeople>['data'] & object; today: string }) {
  const H = householdOf(people, today);
  const n = H.nonHelper.length;
  const kid = H.kids[0]?.firstName;
  const ideas = n > 2
    ? [t('ask.idea.familyEid', { count: n }), t('ask.idea.hotel'), kid ? t('ask.idea.visaFor', { name: kid }) : t('ask.idea.visa'), t('ask.idea.umrah')]
    : [t('ask.idea.flights'), t('ask.idea.dubai'), t('ask.idea.hotel'), t('ask.idea.alula'), t('ask.idea.umrah')];
  return (
    <Animated.View entering={rise(0)} style={{ gap: 14 }}>
      <T style={[font('display'), { fontSize: 40, lineHeight: 42 }]} accessibilityRole="header">{t('ask.title')}</T>
      <T v="body">{t('ask.intro')}</T>
      <ChipWrap>{ideas.map((i) => <Chip key={i} label={i} background={colors.paper} onPress={() => onPick(i)} />)}</ChipWrap>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 16, paddingTop: 4 },
  bubble: { alignSelf: 'flex-end', maxWidth: '78%', backgroundColor: colors.green, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 22, borderBottomRightRadius: 6 },
  act: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingTop: 28, paddingHorizontal: 20, gap: 6, backgroundColor: 'rgba(233,226,216,0.96)' },
  composer: { height: 56, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 20, paddingEnd: 6, flexDirection: 'row', alignItems: 'center', gap: 8, boxShadow: '0px 10px 30px -18px rgba(30,53,45,0.4)' },
  input: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  send: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  demo: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.goldWash, justifyContent: 'center' },
});
