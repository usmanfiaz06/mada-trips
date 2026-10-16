import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import {
  NEED_KEYS, NEED_LABELS, REQUEST_FORMS, listOf, wordFor, formatSar, householdOf, nameIn, personName, todayIn,
  type AskIntent, type BookingRequestView, type CopyKey, type NeedKey, type Person, type RequestFormKind,
} from '@mada/shared';
import { bookingApi, bookingKeys, sendRequest, useBookingRequest, usePayDraft, useThread } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, listSep, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, font, radii, ff } from '@/theme';
import { Button, LinkButton } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Pill } from '../Pill';
import { ErrorState } from '../states/ErrorState';
import { T } from '../Text';
import { AgentDot, ArtMap, ChipWrap, MadaDot, Notice, Toggle, enter, useWho } from './parts';
import { TravellerChips } from './Travellers';
import { TravellerPassports } from '../passport/TravellerPassports';
import { AttachmentChip } from './Attachment';
import { FlightFares } from './FlightRequest';
import { Answered, ThreadBubble, TypingDots, clock } from './Conversation';
import { PhoneSheet, usePhoneNeeded } from './PhoneSheet';

/* Requests a person at Mada completes: one question at a time, per-person needs, a note, then the quote and the thread. */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const PROMPT_KEYS = ['ask.prompt.flight', 'ask.prompt.stay', 'ask.prompt.visa', 'ask.prompt.umrah', 'ask.prompt.car', 'ask.prompt.food', 'ask.prompt.todo', 'ask.prompt.esim'] as const;
export const isPrompt = (q: string) => PROMPT_KEYS.some((k) => t(k) === q);

/** The chips' words in the traveller's language (the stored English answer is what the desk reads); a city by its name. */
export const optionLabel = (o: string) => { const w = wordFor(o, getLocale()); return w === o ? nameIn(o, getLocale()) : w; };

/** Inside Ask, the request's thread takes Ask's own composer (one box at the bottom, never two). */
export const AskReplyContext = createContext<((r: { id: string; agent: string } | null) => void) | null>(null);

