import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { circleDest, joinNames, planById, type CircleMessage, type MadaAction, type PersonRef, type SplitShare } from '@mada/shared';
import { Button } from '@/components/Button';
import { Bubble, BubbleText, ShareCard, SplitCard, SysLine, Typing, VoteCard, VoteIcon, type Who } from '@/components/circles/chat';
import { ArtChat } from '@/components/circles/art';
import { useSaveToggle } from '@/components/circles/hooks';
import { CircleSettings } from '@/components/circles/settings';
import { ToolsSheet, ShareSheet, SplitSheet, VoteSheet, type Tool } from '@/components/circles/tools';
import { Faces, Row, webNoOutline } from '@/components/circles/ui';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { COVERS, circlesApi, ck, queueMessage, sysText, useAct, useCircle, useMeId, useMergeMessages, useMessages } from '@/lib/circles';
import { useOutbox } from '@/lib/net/outbox';
import { ErrorState, GoneState } from '@/components/states';
import { OutboxStatus } from '@/components/states/OutboxList';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff, font } from '@/theme';

/** One circle (prototype Group): the chat, with votes, splits, shared plans and places, and Mada. Polls every 5 s. */
export default function CircleChat() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const me = useMeId();
  const bottom = useBottomInset();
  const circle = useCircle(id);
  const msgs = useMessages(id);
  const merge = useMergeMessages(id);
  const [draft, setDraft] = useState('');
  const [sheet, setSheetRaw] = useState<null | 'tools' | Tool | 'settings'>(null);
  const [opens, setOpens] = useState(0);
  const setSheet = (s: null | 'tools' | Tool | 'settings') => { if (s) setOpens((n) => n + 1); setSheetRaw(s); };
  const [asking, setAsking] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const positions = useRef(new Map<string, number>());
  const { isSaved, togglePost, togglePlan } = useSaveToggle();
  const d = circle.data;
  const items = msgs.data?.items ?? [];
  const reads = msgs.data?.reads ?? [];
  const holdTop = useRef<boolean | null>(null);

  const people = useMemo(() => new Map<string, PersonRef>([...(d?.invited ?? []).map((i) => [i.person.id, i.person] as const), ...(d?.members ?? []).map((m) => [m.id, m] as const)]), [d]);
  const dest = d ? circleDest({ dest: d.circle.dest, name: d.circle.name, trip: d.circle.trip }) : null;
  const others = (d?.members ?? []).filter((m) => m.id !== me);
  const invited = d?.invited ?? [];
  const admin = d?.circle.role === 'admin';
  const dm = !!d?.circle.dm;

  // Read up to now while the chat is open, and on every new message.
  const read = useAct(() => circlesApi.update(id, { read: true }), () => [ck.list]);
  const count = items.length;
  const joins = items.filter((m) => m.kind === 'sys' && ['joined', 'joinedByLink', 'left', 'removed', 'admin', 'renamed'].includes(m.sys!.event)).length;
  useEffect(() => { if (joins) void circle.refetch(); }, [joins]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d && count) read.mutate(undefined); }, [d?.circle.id, count]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { msgs.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!count || !d) return;
    if (holdTop.current === null) holdTop.current = d.circle.fresh;
    if (holdTop.current) { holdTop.current = false; return; }
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }, [count, asking, d]);

  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('error.internal'));
  const send = useAct((b: Parameters<typeof circlesApi.send>[1]) => circlesApi.send(id, b), () => [], (b) => queueMessage(id, 'body' in b ? b.body : t('circles.tools.share'), `/circles/${id}/messages`, b));
  const queued = useOutbox('circle', (i) => i.meta?.circleId === id);
  const say = (text?: string) => {
    const v = (text ?? draft).trim();
    if (!v) return;
    buzz('tap');
    setDraft('');
    const mada = /@mada\b/i.test(v) || !!items.filter((m) => m.kind !== 'sys').at(-1)?.mada?.askWhere;
    if (mada) setAsking(true);
    send.mutate({ body: v }, { onSuccess: (r) => { if (r) merge(r.items); }, onError: (e) => { setDraft(v); fail(e); }, onSettled: () => setAsking(false) });
  };
  const vote = useAct((b: Parameters<typeof circlesApi.vote>[1]) => circlesApi.vote(id, b), () => [], (b) => queueMessage(id, b.q, `/circles/${id}/votes`, b));
  const cast = useAct((a: { mid: string; o: string }) => circlesApi.cast(id, a.mid, a.o), () => [], (a) => ({ ...queueMessage(id, a.o, `/circles/${id}/votes/${a.mid}`, { option: a.o }), dedupe: `vote:${a.mid}` }));
  const close = useAct((mid: string) => circlesApi.closeVote(id, mid), () => []);
  const pick = useAct((a: { mid: string; o: string }) => circlesApi.pick(id, a.mid, a.o), () => []);
  const split = useAct((b: Parameters<typeof circlesApi.split>[1]) => circlesApi.split(id, b), () => []);
  const paid = useAct((a: { mid: string; key: string }) => circlesApi.paid(id, a.mid, { key: a.key, via: 'cash' }), () => []);
  const remind = useAct((mid: string) => circlesApi.remindSplit(id, mid), () => []);
  const dismiss = useAct((mid: string) => circlesApi.dismiss(id, mid), () => []);
  const pin = useAct((pid: string) => circlesApi.update(id, { pin: { kind: 'plan', id: pid } }), () => [ck.circle(id), ck.messages(id)]);
  const on = { onSuccess: (r: { items: CircleMessage[] } | undefined) => { if (r) merge(r.items); }, onError: fail };

  if (circle.isError && (circle.error as ApiError)?.status === 404) {
    return <Screen><TopBar onBack={() => router.back()} backLabel={t('circles.back')} /><GoneState variant="full" /></Screen>;
  }
  if (!circle.data && (circle.view === 'error' || circle.view === 'offline')) {
    return <Screen><TopBar onBack={() => router.back()} backLabel={t('circles.back')} /><ErrorState problem={circle.problem} onRetry={circle.retry} /></Screen>;
  }
  if (!d) return <Screen><TopBar onBack={() => router.back()} backLabel={t('circles.back')} /></Screen>;

  const author = (m: CircleMessage): Who => m.author.kind === 'user' ? (m.author.id === me ? { kind: 'me' } : { kind: 'person', p: people.get(m.author.id) ?? { id: m.author.id, name: m.author.name, short: m.author.name, initial: m.author.name.charAt(0), tone: 'default' } })
    : m.author.kind === 'agent' ? { kind: 'agent', name: m.author.name } : { kind: 'mada' };
  const whoName = (m: CircleMessage) => (m.author.kind === 'user' && m.author.id === me ? t('circles.you') : m.author.kind === 'user' ? m.author.name : t('circles.mada'));
  const openVote = [...items].reverse().find((m) => m.kind === 'vote' && !m.vote!.closed);
  const pinned = openVote ? { kind: 'vote' as const, m: openVote } : d.pinned ? { kind: 'plan' as const, id: d.pinned.id } : null;
  const voters = (m: CircleMessage) => m.vote!.options.reduce((a, o) => a + o.votes.length, 0);
  const lastMine = [...items].reverse().find((m) => m.kind === 'text' && m.author.kind === 'user' && m.author.id === me);
  const story = items.some((m) => ['text', 'vote', 'split', 'card'].includes(m.kind) || (m.kind === 'mada' && m.mada!.kind !== 'welcome') || m.author.kind === 'agent');
  const ask = (prefill: string) => router.push({ pathname: '/ask', params: { prefill } });
  const act = (m: CircleMessage, a: MadaAction) => {
    buzz('tap');
    if (a.ask) ask(a.ask);
    else if (a.plan) router.push(`/plan/${a.plan}`);
    else if (a.say) say(a.say);
    else if (a.pick && m.mada?.ref) pick.mutate({ mid: m.mada.ref, o: a.pick }, on);
    else if (a.dismiss) dismiss.mutate(m.id, on);
  };
  const payShare = (m: CircleMessage, sh: SplitShare) => {
    const payee = people.get(m.split!.paidBy)?.short ?? '';
    router.push({ pathname: '/pay', params: { kind: 'share', amount: String(sh.amount), title: m.split!.what, circle: d.circle.name, payee, circleId: id, messageId: m.id, shareKey: sh.key } });
  };
  const jump = (mid: string) => { const y = positions.current.get(mid); if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 120), animated: true }); };
  const sub = [dest && d.circle.trip ? d.circle.trip : dest, tn('circles.people', d.members.length), invited.length ? t('circles.chat.invited', { count: invited.length }) : null, d.circle.muted ? t('circles.chat.muted') : null].filter(Boolean).join(' · ');

  const faces = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('circles.chat.settingsA11y', { name: d.circle.name })} onPress={() => { buzz('tap'); setSheet('settings'); }}
      style={[st.faces, d.circle.cover && !dm ? st.facesPhoto : null]} testID="circle-settings">
      <Faces people={d.members.slice(0, 3)} size={28} overlap={8} ring={d.circle.cover && !dm ? 'rgba(15,26,22,0.6)' : colors.sand} />
      {d.members.length > 3 ? <T style={{ fontSize: 12, fontFamily: ff.ui600, color: d.circle.cover && !dm ? colors.paper : colors.green }}>+{d.members.length - 3}</T> : null}
    </Pressable>
  );

  return (
    <Screen>
      {dm ? <TopBar onBack={() => router.back()} backLabel={t('circles.back')} title={d.circle.name} right={faces} /> : (
        <View style={[st.head, d.circle.cover ? { backgroundColor: colors.night } : null]}>
          {d.circle.cover ? <>
            <Image source={COVERS[d.circle.cover]} style={StyleSheet.absoluteFill} contentFit="cover" />
            <VGradient id="cx-head" stops={[[0, 'rgba(15,26,22,0.55)'], [0.4, 'rgba(15,26,22,0.25)'], [1, 'rgba(15,26,22,0.82)']]} />
          </> : null}
          <TopBar onBack={() => router.back()} backLabel={t('circles.back')} dark={!!d.circle.cover} right={faces} />
          <View style={{ paddingHorizontal: 24, gap: 4 }}>
            <T style={[font('display', d.circle.cover ? colors.paper : colors.green), { fontSize: 34, lineHeight: 36 }]} accessibilityRole="header" balance={false}>{d.circle.name}</T>
            <T style={{ fontSize: 13, fontFamily: ff.ui400, color: d.circle.cover ? 'rgba(255,253,249,0.88)' : colors.ink3 }}>{sub}</T>
          </View>
        </View>
      )}
      {pinned ? (
        <Pressable accessibilityRole="button" onPress={() => (pinned.kind === 'vote' ? jump(pinned.m.id) : router.push(`/plan/${pinned.id}`))} style={st.pin} testID="pinned">
          <View style={st.pinIc}>{pinned.kind === 'vote' ? <VoteIcon /> : <Icon name="pin" size={16} color={colors.goldInk} />}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ fontSize: 11, fontFamily: ff.ui600, letterSpacing: 0.7, color: colors.goldInk, textTransform: 'uppercase' }}>{pinned.kind === 'vote' ? t('circles.chat.openVote') : t('circles.chat.pinnedPlan')}</T>
            <T style={{ fontSize: 14, fontFamily: ff.ui600, color: colors.green }} numberOfLines={1}>{pinned.kind === 'vote' ? t('circles.chat.voted', { q: pinned.m.vote!.q, n: voters(pinned.m), total: d.members.length }) : planById(pinned.id)?.title}</T>
          </View>
          <Icon name="chevron" size={18} />
        </Pressable>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={st.thread} keyboardShouldPersistTaps="handled">
          {!story && msgs.isSuccess ? (
            <View style={st.hero}>
              <ArtChat />
              <T style={[font('display'), { fontSize: 30, lineHeight: 32, textAlign: 'center' }]} balance>{dm ? t('circles.chat.dmTitle', { name: d.circle.name }) : t('circles.chat.startsHere', { name: d.circle.name })}</T>
              <T v="small" style={{ textAlign: 'center' }}>{dm ? t('circles.chat.dmBody') : t('circles.chat.startsBody')}</T>
              {dm ? <Row gap={8}>{[t('circles.chat.idea.salam'), t('circles.chat.idea.free')].map((x) => <Button key={x} size="small" block={false} variant="secondary" label={x} onPress={() => { setDraft(x); input.current?.focus(); }} />)}</Row> : null}
            </View>
          ) : null}
          {items.map((m, i) => {
            const prev = items[i - 1];
            const onLayout = (e: { nativeEvent: { layout: { y: number } } }) => positions.current.set(m.id, e.nativeEvent.layout.y);
            if (m.kind === 'sys') return <View key={m.id} onLayout={onLayout}><SysLine text={sysText(m, me, people)} /></View>;
            const who = author(m);
            const cont = !!prev && prev.kind === 'text' && m.kind === 'text' && prev.author.kind === m.author.kind && (prev.author as { id?: string }).id === (m.author as { id?: string }).id;
            if (m.kind === 'vote') return (
              <View key={m.id} onLayout={onLayout}><Bubble who={who} wide label={t('circles.chat.startedVote', { who: whoName(m) })}>
                <VoteCard m={m} me={me} total={d.members.length} people={people} canClose={(m.author.kind === 'user' && m.author.id === me) || admin}
                  onVote={(o) => cast.mutate({ mid: m.id, o }, on)} onClose={() => close.mutate(m.id, on)} />
              </Bubble></View>
            );
            if (m.kind === 'split') return (
              <View key={m.id} onLayout={onLayout}><Bubble who={who} wide label={t('circles.chat.splitCost', { who: whoName(m) })}>
                <SplitCard m={m} me={me} people={people} onPay={(sh) => payShare(m, sh)}
                  onRemind={() => remind.mutate(m.id, { ...on, onSuccess: (r) => { if (!r) return; merge(r.items); const names = m.split!.shares.filter((s) => !s.paid && !s.ids.includes(me)).map((s) => people.get(s.ids[0]!)?.short ?? ''); toast(t('circles.split.remindToast', { names: joinNames(names) })); } })}
                  onMark={(sh) => paid.mutate({ mid: m.id, key: sh.key }, on)} />
              </Bubble></View>
            );
            if (m.kind === 'card' && m.card) return (
              <View key={m.id} onLayout={onLayout}><Bubble who={who} wide label={m.card.kind === 'plan' ? t('circles.chat.sharedPlan', { who: whoName(m) }) : t('circles.chat.sharedPlace', { who: whoName(m) })}>
                <ShareCard m={m} saved={m.card.kind === 'plan' ? isSaved('plan', m.card.id) : isSaved('post', m.card.post.id)} pinned={d.pinned?.id === (m.card.kind === 'plan' ? m.card.id : '')} canPin={!dm}
                  onOpenPlan={(pid) => router.push(`/plan/${pid}`)} onPin={() => m.card?.kind === 'plan' && pin.mutate(m.card.id)}
                  onSave={() => (m.card!.kind === 'plan' ? togglePlan(m.card!.id) : togglePost(m.card!.post))}
                  onPlan={() => m.card!.kind === 'place' && ask(m.card!.post.kind === 'food' ? t('circles.tableAsk', { place: m.card!.post.place }) : m.card!.post.place)} />
              </Bubble></View>
            );
            if (m.kind === 'mada' && m.mada) {
              if (m.mada.kind === 'welcome') {
                const text = others.length ? t('circles.mada.welcomeOthers', { name: d.circle.name })
                  : invited.length ? t(invited.length === 1 ? 'circles.mada.welcomeInvited.one' : 'circles.mada.welcomeInvited.other', { name: d.circle.name, names: joinNames(invited.map((x) => x.person.short)) })
                    : t('circles.mada.welcomeAlone', { name: d.circle.name });
                return (
                  <View key={m.id} onLayout={onLayout}><Bubble who={{ kind: 'mada' }}>
                    <BubbleText>{text}</BubbleText>
                    <Row wrap gap={8}>
                      {!others.length && !invited.length ? <Button size="small" block={false} label={t('circles.chat.invitePeople')} onPress={() => setSheet('settings')} /> : null}
                      <Button size="small" block={false} variant="secondary" label={t('circles.mada.ideasFor', { dest: dest ?? t('circles.mada.aTrip') })} onPress={() => say(t('circles.mada.ideasMsg', { dest: dest ?? t('circles.mada.aTrip') }))} testID="mada-ideas" />
                      <Button size="small" block={false} variant="secondary" label={t('circles.chat.startVote')} onPress={() => setSheet('vote')} />
                      {others.length ? <Button size="small" block={false} variant="secondary" label={t('circles.chat.split')} onPress={() => setSheet('split')} /> : null}
                    </Row>
                  </Bubble></View>
                );
              }
              return (
                <View key={m.id} onLayout={onLayout}><Bubble who={{ kind: 'mada' }} testID="mada-answer">
                  <BubbleText>{m.body}</BubbleText>
                  {m.mada.list.length ? <View style={{ gap: 4 }}>{m.mada.list.map((l, j) => <Row key={l} gap={8} style={{ alignItems: 'flex-start' }}><T style={{ fontFamily: ff.ui700, color: colors.goldDeep, fontSize: 15 }}>{j + 1}.</T><T style={{ flex: 1, fontSize: 15, lineHeight: 22, color: colors.green, fontFamily: ff.ui400 }}>{l}</T></Row>)}</View> : null}
                  {m.mada.foot ? <T v="tiny">{m.mada.foot}</T> : null}
                  {!m.mada.done && m.mada.actions.length ? (
                    <Row wrap gap={8}>{m.mada.actions.map((a, j) => <Button key={a.label} size="small" block={false} variant={j === 0 && !a.say ? 'primary' : 'secondary'} label={a.label} onPress={() => act(m, a)} />)}</Row>
                  ) : null}
                </Bubble></View>
              );
            }
            const seen = m === lastMine && !items.slice(i + 1).some((x) => x.kind !== 'sys' && !(x.author.kind === 'user' && x.author.id === me) && x.author.kind !== 'mada')
              ? reads.filter((r) => r.userId !== me && Date.parse(r.at) >= Date.parse(m.createdAt)).map((r) => people.get(r.userId)?.short).filter(Boolean) as string[] : [];
            return (
              <View key={m.id} onLayout={onLayout} style={{ gap: 4 }}>
                <Bubble who={who} cont={cont}><BubbleText mine={who.kind === 'me'}>{m.body}</BubbleText></Bubble>
                {seen.length ? <T style={st.seen} testID="seen">{dm ? t('circles.chat.seen') : t('circles.chat.seenBy', { names: joinNames(seen) })}</T> : null}
              </View>
            );
          })}
          {queued.map((q) => (
            <View key={q.id} style={{ gap: 4 }} testID="queued-message">
              <Bubble who={{ kind: 'me' }}><BubbleText mine>{q.label}</BubbleText></Bubble>
              <View style={{ alignSelf: 'flex-end' }}><OutboxStatus item={q} /></View>
            </View>
          ))}
          {asking ? <Typing text={t('circles.chat.madaTyping')} /> : null}
        </ScrollView>
        <View style={[st.composer, { bottom: 22 + bottom }]}>
          {!dm ? <Pressable accessibilityRole="button" accessibilityLabel={t('circles.chat.tools')} onPress={() => { buzz('tap'); setSheet('tools'); }} style={st.plus} testID="chat-tools"><Icon name="plus" size={20} color={colors.goldInk} /></Pressable> : null}
          <TextInput ref={input} value={draft} onChangeText={setDraft} placeholder={dm ? t('circles.chat.placeholderDm', { name: d.circle.name }) : t('circles.chat.placeholder')} placeholderTextColor={colors.muted}
            accessibilityLabel={t('circles.chat.input')} onSubmitEditing={() => say()} returnKeyType="send" style={[st.input, font('body', colors.green), webNoOutline, dm ? { paddingStart: 14 } : null]} testID="chat-input" />
          <Pressable accessibilityRole="button" accessibilityLabel={t('circles.chat.send')} onPress={() => say()} style={st.send} testID="chat-send"><Icon name="up" color={colors.mist} size={18} /></Pressable>
        </View>
      </KeyboardAvoidingView>

      <ToolsSheet visible={sheet === 'tools'} onClose={() => setSheet(null)} canSplit={others.length > 0} dest={dest}
        onPick={(tool) => { if (tool === 'ask') { setSheet(null); setDraft('@Mada '); setTimeout(() => input.current?.focus(), 80); } else setSheet(tool); }} />
      <VoteSheet key={`v${opens}`} visible={sheet === 'vote'} onClose={() => setSheet(null)} dest={dest} busy={vote.isPending} onPost={(v) => vote.mutate(v, { onSuccess: (r) => { if (r) merge(r.items); setSheet(null); }, onError: fail })} />
      <SplitSheet key={`s${opens}`} visible={sheet === 'split'} onClose={() => setSheet(null)} me={me} members={d.members} busy={split.isPending} onPost={(s) => split.mutate(s, { onSuccess: (r) => { if (r) merge(r.items); setSheet(null); }, onError: fail })} />
      <ShareSheet visible={sheet === 'share'} onClose={() => setSheet(null)} onPick={(card, p) => send.mutate({ card, pin: p }, { onSuccess: (r) => { if (r) merge(r.items); setSheet(null); buzz('success'); }, onError: fail })} />
      <CircleSettings key={`c${opens}`} visible={sheet === 'settings'} onClose={() => setSheet(null)} d={d} onGone={() => { setSheet(null); router.back(); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { paddingBottom: 12 },
  faces: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4, borderRadius: 999 },
  facesPhoto: { backgroundColor: 'rgba(15,26,22,0.42)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)', paddingVertical: 3, paddingStart: 3, paddingEnd: 8 },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginHorizontal: 16, marginBottom: 2, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.paper, boxShadow: '0px 10px 24px -20px rgba(15,26,22,0.6)' },
  pinIc: { width: 32, height: 32, borderRadius: 999, backgroundColor: '#f3ead8', alignItems: 'center', justifyContent: 'center' },
  thread: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 110, gap: 10 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 18, paddingBottom: 8, paddingHorizontal: 12 },
  seen: { alignSelf: 'flex-end', fontSize: 12, color: colors.ink3, paddingEnd: 4, fontFamily: ff.ui400 },
  composer: { position: 'absolute', start: 16, end: 16, height: 54, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, boxShadow: '0px 16px 30px -22px rgba(15,26,22,0.6)' },
  plus: { width: 40, height: 40, borderRadius: 999, backgroundColor: '#f3ead8', alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, height: 44, paddingHorizontal: 6, fontSize: 16 },
  send: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
