import { useEffect, useRef, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DESK_PHONE, DESK_SMS, DESK_TEL, DESK_WHATSAPP, SUPPORT_TOPICS, checkUpload, formatSar, type SupportMessage, type SupportTopic } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { InlineError } from '@/components/states';
import { ArtChat } from '@/components/wallet/Arts';
import { TypingDots } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { useApiQuery } from '@/lib/net/hooks';
import { useDeviceOffline, useNet } from '@/lib/net/state';
import { discardItem, retryItem, useOutbox } from '@/lib/net/outbox';
import { chooseFile } from '@/lib/pick';
import { useSession } from '@/lib/session';
import { SUPPORT_KIND, deliver, newClientId, useChat, useSendToMada } from '@/lib/support-chat';
import { toast } from '@/lib/toast';
import { usePresence, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { hhmm, nextTrip } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

const TOPIC_ICON: Record<SupportTopic, IconName> = { change: 'flight', refund: 'refund', bag: 'bag', docs: 'visa', airport: 'pin', other: 'more' };

/**
 * Talk to Mada (prototype Support.jsx, COPY.md §1): one conversation, with the person on duty shown small under
 * "Mada". Topics to start, instant answers for what was asked, the bag form, urgent help with a call button, and
 * offline: messages wait on the phone, with call and SMS to the desk. `?trip=` opens the trip's conversation.
 */
export default function Support() {
  const router = useRouter();
  const { trip: tripParam, topic, thread: threadParam } = useLocalSearchParams<{ trip?: string; topic?: string; thread?: string }>();
  const user = useSession((s) => s.user);
  const trips = useTrips();
  const trip = nextTrip(trips.data);
  const tripId = tripParam ?? undefined;
  const key = threadParam ?? (tripId ? `trip:${tripId}` : 'account');
  const q = useApiQuery({ queryKey: walletKeys.thread(key), refetchOnMount: 'always', refetchInterval: 10_000, queryFn: () => (threadParam ? walletApi.thread(threadParam) : walletApi.openThread(tripId ? { tripId } : {})) });
  const th = q.data?.thread;
  const phoneOffline = useDeviceOffline();
  const presence = usePresence(th?.id && q.data?.messages.some((m) => m.author.kind === 'user') ? th.id : undefined);
  const typing = useChat((s) => (th ? !!s.typing[th.id] : false));
  const offline = useNet((s) => s.online === false) || demo('offline');
  const pending = useOutbox(SUPPORT_KIND, (i) => i.meta?.threadId === th?.id);
  const { send: post, sending } = useSendToMada(key, th?.id, t('action.send'));
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const bottom = useBottomInset();
  const started = useRef(false);

  const messages = q.data?.messages ?? [];
  useEffect(() => { if (th?.id && th.unread) walletApi.markRead(th.id).catch(() => {}); }, [th?.id, th?.unread, messages.length]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [messages.length, typing, pending.length]);

  const send = (body: string, extra: { topic?: SupportTopic } = {}) => {
    if (!th || (!body.trim() && !extra.topic)) return;
    buzz('tap');
    post({ body: body.trim(), ...extra });
  };
  const reply = (m: SupportMessage, choice: string) => {
    if (!th) return;
    buzz('tap');
    post({ body: '', reply: { messageId: m.id, choice } });
  };
  // A topic passed in (Help → a topic): start with it once.
  useEffect(() => {
    if (!th || started.current || messages.length || !topic || !(SUPPORT_TOPICS as readonly string[]).includes(topic)) return;
    started.current = true;
    send('', { topic: topic as SupportTopic });
  }, [th, topic, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const attach = async () => {
    if (!th) return;
    const f = await chooseFile();
    if (!f) return;
    const bad = checkUpload(f);
    if (bad) { toast(bad === 'wallet.upload.tooBig' ? t('support.tooBig') : t(bad)); buzz('soft'); return; }
    const clientId = newClientId();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { const r = await walletApi.sendAttachment(th.id, f, clientId); deliver(key, th.id, r.messages); return; } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) { toast(e.message); return; }
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
    toast(t('support.uploadFailed'));
  };

  const lastResolved = messages.map((m) => !!m.card?.resolved).lastIndexOf(true);
  const lastRated = messages.map((m) => !!m.card?.rated).lastIndexOf(true);
  const askRating = lastResolved > -1 && lastResolved > lastRated && !typing && !pending.length;
  const queued = pending.filter((i) => i.state !== 'failed');
  const smsBody = encodeURIComponent(queued.map((i) => i.meta?.text).filter(Boolean).join('\n') || t('support.offline.smsBody'));
  const who = presence.data?.agent;
  const away = phoneOffline || presence.data?.online === false;
  const line = typing && !away ? t('presence.typing', { agent: who?.name ?? 'Faisal' })
    : presence.data?.line ?? (phoneOffline ? t('presence.offline', { agent: 'Faisal' }) : `${t('presence.online', { agent: 'Faisal' })} · ${t('presence.replies', { minutes: 2 })}`);
  const what = th?.tripId && trip ? t('support.aboutTrip', { city: trip.city }) : t('support.account');
  const name = user?.name;

  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))} right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="link" accessibilityLabel={t('support.whatsapp')} onPress={() => Linking.openURL(DESK_WHATSAPP).catch(() => {})} style={[styles.iconBtn, { backgroundColor: colors.paper }]}><ChatIcon /></Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={t('support.call', { phone: DESK_PHONE })} onPress={() => Linking.openURL(DESK_TEL).catch(() => {})} style={[styles.iconBtn, { backgroundColor: colors.green }]} testID="support-call"><PhoneIcon /></Pressable>
        </View>
      } />
      <View style={styles.head}>
        <View>
          <View style={[styles.avatar, { backgroundColor: colors.green }]}><T style={{ fontFamily: ff.ui600, fontSize: 20, color: colors.sand }}>{who?.initial ?? 'F'}</T></View>
          {away ? <View style={[styles.dot, styles.dotAway]} testID="support-presence-away" /> : <View style={styles.dot} />}
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <T v="h2" style={{ fontSize: 22 }} accessibilityRole="header">{t('presence.title')}</T>
          <T v="tiny" testID="support-presence">{line}</T>
        </View>
      </View>
      {th ? <View style={styles.about}><Icon name="trips" size={16} color={colors.goldInk} /><T v="caption" color={colors.goldInk} style={{ fontFamily: ff.ui600 }}>{t('support.about', { about: th.about })}</T></View> : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 120, gap: 10 }} keyboardShouldPersistTaps="handled">
          <T v="tiny" style={{ textAlign: 'center', marginHorizontal: 12 }}>{t('support.disclosure')}</T>
          {q.data && messages.length === 0 && !pending.length ? (
            <View style={{ gap: 12 }}>
              <View style={{ alignItems: 'center' }}><ArtChat /></View>
              <Bubble them><T v="body" color={colors.green} style={{ fontSize: 15 }}>{name ? t('support.hiNamed', { name, what }) : t('support.hi', { what })}</T></Bubble>
              <View style={styles.topics} accessibilityLabel={t('support.topics')}>
                {SUPPORT_TOPICS.map((k) => (
                  <Pressable key={k} accessibilityRole="button" onPress={() => send('', { topic: k })} style={({ pressed }) => [styles.topic, pressed ? { transform: [{ scale: 0.98 }] } : null]} testID={`topic-${k}`}>
                    <Icon name={TOPIC_ICON[k]} size={18} /><T v="h3" style={{ fontSize: 14 }}>{t(`support.topic.${k}`)}</T>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {messages.map((m) => <Message key={m.id} m={m} hasTrip={!!th?.tripId} onReply={reply} onBag={(b) => post({ body: '', bag: b, bagFor: m.id })}
            onNoRef={() => post({ body: '', bag: { messageId: m.id, none: true } })} onAction={(to) => router.push(to as '/trips')} />)}
          {!q.data && (q.view === 'error' || q.view === 'slow') ? <InlineError problem={q.problem} onRetry={() => q.retry()} testID="support-load-error" /> : null}
          {sending && sending.threadId === th?.id && sending.req.body ? (
            <View style={{ alignSelf: 'flex-end', maxWidth: '82%', gap: 4 }}>
              <Bubble><T v="body" color={colors.mist} style={{ fontSize: 15 }}>{sending.req.body}</T></Bubble>
              <T v="tiny" style={{ alignSelf: 'flex-end' }}>{t('support.sending')}</T>
            </View>
          ) : null}
          {pending.map((i) => (
            <View key={i.id} style={{ alignSelf: 'flex-end', maxWidth: '82%', gap: 4 }}>
              <Bubble><T v="body" color={colors.mist} style={{ fontSize: 15 }}>{i.meta?.text || t('support.sending')}</T></Bubble>
              {i.state === 'failed' ? (
                <View style={{ flexDirection: 'row', gap: 12, alignSelf: 'flex-end', alignItems: 'center' }}>
                  <T v="tiny" color={colors.badInk}>{t('support.notSent')}</T>
                  <Pressable onPress={() => retryItem(i.id)}><T v="tiny" style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }}>{t('support.sendAgain')}</T></Pressable>
                  <Pressable onPress={() => discardItem(i.id)}><T v="tiny" style={{ textDecorationLine: 'underline' }}>{t('support.remove')}</T></Pressable>
                </View>
              ) : <T v="tiny" style={{ alignSelf: 'flex-end' }} testID="support-queued">{offline || i.state === 'queued' ? t('support.queued') : t('support.sending')}</T>}
            </View>
          ))}
          {typing ? <Bubble them><TypingDots /></Bubble> : null}
          {offline ? (
            <View style={styles.well} accessibilityRole="alert" testID="support-offline">
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="wifiOff" size={18} /><T v="h3" style={{ fontSize: 15 }}>{t('support.offline.title')}</T></View>
              <T v="small">{`${queued.length ? tn('support.offline.queued', queued.length) : t('support.offline.none')} ${t('support.offline.desk')}`}</T>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button size="small" block={false} label={t('support.offline.call')} onPress={() => Linking.openURL(DESK_TEL).catch(() => {})} testID="offline-call" />
                <Button variant="secondary" size="small" block={false} label={t('support.offline.sms')} onPress={() => Linking.openURL(`${DESK_SMS}?&body=${smsBody}`).catch(() => {})} testID="offline-sms" />
              </View>
            </View>
          ) : null}
          {askRating ? (
            <View style={styles.well} testID="support-rate">
              <T v="h3" style={{ fontSize: 15 }}>{t('support.rate.title')}</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button variant="secondary" size="small" block={false} label={t('support.rate.yes')} onPress={() => post({ body: '', rating: 'yes' })} />
                <Button variant="secondary" size="small" block={false} label={t('support.rate.no')} onPress={() => post({ body: '', rating: 'not_yet' })} />
              </View>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.act, { paddingBottom: 20 + bottom }]}>
          <View style={styles.composer}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('support.attach')} onPress={attach} style={styles.attach} testID="support-attach"><Icon name="plus" size={20} /></Pressable>
            <TextInput accessibilityLabel={t('support.placeholder')} value={draft} onChangeText={setDraft} placeholder={t('support.placeholder')} placeholderTextColor={colors.muted} testID="support-input"
              onSubmitEditing={() => { send(draft); setDraft(''); }} returnKeyType="send"
              style={[styles.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('support.send')} disabled={!draft.trim()} onPress={() => { send(draft); setDraft(''); }} style={[styles.sendBtn, !draft.trim() ? { opacity: 0.45 } : null]} testID="support-send">
              <Icon name="up" size={18} color={colors.mist} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({ them, children }: { them?: boolean; children: React.ReactNode }) {
  return <View style={[styles.msg, them ? styles.them : styles.me]}>{children}</View>;
}

const REFUND_STAGE: Record<string, Parameters<typeof t>[0]> = { requested: 'support.refund.stage.requested', approved: 'support.refund.stage.approved', sent: 'support.refund.stage.sent', rejected: 'support.refund.stage.rejected' };

function Message({ m, hasTrip, onReply, onBag, onNoRef, onAction }: {
  m: SupportMessage; hasTrip: boolean; onReply: (m: SupportMessage, choice: string) => void; onBag: (b: { ref: string; kind: string; to: string }) => void; onNoRef: () => void; onAction: (to: string) => void;
}) {
  const mine = m.author.kind === 'user';
  const fg = mine ? colors.mist : colors.green;
  const c = m.card;
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 4 }}>
      {m.author.kind === 'agent' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.avatar, { width: 22, height: 22, backgroundColor: colors.green }]}><T style={{ fontFamily: ff.ui600, fontSize: 10, color: colors.sand }}>{m.author.name.charAt(0)}</T></View>
          <T v="caption" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{m.author.name}</T>
        </View>
      ) : null}
      <View style={[styles.msg, mine ? styles.me : styles.them]}>
        {m.attachment && m.attachment.mime !== 'application/pdf' ? <View style={styles.photo}><Icon name="scan" color={colors.muted} /><T v="tiny" color={mine ? colors.onDark2 : colors.ink3}>{m.attachment.name}</T></View> : null}
        {m.body ? <T v="body" color={fg} style={{ fontSize: 15, lineHeight: 21 }}>{m.body}</T> : null}
        {c?.refund ? (
          <View style={styles.refund}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="h3" style={{ fontSize: 15 }}>{formatSar(c.refund.amount)}</T>
              <View style={styles.pill}><T v="caption" style={{ fontFamily: ff.ui600 }}>{c.refund.stage === 'sent' ? t('support.refund.sent') : c.refund.stage === 'rejected' ? t('support.refund.withFaisal') : t('support.refund.onWay')}</T></View>
            </View>
            <T v="small">{c.refund.title}</T>
            <T v="small" color={colors.green}>{`${t(REFUND_STAGE[c.refund.stage] ?? 'support.refund.stage.requested')}. ${t('support.refund.to', { card: c.refund.card })}`}</T>
          </View>
        ) : null}
        {c?.steps ? <View style={{ gap: 6 }}>{c.steps.map((s, i) => <T key={s} v="callout" color={colors.green}>{`${i + 1}. ${s}`}</T>)}</View> : null}
        {c?.choices && !c.picked ? <View style={{ gap: 6 }}>{c.choices.map((ch) => <Button key={ch.key} variant="secondary" size="small" style={{ backgroundColor: colors.mist, justifyContent: 'flex-start' }} label={ch.label} onPress={() => onReply(m, ch.key)} />)}</View> : null}
        {c?.form === 'bag' && !c.filed ? <BagForm hasTrip={hasTrip} onSend={onBag} onNone={onNoRef} /> : null}
        {c?.action ? <Button variant="gold" size="small" block={false} style={{ alignSelf: 'flex-start' }} label={c.action.label} onPress={() => onAction(c.action!.to)} /> : null}
        {c?.urgent ? <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('support.callDesk')} onPress={() => Linking.openURL(DESK_TEL).catch(() => {})} testID="urgent-call" /> : null}
        <T style={{ fontSize: 11, opacity: 0.6, color: fg }}>{`${hhmm(m.createdAt)}${mine ? ` · ${t('support.read')}` : ''}`}</T>
      </View>
    </View>
  );
}

