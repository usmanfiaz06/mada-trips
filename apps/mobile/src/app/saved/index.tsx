import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { planById } from '@mada/shared';
import { Button } from '@/components/Button';
import { ArtBookmark } from '@/components/circles/art';
import { useSaveToggle } from '@/components/circles/hooks';
import { InviteSheet } from '@/components/circles/sheets';
import { Row, TextLink } from '@/components/circles/ui';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { circlesApi, cityCover, photoSource, useSaved } from '@/lib/circles';
import { listSep, t, tn } from '@/lib/i18n';
import { colors, font } from '@/theme';

/** Everything you saved, by city (prototype Saved): plan a day from them, share the list, open a map. */
export default function Saved() {
  const router = useRouter();
  const { city: only } = useLocalSearchParams<{ city?: string }>();
  const q = useSaved();
  const { togglePost } = useSaveToggle();
  const [share, setShare] = useState<string | null>(null);
  const saved = q.data?.saved ?? [];
  const posts = saved.filter((s) => s.kind === 'post' && s.post);
  const plans = saved.filter((s) => s.kind === 'plan' && planById(s.refId));
  const cities = only ? [only] : [...new Set(posts.map((s) => s.city))];
  const ask = (prefill: string) => router.push({ pathname: '/ask', params: { prefill } });

  return (
    <Screen>
      <TopBar onBack={() => router.back()} backLabel={t('circles.back')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 16, flexGrow: 1 }}>
        <T v="h1" accessibilityRole="header">{only ? t('circles.savedScreen.inCity', { city: only }) : t('circles.saved.title')}</T>
        {q.isSuccess && !posts.length && !plans.length ? (
          <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 60 }}>
            <EmptyState art={<ArtBookmark />} title={t('circles.saved.emptyTitle')} body={t('circles.savedScreen.emptyBody')}
              action={<Button label={t('circles.saved.emptyAction')} onPress={() => router.navigate('/circles')} />} />
          </View>
        ) : null}
        {cities.map((city) => {
          const items = posts.filter((s) => s.city === city);
          if (!items.length) return null;
          return (
            <View key={city} style={{ gap: 10 }}>
              <View style={st.cover}>
                <Image source={cityCover(city)} style={StyleSheet.absoluteFill} contentFit="cover" />
                <VGradient id={`sv-${city}`} stops={[[0, 'rgba(15,26,22,0.05)'], [0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
                <View style={{ padding: 16 }}>
                  <T style={[font('display', colors.paper), { fontSize: 28, lineHeight: 30 }]}>{city}</T>
                  <T v="tiny" color="rgba(255,253,249,0.9)">{tn('circles.places', items.length)}</T>
                </View>
              </View>
              <Row wrap gap={10}>
                <Button size="small" block={false} label={t('circles.savedScreen.dayFrom')} onPress={() => ask(t('circles.savedScreen.dayAsk', { city, places: items.map((i) => i.post!.place).join(listSep()) }))} />
                <Button size="small" block={false} variant="secondary" icon={<Icon name="link" size={18} />} label={t('circles.savedScreen.share')} onPress={() => setShare(city)} />
              </Row>
              {items.map((s) => {
                const p = s.post!;
                const src = photoSource(p);
                return (
                  <Card key={s.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                    {src ? <Image source={src} style={st.thumb} contentFit="cover" /> : <View style={[st.thumb, { backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' }]}><T v="h2">{p.author?.initial ?? '?'}</T></View>}
                    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                      <T v="h3" style={{ fontSize: 15 }}>{p.place}</T>
                      <T v="tiny">{t('circles.savedScreen.from', { name: p.author?.short ?? t('circles.you'), kind: p.kind === 'food' ? t('circles.kind.food') : t('circles.kind.todo') })}</T>
                      <Row gap={14} style={{ marginTop: 4 }}>
                        <TextLink size={13} label={t('circles.savedScreen.map')} onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.place}, ${p.city}`)}`)} />
                        <TextLink size={13} label={p.kind === 'food' ? t('circles.bookTable') : t('circles.planIt')} onPress={() => ask(p.kind === 'food' ? t('circles.tableAsk', { place: p.place }) : p.place)} />
                        <TextLink size={13} color={colors.badInk} label={t('circles.remove')} onPress={() => togglePost(p)} />
                      </Row>
                    </View>
                  </Card>
                );
              })}
            </View>
          );
        })}
        {!only && plans.length ? (<>
          <T v="eyebrow">{t('circles.savedScreen.plans')}</T>
          {plans.map((s) => (
            <Card key={s.id} onPress={() => router.push(`/plan/${s.refId}`)} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={planById(s.refId)!.title}>
              <T v="h3" style={{ fontSize: 15, flex: 1 }}>{planById(s.refId)!.title}</T><Icon name="chevron" />
            </Card>
          ))}
        </>) : null}
      </ScrollView>
      <InviteSheet visible={!!share} onClose={() => setShare(null)} what={t('circles.invite.list', { city: share ?? '' })} load={() => circlesApi.createInvite({ link: true }).then((r) => r.link!)} />
    </Screen>
  );
}

const st = StyleSheet.create({
  cover: { height: 120, borderRadius: 24, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green },
  thumb: { width: 56, height: 56, borderRadius: 14 },
});
