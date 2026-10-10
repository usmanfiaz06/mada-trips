import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import {
  NEED_KEYS, NEED_LABELS, REQUEST_FORMS, formatSar, householdOf, personName, todayIn,
  type AskIntent, type BookingRequestView, type CopyKey, type NeedKey, type Person, type RequestFormKind,
} from '@mada/shared';
import { bookingApi, bookingKeys, sendRequest, useBookingRequest, usePayDraft, useThread } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { toast } from '@/lib/toast';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { T } from '../Text';
import { AgentDot, ArtMap, ChipWrap, MadaDot, Notice, Toggle } from './parts';
import { TravellerChips } from './Travellers';

/* Requests a person at Mada completes: one question at a time, per-person needs, a note, then the quote and the thread. */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const PROMPT_KEYS = ['ask.prompt.flight', 'ask.prompt.stay', 'ask.prompt.visa', 'ask.prompt.umrah', 'ask.prompt.car', 'ask.prompt.food', 'ask.prompt.todo', 'ask.prompt.esim'] as const;
export const isPrompt = (q: string) => PROMPT_KEYS.some((k) => t(k) === q);

export function RequestFlow({ kind, query, intent, people, selfName, sysNote, autoSend, search, onSent }: {
  kind: RequestFormKind; query: string; intent: AskIntent | null; people: Person[]; selfName: string; sysNote?: string;
  autoSend?: boolean; search?: Parameters<typeof sendRequest>[0]['search']; onSent?: (id: string | null) => void;
}) {
  const form = REQUEST_FORMS[kind] ?? [];
  const H = useMemo(() => householdOf(people, todayIn()), [people]);
  const typed = query && !isPrompt(query) ? query : '';
  const [answers, setAnswers] = useState<Record<string, string[] | true>>(() => ({ ...(intent?.answers ?? {}) }));
  const named = intent?.travellerIds?.filter((id) => people.some((p) => p.id === id)) ?? [];
  const [who, setWho] = useState<string[]>(named.length ? named : H.me ? [H.me] : []);
  const [needs, setNeeds] = useState<Record<string, NeedKey[]>>(() => ({ ...(intent?.needs ?? {}) }) as Record<string, NeedKey[]>);
  const [note, setNote] = useState(typed);
  const [sent, setSent] = useState<{ id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const firstOpen = form.findIndex((f) => !(f.people || f.needs ? answers[f.k] : (answers[f.k] as string[] | undefined)?.length));
  const done = firstOpen === -1;
  const assigned = new Set(Object.values(needs).flat());
  const unassigned = (intent?.needsMentioned ?? []).filter((k) => !assigned.has(k));
  const nameOf = (id: string) => personName(people.find((p) => p.id === id), selfName);

  const send = async () => {
    setBusy(true);
    try {
      const plain = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v === true ? ['yes'] : v]));
      const r = await sendRequest({ kind: kind as never, query, answers: plain, travellerIds: who, needs, note: note.trim(), search: search ?? null });
      buzz('success');
      setSent({ id: r?.id ?? null });
      onSent?.(r?.id ?? null);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  useEffect(() => { if (autoSend && !sent) void send(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (sent) return <SentRequest id={sent.id} people={people} selfName={selfName} />;
  if (autoSend) return null;

  return (
    <View style={{ gap: 18 }}>
      {sysNote ? <Notice icon="doc"><T v="small">{sysNote}</T></Notice> : null}
      {kind === 'umrah' ? <Notice icon="umrah" warn><T v="small">{t('request.umrahNusuk')}</T></Notice> : null}
      {form.map((f, i) => (i > (done ? form.length : firstOpen) ? null : (
        <Animated.View key={f.k} entering={rise(0)} style={{ gap: 10 }}>
          <T v="h2">{t(f.q as CopyKey)}</T>
          {f.people ? (
            <>
              <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
              {!answers[f.k] ? <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('request.done')} onPress={() => setAnswers({ ...answers, [f.k]: true })} /> : null}
              {kind === 'visa' && who.some((id) => people.find((p) => p.id === id)?.relation === 'helper')
                ? <T v="small">{t('request.helperVisa', { names: who.filter((id) => people.find((p) => p.id === id)?.relation === 'helper').map(nameOf).join(' and ') })}</T> : null}
            </>
          ) : null}
          {f.needs ? (
            <>
              {unassigned.length ? <T v="small" color={colors.green}>{t('request.mentioned', { needs: unassigned.map((k) => NEED_LABELS[k].toLowerCase()).join(' and ') })}</T> : null}
              {who.map((id) => (
                <Card key={id} variant="well" padding={14} style={{ gap: 8 }}>
                  <T v="h3" style={{ fontSize: 15 }}>{nameOf(id)}</T>
                  <ChipWrap>
                    {NEED_KEYS.map((k) => {
                      const on = (needs[id] ?? []).includes(k);
                      return <Toggle key={k} small label={NEED_LABELS[k]} on={on} hint={unassigned.includes(k)} accessibilityLabel={`${NEED_LABELS[k]} for ${nameOf(id)}`} onPress={() => {
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
              {!answers[f.k] ? <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={Object.values(needs).some((x) => x.length) ? t('request.done') : t('request.nothingNeeded')} onPress={() => setAnswers({ ...answers, [f.k]: true })} /> : null}
            </>
          ) : null}
          {f.options ? (
            <ChipWrap>
              {f.options.map((o) => {
                const cur = (answers[f.k] as string[] | undefined) ?? [];
                const on = cur.includes(o);
                return <Toggle key={o} label={o} on={on} onPress={() => setAnswers({ ...answers, [f.k]: f.multi ? (on ? cur.filter((x) => x !== o) : [...cur, o]) : [o] })} />;
              })}
            </ChipWrap>
          ) : null}
        </Animated.View>
      )))}
      {done ? (
        <Animated.View entering={rise(0)} style={{ gap: 10 }}>
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

/** What was sent, how it's moving, the price per person, the thread. Also opened from Trips → Requests. */
export function SentRequest({ id }: { id: string | null; people?: Person[]; selfName?: string }) {
  const router = useRouter();
  const q = useBookingRequest(id);
  const r = q.data;
  if (!id) {
    return (
      <Animated.View entering={rise(0)} style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <MadaDot size={40} />
          <View style={{ flex: 1 }}><T v="h3">{t('request.queued')}</T><T v="small">{t('request.sentBody')}</T></View>
        </View>
        <Button variant="secondary" label={t('search.seeInTrips')} onPress={() => router.replace('/trips')} />
      </Animated.View>
    );
  }
  if (!r) return null;
  const answered = ['quoted', 'paid', 'done'].includes(r.status);
  const agent = r.agent?.name ?? 'Mada';
  return (
    <Animated.View entering={rise(0)} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <AgentDot name={agent} size={40} />
        <View style={{ flex: 1 }}>
          <T v="h3">{answered ? t('actor.replied', { agent }) : t('request.sent')}</T>
          <T v="small">{answered && r.quote ? t('request.replied') : t('request.sentBody')}</T>
        </View>
      </View>
      <Card variant="well" style={{ gap: 8 }}>
        <T v="h3">{r.title}</T>
        <T v="small">{r.summary || r.detail}</T>
        {r.note && r.summary ? <T style={styles.quote}>“{r.note}”</T> : null}
      </Card>
      {answered && r.quote ? (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><AgentDot name={agent} size={28} /><T v="h3" style={{ fontSize: 14 }}>{t('actor.intro', { agent })}</T></View>
          <T v="small" color={colors.green}>{r.quote.lead || r.quote.text}</T>
          {r.quote.needLines.length ? <View style={{ gap: 4 }}>{r.quote.needLines.map((x) => <T key={x} v="small">• {x}</T>)}</View> : null}
          <QuoteBreakdown r={r} />
          {r.status === 'quoted' && r.quote.status === 'open' && r.quote.total.amount > 0 ? (
            <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('request.pay', { price: formatSar(r.quote.total.amount) })} testID="request-pay"
              onPress={() => { usePayDraft.getState().set({ draft: { kind: 'quote', requestId: r.id }, title: r.title }); router.push('/pay'); }} />
          ) : null}
        </Card>
      ) : null}
      <RequestThread request={r} />
      <Button variant="secondary" label={t('search.seeInTrips')} onPress={() => router.replace('/trips')} />
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

/** Replies under a request, with the agent. Offers come with a button. */
export function RequestThread({ request }: { request: BookingRequestView }) {
  const qc = useQueryClient();
  const th = useThread(request.id);
  const [draft, setDraft] = useState('');
  const msgs = th.data?.messages ?? [];
  const agent = request.agent?.name ?? 'Mada';
  const send = async (text: string) => {
    const v = text.trim();
    if (!v) return;
    buzz('tap');
    setDraft('');
    try { qc.setQueryData(bookingKeys.messages(request.id), await bookingApi.postMessage(request.id, v)); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };
  const accept = async (messageId: string) => {
    if (!request.quote) return;
    try {
      const out = await bookingApi.acceptOffer(request.quote.id, messageId);
      qc.setQueryData(bookingKeys.request(request.id), out.request);
      qc.setQueryData(bookingKeys.messages(request.id), { messages: out.messages, agentTyping: false });
      buzz('success');
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };
  const suggestions = request.kind === 'umrah' ? [t('request.suggest.closer'), t('request.suggest.later')] : request.kind === 'flight' ? [t('request.suggest.laterFlight'), t('request.suggest.less')] : [t('request.suggest.dates')];
  return (
    <View style={{ gap: 8 }} accessibilityLabel={t('request.a11y.thread')}>
      {msgs.map((m) => (
        <View key={m.id} style={[styles.msg, m.from === 'me' ? styles.me : null]}>
          {m.from !== 'me' ? <AgentDot name={m.authorName ?? agent} size={28} /> : null}
          <View style={[styles.bubble, m.from === 'me' ? styles.bubbleMe : styles.bubbleThem]}>
            <T style={[font('callout', m.from === 'me' ? colors.mist : colors.green), { lineHeight: 20 }]}>{m.text}</T>
            {m.offer && !m.offer.accepted ? <Button size="small" block={false} variant="gold" style={{ alignSelf: 'flex-start' }} label={t('request.switch')} onPress={() => accept(m.id)} /> : null}
          </View>
        </View>
      ))}
      {th.data?.agentTyping ? (
        <View style={styles.msg}><AgentDot name={agent} size={28} /><View style={[styles.bubble, styles.bubbleThem]}><T v="small" accessibilityLabel={t('presence.typing', { agent })}>{t('presence.typing', { agent })}</T></View></View>
      ) : null}
      {!msgs.length ? <ChipWrap>{suggestions.map((x) => <Toggle key={x} label={x} on={false} onPress={() => send(x)} />)}</ChipWrap> : null}
      <View style={styles.reply}>
        <TextInput accessibilityLabel={t('request.reply')} value={draft} onChangeText={setDraft} placeholder={t('request.reply')} placeholderTextColor={colors.muted}
          onSubmitEditing={() => send(draft)} returnKeyType="send" style={[{ flex: 1, minWidth: 0 }, font('body', colors.green), { fontSize: 15 }, webNoOutline]} testID="reply-input" />
        <Pressable accessibilityRole="button" accessibilityLabel={t('request.a11y.send')} disabled={!draft.trim()} onPress={() => send(draft)} style={[styles.send, !draft.trim() ? { opacity: 0.4 } : null]}>
          <Icon name="up" color={colors.mist} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

/** A city we don't sell live: Mada searches it by hand and replies in the request. */
export function ByHand({ city, stay, queued }: { city: string; stay?: boolean; queued?: boolean }) {
  return (
    <Animated.View entering={rise(0)} style={{ gap: 14 }}>
      <View style={styles.stage}><ArtMap /></View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <MadaDot size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3">{queued ? t('search.byHand.queued', { city }) : stay ? t('search.byHand.stayTitle', { city }) : t('search.byHand.title', { city })}</T>
          <T v="small">{t('search.byHand.body')}</T>
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
  msg: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: '88%' },
  me: { alignSelf: 'flex-end' },
  bubble: { paddingVertical: 9, paddingHorizontal: 13, gap: 6, flexShrink: 1 },
  bubbleThem: { backgroundColor: colors.paper, borderRadius: 18, borderTopLeftRadius: 6 },
  bubbleMe: { backgroundColor: colors.green, borderRadius: 18, borderTopRightRadius: 6 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 46, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 16, paddingEnd: 4 },
  send: { width: 38, height: 38, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  stage: { height: 132, borderRadius: 20, backgroundColor: '#f6efe2', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,93,39,0.1)' },
});
