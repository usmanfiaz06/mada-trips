import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { DESTINATIONS, addDays, formatSar, householdOf, quickDates, type AskIntent, type Person } from '@mada/shared';
import { bookingApi, useDemo, usePayDraft, usePlans } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { EmptyState } from '../EmptyState';
import { Pill } from '../Pill';
import { T } from '../Text';
import { VGradient } from '../Gradient';
import { EntryChecks, blockLabel } from './EntryChecks';
import type { Cta } from './FlightFlow';
import { rangeName } from './format';
import { ArtSuitcase, Photo, Working, useSequence } from './parts';
import { ByHand, RequestFlow } from './Requests';
import { TravellerChips } from './Travellers';

/* Stays, curated plans and eSIMs in Ask. */

export function StayFlow({ intent, query, people, selfName, today, setCta }: { intent: AskIntent; query: string; people: Person[]; selfName: string; today: string; setCta: (c: Cta) => void }) {
  const router = useRouter();
  const demo = useDemo((s) => s.on);
  const H = useMemo(() => householdOf(people, today), [people, today]);
  const destKey = intent.destination && intent.destination !== 'other' ? intent.destination : 'istanbul';
  const dest = DESTINATIONS[destKey]!;
  const eid = quickDates(today).find((q) => q.id === 'eid')?.dates ?? [addDays(today, 30), addDays(today, 36)];
  const checkIn = intent.depart ?? eid[0];
  const checkOut = intent.return ?? (intent.depart ? addDays(intent.depart, 6) : eid[1]);
  const nights = Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000));
  const [who, setWho] = useState<string[]>(intent.travellerIds?.length ? intent.travellerIds : H.nonHelper.length ? H.nonHelper.map((p) => p.id) : H.me ? [H.me] : []);
  const [pick, setPick] = useState<string | null>(null);
  const [byHand, setByHand] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const flags = [...demo].sort().join(',');
  const n = who.length;
  const steps = [t('search.working.stays'), n > 2 ? t('search.working.together') : t('search.working.quiet')];
  const step = useSequence(2, 700, 'go');
  const other = intent.destination === 'other' || !!dest.byHand;
  const search = useQuery({ queryKey: ['booking', 'stays', destKey, checkIn, nights, who.join(), flags], enabled: !other && !byHand, staleTime: 600_000, queryFn: () => bookingApi.searchStays({ destination: destKey, checkIn, nights, travellerIds: who }) });
  const entry = useQuery({ queryKey: ['booking', 'entry', destKey, who.join(), checkIn, checkOut, answers, flags], enabled: !other && !!search.data, placeholderData: (p) => p, queryFn: () => bookingApi.entry({ destination: destKey, travellerIds: who, depart: checkIn, return: checkOut, answers }) });
  const s = search.data;
  const cur = s?.options.find((o) => o.id === pick) ?? s?.options[0];
  const ready = !other && !byHand && step >= 2 && s?.outcome === 'ok' && !!cur;
  useEffect(() => {
    if (!ready || !cur) { setCta(null); return; }
    const block = blockLabel(entry.data);
    setCta({ label: block ?? t('search.review', { price: formatSar(cur.total.amount) }), disabled: !!block, testID: 'ask-review', onPress: () => { usePayDraft.getState().set({ draft: { kind: 'stay', stayOfferId: cur.id, travellerIds: who }, title: cur.name, destination: destKey, askAgain: query }); router.push('/pay'); } });
  }, [ready, cur?.id, entry.data, who.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (other || byHand || s?.outcome === 'by_hand') {
    const city = intent.destination === 'other' ? intent.destinationName ?? '' : dest.name;
    return (
      <View style={{ gap: 14 }}>
        <ByHand city={city} stay queued={demo.has('offline')} />
        <RequestFlow kind="stay" query={query} intent={null} people={people} selfName={selfName} autoSend
          search={{ destination: intent.destination === 'other' ? null : destKey, destinationName: intent.destination === 'other' ? city : null, from: null, depart: checkIn, return: checkOut, cabin: null, carrier: null }} />
      </View>
    );
  }
  if (step < 2 || !s) return <Working lines={steps} step={Math.min(step, 1)} />;
  if (s.outcome === 'none') {
    return <EmptyState art={<ArtSuitcase />} title={t('search.stays.none.title')} body={t('search.stays.none.body', { rooms: s.options[0]?.roomsLabel ?? (n > 2 ? t('search.rooms.connecting') : t('search.rooms.one')) })} action={<Button label={t('search.stays.byHand')} onPress={() => { buzz('tap'); setByHand(true); }} />} />;
  }
  return (
    <View style={{ gap: 12 }}>
      <Animated.View entering={rise(0)} style={{ gap: 2 }}>
        <T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('search.stays.title')}</T>
        <T v="small">{t('search.stays.sub', { dates: rangeName(checkIn, checkOut, today), nights, rooms: cur?.roomsLabel ?? '' })}</T>
      </Animated.View>
      {s.options.map((h, i) => {
        const on = cur?.id === h.id;
        return (
          <Animated.View key={h.id} entering={rise(i + 1)}>
            <Card padding={0} selected={on} onPress={() => setPick(h.id)} accessibilityLabel={h.name} style={{ overflow: 'hidden', gap: 0 }}>
              <View style={styles.photo}>
                <Photo name={h.photo} focal={h.focal} />
                <Pill label={t(`search.label.${h.label}`)} variant={on ? 'gold' : 'default'} style={[styles.pillTL, on ? null : { backgroundColor: 'rgba(255,253,249,0.9)' }]} />
                <Pill label={h.rating} style={[styles.pillTR, { backgroundColor: 'rgba(255,253,249,0.9)' }]} />
              </View>
              <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 4 }}>
                <View style={styles.spread}><T v="h3" style={{ flex: 1 }}>{h.name}</T><T style={styles.price}>{formatSar(h.total.amount)}</T></View>
                <T v="small">{h.area}</T>
                <T v="small" color={colors.green}>{h.note}</T>
              </View>
            </Card>
          </Animated.View>
        );
      })}
      <Card variant="well" style={{ gap: 10 }}>
        <T v="h3">{t('search.staying')}</T>
        <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
      </Card>
      <EntryChecks result={entry.data} destination={destKey} travellerIds={who} depart={checkIn} ret={checkOut} answer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} remove={(id) => setWho((w) => w.filter((x) => x !== id))} />
      <View style={{ height: 60 }} />
    </View>
  );
}

