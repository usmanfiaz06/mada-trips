import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { DESTINATIONS, esimWhereKey, formatSar, nameIn, rangeLabel, type CopyKey, type EsimPlan, type EsimPlansResponse } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Approx } from '@/components/wallet/Approx';
import { Box, H3, PickCard, Rise, Small, Tiny } from '@/components/trips/ui';
import { ChipWrap } from '@/components/booking/parts';
import { ApiError } from '@/lib/api';
import { usePayDraft } from '@/lib/booking';
import { planLabel, useEsimPlans } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { useTrips } from '@/lib/trips';
import { colors } from '@/theme';

/*
 * An eSIM for the trip (Ask "data for Istanbul", or Today's readiness): the trip's country and days, 2–3 sizes priced
 * in SAR (≈ the display currency), one eSIM per traveller who wants it, and "does your phone take one?" with the steps
 * to check when they're not sure. Review opens the order sheet; the eSIM is bought once the payment goes through.
 */

const PLACES = ['istanbul', 'dubai', 'london', 'cairo', 'baku', 'tbilisi', 'paris'] as const;
const DAYS = [3, 5, 7, 10, 14, 30];
type Phone = 'iphone' | 'samsung' | 'pixel' | 'unsure' | 'no';

export const whereOf = (p: Pick<EsimPlansResponse, 'where' | 'plans'>) => {
  const code = p.where?.code ?? '';
  const k = esimWhereKey(code);
  return k ? t(k as CopyKey) : nameIn(p.plans[0]?.coverage.name ?? code, getLocale());
};

