import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Animated from 'react-native-reanimated';
import { REQUEST_FORMS, addDays, languageOfText, t as tShared, askIntentOfRules, correctAsk, correctEsimAsk, correctionLine, householdOf, parseAskRules, partyOfPeople, todayIn, type AskIntent, type AskKind, type CopyKey, type Person, type RequestFormKind } from '@mada/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, LinkButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { DemoSheet } from '@/components/booking/DemoSheet';
import { FlightFlow, useFlightHeadStart, type Cta } from '@/components/booking/FlightFlow';
import { EsimFlow, PlanFlow, StayFlow } from '@/components/booking/OtherFlows';
import { UmrahFlow } from '@/components/booking/UmrahFlow';
import { ChipWrap, Notice, enter } from '@/components/booking/parts';
import { AskReplyContext, ReplyBar, RequestFlow } from '@/components/booking/Requests';
import { EarlierAsks, MadaLine, MeBubble } from '@/components/booking/Conversation';
import { ChatThread, type ChatOpen } from '@/components/booking/ChatThread';
import { IdeaTiles } from '@/components/trips/ui';
import { ApiError, api } from '@/lib/api';
import { carryOverGuestPeople } from '@/lib/guest';
import { useNet } from '@/lib/net';
import { keys, usePeople } from '@/lib/queries';
import { flushAsk, loadAsk, noteAskSettled, peekAsk, remapAsk, saveAsk, setRelaunchTo } from '@/lib/resume';
import { bookingApi, useDemo, usePayDraft } from '@/lib/booking';
import { sendAskChat, stopAskChat, useAskChat, useAskChatOn } from '@/lib/ask-chat';
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
 * With the conversation on (GET /config askChat, signed in, online: docs/app/ASK-CHAT.md), a new ask goes to Mada's
 * conversation instead, which talks back as it works and shows the same cards; a card opens the flow for that search.
 * If the conversation stops for any reason, the flows answer exactly as they always have.
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
  // Offline (the demo switch, or the phone really has no connection, as after a reload with no signal): searching
  // waits, and nothing pretends to hold seats (critique 2, #3).
  const demoOffline = useDemo((s) => s.on.has('offline'));
  const netState = useNet((s) => s.online);
  const netOffline = netState === false;
  // The server couldn't be reached for the reading itself: offline until a connection is known again (then the search runs).
  const [parseOffline, setParseOffline] = useState(false);
  const offline = demoOffline || netOffline || (parseOffline && netState !== true);
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
  /** How tall the action at the bottom stands, so a stage (the stays map) ends above it. */
  const [actH, setActH] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  // A request sent from here: its thread takes the bottom box (one composer, never two). "Ask something else" gives it back.
  const [replyTo, setReplyTo] = useState<{ id: string; agent: string } | null>(null);
  const [askNew, setAskNew] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // The corrections typed since the ask, shown as bubbles, each with Mada's line on what changed.
  const [fixes, setFixes] = useState<{ text: string; line: string | null }[]>([]);
  // Earlier asks in this chat (a new place starts a fresh thread): folded above the new one.
  const [earlier, setEarlier] = useState<{ query: string; fixes: string[] }[]>([]);
  const [fixing, setFixing] = useState<string | null>(null);
  const onReply = useCallback((r: { id: string; agent: string } | null) => { setReplyTo(r); setAskNew(false); }, []);
  const selfName = user?.name ?? '';
  const household = people.data ?? [];
  const headStart = useFlightHeadStart(household, today);
  const chatOn = useAskChatOn() && !offline;
  const chatTurns = useAskChat((s) => s.turns);
  // Each Ask opens on a fresh conversation (the server keeps the thread while this screen is open).
  useEffect(() => { useAskChat.getState().reset(); return () => { stopAskChat(); useAskChat.getState().reset(); }; }, []);

  /** "we are 5", "December", "عندي تصريح": change the answer in hand instead of starting again. */
  const correct = (text: string): 'done' | 'unclear' | 'new' => {
    if (!intent || askNew || replyTo) return 'new';
    const apply = (next: AskIntent, line: string | null) => {
      buzz('tap');
      forgetSettled();
      setFixes((f) => [...f, { text, line }]); setFixing(null); setDraft(''); setCta(null);
      setIntent(next); setRound((r) => r + 1);
      return 'done' as const;
    };
    // The eSIM planner: what's typed is the place ("Pakistan", "باكستان", "Lahore") and the days ("for 10 days").
    // A name Mada can't place is still taken as the place (the planner says plainly when there's no eSIM for it).
    if (intent.kind === 'esim') {
      const e = correctEsimAsk({ ...intent, ...settled }, text);
      if (e?.type === 'apply') return apply(e.intent, null);
      if (e?.type === 'place') return apply(e.intent, null);
      if (e?.type === 'new') return 'new';
      return 'unclear';
    }
    const prev = { ...intent, ...settled };
    const c = correctAsk(prev, text, { today, people: household });
    if (c.type !== 'apply') return c.type;
    // Another place is another trip: a fresh thread, the old one folded above (critique 2, #14).
    if (prev.destination && c.intent.destination && c.intent.destination !== prev.destination) return 'new';
    // What changed, said back in the words' language ("Now 5 people: 2 adults, 3 children (2, 6, 13).").
    return apply(c.intent, correctionLine(prev, c, { people: household, selfName: user?.name ?? '', locale: languageOfText(text) ?? appLocale() }));
  };
  /** Mada couldn't tell what to change: ask again from that question, or start something new. */
  const fix = (what: 'who' | 'when' | 'where' | 'new') => {
    const text = fixing;
    setFixing(null);
    if (what === 'new') { if (text) void submit(text, undefined, true); return; }
    if (!intent) return;
    const base: AskIntent = { ...intent, ...settled, answers: { ...intent.answers } };
    if (what === 'who') Object.assign(base, { travellerIds: null, party: base.party ?? partyOfPeople(household, base.travellerIds ?? [], today, base.infants) });
    if (what === 'when') { Object.assign(base, { depart: null, return: null, monthOnly: null }); delete base.answers.when; delete base.answers.days; }
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
    if (chatOn && !kindHint) { await talk(v); return; }
    await runFlows(v, kindHint);
  };

  /** The conversation (docs/app/ASK-CHAT.md). If it stops, the flows answer with what the server read, or read it again. */
  const talk = async (v: string) => {
    buzz('tap');
    forgetSettled();
    setVoice(languageOfText(v));
    if (query) { const was = { query, fixes: fixes.map((f) => f.text) }; setEarlier((e) => [...e, was].slice(-5)); }
    setQuery(''); setIntent(null); setCta(null); setDraft(''); setReplyTo(null); setAskNew(false); setFixes([]); setFixing(null);
    const turn = await sendAskChat(v);
    if (turn.state !== 'stopped') return; // done, or a newer message took over
    // Nothing said yet: as if the conversation had never been there.
    if (!turn.text && !turn.cards.length) useAskChat.setState((s) => ({ turns: s.turns.filter((x) => x.id !== turn.id) }));
    if (turn.intent) { saveAsk(v, turn.intent); setQuery(v); setIntent(turn.intent); setRound((r) => r + 1); return; }
    await runFlows(v, undefined, true);
  };

  /** A card in the conversation: the flow for the same search, the pay sheet, the desk. */
  const openChat = (o: ChatOpen) => {
    if (o.kind === 'pay') { usePayDraft.getState().set({ draft: o.pay.draft, title: o.pay.title }); router.push('/pay'); return; }
    if (o.kind === 'handoff') { router.push('/support' as Href); return; }
    if (o.kind === 'request') { router.push({ pathname: '/ask/request/[id]', params: { id: o.id } }); return; }
    if (o.kind === 'trip') { router.push({ pathname: '/trip/[id]', params: { id: o.id } }); return; }
    const c = o.card;
    const base: AskIntent = o.turn.intent ?? askIntentOfRules(parseAskRules(o.turn.me, { today, people: household }));
    let next: AskIntent;
    if (c.type === 'flights' || c.type === 'stays') {
      const back = c.type === 'stays' ? addDays(c.search.depart, c.nights) : c.search.return;
      next = { ...base, kind: c.type === 'flights' ? 'flight' : 'stay', destination: c.search.destination, destinationName: null, from: c.search.from ?? base.from, depart: c.search.depart, return: back, tripType: back ? 'return' : 'oneway', monthOnly: null, travellerIds: c.search.travellerIds, travellerCount: null, party: null, ask: null };
    } else next = { ...base, kind: c.type === 'esim' ? 'esim' : c.type === 'entry' ? 'visa' : 'car' };
    forgetSettled();
    setQuery(o.turn.me); setCta(null); setFixes([]); setFixing(null);
    saveAsk(o.turn.me, next);
    setIntent(next); setRound((r) => r + 1);
  };

  /** Ask's own flows: the words read on the server (POST /ask/parse), then the flow for what was asked. */
  const runFlows = async (v: string, kindHint?: AskKind, quiet = false) => {
    if (!quiet) buzz('tap');
    forgetSettled();
    // Mada answers in the language this was written in, whatever the app is set to (per message).
    setVoice(languageOfText(v));
    // The ask on screen folds into "Earlier" above the new one.
    if (query) { const was = { query, fixes: fixes.map((f) => f.text) }; setEarlier((e) => [...e, was].slice(-5)); }
    setQuery(v); setCta(null); setDraft(''); setReplyTo(null); setAskNew(false); setFixes([]); setFixing(null);
    // Anyone can ask and see prices; signing in waits for an account action (lib/signin-ask.ts).
    setParsing(true);
    // The flight search starts from the phone's own reading while the server reads the words (FlightFlow.tsx).
    setParseOffline(false);
    if ((!kindHint || kindHint === 'flight') && !offline) { const r = parseAskRules(v, { today, people: household }); headStart(askIntentOfRules(r, kindHint ?? r.kind)); }
    try {
      const { intent: it } = await bookingApi.parse(v);
      const next = kindHint ? { ...it, kind: kindHint } : it;
      saveAsk(v, next);
      setIntent(next);
      setRound((r) => r + 1);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') {
        // Offline: the same rules the server runs read it here, so requests can still be written and saved; searching
        // waits for a connection, and the offline card shows before any progress.
        setParseOffline(true);
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
  const stage = cta && !offline ? cta.stage ?? null : null;
  let body: React.ReactNode;
  if (!intent) body = parsing || chatTurns.length ? null : <Start onPick={(x) => submit(x)} onResume={() => { void restore(); }} people={household} today={today} />;
  else if (offline && (kind === 'flight' || kind === 'stay')) body = <Notice icon="wifiOff" title={t('ask.offline.title')}><T v="small">{t('ask.offline.body')}</T></Notice>;
  else if (kind === 'flight') body = <FlightFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} onSync={onSync} />;
  else if (kind === 'stay') body = <StayFlow key={round} intent={intent} query={query} people={household} selfName={selfName} today={today} setCta={setCta} onSync={onSync} />;
  else if (kind === 'plan') body = <PlanFlow key={round} query={query} people={household} today={today} />;
  else if (kind === 'esim') body = <EsimFlow key={round} intent={intent} query={query} onSync={onSync} />;
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
        <View style={{ flex: 1 }}>
        <ScrollView ref={scroll} aria-hidden={stage ? true : undefined} importantForAccessibility={stage ? 'no-hide-descendants' : 'auto'} onContentSizeChange={() => { if (replyTo || (chatTurns.length && !intent)) scroll.current?.scrollToEnd({ animated: true }); }} style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: 170 + bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ gap: 16 }} {...dirProps}>
          <EarlierAsks items={earlier} />
          <ChatThread turns={chatTurns} onOpen={openChat} onSay={(x) => { void submit(x, undefined, true); }} />
          {query ? <MeBubble text={query} testID="ask-query" /> : null}
          {answering ? <T v="tiny" testID="ask-voice">{t('ask.voice.note')}</T> : null}
          {fixes.map((f, i) => (
            <View key={`${i}-${f.text}`} style={{ gap: 10 }}>
              <MeBubble text={f.text} testID="ask-fix" />
              {f.line ? <MadaLine text={f.line} testID="ask-fix-line" /> : null}
            </View>
          ))}
          <AskReplyContext.Provider value={onReply}>{body}</AskReplyContext.Provider>
          {fixing && intent ? <FixPrompt text={fixing} kind={intent.kind} onPick={fix} /> : null}
          </View>
        </ScrollView>
        {/* The stays map: over the results, from the top bar down to the action (or to the bottom when its card is open), so nothing shows through. */}
        {stage ? <View style={[styles.stage, { bottom: cta?.bare ? 0 : actH }]} testID="ask-stage">{stage}</View> : null}
        </View>
        <View style={[styles.act, { paddingBottom: 24 + bottom }, cta?.bare && !offline ? styles.actAway : stage ? { backgroundColor: colors.sand } : null]} pointerEvents="box-none" onLayout={(e) => { if (!cta?.bare) setActH(e.nativeEvent.layout.height); }}>
          {cta?.bare && !offline ? null : cta && !offline && cta.refine ? (
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

/**
 * "What should Mada change?": who, the dates or the place, asked again from that question; or a new ask. Always more
 * than one way on: a flow whose form names none of them (an eSIM, a plan) still offers where and when.
 */
function fixOptions(kind: AskKind): ('who' | 'when' | 'where')[] {
  const all = ['who', 'when', 'where'] as const;
  // An eSIM is a place and a number of days; who gets one is picked on the plans.
  if (kind === 'esim') return ['where', 'when'];
  if (kind === 'flight' || kind === 'stay') return [...all];
  const form = REQUEST_FORMS[kind as RequestFormKind] ?? [];
  const named = all.filter((w) => form.some((f) => (w === 'who' ? f.people : f.k === w)));
  return named.length ? named : [...all];
}
function FixPrompt({ text, kind, onPick }: { text: string; kind: AskKind; onPick: (w: 'who' | 'when' | 'where' | 'new') => void }) {
  const KEYS = { who: 'fix.who', when: 'fix.when', where: 'fix.where' } as const;
  const opts = fixOptions(kind).map((w) => [w, KEYS[w]] as const);
  return (
    <Animated.View entering={enter(0)} style={{ gap: 10 }} testID="ask-fix-prompt">
      <MeBubble text={text} />
      <T v="h3">{t('fix.title')}</T>
      <ChipWrap>
        {opts.map(([w, k]) => <Chip key={w} label={t(k)} background={colors.paper} onPress={() => onPick(w)} testID={`ask-fix-${w}`} />)}
        <Chip label={t('fix.new')} background={colors.paper} onPress={() => onPick('new')} testID="ask-fix-new" />
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
      <ChipWrap>
        {ideas.map((i) => <Chip key={i} label={i} background={colors.paper} onPress={() => onPick(i)} />)}
        {/* Internet abroad: the eSIM plans straight away (the trip, or where, is asked there). */}
        <Chip label={t('es.idea')} icon={(c) => <Icon name="globe" size={17} color={c} />} background={colors.paper} onPress={() => router.push('/esim/plans' as Href)} testID="ask-idea-esim" />
      </ChipWrap>
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
  actAway: { paddingTop: 0, paddingBottom: 0, height: 0, overflow: 'hidden' },
  stage: { position: 'absolute', top: 0, start: 0, end: 0, backgroundColor: colors.sand },
  composer: { height: 56, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 20, paddingEnd: 6, flexDirection: 'row', alignItems: 'center', gap: 8, boxShadow: '0px 10px 30px -18px rgba(30,53,45,0.4)' },
  input: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  listening: { backgroundColor: colors.gold },
  send: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  demo: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.goldWash, justifyContent: 'center' },
});
