import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { ArtPaperPlane } from '@/components/art/Arts';
import { DepartureBoard } from '@/components/art/DepartureBoard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { colors, font, radii, shadow, ff } from '@/theme';

type Tab = 'upcoming' | 'requests' | 'past';
const IDEAS = [
  { img: require('../../../assets/images/istanbul.jpg'), key: 'istanbul' },
  { img: require('../../../assets/images/alula.jpg'), key: 'alula' },
  { img: require('../../../assets/images/riyadh.jpg'), key: 'season' },
] as const;
const ideaText = (k: (typeof IDEAS)[number]['key']) => ({ title: t(`trips.idea.${k}.title`), sub: t(`trips.idea.${k}.sub`) });


/** Trips with nothing booked: the departures board, ideas close to home (prototype Trips › Upcoming/Requests/Past). */
export default function Trips() {
  const router = useRouter();
  const top = useTopInset();
  const [tab, setTab] = useState<Tab>('upcoming');
  const ask = () => router.push('/ask');

  return (
    <Screen>
      <Scroll top={top + 10}>
        <View style={styles.header}>
          <T v="h1" style={{ fontSize: 34, lineHeight: 38 }} accessibilityRole="header">{t('trips.title')}</T>
          <Pressable accessibilityRole="button" accessibilityLabel={t('trips.empty.action')} onPress={() => { buzz('tap'); ask(); }} style={styles.plus}><Icon name="plus" color={colors.mist} /></Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
          {(['upcoming', 'requests', 'past'] as const).map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => { buzz('select'); setTab(k); }}
              style={[styles.seg, tab === k ? styles.segOn : null]}>
              <T style={font('h3', tab === k ? colors.mist : colors.green)}>{t(`trips.tab.${k}`)}</T>
            </Pressable>
          ))}
        </View>

        {tab === 'upcoming' && (<>
          <Animated.View entering={rise(0)} style={[styles.hero, shadow('card')]}>
            <DepartureBoard onPick={ask} />
            <T style={[font('display'), { fontSize: 32, lineHeight: 33 }]}>{t('trips.empty.title')}</T>
            <T v="small">{t('trips.empty.body')}</T>
            <Button label={t('trips.empty.action')} onPress={ask} />
          </Animated.View>
          <T v="eyebrow">{t('trips.ideas.title')}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
            {IDEAS.map(({ img, key }) => ({ img, key, ...ideaText(key) })).map((it) => (
              <Pressable key={it.key} onPress={() => { buzz('tap'); ask(); }} style={styles.idea} accessibilityRole="button" accessibilityLabel={it.title}>
                <Image source={it.img} style={StyleSheet.absoluteFill} contentFit="cover" />
                <VGradient id={`idea-${it.key}`} stops={[[0.4, 'rgba(15,26,22,0)'], [1, 'rgba(15,26,22,0.75)']]} />
                <View style={{ padding: 12, paddingEnd: 10 }}>
                  <T v="h3" color={colors.paper} style={{ fontSize: 14, lineHeight: 17 }}>{it.title}</T>
                  <T v="tiny" color="rgba(255,253,249,0.8)" style={{ fontSize: 11, lineHeight: 14, fontFamily: ff.ui500 }}>{it.sub}</T>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </>)}

        {tab === 'requests' && (
          <EmptyState art={<ArtPaperPlane width={280} height={112} />} title={t('trips.requests.empty.title')} body={t('trips.requests.empty.body')}
            action={<Button label={t('trips.requests.empty.action')} onPress={ask} />}
            ideas={(['visa', 'table', 'car', 'umrah'] as const).map((k) => [t(`trips.requests.idea.${k}`), ask] as [string, () => void])} />
        )}

        {tab === 'past' && (
          <Animated.View entering={rise(0)} style={[styles.hero, shadow('card')]}>
            <View style={styles.ppEmpty}>
              <T style={styles.ppTitle}>{t('trips.past.page')}</T>
              {([[18, 22, -12], [62, 16, 8], [28, 60, 6], [70, 58, -6]] as const).map(([x, y, r], k) => (
                <View key={k} style={[styles.slot, { left: `${x}%`, top: `${y}%`, transform: [{ rotate: `${r}deg` }] }, k === 0 ? styles.slotFirst : null]}>
                  {k === 0 ? <T style={[font('display', colors.goldInk), { fontSize: 14, lineHeight: 14, textAlign: 'center', textTransform: 'uppercase', width: 52 }]}>{t('trips.past.first')}</T> : null}
                </View>
              ))}
            </View>
            <T style={[font('display'), { fontSize: 32, lineHeight: 33 }]}>{t('trips.past.empty.title')}</T>
            <T v="small">{t('trips.past.empty.body')}</T>
            <Button label={t('trips.past.empty.action')} onPress={ask} />
          </Animated.View>
        )}
      </Scroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plus: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  seg: { height: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  hero: { gap: 14, padding: 18, borderRadius: radii.hero, backgroundColor: colors.paper },
  idea: { width: 124, height: 150, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end' },
  ppEmpty: { height: 210, borderRadius: 18, backgroundColor: '#f6ecd8', borderWidth: 1, borderColor: 'rgba(125,93,39,0.15)', overflow: 'hidden' },
  ppTitle: { position: 'absolute', top: 10, start: 14, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1.8, color: colors.goldDeep, fontFamily: ff.ui700 },
  slot: { position: 'absolute', width: 74, height: 74, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(125,93,39,0.3)', alignItems: 'center', justifyContent: 'center' },
  slotFirst: { borderColor: colors.goldDeep },
});