export function EsimPlanner({ tripId: tripIn, destination: destIn, days: daysIn }: { tripId?: string | null; destination?: string | null; days?: number | null }) {
  const router = useRouter();
  const trips = useTrips();
  const upcoming = (trips.data?.upcoming ?? []).filter((x) => x.status !== 'cancelled').slice(0, 4);
  const [tripId, setTripId] = useState<string | null>(tripIn ?? null);
  const [dest, setDest] = useState<string | null>(destIn ?? null);
  const [days, setDays] = useState<number | null>(daysIn ?? null);
  const [other, setOther] = useState(false);
  const asking = !tripId && !dest;
  const q = useEsimPlans({ tripId, destination: tripId ? null : dest, days: tripId ? daysIn ?? null : days ?? 7 });
  const data = q.data;
  const [pick, setPick] = useState<string | null>(null);
  const [who, setWho] = useState<string[] | null>(null);
  const [phone, setPhone] = useState<Phone | null>(null);
  const [check, setCheck] = useState(false);
  const people = useMemo(() => data?.people ?? [], [data]);
  const chosen = who ?? people.filter((p) => !p.has).map((p) => p.id);
  const plan: EsimPlan | undefined = data?.plans.find((p) => p.id === (pick ?? data.recommended)) ?? data?.plans[0];
  const count = chosen.length;
  const total = plan ? plan.price.amount * count : 0;

  if (asking) {
    return (
      <View style={{ gap: 14 }} testID="esim-where">
        <Rise><T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('es.which')}</T></Rise>
        {upcoming.map((x) => (
          <PickCard key={x.id} radio on={false} onPress={() => setTripId(x.id)} title={nameIn(x.city, getLocale())} sub={rangeLabel(x.startDate, x.endDate, getLocale())} testID={`esim-trip-${x.id}`} />
        ))}
        {!other && upcoming.length ? <Button variant="secondary" label={t('es.which.other')} onPress={() => setOther(true)} testID="esim-other" /> : null}
        {other || !upcoming.length ? (
          <>
            <H3>{t('es.which.where')}</H3>
            <ChipWrap>{PLACES.map((k) => <Chip key={k} label={nameIn(DESTINATIONS[k]!.name, getLocale())} on={false} onPress={() => { buzz('select'); setDest(k); }} testID={`esim-place-${k}`} />)}</ChipWrap>
          </>
        ) : null}
      </View>
    );
  }

  if (q.isPending) return <View style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}><ActivityIndicator color={colors.green} /></View>;
  if (q.isError || !data) {
    const offline = q.error instanceof ApiError && q.error.code === 'OFFLINE';
    return <Box tone="cream"><Small>{offline ? t('es.offline') : q.error instanceof Error ? q.error.message : t('error.internal')}</Small></Box>;
  }
  const where = whereOf(data);
  if (data.outcome === 'none' || !plan) {
    return (
      <View style={{ gap: 12 }} testID="esim-none">
        <T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('es.none.title', { where: where || nameIn(dest ?? '', getLocale()) })}</T>
        <Small>{t('es.none.body')}</Small>
        <Button label={t('es.none.cta')} variant="secondary" onPress={() => router.push('/support?topic=other' as Href)} />
      </View>
    );
  }
  const sizeTitle = (p: EsimPlan) => `${t(`es.size.${p.size}` as CopyKey)} · ${planLabel(p, t)}`;
  const phoneOk = phone === 'iphone' || phone === 'samsung' || phone === 'pixel';

  return (
    <View style={{ gap: 14 }} testID="esim-planner">
      <Rise><T v="h2" style={{ fontSize: 24, lineHeight: 30 }} accessibilityRole="header">{t('es.title', { where })}</T></Rise>
      <Rise step={1}><Small style={{ marginTop: -6 }}>{t('es.sub', { days: data.days })}</Small></Rise>
      {!tripId ? (
        <ChipWrap>{DAYS.map((d) => <Chip key={d} label={t('es.days.n', { n: d })} on={(days ?? 7) === d} onPress={() => { buzz('select'); setDays(d); setPick(null); }} testID={`esim-days-${d}`} />)}</ChipWrap>
      ) : null}
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {data.plans.map((p) => (
          <PickCard key={p.id} radio on={plan.id === p.id} onPress={() => setPick(p.id)} title={sizeTitle(p)} sub={t(`es.size.${p.size}.sub` as CopyKey)} right={t('es.plan.each', { price: formatSar(p.price.amount) })}
            note={!p.fits ? t('es.plan.short', { days: p.days }) : undefined} testID={`esim-plan-${p.size}`} />
        ))}
      </View>
      {data.where && data.where.kind !== 'local' ? <Tiny>{t('es.plan.region', { where })}</Tiny> : null}

      {people.length > 1 ? (
        <View style={{ gap: 8 }}>
          <H3>{t('es.who')}</H3>
          <Tiny style={{ marginTop: -4 }}>{t('es.who.sub')}</Tiny>
          {people.map((p) => (
            <PickCard key={p.id} on={chosen.includes(p.id)} disabled={p.has} onPress={() => setWho(chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}
              title={p.name} sub={p.has ? t('es.who.has') : null} testID={`esim-who-${p.id}`} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8 }} testID="esim-phone">
        <H3>{t('es.phone.title')}</H3>
        <ChipWrap>
          {(['iphone', 'samsung', 'pixel', 'unsure'] as const).map((k) => (
            <Chip key={k} label={t(`es.phone.${k}` as CopyKey)} on={phone === k} onPress={() => { buzz('select'); setPhone(k); if (k === 'unsure') setCheck(true); }} testID={`esim-phone-${k}`} />
          ))}
        </ChipWrap>
        {phoneOk ? <Tiny color={colors.green}>{t('es.phone.this')}</Tiny> : null}
        {phone === 'no' ? <Box tone="cream"><Small>{t('es.check.noBody')}</Small><Button variant="secondary" label={t('es.tr.talk')} onPress={() => router.push('/support?topic=other' as Href)} /></Box> : null}
      </View>

      <View style={{ gap: 4 }}>
        <Button testID="esim-review" label={t('es.review', { price: formatSar(total) })} disabled={!count || !phoneOk}
          onPress={() => {
            buzz('tap');
            usePayDraft.getState().set({ draft: { kind: 'esim', count, packageId: plan.id, where: data.where?.code ?? undefined, tripId: data.tripId, travellerIds: chosen }, title: t('pay.title.esimFor', { where }) });
            router.push('/pay');
          }} />
        <View style={{ alignItems: 'center' }}><Approx amount={total} /></View>
      </View>

      <Sheet visible={check} onClose={() => setCheck(false)} label={t('es.check.title')}>
        <View style={{ gap: 12 }} testID="esim-check">
          <T v="h2">{t('es.check.title')}</T>
          <Small>{t('es.check.iphone')}</Small>
          <Small>{t('es.check.android')}</Small>
          <Tiny>{t('es.check.locked')}</Tiny>
          <Button label={t('es.check.yes')} testID="esim-check-yes" onPress={() => { setPhone('iphone'); setCheck(false); }} />
          <Button variant="secondary" label={t('es.check.no')} testID="esim-check-no" onPress={() => { setPhone('no'); setCheck(false); }} />
        </View>
      </Sheet>
    </View>
  );
}
