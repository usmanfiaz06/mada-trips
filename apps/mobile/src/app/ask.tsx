import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { REQUEST_FORMS, languageOfText, t as tShared, askIntentOfRules, correctAsk, householdOf, parseAskRules, partyOfPeople, todayIn, type AskIntent, type AskKind, type CopyKey, type Person, type RequestFormKind } from '@mada/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, LinkButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { DemoSheet } from '@/components/booking/DemoSheet';
import { FlightFlow, type Cta } from '@/components/booking/FlightFlow';
import { EsimFlow, PlanFlow, StayFlow } from '@/components/booking/OtherFlows';
import { UmrahFlow } from '@/components/booking/UmrahFlow';
import { ChipWrap, Notice, enter } from '@/components/booking/parts';
import { AskReplyContext, ReplyBar, RequestFlow } from '@/components/booking/Requests';
import { MeBubble } from '@/components/booking/Conversation';
import { IdeaTiles } from '@/components/trips/ui';
import { ApiError, api } from '@/lib/api';
import { carryOverGuestPeople } from '@/lib/guest';
import { keys, usePeople } from '@/lib/queries';
import { flushAsk, loadAsk, noteAskSettled, peekAsk, remapAsk, saveAsk, setRelaunchTo } from '@/lib/resume';
import { bookingApi, useDemo } from '@/lib/booking';
import { SHOW_DEMO_SWITCHES } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { appLocale, setVoice, switchLanguage, t, useVoiceLocale } from '@/lib/i18n';
import { ASK_RESUME } from '@/lib/signin-ask';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useVoice } from '@/lib/voice';
import { colors, font, ff } from '@/theme';

/*
 * Ask: one composer for flights, stays, plans and anything a person at Mada does by hand (FLOWS.md §2–4). What was typed
 * is read on the server (POST /ask/parse), then one question at a time, then the results with the one action at the
 * bottom. Opened by the sun orb, Today's shortcuts, or with ?prefill= / ?intent= from anywhere.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
/** What the flow on screen has settled (asked there, not typed), so a correction starts from it. One Ask at a time. */
let settled: Partial<AskIntent> = {};
// Also kept on the phone (lib/resume.ts): a sign-in, a language switch or a reload comes back to the same search.
const onSync = (p: Partial<AskIntent>) => { settled = { ...settled, ...p }; noteAskSettled(p); };
const forgetSettled = () => { settled = {}; };
const PROMPT: Partial<Record<AskKind, CopyKey>> = { flight: 'ask.prompt.flight', stay: 'ask.prompt.stay', visa: 'ask.prompt.visa', umrah: 'ask.prompt.umrah', car: 'ask.prompt.car', food: 'ask.prompt.food', todo: 'ask.prompt.todo', esim: 'ask.prompt.esim' };