export function PlanFlow({ query, people, today }: { query: string; people: Person[]; today: string }) {
  const router = useRouter();
  const plans = usePlans();
  const kids = householdOf(people, today).kids.length > 0;
  const step = useSequence(3, 650, 'go');
  const id = /istanbul/i.test(query) ? 'istanbul3' : 'alula2';
  const plan = plans.data?.find((p) => p.id === id);
  const steps = [t('plan.working.open'), kids ? t('plan.working.prayerKids') : t('plan.working.prayer'), t('plan.working.tables')];
  if (step < 3 || !plan) return <Working lines={steps} step={Math.min(step, 2)} />;
  const go = () => router.push({ pathname: '/ask/plan/[id]', params: { id } });
  return (
    <Animated.View entering={rise(0)} style={{ gap: 12 }}>
      <T v="h2">{t('plan.ready')}</T>
      <Pressable accessibilityRole="button" accessibilityLabel={plan.title} onPress={go} style={styles.planCard}>
        <Photo name={plan.photo} />
        <VGradient id="plan-shade" stops={[[0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
        <View style={styles.over}>
          <Pill variant="glass" label={t('plan.stops', { days: plan.days, count: plan.stops })} />
          <T style={[font('displaySmall', colors.paper), { fontSize: 30, lineHeight: 32 }]}>{plan.title}</T>
          <T v="small" color="rgba(255,253,249,0.9)">{plan.sub}</T>
        </View>
      </Pressable>
      <Button label={t('plan.see')} onPress={go} testID="plan-see" />
    </Animated.View>
  );
}

export function EsimFlow() {
  const router = useRouter();
  const n = 1;
  return (
    <Animated.View entering={rise(0)} style={{ gap: 12 }}>
      <T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('esim.title')}</T>
      <Card>
        <View style={styles.spread}><T v="h3">{t('esim.plan')}</T><T style={styles.price}>{t('esim.each', { price: formatSar(3900) })}</T></View>
        <T v="small">{t('esim.body')}</T>
      </Card>
      <Button label={t('search.review', { price: formatSar(3900 * n) })} onPress={() => { usePayDraft.getState().set({ draft: { kind: 'esim', count: n }, title: t('pay.title.esim') }); router.push('/pay'); }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  photo: { height: 120, position: 'relative', backgroundColor: colors.stage },
  pillTL: { position: 'absolute', top: 10, start: 10 },
  pillTR: { position: 'absolute', top: 10, end: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontFamily: ff.ui600, fontSize: 16, color: colors.green, fontVariant: ['tabular-nums'] },
  planCard: { height: 220, borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.stage },
  over: { position: 'absolute', start: 0, end: 0, bottom: 0, padding: 16, gap: 4 },
});