const KINDS = ['support.bag.black', 'support.bag.coloured', 'support.bag.box'] as const;
function BagForm({ hasTrip, onSend, onNone }: { hasTrip: boolean; onSend: (b: { ref: string; kind: string; to: string }) => void; onNone: () => void }) {
  const [ref, setRef] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>(KINDS[0]);
  const [to, setTo] = useState<'support.bag.hotel' | 'support.bag.home'>(hasTrip ? 'support.bag.hotel' : 'support.bag.home');
  const ok = ref.trim().length >= 5;
  return (
    <View style={styles.form} testID="bag-form">
      <Field label={t('support.bag.ref')} value={ref} onChangeText={setRef} placeholder={t('support.bag.refHint')} autoCapitalize="characters" testID="bag-ref" />
      <T v="tiny">{t('support.bag.what')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{KINDS.map((k) => <Chip key={k} on={kind === k} label={t(k)} background={colors.paper} onPress={() => setKind(k)} />)}</View>
      <T v="tiny">{t('support.bag.to')}</T>
      <View style={{ flexDirection: 'row', gap: 6 }}>{(['support.bag.hotel', 'support.bag.home'] as const).map((k) => <Chip key={k} on={to === k} label={t(k)} background={colors.paper} onPress={() => setTo(k)} />)}</View>
      <Button size="small" label={t('action.send')} disabled={!ok} onPress={() => onSend({ ref: ref.trim(), kind: t(kind), to: t(to) })} testID="bag-send" />
      <Pressable accessibilityRole="button" onPress={onNone}><T v="small" style={{ textDecorationLine: 'underline', fontFamily: ff.ui600 }}>{t('support.bag.none')}</T></Pressable>
    </View>
  );
}

/** The phone glyph (prototype Support.jsx PhoneIcon). */
function PhoneIcon({ color = colors.mist, size = 20 }: { color?: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></Svg>;
}

/** WhatsApp's speech bubble, drawn in our line style. */
function ChatIcon({ color = colors.green, size = 20 }: { color?: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z" /><Path d="M9 9.5c.3 1.8 1.7 3.2 3.5 3.5l1-1 2 .8c-.2 1.3-1.3 2-2.5 1.7A6 6 0 0 1 8.3 9.8C8 8.6 8.7 7.5 10 7.3l.8 2z" /></Svg>;
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingBottom: 8 },
  avatar: { width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', end: -2, bottom: -2, width: 13, height: 13, borderRadius: 99, backgroundColor: colors.live, borderWidth: 2, borderColor: colors.sand },
  dotAway: { backgroundColor: colors.ink3 },
  about: { marginHorizontal: 24, marginBottom: 6, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f3ead8', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topic: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.paper, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 12 },
  msg: { gap: 8, paddingVertical: 10, paddingHorizontal: 14 },
  them: { backgroundColor: colors.paper, borderTopLeftRadius: 6, borderTopRightRadius: 22, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, alignSelf: 'flex-start' },
  me: { backgroundColor: colors.green, borderTopLeftRadius: 22, borderTopRightRadius: 6, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, alignSelf: 'flex-end' },
  photo: { width: 180, height: 110, borderRadius: 14, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center', gap: 4 },
  refund: { gap: 4, padding: 12, borderRadius: 14, backgroundColor: colors.mist },
  pill: { height: 24, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.paper, justifyContent: 'center' },
  well: { gap: 8, padding: 16, borderRadius: 24, backgroundColor: colors.mist },
  form: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.mist },
  act: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingTop: 24, paddingHorizontal: 20, backgroundColor: 'transparent' },
  composer: { height: 52, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 8, paddingEnd: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  attach: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, fontSize: 16, fontFamily: ff.ui400, color: colors.green, height: 48 },
  sendBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