export function RequestFlow({ kind, query, intent, people, selfName, sysNote, autoSend, search, onSent, travellerIds }: {
  kind: RequestFormKind; query: string; intent: AskIntent | null; people: Person[]; selfName: string; sysNote?: string;
  autoSend?: boolean; search?: Parameters<typeof sendRequest>[0]['search']; onSent?: (id: string | null) => void; travellerIds?: string[];
}) {
  const form = REQUEST_FORMS[kind] ?? [];
  const H = useMemo(() => householdOf(people, todayIn()), [people]);
  const named = (travellerIds ?? intent?.travellerIds ?? []).filter((id) => people.some((p) => p.id === id));
  // "For 4" already says who: that question is skipped, like any other the words answered.
  const [answers, setAnswers] = useState<Record<string, string[] | true>>(() => {
    const a: Record<string, string[] | true> = { ...(intent?.answers ?? {}) };
    const k = form.find((f) => f.people)?.k;
    if (k && (travellerIds?.length || (intent?.travellerCount && named.length >= intent.travellerCount))) a[k] = true;
    return a;
  });
  const [who, setWho] = useWho(() => (named.length ? named : H.me ? [H.me] : []));
  const [needs, setNeeds] = useState<Record<string, NeedKey[]>>(() => ({ ...(intent?.needs ?? {}) }) as Record<string, NeedKey[]>);
  // What was typed is already the first bubble; the note is only for something new.
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<{ id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // A question with several answers ("What matters?") stays open until Done; the others close on a tap.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(form.filter((f) => f.multi && (intent?.answers ?? {})[f.k]?.length).map((f) => f.k)));
  const isOpen = (k: string, f: (typeof form)[number]) => editing === k || (!!f.multi && !chosen.has(k)) || !(f.people || f.needs ? answers[k] : (answers[k] as string[] | undefined)?.length);
  const firstOpen = form.findIndex((f) => isOpen(f.k, f));
  const done = firstOpen === -1;
  const assigned = new Set(Object.values(needs).flat());
  const unassigned = (intent?.needsMentioned ?? []).filter((k) => !assigned.has(k));
  const nameOf = (id: string) => personName(people.find((p) => p.id === id), selfName);
  const answer = (k: string, v: string[] | true) => { setAnswers((a) => ({ ...a, [k]: v })); setEditing(null); };
  // Only questions that were asked show as answered; one answered by the words typed isn't asked at all.
  const [asked] = useState(() => new Set(form.filter((f) => !answers[f.k]).map((f) => f.k)));

  const send = async () => {
    setBusy(true);
    try {
      const plain: Record<string, string[]> = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v === true ? ['yes'] : v]));
      // "A table for 2" from someone whose household has only them: the party is 2, not who's in the profile.
      if (intent?.travellerCount && intent.travellerCount > who.length) plain.party = [String(intent.travellerCount)];
      const r = await sendRequest({ kind: kind as never, query, answers: plain, travellerIds: who, needs, note: note.trim(), search: search ?? null });
      buzz('success');
      setSent({ id: r?.id ?? null });
      onSent?.(r?.id ?? null);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!autoSend || sent) return undefined;
    const id = setTimeout(() => { void send(); }, 0);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (sent) return <SentRequest id={sent.id} people={people} selfName={selfName} />;
  if (autoSend) return null;

  const answeredText = (f: (typeof form)[number]) => (f.people ? joinAnd(who.map(nameOf))
    : f.needs ? (who.filter((id) => (needs[id] ?? []).length).map((id) => `${nameOf(id)}: ${(needs[id] ?? []).map((k) => wordFor(NEED_LABELS[k]).toLowerCase()).join(listSep())}`).join(' · ') || t('request.nothingNeeded'))
      : ((answers[f.k] as string[] | undefined) ?? []).map(optionLabel).join(listSep()));

  return (
    <View style={{ gap: 18 }}>
      {sysNote ? <Notice icon="doc"><T v="small">{sysNote}</T></Notice> : null}
      {kind === 'umrah' ? <Notice icon="umrah" warn><T v="small">{t('request.umrahNusuk')}</T></Notice> : null}
      {form.map((f, i) => {
        if (i > (done ? form.length : firstOpen)) return null;
        if (!isOpen(f.k, f)) return asked.has(f.k) ? <Answered key={f.k} q={t(f.q as CopyKey)} a={answeredText(f)} onChange={() => setEditing(f.k)} testID={`answered-${f.k}`} /> : null;
        return (
          <Animated.View key={f.k} entering={enter(0)} style={{ gap: 10 }}>
            <T v="h2" accessibilityRole="header">{t(f.q as CopyKey)}</T>
            {f.people ? (
              <>
                <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
                {/* Each traveller's passport, right here (add, needs a look, or ready): nobody is sent to the Wallet. */}
                <TravellerPassports kind={kind} people={people} travellerIds={who} selfName={selfName} />
                <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={who.length === 1 ? t('ask.q.just', { name: nameOf(who[0]!) }) : t('ask.q.these', { count: who.length })} onPress={() => answer(f.k, true)} testID="request-who-done" />
                {kind === 'visa' && who.some((id) => people.find((p) => p.id === id)?.relation === 'helper')
                  ? <T v="small">{t('request.helperVisa', { names: listOf(who.filter((id) => people.find((p) => p.id === id)?.relation === 'helper').map(nameOf)) })}</T> : null}
              </>
            ) : null}
            {f.needs ? (
              <>
                {unassigned.length ? <T v="small" color={colors.green}>{t('request.mentioned', { needs: listOf(unassigned.map((k) => wordFor(NEED_LABELS[k]).toLowerCase())) })}</T> : null}
                {who.map((id) => (
                  <Card key={id} variant="well" padding={14} style={{ gap: 8 }}>
                    <T v="h3" style={{ fontSize: 15 }}>{nameOf(id)}</T>
                    <ChipWrap>
                      {NEED_KEYS.map((k) => {
                        const on = (needs[id] ?? []).includes(k);
                        return <Toggle key={k} small label={wordFor(NEED_LABELS[k])} on={on} hint={unassigned.includes(k)} accessibilityLabel={t('need.for', { need: wordFor(NEED_LABELS[k]), name: nameOf(id) })} onPress={() => {
                          const cur = needs[id] ?? [];
                          let next = on ? cur.filter((x) => x !== k) : [...cur, k];
                          if (!on && k === 'wheelchairGate') next = next.filter((x) => x !== 'wheelchairSeat');
                          if (!on && k === 'wheelchairSeat') next = next.filter((x) => x !== 'wheelchairGate');
                          setNeeds({ ...needs, [id]: next });
                        }} />;
                      })}
                    </ChipWrap>
                    {(needs[id] ?? []).includes('oxygen') ? <T v="small" color={colors.green}>{t('request.oxygen')}</T> : null}
                  </Card>
                ))}
                <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={Object.values(needs).some((x) => x.length) ? t('request.done') : t('request.nothingNeeded')} onPress={() => answer(f.k, true)} />
              </>
            ) : null}
            {f.options ? (
              <ChipWrap>
                {f.options.map((o) => {
                  const cur = (answers[f.k] as string[] | undefined) ?? [];
                  const on = cur.includes(o);
                  return <Toggle key={o} label={optionLabel(o)} on={on} onPress={() => (f.multi ? setAnswers({ ...answers, [f.k]: on ? cur.filter((x) => x !== o) : [...cur, o] }) : answer(f.k, [o]))} />;
                })}
              </ChipWrap>
            ) : null}
            {f.multi && ((answers[f.k] as string[] | undefined) ?? []).length ? <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('request.done')} onPress={() => { setChosen((c) => new Set(c).add(f.k)); setEditing(null); }} testID="request-multi-done" /> : null}
          </Animated.View>
        );
      })}
      {done ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          {form.length ? (
            <View style={{ gap: 6 }}>
              <T v="small" style={{ fontFamily: ff.ui600 }}>{t('request.note.label')}</T>
              <TextInput accessibilityLabel={t('request.note.label')} multiline value={note} onChangeText={setNote} placeholder={t('request.note.hint')} placeholderTextColor={colors.muted}
                style={[styles.note, font('body', colors.green), { fontSize: 15 }, webNoOutline]} testID="request-note" />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MadaDot size={28} />
            <T v="small" style={{ flex: 1 }}>{kind === 'visa' ? t('request.willVisa') : t('request.willPrice')}</T>
          </View>
          <Button label={t('request.send')} busy={busy} onPress={send} testID="request-send" />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Where a request is: sent, the agent on it, the answer with its price, paid. */
export function RequestProgress({ r }: { r: BookingRequestView }) {
  const agent = r.agent?.name ?? 'Mada';
  const at = r.status === 'queued' ? -1 : r.status === 'sent' ? 0 : r.status === 'reviewing' ? 1 : r.status === 'quoted' ? 2 : r.status === 'cancelled' ? -1 : 3;
  const price = r.quote && r.quote.total.amount > 0 ? formatSar(r.quote.total.amount) : null;
  const steps = [t('ask.req.step.sent'), t('ask.req.step.onIt', { agent }), price ? t('ask.req.step.priced', { price }) : t('ask.req.step.answer'), r.status === 'done' ? t('ask.req.step.done') : t('ask.req.step.paid')];
  if (r.status === 'cancelled') return <Pill label={t('ask.req.cancelled')} />;
  return (
    <View style={styles.progress} accessibilityLabel={steps[Math.max(0, at)]} accessibilityRole="progressbar" testID="request-progress">
      {steps.map((x, i) => (
        <View key={x} style={{ flex: 1, gap: 6 }}>
          <View style={[styles.bar, { backgroundColor: i <= at ? (i === at && at < 3 ? colors.gold : colors.green) : colors.line }]} />
          <T v="tiny" numberOfLines={2} style={i === at ? { color: colors.green, fontFamily: ff.ui600 } : null}>{x}</T>
        </View>
      ))}
    </View>
  );
}

/** What was sent, how it's moving, the price per person, the thread. Also opened from Trips → Requests. */
export function SentRequest({ id, screen }: { id: string | null; people?: Person[]; selfName?: string; screen?: boolean }) {
  const router = useRouter();
  const q = useBookingRequest(id);
  const r = q.data;
  const host = useContext(AskReplyContext);
  const phoneNeeded = usePhoneNeeded();
  const [phoneOpen, setPhoneOpen] = useState(false);
  useEffect(() => { if (host && r) host({ id: r.id, agent: r.agent?.name ?? 'Mada' }); }, [host, r?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => host?.(null), [host]);
  if (!id) {
    return (
      <Animated.View entering={enter(0)} style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <MadaDot size={40} />
          <View style={{ flex: 1 }}><T v="h3">{t('request.queued')}</T><T v="small">{t('request.sentBody')}</T></View>
        </View>
        <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('search.seeInTrips')} onPress={() => router.replace('/trips')} /></View>
      </Animated.View>
    );
  }
  if (!r) return q.isError ? <ErrorState variant="card" error={q.error} onRetry={() => { void q.refetch(); }} testID="request-error" /> : null;
  const answered = ['quoted', 'paid', 'done'].includes(r.status);
  const agent = r.agent?.name ?? 'Mada';
  const canPay = !r.quote?.flight && r.status === 'quoted' && r.quote?.status === 'open' && (r.quote?.total.amount ?? 0) > 0;
  const pay = () => { usePayDraft.getState().set({ draft: { kind: 'quote', requestId: r.id }, title: r.title }); router.push('/pay'); };
  return (
    <Animated.View entering={enter(0)} style={{ gap: 14 }}>
      {screen ? null : (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <AgentDot name={agent} size={40} />
          <View style={{ flex: 1 }}>
            <T v="h3">{answered ? t('actor.replied', { agent }) : t('ask.req.withAgent', { agent })}</T>
            <T v="small">{answered && r.quote ? t('request.replied') : t('request.sentBody')}</T>
          </View>
        </View>
      )}
      <Card variant="well" style={{ gap: 8 }}>
        <T v="h3">{r.title}</T>
        {r.summary || r.detail ? <T v="small">{r.summary || r.detail}</T> : null}
        {r.note && r.note !== r.title && r.summary ? <T style={styles.quote}>“{r.note}”</T> : null}
        <RequestProgress r={r} />
      </Card>
      {answered && r.quote ? (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><AgentDot name={agent} size={28} /><T v="h3" style={{ fontSize: 14, flex: 1 }}>{t('actor.intro', { agent })}</T>{r.updatedAt ? <T v="tiny">{clock(r.updatedAt)}</T> : null}</View>
          <T v="small" color={colors.green}>{r.quote.lead || r.quote.text}</T>
          {r.quote.needLines.length ? <View style={{ gap: 4 }}>{r.quote.needLines.map((x) => <T key={x} v="small">• {x}</T>)}</View> : null}
          {r.quote.flight ? <FlightFares r={r} today={todayIn()} /> : <QuoteBreakdown r={r} />}
          {r.quote.flight && r.status === 'paid' ? <T v="small" color={colors.green} testID="fares-paid">{t('beta.fq.paid', { agent })}</T> : null}
          {r.quote.flight && r.status === 'done' ? <T v="small" color={colors.ok} testID="fares-ticketed">{t('beta.fq.ticketed')}</T> : null}
          {!r.quote.flight && (r.status === 'paid' || r.status === 'done') ? <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="check" size={16} color={colors.ok} width={2.4} /><T v="small" color={colors.ok}>{t('ask.req.paidLine')}</T></View> : null}
          {canPay ? (
            <Button label={t('request.pay', { price: formatSar(r.quote.total.amount) })} testID="request-pay" onPress={() => (phoneNeeded ? setPhoneOpen(true) : pay())} />
          ) : null}
          {canPay && phoneNeeded ? <T v="tiny">{t('ask.phone.beforePay')}</T> : null}
        </Card>
      ) : null}
      <RequestThread request={r} stage={screen} />
      {screen ? null : <View style={{ alignSelf: 'center' }}><LinkButton label={t('search.seeInTrips')} onPress={() => router.replace('/trips')} testID="request-see-trips" /></View>}
      <PhoneSheet visible={phoneOpen} onClose={() => setPhoneOpen(false)} onDone={() => { setPhoneOpen(false); pay(); }} />
    </Animated.View>
  );
}

export function QuoteBreakdown({ r }: { r: BookingRequestView }) {
  if (!r.quote?.breakdown.length) return null;
  return (
    <View style={styles.table} accessibilityLabel={t('request.a11y.breakdown')}>
      {r.quote.breakdown.map((b) => (
        <View key={(b.personId ?? '') + b.name} style={{ gap: 3 }}>
          <T v="h3" style={{ fontSize: 14 }}>{b.name}</T>
          {b.lines.map((l) => (
            <View key={l.label} style={styles.spread}><T v="small" style={{ flex: 1 }}>{l.label}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{formatSar(l.amount)}</T></View>
          ))}
        </View>
      ))}
      <View style={[styles.spread, styles.total]}><T v="h3" style={{ fontSize: 15 }}>{t('request.total')}</T><T v="h3" style={{ fontSize: 15 }}>{formatSar(r.quote.total.amount)}</T></View>
    </View>
  );
}

/** One-tap replies that fit what was asked: nobody is offered "change the dates" for a request without dates. */
export function requestSuggestions(r: BookingRequestView): string[] {
  if (r.quote?.flight) return [t('beta.fq.another'), t('beta.fq.checkAgain')];
  if (r.kind === 'umrah') return [t('request.suggest.closer'), t('request.suggest.later')];
  if (r.kind === 'flight') return [t('request.suggest.laterFlight'), t('request.suggest.less')];
  if (r.kind === 'visa') return [t('ask.suggest.earlierAppt')];
  if (r.kind === 'car') return [t('ask.suggest.biggerCar'), t('ask.suggest.childSeat')];
  if (r.kind === 'food') return [t('ask.suggest.later'), t('ask.suggest.view')];
  if (r.kind === 'stay') return [t('ask.suggest.cheaperStay'), t('ask.suggest.breakfast')];
  const dated = !!r.summary && !/Any day is fine/.test(r.summary);
  return [dated ? t('ask.suggest.anotherDay') : t('ask.suggest.weekend'), t('ask.suggest.addCar')];
}

/** Send a reply to the agent, from whichever box holds it (Ask's composer, or the request screen's). */
export function useReply(requestId: string) {
  const qc = useQueryClient();
  return async (text: string) => {
    const v = text.trim();
    if (!v) return false;
    buzz('tap');
    try { qc.setQueryData(bookingKeys.messages(requestId), await bookingApi.postMessage(requestId, v)); return true; } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); return false; }
  };
}

/** The reply box under a thread: one line, the send arrow on the end side. */
export function ReplyBar({ requestId, agent }: { requestId: string; agent: string }) {
  const [draft, setDraft] = useState('');
  const reply = useReply(requestId);
  const send = async () => { const v = draft; setDraft(''); if (!(await reply(v))) setDraft(v); };
  return (
    <View style={styles.reply}>
      <TextInput accessibilityLabel={t('ask.req.replyTo', { agent })} value={draft} onChangeText={setDraft} placeholder={t('ask.req.replyTo', { agent })} placeholderTextColor={colors.muted}
        onSubmitEditing={send} returnKeyType="send" style={[styles.replyInput, webNoOutline]} testID="reply-input" />
      <Pressable accessibilityRole="button" accessibilityLabel={t('request.a11y.send')} disabled={!draft.trim()} onPress={send} style={[styles.send, !draft.trim() ? { opacity: 0.4 } : null]} testID="reply-send">
        <Icon name="up" color={colors.mist} size={20} />
      </Pressable>
    </View>
  );
}

/**
 * Replies under a request, with the agent: who said it and when, the agent typing, offers with a button. `stage`:
 * while nothing has been said yet, the map the request travels over fills the room the thread will take.
 */
export function RequestThread({ request, stage }: { request: BookingRequestView; stage?: boolean }) {
  const qc = useQueryClient();
  const th = useThread(request.id);
  const reply = useReply(request.id);
  const msgs = th.data?.messages ?? [];
  const agent = request.agent?.name ?? 'Mada';
  const accept = async (messageId: string) => {
    if (!request.quote) return;
    try {
      const out = await bookingApi.acceptOffer(request.quote.id, messageId);
      qc.setQueryData(bookingKeys.request(request.id), out.request);
      qc.setQueryData(bookingKeys.messages(request.id), { messages: out.messages, agentTyping: false });
      buzz('success');
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };
  const waiting = th.data?.agentTyping || msgs.at(-1)?.from === 'me';
  const suggestions = requestSuggestions(request);
  return (
    <View style={{ gap: 10 }} accessibilityLabel={t('request.a11y.thread')}>
      {stage && !msgs.length && !waiting ? <View style={styles.stage} testID="request-stage"><ArtMap /></View> : null}
      {msgs.map((m) => (
        <ThreadBubble key={m.id} mine={m.from === 'me'} name={m.authorName ?? agent} text={m.text} time={clock(m.createdAt)}>
          {m.attachment ? <AttachmentChip file={m.attachment} mine={m.from === 'me'} /> : null}
          {m.offer && !m.offer.accepted ? <Button size="small" block={false} variant="gold" style={{ alignSelf: 'flex-start' }} label={t('request.switch')} onPress={() => accept(m.id)} /> : null}
        </ThreadBubble>
      ))}
      {waiting ? <TypingDots name={agent} /> : null}
      {!msgs.some((m) => m.from === 'me') && !waiting && request.status !== 'cancelled' ? <ChipWrap>{suggestions.map((x) => <Toggle key={x} label={x} on={false} onPress={() => { void reply(x); }} />)}</ChipWrap> : null}
    </View>
  );
}

/** A city we don't sell live: Mada searches it by hand and replies in the request. */
export function ByHand({ city, stay, queued }: { city: string; stay?: boolean; queued?: boolean }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: 14 }}>
      <View style={styles.stage}><ArtMap /></View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <MadaDot size={40} />
        <View style={{ flex: 1 }}>
          <T v="h3">{queued ? t('search.byHand.queued', { city }) : stay ? t('search.byHand.stayTitle', { city }) : t('search.byHand.title', { city })}</T>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  note: { minHeight: 84, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16, paddingVertical: 12, textAlignVertical: 'top' },
  quote: { fontSize: 13, lineHeight: 19, color: colors.green, paddingStart: 10, borderStartWidth: 2, borderColor: colors.gold, fontStyle: 'italic' },
  table: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.mist },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  total: { paddingTop: 8, borderTopWidth: 1, borderColor: colors.line },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 20, paddingEnd: 6, boxShadow: '0px 10px 30px -18px rgba(30,53,45,0.4)' },
  replyInput: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  send: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 6, paddingTop: 4 },
  bar: { height: 4, borderRadius: 999 },
  stage: { height: 132, borderRadius: 20, backgroundColor: '#f6efe2', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,93,39,0.1)' },
});
