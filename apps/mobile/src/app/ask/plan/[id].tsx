import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { formatSar, householdOf, todayIn } from '@mada/shared';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Act, Screen, TopBar, useBottomInset } from '@/components/Layout';
import { Pill } from '@/components/Pill';
import { T } from '@/components/Text';
import { ChipWrap, Photo, Toggle, enter } from '@/components/booking/parts';
import { usePayDraft, usePlan } from '@/lib/booking';
import { circlesApi, ck, useSaved } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { colors, font, ff } from '@/theme';

/* A curated plan, day by day (Plan.jsx). Book it all through the same order sheet; change something in Ask. */

/** Plan notes are written for a family of four. Say them for who's actually going. */
function fitNote(note: string, n: number, kids: boolean) {
  let s = note.replace(/\b(for|all) 4\b/g, (_m, w: string) => (n === 1 ? (w === 'all' ? 'you' : 'one') : `${w} ${n}`)).replace('Tickets for all you', 'Your ticket').replace('Booked for 6', `Booked for ${n}`);
  if (n <= 2) s = s.replace('Two connecting rooms', n === 1 ? 'A room' : 'A double room');
  if (!kids) s = s.replace(/ Kids’ menu\.| Kids feed the gulls\.|, family dining| 2 hours is enough with kids\./g, (m) => (m.includes('2 hours') ? ' 2 hours is enough.' : ''));
  return s;
}

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bottom = useBottomInset();
  const plan = usePlan(String(id ?? ''));
  const people = usePeople();
  const [day, setDay] = useState(0);
  const qc = useQueryClient();
  const saves = useSaved();
  const savedItem = saves.data?.saved.find((x) => x.kind === 'plan' && x.refId === String(id));
  const toggleSave = async () => {
    buzz('select');
    try {
      if (savedItem) await circlesApi.unsave(savedItem.id);
      else await circlesApi.save({ kind: 'plan', refId: String(id) });
      await qc.invalidateQueries({ queryKey: ck.saved });
      toast(savedItem ? t('plan.removedToast') : t('plan.savedToast'));
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };
  const p = plan.data;
  const today = todayIn();
  const H = householdOf(people.data ?? [], today);
  const travellers = H.nonHelper.map((x) => x.id);
  const n = Math.max(1, travellers.length);
  const kids = H.kids.length > 0;
  if (!p) return <Screen><TopBar onBack={() => router.back()} /></Screen>;
  return (
    <Screen>
      <View style={styles.hero}>
        <Photo name={p.photo} />
        <VGradient id="plan-hero" stops={[[0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
        <View style={{ position: 'absolute', top: 0, start: 0, end: 0 }}><TopBar onBack={() => router.back()} dark /></View>
        <View style={styles.over}>
          <Pill variant="glass" label={t('plan.by', { days: p.days })} />
          <T style={[font('display', colors.paper), { fontSize: 36, lineHeight: 38 }]} accessibilityRole="header">{p.title}</T>
          <T v="small" color="rgba(255,253,249,0.9)">{p.sub}</T>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 170 + bottom, gap: 16 }} showsVerticalScrollIndicator={false}>
        <ChipWrap>{p.plan.map((d, i) => <Toggle key={d.day} label={d.day} on={day === i} onPress={() => setDay(i)} />)}</ChipWrap>
        <View key={day}>
          {p.plan[day]!.stops.map((st, i, arr) => (
            <Animated.View key={st.title} entering={enter(i)} style={styles.item}>
              <View style={styles.rail}>
                <View style={styles.dot}><Icon name={st.icon} size={18} /></View>
                {i < arr.length - 1 ? <View style={styles.bar} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 18, gap: 2 }}>
                <T v="tiny" color={colors.goldInk} style={{ fontFamily: ff.ui600 }}>{st.time}</T>
                <T v="h3">{st.title}</T>
                <T v="small">{fitNote(st.note, n, kids)}</T>
              </View>
            </Animated.View>
          ))}
        </View>
        <Card variant="well" style={{ gap: 8 }}>
          <T v="h3">{t('plan.yours.title')}</T>
          <T v="small">{t('plan.yours.body')}</T>
          <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start' }} label={t('plan.change')} onPress={() => router.push({ pathname: '/ask', params: { prefill: t('plan.changePrefill', { title: p.title }) } })} />
        </Card>
      </ScrollView>
      <Act>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label={t('plan.book', { price: formatSar(p.total.amount) })} testID="plan-book" onPress={() => { usePayDraft.getState().set({ draft: { kind: 'package', planId: p.id, travellerIds: travellers }, title: p.title }); router.push('/pay'); }} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={savedItem ? t('plan.saved') : t('plan.save')} accessibilityState={{ selected: !!savedItem }} onPress={toggleSave} testID="plan-save"
            style={[styles.save, { backgroundColor: savedItem ? colors.green : colors.paper }]}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill={savedItem ? colors.mist : 'none'} stroke={savedItem ? colors.mist : colors.green} strokeWidth={1.8} strokeLinejoin="round"><Path d="M6 3h12v18l-6-4-6 4z" /></Svg>
          </Pressable>
        </View>
      </Act>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 250, position: 'relative', backgroundColor: colors.stage },
  over: { position: 'absolute', start: 0, end: 0, bottom: 0, padding: 16, gap: 4 },
  item: { flexDirection: 'row', gap: 12 },
  rail: { width: 44, alignItems: 'center' },
  dot: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  save: { width: 56, height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, width: 2, backgroundColor: 'rgba(30,53,45,0.12)', marginVertical: 4 },
});
