import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { type Post, type PostKind } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { InlineError } from '@/components/states';
import { T } from '@/components/Text';
import { COVERS, photoSource, useDiscover, usePosts } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, ff, font } from '@/theme';
import { ArtMap } from './art';
import { useSaveToggle } from './hooks';
import { CitySheet, relLabel } from './sheets';
import { Face, GlassButton, PhotoFill } from './ui';

const Arrow = () => <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.paper} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const Bookmark = ({ on }: { on: boolean }) => <Svg width={16} height={16} viewBox="0 0 24 24" fill={on ? colors.green : 'none'} stroke={on ? colors.green : colors.paper} strokeWidth={2} strokeLinejoin="round"><Path d="M6 3h12v18l-6-4-6 4z" /></Svg>;

/** A city Discover has no week for yet: its guide, from the places screens. Swap the id here when their search lands. */
const openCityGuide = (city: string) => router.push(`/city/${encodeURIComponent(city.toLowerCase())}`);

/** Discover (prototype Circles → Discover): what's on this week in a city, trips we've planned, tips from people who went. */
export function Discover({ picked, setPicked, onPost, onOpen }: { picked: string | null; setPicked: (c: string) => void; onPost: (city: string) => void; onOpen: (p: Post) => void }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<PostKind | null>(null);
  const d = useDiscover(picked);
  const city = d.data?.city ?? picked ?? '';
  const posts = usePosts(city || null, filter);
  const { isSaved, togglePost } = useSaveToggle();
  const ask = (prefill: string) => router.push({ pathname: '/ask', params: { prefill } });
  const feed = posts.data?.posts ?? [];

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <T v="h2" style={{ fontSize: 22, lineHeight: 28 }}>{t('circles.discover.on')} </T>
        <Pressable accessibilityRole="button" accessibilityLabel={t('circles.discover.cityA11y', { city })} onPress={() => { buzz('tap'); setPicking(true); }} style={s.citySwitch} testID="city-switch">
          <T style={[font('h2', colors.goldInk), { fontSize: 22, lineHeight: 28, textDecorationLine: 'underline', textDecorationColor: 'rgba(185,143,74,0.45)' }]}>{city}</T>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.goldInk} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 9l6 6 6-6" /></Svg>
        </Pressable>
      </View>
      {d.data?.tripDates ? <T v="tiny" style={{ marginTop: -8 }}>{t('circles.discover.whileThere', { dates: d.data.tripDates })}</T> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.rail}>
        {(d.data?.events ?? []).map((e, i) => (
          <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} onPress={() => { buzz('tap'); ask(t('circles.discover.eventAsk', { title: e.title, city })); }} style={[s.story, { width: 236, minHeight: 300 }]}>
            <PhotoFill source={COVERS[e.photoKey]} veil="story" position={['50% 40%', '30% 70%', '70% 30%'][i % 3]} />
            <View style={s.top}><Pill variant="glass" label={e.tag} /></View>
            <View style={s.body}>
              <T style={[font('display', colors.paper), { fontSize: 26, lineHeight: 28 }]} balance={false}>{e.title}</T>
              <T v="small" color="rgba(255,253,249,0.88)">{e.when}{'\n'}{e.where}</T>
              <GlassButton label={t('circles.discover.book')} after={<Arrow />} onPress={() => ask(t('circles.discover.eventAsk', { title: e.title, city }))} />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <T v="h2" style={{ fontSize: 22, lineHeight: 28, marginTop: 6 }}>{t('circles.discover.plans')}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.rail}>
        {(d.data?.plans ?? []).map((pl) => (
          <Pressable key={pl.id} accessibilityRole="button" accessibilityLabel={pl.title} onPress={() => { buzz('tap'); router.push(`/plan/${pl.id}`); }} style={[s.story, { width: 280, minHeight: 220 }]} testID={`plan-${pl.id}`}>
            <PhotoFill source={COVERS[pl.photoKey]} veil="story" />
            <View style={s.top}><Pill variant="glass" label={t('circles.discover.planPill', { days: pl.days })} /></View>
            <View style={[s.body, { gap: 4 }]}>
              <T style={[font('display', colors.paper), { fontSize: 26, lineHeight: 28 }]} balance={false}>{pl.title}</T>
              <T v="small" color="rgba(255,253,249,0.88)">{pl.sub}</T>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.spread, { marginTop: 6 }]}>
        <T v="h2" style={{ fontSize: 22, lineHeight: 28 }}>{t('circles.discover.tips')}</T>
        <View style={{ flexDirection: 'row', gap: 12 }} accessibilityLabel={t('circles.discover.filterA11y')}>
          {([[null, t('circles.discover.all')], ['food', t('circles.discover.food')], ['todo', t('circles.discover.todo')]] as const).map(([f, l]) => (
            <Pressable key={l} accessibilityRole="button" accessibilityState={{ selected: filter === f }} onPress={() => { buzz('select'); setFilter(f); }}
              style={{ paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: filter === f ? colors.gold : 'transparent' }}>
              <T style={{ fontFamily: ff.ui600, fontSize: 14, color: filter === f ? colors.green : '#7a857f' }}>{l}</T>
            </Pressable>
          ))}
        </View>
      </View>

      {d.view === 'error' || d.view === 'offline' ? <InlineError problem={d.problem} onRetry={d.retry} /> : null}
      {posts.view === 'error' || posts.view === 'offline' ? <InlineError problem={posts.problem} onRetry={posts.retry} /> : null}
      {posts.isSuccess && feed.length === 0 ? (
        <EmptyState art={<ArtMap />} title={filter === 'food' ? t('circles.discover.empty.food', { city }) : filter === 'todo' ? t('circles.discover.empty.todo', { city }) : t('circles.discover.empty.all', { city })}
          body={t('circles.discover.empty.body')} action={<Button label={t('circles.discover.empty.action')} onPress={() => onPost(city)} />}
          ideas={filter ? [[t('circles.discover.empty.allTips'), () => setFilter(null)]] : undefined} />
      ) : null}

      {feed.map((p) => {
        const on = isSaved('post', p.id);
        const src = photoSource(p);
        return (
          <View key={p.id}>
            <Pressable accessibilityRole="button" accessibilityLabel={p.place} onPress={() => onOpen(p)} style={[s.story, src ? { minHeight: 380 } : s.plain]} testID="tip-card">
              {src ? <PhotoFill source={src} veil="story" position="50% 55%" /> : null}
              <View style={s.top}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('circles.tip.profileA11y', { name: p.author.short })} disabled={p.relation === 'you'}
                  onPress={() => { buzz('tap'); router.push(`/friend/${p.author.id}`); }} style={s.author}>
                  <Face p={p.author} size={28} />
                  <View>
                    <T style={{ fontFamily: ff.ui600, fontSize: 13, color: colors.paper }}>{p.relation === 'you' ? t('circles.you') : p.author.short}</T>
                    <T style={{ fontSize: 11, color: 'rgba(255,253,249,0.8)', fontFamily: ff.ui400 }}>{relLabel(p)}{p.status === 'pending' ? ` · ${t('circles.post.checking')}` : ''}</T>
                  </View>
                </Pressable>
                <Pill variant="glass" label={p.kind === 'food' ? t('circles.kind.food') : t('circles.discover.todo')} />
              </View>
              <View style={s.body}>
                {!src ? <T style={[font('display', colors.gold), { fontSize: 64, lineHeight: 52, marginTop: 30, height: 34 }]}>“</T> : null}
                <T style={[font('display', colors.paper), { fontSize: 27, lineHeight: 29 }]} balance={false}>{p.text}</T>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Icon name="pin" size={16} color={colors.gold} />
                  <T style={{ fontFamily: ff.ui600, fontSize: 14, color: 'rgba(255,253,249,0.92)' }}>{p.place}</T>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <GlassButton on={on} a11y={t('circles.tip.saveA11y', { place: p.place })} icon={<Bookmark on={on} />} label={String(p.saves)} onPress={() => togglePost(p)} testID="tip-bookmark" />
                  <GlassButton label={p.kind === 'food' ? t('circles.bookTable') : t('circles.planIt')} onPress={() => ask(p.kind === 'food' ? t('circles.tableAsk', { place: p.place }) : p.place)} icon={null} />
                </View>
              </View>
            </Pressable>
          </View>
        );
      })}

      <CitySheet visible={picking} onClose={() => setPicking(false)} current={city} sheet={d.data?.sheet ?? []} onPick={(c) => { setPicked(c); setPicking(false); setFilter(null); }} onGuide={openCityGuide} />
    </>
  );
}

const s = StyleSheet.create({
  citySwitch: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  rail: { paddingHorizontal: 20, gap: 12 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  story: { borderRadius: 28, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green, boxShadow: '0px 24px 40px -30px rgba(15,26,22,0.8)' },
  plain: { minHeight: 300, paddingTop: 64 },
  top: { position: 'absolute', top: 14, start: 14, end: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  body: { padding: 18, gap: 10 },
  author: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 4, paddingStart: 4, paddingEnd: 12, borderRadius: 999, backgroundColor: 'rgba(15,26,22,0.45)' },
});
