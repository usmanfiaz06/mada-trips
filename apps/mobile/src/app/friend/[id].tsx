import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { ReportBody } from '@/components/circles/sheets';
import { ChoiceCard, Face, Row, RoundButton } from '@/components/circles/ui';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { circlesApi, ck, useAct, useAround, useProfile, whenLabel } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/** A friend, or someone on Mada (prototype Friend): follow, add, message, plan together; hide, remove, report or block. */
export default function Friend() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const q = useProfile(id);
  const around = useAround();
  const [sheet, setSheet] = useState<null | 'more' | 'remove' | 'report'>(null);
  const touched = () => [ck.profile(id), ck.friends, ck.all];
  const follow = useAct(() => (q.data?.following ? circlesApi.unfollow(id) : circlesApi.follow(id)), touched);
  const add = useAct(() => circlesApi.addFriend(id), touched);
  const accept = useAct(() => circlesApi.acceptFriend(id), touched);
  const remove = useAct(() => circlesApi.removeFriend(id), touched);
  const dm = useAct(() => circlesApi.dm(id), () => [ck.list]);
  const hide = useAct(() => circlesApi.aroundAction(id, 'hide'), () => [ck.around]);
  const report = useAct((reason: string) => circlesApi.report({ targetKind: 'user', targetId: id, reason: reason as 'other', block: true }), touched);
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('error.internal'));

  if (q.isError || (q.isSuccess && !q.data)) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <View style={{ paddingHorizontal: 20 }}><T v="h1" accessibilityRole="header">{t('circles.friend.gone')}</T></View>
      </Screen>
    );
  }
  const p = q.data;
  if (!p) return <Screen><TopBar onBack={() => router.back()} /></Screen>;
  const f = p.person;
  const here = around.data?.people.find((x) => x.person.id === id);
  const lead = p.isFriend ? (f.since ? t('circles.friend.since', { year: f.since }) : t('circles.friend.sinceToday')) : p.following ? t('circles.friend.youFollow') : t('circles.friend.tripsWith', { count: f.trips });

  return (
    <Screen>
      <TopBar onBack={() => router.back()} right={<RoundButton a11y={t('circles.friend.more', { name: f.short })} icon={<Icon name="more" />} onPress={() => setSheet('more')} testID="friend-more" />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 16 }}>
        <Row gap={14}>
          <Face p={f} size={68} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h1" style={{ fontSize: 26, lineHeight: 30 }} accessibilityRole="header">{f.name}</T>
            <T v="small">{t('circles.friend.stats', { lead, places: f.places, followers: p.followers })}</T>
          </View>
        </Row>
        {here ? (
          <Card variant="focal" style={{ gap: 6 }}>
            <T v="h3" color={colors.mist}>{t('circles.friend.inCity', { city: here.city })}</T>
            <T v="small" color={colors.onDark2}>{t('circles.friend.inCitySub', { dates: here.dates ?? '', name: f.short })}</T>
          </Card>
        ) : null}
        <Row wrap gap={10}>
          {p.isFriend ? <Button size="small" block={false} label={t('circles.friend.message')} testID="friend-message" onPress={() => dm.mutate(undefined, { onSuccess: (r) => router.push(`/circle/${r.circleId}`), onError: fail })} /> : (<>
            <Button size="small" block={false} variant={p.following ? 'secondary' : 'primary'} label={p.following ? t('circles.friend.following') : t('circles.friend.follow')} testID="friend-follow"
              onPress={() => follow.mutate(undefined, { onSuccess: () => { buzz('select'); toast(p.following ? t('circles.friend.unfollowToast', { name: f.short }) : t('circles.friend.followToast', { name: f.short })); } })} />
            {p.askedMe
              ? <Button size="small" block={false} variant="secondary" label={t('circles.friend.acceptRequest')} onPress={() => accept.mutate(undefined, { onSuccess: () => toast(t('circles.people.friendsNow', { name: f.short })) })} />
              : <Button size="small" block={false} variant="secondary" disabled={p.asked} label={p.asked ? t('circles.friend.asked') : t('circles.friend.add')} testID="friend-add"
                onPress={() => add.mutate(undefined, { onSuccess: () => toast(t('circles.friend.askedToast', { name: f.short })), onError: fail })} />}
          </>)}
          {p.isFriend ? <Button size="small" block={false} variant="secondary" label={t('circles.friend.planTogether')} onPress={() => router.push({ pathname: '/circle/new', params: { with: id } })} /> : null}
        </Row>
        {!p.isFriend ? <T v="tiny">{t('circles.friend.followNote', { name: f.short })}</T> : null}
        {p.circles.length ? (<>
          <T v="eyebrow">{t('circles.friend.circlesTogether')}</T>
          {p.circles.map((c) => (
            <Card key={c.id} onPress={() => router.push(`/circle/${c.id}`)} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={c.name}>
              <T v="h3" style={{ fontSize: 15, flex: 1 }}>{c.name}</T><T v="tiny">{tn('circles.people', c.memberCount)}</T><Icon name="chevron" />
            </Card>
          ))}
        </>) : null}
        <T v="eyebrow">{t('circles.friend.tips', { name: f.short })}</T>
        {p.posts.length ? p.posts.map((x) => (
          <Card key={x.id} style={{ gap: 6 }}>
            <T v="tiny">{`${x.city} · ${x.kind === 'food' ? t('circles.kind.food') : t('circles.kind.todo')} · ${whenLabel(x.createdAt)}`}</T>
            <T v="h3" style={{ fontSize: 15 }}>{x.place}</T>
            <T v="small" color={colors.inkSoft}>{x.text}</T>
          </Card>
        )) : <T v="small">{t('circles.friend.noTips', { name: f.short })}</T>}
      </ScrollView>

      <Sheet visible={!!sheet} onClose={() => setSheet(null)} label={f.short}>
        {sheet === 'remove' ? (<>
          <T v="h2">{t('circles.friend.removeTitle', { name: f.short })}</T>
          <T v="body">{t('circles.friend.removeBody')}</T>
          <Button variant="secondary" color={colors.badInk} style={{ backgroundColor: colors.mist }} label={t('circles.remove')} testID="remove-yes"
            onPress={() => remove.mutate(undefined, { onSuccess: () => { toast(t('circles.friend.removed', { name: f.short })); setSheet(null); router.back(); } })} />
          <Button variant="ghost" label={t('circles.keep')} onPress={() => setSheet(null)} />
        </>) : sheet === 'report' ? (
          <ReportBody cta={t('circles.report.andBlock')} onSend={(r) => report.mutate(r, { onSuccess: () => { buzz('success'); toast(t('circles.report.blockedDone')); setSheet(null); router.back(); } })} />
        ) : (<>
          <T v="h2">{f.short}</T>
          <ChoiceCard title={t('circles.friend.hideAround')} sub={t('circles.friend.hideAroundSub')} onPress={() => { if (p.isFriend) hide.mutate(undefined); setSheet(null); toast(t('circles.friend.hideAroundToast', { name: f.short })); }} />
          {p.isFriend ? <ChoiceCard title={t('circles.friend.remove')} sub={t('circles.friend.removeSub')} onPress={() => setSheet('remove')} testID="friend-remove" /> : null}
          <ChoiceCard danger title={t('circles.friend.reportBlock')} sub={t('circles.friend.reportBlockSub')} onPress={() => setSheet('report')} testID="friend-report" />
        </>)}
      </Sheet>
    </Screen>
  );
}