export default function Ask() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prefill?: string; intent?: string; resume?: string }>();
  const qc = useQueryClient();
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
  // Speak instead of type: the words land in the box as they're heard, to check before sending.
  const voice = useVoice({
    onText: (text) => setDraft(text),
    onProblem: (p) => { buzz('soft'); toast(t(p === 'denied' ? 'ask.voice.denied' : p === 'none' ? 'ask.voice.none' : p === 'unsupported' ? 'ask.voice.unsupported' : 'ask.voice.failed')); },
  });
  const [cta, setCta] = useState<Cta>(null);
  const [parsing, setParsing] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  // A request sent from here: its thread takes the bottom box (one composer, never two). "Ask something else" gives it back.
  const [replyTo, setReplyTo] = useState<{ id: string; agent: string } | null>(null);
  const [askNew, setAskNew] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // The corrections typed since the ask, shown as bubbles.
  const [fixes, setFixes] = useState<string[]>([]);
  const [fixing, setFixing] = useState<string | null>(null);
  const onReply = useCallback((r: { id: string; agent: string } | null) => { setReplyTo(r); setAskNew(false); }, []);
  const selfName = user?.name ?? '';
  const household = people.data ?? [];

  /** "we are 5", "December", "عندي تصريح": change the answer in hand instead of starting again. */
  const correct = (text: string): 'done' | 'unclear' | 'new' => {
    if (!intent || askNew || replyTo) return 'new';
    const c = correctAsk({ ...intent, ...settled }, text, { today, people: household });
    if (c.type !== 'apply') return c.type;
    buzz('tap');
    forgetSettled();
    setFixes((f) => [...f, text]); setFixing(null); setDraft(''); setCta(null);
    setIntent(c.intent); setRound((r) => r + 1);
    toast(c.changed.length === 1 && c.changed[0] === 'permit' ? t('fix.permit') : t('fix.done'));
    return 'done';
  };
  /** Mada couldn't tell what to change: ask again from that question, or start something new. */
  const fix = (what: 'who' | 'when' | 'where' | 'new') => {
    const text = fixing;
    setFixing(null);
    if (what === 'new') { if (text) void submit(text, undefined, true); return; }
    if (!intent) return;
    const base: AskIntent = { ...intent, ...settled, answers: { ...intent.answers } };
    if (what === 'who') Object.assign(base, { travellerIds: null, party: base.party ?? partyOfPeople(household, base.travellerIds ?? [], today, base.infants) });
    if (what === 'when') { Object.assign(base, { depart: null, return: null, monthOnly: null }); delete base.answers.when; }
    if (what === 'where') { Object.assign(base, { destination: null, destinationName: null }); delete base.answers.where; }
    buzz('tap');
    forgetSettled();
    setCta(null); setIntent({ ...base, ask: what }); setRound((r) => r + 1);
  };

  const submit = async (text: string, kindHint?: AskKind, fresh = false) => {
    const v = text.trim();
    if (!v) return;
    if (!fresh && !kindHint) {
      const r = correct(v);
      if (r === 'done') return;
      if (r === 'unclear') { buzz('soft'); setDraft(''); setFixing(v); return; }
    }
    buzz('tap');
    forgetSettled();
    // Mada answers in the language this was written in, whatever the app is set to (per message).
    setVoice(languageOfText(v));
    setQuery(v); setCta(null); setDraft(''); setReplyTo(null); setAskNew(false); setFixes([]); setFixing(null);
    // Anyone can ask and see prices; signing in waits for an account action (lib/signin-ask.ts).
    setParsing(true);
    try {
      const { intent: it } = await bookingApi.parse(v);
      const next = kindHint ? { ...it, kind: kindHint } : it;
      saveAsk(v, next);
      setIntent(next);
      setRound((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') {
        // Offline: requests can still be written and saved; searching waits for a connection.
        // Offline: the same rules the server runs read it here, so requests can still be written and saved.
        const r = parseAskRules(v, { today, people: household });
        const next = askIntentOfRules(r, kindHint ?? r.kind);
        saveAsk(v, next);
        setIntent(next);
        setRound((r) => r + 1);
      } else toast(e instanceof Error ? e.message : t('error.internal'));
    } finally { setParsing(false); }
  };

  /**
   * The saved search back on screen, with the option picked (lib/resume.ts). Signed in since it was saved: the people
   * added as a guest move onto the account first, so the search runs for them.
   */
  const restore = async () => {
    const snap = await loadAsk();
    if (!snap) return false;
    let it = snap.intent;
    if (useSession.getState().status === 'signedIn') {
      const map = await carryOverGuestPeople(api).catch(() => new Map<string, string>());
      if (map.size) {
        remapAsk(map);
        it = { ...it, travellerIds: it.travellerIds?.map((id) => map.get(id) ?? id) ?? null };
        await qc.invalidateQueries({ queryKey: keys.people });
      }
    }
    forgetSettled();
    // The words' language answers again, unless the reader switched the app's language since (then the app's wins).
    setVoice(!snap.app || snap.app === appLocale() ? languageOfText(snap.query) : null);
    setQuery(snap.query); setCta(null); setFixes([]); setFixing(null); setReplyTo(null); setAskNew(false);
    setIntent(it); setRound((r) => r + 1);
    return true;
  };
  // Signed in over this screen ("Sign in to book this"): the same search again, for the account's people.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    // Quietly: the end of sign-in says "Back where you were." when it lands here (alerts, welcome back).
    if (was !== 'signedIn' && status === 'signedIn' && intent) void restore();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // The answer's language is this conversation's only: the rest of the app keeps the app's.
  useEffect(() => () => setVoice(null), []);
  const answering = useVoiceLocale((v) => v.voice);
  const dirProps = answering ? ({ dir: answering === 'ar' ? 'rtl' : 'ltr', style: { gap: 16, direction: answering === 'ar' ? 'rtl' : 'ltr' } } as object) : null;
  /** The other language, mid-ask: saved first, so the app restarts into the same search with the same option. */
  const switchTo = async () => {
    const next = appLocale() === 'ar' ? 'en' : 'ar';
    buzz('tap');
    flushAsk();
    if (Platform.OS === 'web') { try { globalThis.history?.replaceState(null, '', ASK_RESUME); } catch { /* */ } }
    else await setRelaunchTo(ASK_RESUME);
    const ok = await switchLanguage(next);
    if (!ok) toast(t('lang.restart.manual'));
  };

  useEffect(() => {
    const id = setTimeout(() => {
      if (params.resume) void restore().then((ok) => { if (ok) toast(t('resume.back')); });
      else if (params.prefill) void submit(String(params.prefill));
      else if (params.intent && PROMPT[params.intent as AskKind]) void submit(t(PROMPT[params.intent as AskKind]!), params.intent as AskKind);
    }, 0);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = intent?.kind;
  let body: React.ReactNode;
  if (!intent) body = parsing ? null : <Start onPick={(x) => submit(x)} onResume={() => { void restore(); }} people={household} today={today} />;
  else if (offline && (kind === 'flight' || kind === 'stay')) body = <Notice icon="wifiOff" title={t('ask.offline.title')}><T v="small">{t('ask.offline.body')}</T></Notice>;
  else if (kind === 'flight') body = <FlightFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} onSync={onSync} />;
  else if (kind === 'stay') body = <StayFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} onSync={onSync} />;
  else if (kind === 'plan') body = <PlanFlow key={round} query={query} people={household} today={today} />;
  else if (kind === 'esim') body = <EsimFlow key={round} intent={intent} />;
  else if (kind === 'umrah') body = <UmrahFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} onSync={onSync} />;
  else body = <RequestFlow key={round} kind={kind as 'visa'} query={query} intent={intent} people={household} selfName={selfName} />;

  /** The Ask box: type or speak. On results it refines them (hint and onSend from the flow); otherwise it asks anew. */
  const composer = (hint: string, onSend: (text: string) => void, testID?: string) => (
    <View style={styles.composer} testID={testID}>
      <TextInput value={draft} onChangeText={setDraft} placeholder={voice.listening ? t('ask.voice.listening') : hint} placeholderTextColor={voice.listening ? colors.goldInk : colors.muted} accessibilityLabel={t('ask.a11y.input')}
        onSubmitEditing={() => { if (draft.trim()) onSend(draft.trim()); }} returnKeyType="send" style={[styles.input, webNoOutline]} testID="ask-input" />
      <Pressable accessibilityRole="button"
        accessibilityLabel={voice.listening ? t('ask.a11y.stop') : draft ? t('ask.a11y.send') : t('ask.a11y.talk')}
        accessibilityState={{ busy: voice.listening }}
        onPress={() => {
          if (voice.listening) { voice.stop(); return; }
          if (draft.trim()) { onSend(draft.trim()); return; }
          buzz('tap'); void voice.start();
        }}
        style={[styles.send, voice.listening ? styles.listening : null]} testID="ask-send">
        <Icon name={voice.listening ? 'close' : draft ? 'up' : 'mic'} color={voice.listening ? colors.green : colors.mist} size={20} />
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))} backLabel={t('ask.close')} home={false} right={(
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* The other language, without losing this search (lib/resume.ts). */}
            <Pressable accessibilityRole="button" accessibilityLabel={tShared('ask.lang.a11y', undefined, appLocale())} onPress={() => { void switchTo(); }} style={styles.demo} testID="ask-lang">
              <T v="caption" color={colors.green}>{appLocale() === 'ar' ? tShared('ask.lang.toEnglish', undefined, 'en') : tShared('ask.lang.toArabic', undefined, 'ar')}</T>
            </Pressable>
            {SHOW_DEMO_SWITCHES ? <Pressable accessibilityRole="button" onPress={() => setDemoOpen(true)} style={styles.demo} testID="ask-demo"><T v="caption" color={colors.goldInk}>{t('ask.demo.open')}</T></Pressable> : null}
          </View>
        )} />
        <ScrollView ref={scroll} onContentSizeChange={() => { if (replyTo) scroll.current?.scrollToEnd({ animated: true }); }} style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: 170 + bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }} {...dirProps}>
          {query ? <MeBubble text={query} testID="ask-query" /> : null}
          {answering ? <T v="tiny" testID="ask-voice">{t('ask.voice.note')}</T> : null}
          {fixes.map((f, i) => <MeBubble key={`${i}-${f}`} text={f} testID="ask-fix" />)}
          <AskReplyContext.Provider value={onReply}>{body}</AskReplyContext.Provider>
          {fixing && intent ? <FixPrompt text={fixing} kind={intent.kind} onPick={fix} /> : null}
          </View>
        </ScrollView>
        <View style={[styles.act, { paddingBottom: 24 + bottom }]} pointerEvents="box-none">
          {cta && !offline && cta.refine ? (
            <>
              {/* Results: say what matters (typed or spoken) to refine them; the one action stays below. */}
              {composer(cta.refine.hint, (text) => {
                setDraft('');
                // Who, when or where changes the search itself; anything else refines these results.
                const r = correct(text);
                if (r === 'done') return;
                if (cta.refine!.onSubmit(text) === false) setFixing(text);
              }, cta.refine.testID)}
              <Button label={cta.label} disabled={cta.disabled} onPress={cta.onPress} testID={cta.testID ?? 'ask-cta'} />
            </>
          ) : cta && !offline ? (
            <>
              <Button label={cta.label} disabled={cta.disabled} onPress={cta.onPress} testID={cta.testID ?? 'ask-cta'} />
              <View style={{ alignSelf: 'center' }}><LinkButton label={t('ask.somethingElse')} size={13} onPress={() => setCta(null)} /></View>
            </>
          ) : replyTo && !askNew ? (
            <>
              <ReplyBar requestId={replyTo.id} agent={replyTo.agent} />
              <View style={{ alignSelf: 'center' }}><LinkButton label={t('ask.somethingElse')} size={13} onPress={() => setAskNew(true)} testID="ask-something-else" /></View>
            </>
          ) : composer(voice.listening ? t('ask.voice.listening') : intent ? t('ask.composerMore') : t('ask.composer'), (text) => submit(text))}
        </View>
      </KeyboardAvoidingView>
      <DemoSheet visible={demoOpen} onClose={() => setDemoOpen(false)} />
    </Screen>
  );
}

