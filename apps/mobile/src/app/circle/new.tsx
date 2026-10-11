import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type CircleCover, type PersonRef } from '@mada/shared';
import { Button } from '@/components/Button';
import { CoverArt, CoverPicker, CoverStatus, coverInk } from '@/components/circles/Cover';
import { InviteSheet } from '@/components/circles/sheets';
import { Face, Input, PersonRow, Row, TextLink, Tick } from '@/components/circles/ui';
import { Icon } from '@/components/Icon';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { circlesApi, ck, useAct, useCircles, useFriends, useSearch } from '@/lib/circles';
import { coverInput } from '@/lib/circle-covers';
import { AUTO_FOCUS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { joinAnd, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff, font } from '@/theme';

const IDEAS = ['family', 'eid', 'weekend', 'cousins'] as const;

/** New circle (prototype NewCircle): two calm steps. A name and a cover with a live preview; then who's in. */
export default function NewCircle() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string; with?: string }>();
  const [stage, setStage] = useState<'name' | 'people'>('name');
  const [name, setName] = useState(params.name ?? '');
  // Drawings first: a plane on the green until they pick something else.
  const [cover, setCover] = useState<CircleCover | null>({ kind: 'icon', icon: 'plane', color: 'green' });
  const [upload, setUpload] = useState<Extract<CircleCover, { kind: 'upload' }> | null>(null);
  const [chosen, setPicked] = useState<PersonRef[]>([]);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [invite, setInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const circles = useCircles();
  const friends = useFriends();
  const search = useSearch(term);
  useEffect(() => { const h = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(h); }, [q]);

  const all = useMemo(() => friends.data?.friends ?? [], [friends.data]);
  // "Plan a trip together" arrives with that friend already picked, until they're taken off.
  const [withOff, setWithOff] = useState(false);
  const withF = params.with && !withOff ? all.find((x) => x.id === params.with) ?? null : null;
  const picked = withF && !chosen.some((x) => x.id === withF.id) ? [withF, ...chosen] : chosen;
  const family = all.filter((f) => f.tag === 'family');
  const others = all.filter((f) => f.tag !== 'family');
  const dupe = (circles.data?.circles ?? []).some((c) => !c.dm && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim().length >= 2 && !dupe;
  const isOn = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: PersonRef) => { buzz('select'); if (withF && p.id === withF.id) { setWithOff(true); return; } setPicked(isOn(p.id) ? chosen.filter((x) => x.id !== p.id) : [...chosen, p]); };
  const tag = useMemo(() => (id: string, rel?: string, mutual?: number) => (family.some((f) => f.id === id) || rel === 'family' ? t('circles.newCircle.tagFamily') : all.some((f) => f.id === id) || rel === 'friend' ? t('circles.newCircle.tagFriend') : t('circles.newCircle.tagMada', { count: mutual ?? 0 })), [family, all]);
  const create = useAct(circlesApi.create, () => [ck.list]);
  const make = () => create.mutate({ name: name.trim(), cover: coverInput(cover), invite: picked.map((p) => p.id) }, {
    onSuccess: (d) => {
      buzz('success');
      const names = picked.map((p) => p.short);
      toast(picked.length ? t('circles.newCircle.made', { names: names.length <= 1 ? names[0]! : joinAnd(names) }) : t('circles.newCircle.madeAlone'));
      router.replace(`/circle/${d.circle.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error.internal')),
  });
  const ink = coverInk(cover);
  const row = (p: PersonRef, sub: string) => <PersonRow key={p.id} p={p} sub={sub} on={isOn(p.id)} onPress={() => toggle(p)} right={<Tick on={isOn(p.id)} />} testID="pick-person" />;

  if (stage === 'name') {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} backLabel={t('common.cancel')} right={<T v="tiny" style={{ paddingEnd: 8 }}>{t('circles.newCircle.step', { n: 1 })}</T>} />
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <CoverArt cover={cover} veil style={st.preview} testID="nc-preview">
            <View accessibilityElementsHidden style={{ marginTop: 'auto' }}>
              <T style={[font('display', ink.text), { fontSize: 36, lineHeight: 38 }]} balance={false}>{name.trim() || t('circles.newCircle.yours')}</T>
              <T style={{ fontSize: 13, fontFamily: ff.ui400, color: ink.soft, marginTop: 6 }}>{picked.length ? t('circles.newCircle.andMore', { count: picked.length }) : t('circles.newCircle.justYou')}</T>
            </View>
          </CoverArt>
          <View style={{ gap: 6 }}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.newCircle.name')}</T>
            <Input value={name} onChangeText={setName} placeholder={t('circles.newCircle.nameHint')} maxLength={40} autoFocus={AUTO_FOCUS} bad={dupe} accessibilityLabel={t('circles.newCircle.name')} testID="circle-name" />
            {dupe ? <T v="small" color={colors.badInk} accessibilityRole="alert">{t('circles.newCircle.dupe', { name: name.trim() })}</T> : (
              <Row gap={2} wrap>
                {IDEAS.map((k, i) => (
                  <Row key={k} gap={2}>{i > 0 ? <T style={{ color: '#7a857f', fontSize: 14 }}> · </T> : null}<TextLink label={t(`circles.idea.${k}`)} onPress={() => setName(t(`circles.idea.${k}`))} /></Row>
                ))}
              </Row>
            )}
          </View>
          <View style={{ gap: 10 }}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.cover.a11y')}</T>
            {cover?.kind === 'upload' ? <CoverStatus cover={cover} /> : null}
            <CoverPicker value={cover} onChange={setCover} upload={upload} onUpload={setUpload} />
          </View>
        </ScrollView>
        <Act><Button label={t('circles.newCircle.next')} disabled={!ok} onPress={() => setStage('people')} testID="circle-next" /></Act>
      </Screen>
    );
  }

  const hits = search.data?.people ?? [];
  return (
    <Screen>
      <TopBar home={false} onBack={() => setStage('name')} right={<T v="tiny" style={{ paddingEnd: 8 }}>{t('circles.newCircle.step', { n: 2 })}</T>} />
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4 }}>
          <T v="h1" accessibilityRole="header">{t('circles.newCircle.who', { name: name.trim() })}</T>
          <T v="small">{t('circles.newCircle.whoSub')}</T>
        </View>
        {picked.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }} accessibilityLabel={t('circles.newCircle.picked')}>
            {picked.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={t('circles.newCircle.removeA11y', { name: p.short })} onPress={() => toggle(p)} style={st.chosen}>
                <Face p={p} size={48} />
                <T v="tiny" style={{ fontFamily: ff.ui600, color: colors.green }} numberOfLines={1}>{p.short}</T>
                <View style={st.x}><T style={{ color: colors.mist, fontSize: 12, lineHeight: 16 }}>×</T></View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Input placeholder={t('circles.newCircle.search')} value={q} onChangeText={setQ} accessibilityLabel={t('circles.newCircle.searchA11y')} testID="people-search" />
        {term ? (
          hits.length ? <View style={{ gap: 6 }}>{hits.map((h) => row(h, tag(h.id, h.relation, h.mutual)))}</View> : search.isSuccess && !search.isPlaceholderData ? (
            <View style={st.well}>
              <T v="h3" style={{ fontSize: 15 }}>{search.data?.byPhone ? t('circles.newCircle.noNumber') : t('circles.newCircle.noName', { q: term })}</T>
              <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start' }} icon={<Icon name="link" size={18} />} label={t('circles.newCircle.sendLink')} onPress={() => setInvite(true)} />
            </View>
          ) : null
        ) : (<>
          {family.length ? <><T v="eyebrow">{t('circles.newCircle.family')}</T><View style={{ gap: 6 }}>{family.map((f) => row(f, tag(f.id)))}</View></> : null}
          {others.length ? <><T v="eyebrow">{t('circles.newCircle.friends')}</T><View style={{ gap: 6 }}>{others.map((f) => row(f, tag(f.id)))}</View></> : null}
          {!all.length ? <T v="small">{t('circles.newCircle.nobody')}</T> : null}
        </>)}
        <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); setInvite(true); }} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 6 }}>
          <Icon name="link" size={16} /><T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green, textDecorationLine: 'underline' }}>{t('circles.newCircle.inviteLink')}</T>
        </Pressable>
        {error ? <T v="small" color={colors.badInk} accessibilityRole="alert">{error}</T> : null}
      </ScrollView>
      <Act><Button label={picked.length ? t('circles.newCircle.make', { name: name.trim() }) : t('circles.newCircle.makeLater', { name: name.trim() })} busy={create.isPending} onPress={make} haptic={null} testID="circle-make" /></Act>
      <InviteSheet visible={invite} onClose={() => setInvite(false)} what={name.trim() || t('circles.invite.yourCircle')} load={(o) => circlesApi.createInvite({ link: true, ...o }).then((r) => r.link!)} />
    </Screen>
  );
}

const st = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 150, gap: 18 },
  preview: { height: 200, borderRadius: 28, padding: 18, boxShadow: '0px 22px 40px -28px rgba(15,26,22,0.8)' },
  chosen: { width: 56, alignItems: 'center', gap: 4 },
  x: { position: 'absolute', top: -2, end: 2, width: 18, height: 18, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  well: { backgroundColor: colors.mist, borderRadius: 24, padding: 16, gap: 8 },
});
