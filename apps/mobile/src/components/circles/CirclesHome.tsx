import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { planById, type AroundResponse, type Audience, type CircleSummary, type PersonRef, type Post } from '@mada/shared';
import { ArtCircles, ArtFriends } from '@/components/art/Arts';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { InlineError } from '@/components/states';
import { T } from '@/components/Text';
import {
  COVERS, circlesApi, cityCover, ck, lastLine, photoSource, useAct, useAround, useCircles, useFriends, useKnownPosts, useMeId, useSaved, useStamps, whenLabel,
} from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { toast } from '@/lib/toast';
import { colors, ff, font, shadow } from '@/theme';
import { ArtBookmark, ArtLantern } from './art';
import { ReportBody } from './sheets';
import { ChoiceCard, Face, Faces, Head, Row, TextLink, Toggle } from './ui';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** The Circles view (prototype Circles → Circles): who's around, your circles, friends, tips from people you know, saved, your passport. */
export function CirclesHome({ onDiscover, onOpenPost }: { onDiscover: () => void; onOpenPost: (p: Post) => void }) {
  const router = useRouter();
  const me = useMeId();
  const circles = useCircles();
  const friends = useFriends();
  const known = useKnownPosts();
  const saved = useSaved();
  const stamps = useStamps();
  const around = useAround();
  const list = (circles.data?.circles ?? []).filter((c) => !c.dm);
  const incoming = circles.data?.incoming ?? [];
  const fr = useMemo(() => (friends.data?.friends ?? []).filter((f) => f.tag !== 'family'), [friends.data]);
  const requests = friends.data?.requests ?? [];
  const posts = (known.data?.posts ?? []);
  const savedList = saved.data?.saved ?? [];
  const people = useMemo(() => {
    const m = new Map<string, PersonRef>();
    for (const c of circles.data?.circles ?? []) for (const p of c.preview) m.set(p.id, p);
    for (const f of fr) m.set(f.id, f);
    return m;
  }, [circles.data, fr]);
  const savedCities = [...new Set(savedList.filter((s) => s.kind === 'post').map((s) => s.city))];
  const savedPlans = savedList.filter((s) => s.kind === 'plan' && planById(s.refId));
  const accept = useAct(circlesApi.accept);
  const decline = useAct(circlesApi.decline);

  return (
    <>
      {fr.length > 0 && around.data ? <Around data={around.data} /> : null}

      {incoming.map((iv) => (
        <View key={iv.inviteId} style={st.incoming}>
          <Row gap={12}>
            <Face p={iv.from} size={44} />
            <View style={{ flex: 1 }}>
              <T v="h3" style={{ fontSize: 15 }}>{t('circles.incoming.title', { name: iv.from.short, circle: iv.circle.name })}</T>
              <T v="tiny">{`${tn('circles.people', iv.circle.memberCount)} · ${t('circles.incoming.sub')}`}</T>
            </View>
          </Row>
          <Row gap={8}>
            <Button size="small" block={false} label={t('circles.incoming.join')} busy={accept.isPending} testID="incoming-join"
              onPress={() => accept.mutate(iv.inviteId, { onSuccess: (r) => { buzz('success'); router.push(`/circle/${r.circleId}`); } })} />
            <Button size="small" block={false} variant="secondary" label={t('common.notNow')} onPress={() => decline.mutate(iv.inviteId, { onSuccess: () => toast(t('circles.incoming.declined', { name: iv.from.short })) })} />
          </Row>
        </View>
      ))}

      {circles.view === 'error' || circles.view === 'offline' ? <InlineError problem={circles.problem} onRetry={circles.retry} /> : null}
      <Head title={t('circles.yours')} right={list.length ? String(list.length) : undefined} />
      {circles.isSuccess && list.length === 0 ? (
        <Animated.View entering={rise(1)}>
          <EmptyState art={<ArtCircles />} title={t('circles.empty.title')} body={t('circles.empty.body')}
            action={<Button label={t('circles.empty.action')} onPress={() => router.push('/circle/new')} testID="first-circle" />}
            ideas={(['family', 'eid', 'weekend', 'cousins'] as const).map((k) => [t(`circles.idea.${k}`), () => router.push({ pathname: '/circle/new', params: { name: t(`circles.idea.${k}`) } })] as [string, () => void])} />
        </Animated.View>
      ) : list.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.bleed} contentContainerStyle={[st.rail, { gap: 10 }]}>
          {list.map((c) => <Tile key={c.id} c={c} line={lastLine(c, me, people)} onPress={() => router.push(`/circle/${c.id}`)} />)}
          <Pressable accessibilityRole="button" accessibilityLabel={t('circles.new')} onPress={() => { buzz('tap'); router.push('/circle/new'); }} style={st.newTile}>
            <Icon name="plus" /><T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green }}>{t('circles.new')}</T>
          </Pressable>
        </ScrollView>
      ) : null}

      <Head title={t('circles.friends')} right={fr.length > 0 ? <TextLink label={requests.length ? t('circles.friends.requestsSeeAll', { count: requests.length }) : t('circles.friends.seeAll')} onPress={() => router.push('/people')} /> : undefined} />
      {friends.isSuccess && fr.length === 0 ? (
        <EmptyState compact art={<ArtFriends width={100} height={75} />} title={t('circles.friends.emptyTitle')} body={t('circles.friends.emptyBody')}
          action={<Row gap={8}>
            <Button size="small" block={false} label={t('circles.friends.add')} onPress={() => router.push({ pathname: '/people', params: { add: '1' } })} testID="add-friends" />
            {requests.length ? <Button size="small" block={false} variant="secondary" label={tn('circles.requests', requests.length)} onPress={() => router.push({ pathname: '/people', params: { tab: 'requests' } })} /> : null}
          </Row>} />
      ) : fr.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.bleed} contentContainerStyle={[st.rail, { gap: 14 }]}>
          {fr.map((f) => (
            <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={f.name} onPress={() => { buzz('tap'); router.push(`/friend/${f.id}`); }} style={st.friendChip}>
              <View><Face p={f} size={56} />{f.going ? <View style={st.goingDot} /> : null}</View>
              <T v="tiny" style={{ fontFamily: ff.ui600, color: colors.green }} numberOfLines={1}>{f.short}</T>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel={t('circles.friends.invited')} onPress={() => { buzz('tap'); router.push({ pathname: '/people', params: { tab: 'invited' } }); }} style={st.friendChip}>
            <View style={st.dashedFace}><Icon name="plus" color={colors.goldInk} /></View>
            <T v="tiny" style={{ fontFamily: ff.ui600, color: colors.green }}>{t('circles.friends.invited')}</T>
          </Pressable>
        </ScrollView>
      ) : null}

      {fr.length > 0 || posts.length > 0 ? (<>
        <Head title={t('circles.known.title')} right={t('circles.known.newest')} />
        {known.isSuccess && posts.length === 0 ? (
          <EmptyState compact art={<ArtLantern width={80} height={60} />} title={t('circles.known.emptyTitle')} body={t('circles.known.emptyBody')}
            action={<TextLink label={t('circles.known.emptyAction')} onPress={onDiscover} />} />
        ) : null}
        {posts.map((p) => {
          const src = photoSource(p);
          return (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.place} onPress={() => { buzz('tap'); onOpenPost(p); }} style={({ pressed }) => [st.knownCard, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
              {src ? <Image source={src} style={st.knownImg} contentFit="cover" /> : <View style={[st.knownImg, { backgroundColor: p.author.tone === 'green' ? colors.green : p.author.tone === 'gold' ? colors.gold : colors.mist, alignItems: 'center', justifyContent: 'center' }]}><T style={[font('h2', p.author.tone === 'green' ? colors.sand : colors.green), { fontSize: 24 }]}>{p.author.initial}</T></View>}
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <T v="tiny"><T v="tiny" style={{ fontFamily: ff.ui700, color: colors.green }}>{p.relation === 'you' ? t('circles.you') : p.author.short}</T>{` · ${p.city} · ${whenLabel(p.createdAt)}${p.status === 'pending' ? ` · ${t('circles.post.checking')}` : ''}`}</T>
                <T v="h3" style={{ fontSize: 15 }}>{p.place}</T>
                <T v="small" color={colors.inkSoft} numberOfLines={2}>{p.text}</T>
              </View>
            </Pressable>
          );
        })}
      </>) : null}

      <Head title={t('circles.saved.title')} right={savedList.length ? <TextLink label={t('circles.friends.seeAll')} onPress={() => router.push('/saved')} /> : undefined} />
      {saved.isSuccess && savedList.length === 0 ? (
        <EmptyState compact art={<ArtBookmark width={80} height={60} />} title={t('circles.saved.emptyTitle')} body={t('circles.saved.emptyBody')}
          action={<TextLink label={t('circles.saved.emptyAction')} onPress={onDiscover} />} />
      ) : savedList.length ? (
        <View style={st.grid}>
          {savedCities.map((city) => {
            const n = savedList.filter((s) => s.kind === 'post' && s.city === city).length;
            return (
              <Pressable key={city} accessibilityRole="button" accessibilityLabel={city} onPress={() => { buzz('tap'); router.push({ pathname: '/saved', params: { city } }); }} style={st.savedTile}>
                <Image source={cityCover(city)} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,26,22,0.32)' }]} />
                <View style={{ padding: 12 }}><T v="h3" style={{ fontSize: 15 }} color={colors.paper}>{city}</T><T v="tiny" color="rgba(255,253,249,0.9)">{tn('circles.places', n)}</T></View>
              </Pressable>
            );
          })}
          {savedPlans.map((s) => {
            const pl = planById(s.refId)!;
            return (
              <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={pl.title} onPress={() => { buzz('tap'); router.push(`/plan/${pl.id}`); }} style={st.savedTile}>
                <Image source={COVERS[pl.photoKey]} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,26,22,0.32)' }]} />
                <View style={{ padding: 12 }}><T v="h3" style={{ fontSize: 14 }} color={colors.paper} numberOfLines={2}>{pl.title}</T><T v="tiny" color="rgba(255,253,249,0.9)">{t('circles.saved.planDays', { days: pl.days })}</T></View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Passport stamps={stamps.data} />
    </>
  );
}

function Tile({ c, line, onPress }: { c: CircleSummary; line: string; onPress: () => void }) {
  if (c.cover) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={c.name} onPress={() => { buzz('tap'); onPress(); }} style={st.photoTile} testID="circle-tile">
        <Image source={COVERS[c.cover]} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,26,22,0.18)' }]} />
        <View style={[StyleSheet.absoluteFill, { top: '40%', backgroundColor: 'rgba(15,26,22,0.45)' }]} />
        {c.unread > 0 ? <Pill variant="gold" label={t('circles.unread', { count: c.unread })} style={{ position: 'absolute', top: 10, start: 10 }} /> : null}
        {c.muted ? <Pill variant="glass" label={t('circles.muted')} style={{ position: 'absolute', top: 10, end: 10 }} /> : null}
        <View style={{ padding: 14, gap: 2 }}>
          <T style={[font('display', colors.paper), { fontSize: 22, lineHeight: 24 }]} numberOfLines={1}>{c.name}</T>
          <T v="tiny" color="rgba(255,253,249,0.92)" numberOfLines={1}>{line}</T>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={c.name} onPress={() => { buzz('tap'); onPress(); }} style={[st.plainTile, shadow('card')]} testID="circle-tile">
      <View style={st.spread}>
        <Faces people={c.preview} size={30} ring={colors.paper} />
        {c.unread > 0 ? <Pill variant="gold" label={t('circles.unread', { count: c.unread })} /> : null}
      </View>
      <View style={{ gap: 0 }}>
        <T v="h3" style={{ fontSize: 15 }} numberOfLines={1}>{c.name}</T>
        <T v="tiny" numberOfLines={2}>{line}</T>
      </View>
    </Pressable>
  );
}

/** Who's around: city only, the people you choose, off when you fly home. A friend who shared their city shows on top. */
function Around({ data }: { data: AroundResponse }) {
  const [sheet, setSheet] = useState<null | 'who' | 'person' | 'report'>(null);
  const [who, setWho] = useState<Audience>(data.audience);
  const [target, setTarget] = useState<PersonRef | null>(null);
  const presence = useAct(circlesApi.presence, () => [ck.around]);
  const act = useAct((a: { id: string; action: 'hello' | 'notNow' | 'hide' }) => circlesApi.aroundAction(a.id, a.action), () => [ck.around]);
  const report = useAct(circlesApi.report, () => [ck.around]);
  const names = (ps: PersonRef[]) => ps.map((p) => p.short);
  const joinN = (ps: PersonRef[]) => { const n = names(ps); return n.length <= 1 ? n[0] ?? '' : `${n.slice(0, -1).join(', ')} ${t('circles.and')} ${n[n.length - 1]}`; };
  const whoLine = data.audience === 'family' ? t('circles.around.whoFamily') : data.audience === 'close' ? t('circles.around.whoClose') : joinN(data.options.picked) || t('circles.around.nobody');
  const opts: [Audience, string, string][] = [
    ['picked', t('circles.around.picked'), joinN(data.options.picked) || t('circles.around.nobody')],
    ['close', t('circles.around.close'), data.options.close.length ? tn('circles.people', data.options.close.length) : t('circles.around.nobody')],
    ['family', t('circles.around.family'), data.options.family.length ? names(data.options.family).join(', ') : t('circles.around.nobody')],
  ];
  return (
    <View style={[st.focal, shadow('focal')]}>
      {data.people.map((p) => (
        <View key={p.person.id} style={{ gap: 14 }}>
          <Row gap={12}>
            <View><Face p={p.person} size={44} /><View style={st.liveDot} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="h3" color={colors.mist}>{t('circles.around.here', { name: p.person.short, city: p.city })}</T>
              <T v="tiny" color={colors.onDark2}>{p.dates ? t('circles.around.shared', { dates: p.dates, name: p.person.short }) : t('circles.around.sharedNoDates', { name: p.person.short })}</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('circles.around.more', { name: p.person.short })} onPress={() => { setTarget(p.person); setSheet('person'); }} style={st.moreBtn}>
              <Icon name="more" color={colors.mist} />
            </Pressable>
          </Row>
          {p.hello ? <T v="small" style={{ fontFamily: ff.ui600 }} color="#e6c88f">{p.hello === 'sent' ? t('circles.around.helloSent', { name: p.person.short }) : t('circles.around.notNowDone')}</T> : (
            <Row gap={10}>
              <Button size="small" block={false} variant="gold" label={t('circles.around.sayHello')} haptic="knock" onPress={() => act.mutate({ id: p.person.id, action: 'hello' })} testID="say-hello" />
              <Button size="small" block={false} variant="onDark" label={t('common.notNow')} onPress={() => act.mutate({ id: p.person.id, action: 'notNow' })} />
            </Row>
          )}
          <View style={{ height: 1, backgroundColor: 'rgba(233,226,216,0.12)' }} />
        </View>
      ))}
      <Row gap={12}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3" style={{ fontSize: 15 }} color={colors.mist}>{t('circles.around.tell', { city: data.city })}</T>
          <T v="tiny" color={colors.onDark2}>{data.on ? t('circles.around.on', { who: whoLine }) : t('circles.around.off')}</T>
        </View>
        <Toggle onDark value={data.on} label={t('circles.around.tell', { city: data.city })}
          onChange={(v) => { if (v) setSheet('who'); else presence.mutate({ on: false }, { onSuccess: () => toast(t('circles.around.hidden')) }); }} />
      </Row>

      <Sheet visible={sheet === 'who'} onClose={() => setSheet(null)} label={t('circles.around.sheetLabel')}>
        <T v="h2">{t('circles.around.sheetTitle', { city: data.city })}</T>
        <T v="small">{t('circles.around.sheetBody')}</T>
        {opts.map(([id, title, sub]) => <ChoiceCard key={id} title={title} sub={sub} selected={who === id} onPress={() => setWho(id)} testID={`audience-${id}`} />)}
        <Button label={t('circles.around.turnOn')} haptic="success" onPress={() => presence.mutate({ on: true, audience: who }, { onSuccess: () => setSheet(null) })} testID="around-on" />
      </Sheet>
      <Sheet visible={sheet === 'person' || sheet === 'report'} onClose={() => setSheet(null)} label={target?.short ?? ''}>
        {sheet === 'report' && target ? (
          <ReportBody onSend={(reason) => report.mutate({ targetKind: 'user', targetId: target.id, reason }, { onSuccess: () => { act.mutate({ id: target.id, action: 'hide' }); setSheet(null); buzz('success'); toast(t('circles.report.done')); } })} />
        ) : target ? (<>
          <T v="h2">{target.short}</T>
          <ChoiceCard title={t('circles.around.hide', { name: target.short })} sub={t('circles.around.hideSub')} onPress={() => act.mutate({ id: target.id, action: 'hide' }, { onSuccess: () => { setSheet(null); toast(t('circles.around.hideDone', { name: target.short })); } })} />
          <ChoiceCard danger title={t('circles.report')} sub={t('circles.report.sub')} onPress={() => setSheet('report')} />
          <Button variant="ghost" label={t('circles.cancel')} onPress={() => setSheet(null)} />
        </>) : null}
      </Sheet>
    </View>
  );
}

/** The passport page: stamps from trips taken, or an empty page waiting for the first one. */
function Passport({ stamps }: { stamps: import('@mada/shared').StampsResponse | undefined }) {
  const router = useRouter();
  const [pressed, setPressed] = useState<string | null>(null);
  if (!stamps) return null;
  const has = stamps.stamps.some((s) => !s.upcoming);
  const right = has ? (stamps.places ? t('circles.passport.withPlaces', { countries: tn('circles.passport.countries', stamps.countries), places: stamps.places }) : tn('circles.passport.countries', stamps.countries)) : t('circles.passport.none');
  return (<>
    <Head title={t('circles.passport.title')} right={right} />
    {!has ? (
      <View style={st.passport} accessibilityLabel={t('circles.passport.a11y')}>
        <View style={st.passportFold} />
        <View style={{ position: 'absolute', end: -18, bottom: -14, opacity: 1 }}><Sun width={150} color="rgba(185,143,74,0.1)" /></View>
        <View style={st.spread}><T v="eyebrow" color={colors.goldInk}>{t('circles.passport.head')}</T><Sun width={26} color="#d9b77a" /></View>
        <View style={{ flexDirection: 'row', gap: 14, paddingTop: 10, paddingBottom: 12 }}>
          {stamps.next ? (
            <View style={[st.stamp, st.stampNext, { transform: [{ rotate: '-7deg' }] }]}>
              <View style={st.stampInner}><T style={[font('display', colors.goldInk), { fontSize: 15, lineHeight: 17 }]}>{stamps.next}</T><T style={{ fontSize: 9, fontFamily: ff.ui600, letterSpacing: 0.7, color: colors.goldInk }}>{t('circles.passport.next')}</T></View>
            </View>
          ) : <View style={[st.stamp, st.ghost, { borderColor: 'rgba(185,143,74,0.6)', transform: [{ rotate: '-7deg' }] }]} />}
          <View style={[st.stamp, st.ghost, { transform: [{ rotate: '5deg' }] }]} />
          <View style={[st.stamp, st.ghost, { transform: [{ rotate: '-3deg' }] }]} />
        </View>
        <T v="h3" style={{ fontSize: 15 }}>{stamps.next ? t('circles.passport.firstTrip', { city: stamps.next }) : t('circles.passport.every')}</T>
        <T v="small">{stamps.next ? t('circles.passport.fills') : t('circles.passport.book')}</T>
        {!stamps.next ? <Button size="small" block={false} variant="secondary" label={t('circles.passport.plan')} style={{ alignSelf: 'flex-start', marginTop: 4 }} onPress={() => router.push('/ask')} /> : null}
      </View>
    ) : (
      <View style={st.stampsCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 18, paddingVertical: 4 }}>
          {stamps.stamps.map((s, i) => {
            const color = ['#b98f4a', '#7d5d27', '#1e352d', '#1e352d', '#7d5d27'][i % 5]!;
            const rot = [-8, -4, 6, 9, -10][i % 5]!;
            const on = pressed === s.city;
            return (
              <Pressable key={s.city} accessibilityRole="button" accessibilityLabel={s.upcoming ? t('circles.passport.stampNext', { city: s.city }) : t('circles.passport.stamp', { city: s.city })}
                onPress={() => { buzz('knock'); setPressed(on ? null : s.city); }}
                style={[st.stampBig, { borderColor: color, borderStyle: s.upcoming ? 'dashed' : 'solid', opacity: s.upcoming ? 0.55 : 1, transform: [{ rotate: `${on ? 0 : rot}deg` }, { scale: on ? 1.12 : 1 }] }]}>
                <View style={[st.stampBigInner, { borderColor: color }]}>
                  <T style={[font('display', color), { fontSize: 15, lineHeight: 17 }]}>{s.city}</T>
                  <T style={{ fontSize: 9, fontFamily: ff.ui600, letterSpacing: 0.7, color }}>{s.upcoming ? t('circles.passport.next') : s.month}</T>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        {stamps.rank ? (
          <Row gap={10} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}>
            <Faces people={stamps.rank.faces} size={32} ring={colors.paper} />
            <T v="small" color={colors.inkSoft} style={{ flex: 1 }}>{stamps.rank.position === 1 ? t('circles.passport.lead', { places: stamps.rank.leaderPlaces }) : t('circles.passport.rank', { position: ordinal(stamps.rank.position), leader: stamps.rank.leader.short, places: stamps.rank.leaderPlaces })}</T>
          </Row>
        ) : null}
      </View>
    )}
  </>);
}

const st = StyleSheet.create({
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  rail: { paddingHorizontal: 20 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  focal: { backgroundColor: colors.green, borderRadius: 24, padding: 18, gap: 14 },
  liveDot: { position: 'absolute', end: 0, bottom: 0, width: 12, height: 12, borderRadius: 999, backgroundColor: colors.live, borderWidth: 2, borderColor: colors.green },
  moreBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(233,226,216,0.12)', alignItems: 'center', justifyContent: 'center' },
  incoming: { backgroundColor: colors.paper, borderRadius: 24, padding: 16, gap: 12, borderWidth: 1.5, borderColor: colors.gold },
  photoTile: { width: 210, height: 128, borderRadius: 24, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green },
  plainTile: { width: 176, height: 128, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 16, justifyContent: 'space-between', backgroundColor: colors.paper },
  newTile: { width: 120, height: 128, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center', gap: 8 },
  friendChip: { width: 64, alignItems: 'center', gap: 6 },
  goingDot: { position: 'absolute', end: 1, bottom: 1, width: 14, height: 14, borderRadius: 99, backgroundColor: colors.gold, borderWidth: 2.5, borderColor: colors.sand },
  dashedFace: { width: 56, height: 56, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center' },
  knownCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.paper, borderRadius: 24, padding: 16 },
  knownImg: { width: 64, height: 64, borderRadius: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  savedTile: { width: '48.5%', height: 112, borderRadius: 24, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green },
  passport: { borderRadius: 22, paddingTop: 18, paddingHorizontal: 18, paddingBottom: 20, gap: 6, overflow: 'hidden', backgroundColor: '#f8f1e4', borderWidth: 1, borderColor: 'rgba(185,143,74,0.22)' },
  passportFold: { position: 'absolute', start: 0, end: 0, top: '50%', borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(185,143,74,0.25)' },
  stamp: { width: 76, height: 76, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghost: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(185,143,74,0.38)' },
  stampNext: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.goldDeep, backgroundColor: 'rgba(255,253,249,0.6)' },
  stampInner: { width: 62, height: 62, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center' },
  stampsCard: { backgroundColor: colors.paper, borderRadius: 24, padding: 16, gap: 14 },
  stampBig: { width: 76, height: 76, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stampBigInner: { width: 64, height: 64, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 1 },
});