/** "What should Mada change?": who, the dates or the place, asked again from that question; or a new ask. */
function FixPrompt({ text, kind, onPick }: { text: string; kind: AskKind; onPick: (w: 'who' | 'when' | 'where' | 'new') => void }) {
  const form = REQUEST_FORMS[kind as RequestFormKind] ?? [];
  const searchable = kind === 'flight' || kind === 'stay';
  const opts = ([['who', 'fix.who'], ['when', 'fix.when'], ['where', 'fix.where']] as const)
    .filter(([w]) => searchable || form.some((f) => (w === 'who' ? f.people : f.k === w)));
  return (
    <Animated.View entering={enter(0)} style={{ gap: 10 }} testID="ask-fix-prompt">
      <MeBubble text={text} />
      <T v="h3">{t('fix.title')}</T>
      <ChipWrap>
        {opts.map(([w, k]) => <Chip key={w} label={t(k)} background={colors.paper} onPress={() => onPick(w)} />)}
        <Chip label={t('fix.new')} background={colors.paper} onPress={() => onPick('new')} />
      </ChipWrap>
    </Animated.View>
  );
}

function Start({ onPick, onResume, people, today }: { onPick: (x: string) => void; onResume: () => void; people: Person[]; today: string }) {
  const router = useRouter();
  // A search from earlier (before a restart, a sign-in, a language switch): one tap back to it.
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => { void peekAsk().then((s) => setLast(s?.query ?? null)); }, []);
  // The app was closed (or killed) while Mada was booking: pick it up from the server.
  const active = useQuery({ queryKey: ['booking', 'active'], queryFn: async () => (await bookingApi.activeOrders()).orders });
  const busy = active.data?.find((o) => !['confirmed', 'cancelled', 'declined'].includes(o.status));
  const H = householdOf(people, today);
  const n = H.nonHelper.length;
  const kid = H.kids[0]?.firstName;
  // Asks as chips; places as photo tiles (AlUla, Dubai and Riyadh Season, so no chip says the same place).
  const ideas = n > 2
    ? [t('ask.idea.familyEid', { count: n }), t('ask.idea.hotel'), kid ? t('ask.idea.visaFor', { name: kid }) : t('ask.idea.visa'), t('ask.idea.umrah')]
    : [t('ask.idea.flights'), t('ask.idea.hotel'), t('ask.idea.umrah')];
  return (
    <Animated.View entering={enter(0)} style={{ gap: 20, paddingTop: 8 }}>
      <View style={{ gap: 8 }}>
        <T style={font('display')} accessibilityRole="header">{t('ask.title')}</T>
        <T v="body" color={colors.ink2}>{t('ask.intro')}</T>
      </View>
      {last ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('resume.pickUpA11y', { what: last })} onPress={() => { buzz('tap'); onResume(); }} testID="ask-pick-up">
          <Notice icon="calendar"><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('resume.pickUp')}</T><T v="small" numberOfLines={1}>{last}</T></Notice>
        </Pressable>
      ) : null}
      <ChipWrap>{ideas.map((i) => <Chip key={i} label={i} background={colors.paper} onPress={() => onPick(i)} />)}</ChipWrap>
      <IdeaTiles keys={['alula', 'dubai', 'season']} onAsk={onPick} testID="ask-ideas" />
      {busy ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/waiting/[id]', params: { id: busy.id } })}>
          <Notice icon="flight"><T v="small" color={colors.green}>{t('ask.resume', { place: busy.place })}</T></Notice>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 16, paddingTop: 8 },
  act: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingTop: 28, paddingHorizontal: 20, gap: 6, backgroundColor: 'rgba(233,226,216,0.96)' },
  composer: { height: 56, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 20, paddingEnd: 6, flexDirection: 'row', alignItems: 'center', gap: 8, boxShadow: '0px 10px 30px -18px rgba(30,53,45,0.4)' },
  input: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  listening: { backgroundColor: colors.gold },
  send: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  demo: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.goldWash, justifyContent: 'center' },
});
