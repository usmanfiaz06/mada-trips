import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { DESTINATIONS, addDays, esimWhereKey, formatSar, nameIn, rangeLabel, type CopyKey, type EsimPlan, type EsimPlansResponse } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Approx } from '@/components/wallet/Approx';
import { Box, H3, Num, PickCard, Rise, Row, Small, TextLink, Tiny } from '@/components/trips/ui';
import { ChipWrap, Photo } from '@/components/booking/parts';
import { EsimHero, PersonChip, PhoneArt, PlanCard, countryOf } from './look';
import { ApiError } from '@/lib/api';
import { usePayDraft } from '@/lib/booking';
import { planLabel, useEsimPlans } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { useTrips } from '@/lib/trips';
import { colors, ff, font, radii } from '@/theme';

/*
 * An eSIM for the trip (Ask "data for Istanbul", or Today's readiness): the trip's country and days, 2–3 sizes priced
 * in SAR (≈ the display currency), one eSIM per traveller who wants it, and "does your phone take one?" with the steps
 * to check when they're not sure. Review opens the order sheet; the eSIM is bought once the payment goes through.
 * `layout` places the total and Review: in a bar pinned to the bottom of its own screen; inline (in Ask) at the end.
 */

const PLACES = ['istanbul', 'dubai', 'london', 'cairo', 'baku', 'tbilisi', 'paris'] as const;
const DAYS = [3, 5, 7, 10, 14, 30];
type Phone = 'iphone' | 'samsung' | 'pixel' | 'unsure' | 'no';

export const whereOf = (p: Pick<EsimPlansResponse, 'where' | 'plans'>) => {
  const code = p.where?.code ?? '';
  const k = esimWhereKey(code);
  return k ? t(k as CopyKey) : nameIn(p.plans[0]?.coverage.name ?? code, getLocale());
};

export function EsimPlanner({ tripId: tripIn, destination: destIn, days: daysIn, layout }: {
  tripId?: string | null; destination?: string | null; days?: number | null; layout?: (body: ReactNode, bar: ReactNode | null) => ReactElement;
}) {
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
  const [all, setAll] = useState(false);
  const [change, setChange] = useState(false);
  const inline = !layout;
  const people = useMemo(() => data?.people ?? [], [data]);
  const chosen = who ?? people.filter((p) => !p.has).map((p) => p.id);
  const plan: EsimPlan | undefined = [...(data?.plans ?? []), ...(data?.more ?? [])].find((p) => p.id === (pick ?? data?.recommended)) ?? data?.plans[0];
  const count = chosen.length;
  const total = plan ? plan.price.amount * count : 0;

  const wrap = (body: ReactNode) => (layout ? layout(body, null) : <>{body}</>);
  if (asking) {
    return wrap(
      <View style={{ gap: 16 }} testID="esim-where">
        <Rise><T style={font('displaySmall')} accessibilityRole="header">{t('es.which')}</T></Rise>
        {upcoming.map((x, i) => (
          <Rise key={x.id} step={1 + i}>
            <Pressable testID={`esim-trip-${x.id}`} accessibilityRole="button" accessibilityLabel={nameIn(x.city, getLocale())} onPress={() => { buzz('tap'); setTripId(x.id); }}
              style={({ pressed }) => [styles.tripTile, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
              <Photo name={Object.values(DESTINATIONS).find((d) => d.name === x.city)?.photo ?? 'inflight-wing'} />
              <VGradient id={`esim-trip-${x.id}`} stops={[[0.2, 'rgba(15,26,22,0)'], [1, 'rgba(15,26,22,0.8)']]} />
              <Row style={{ padding: 16, justifyContent: 'space-between' }} align="flex-end">
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={[font('displaySmall', colors.paper), { fontSize: 26, lineHeight: 30 }]} numberOfLines={1}>{nameIn(x.city, getLocale())}</T>
                  <T v="tiny" color="rgba(255,253,249,0.85)">{rangeLabel(x.startDate, x.endDate, getLocale())}</T>
                </View>
                <View style={styles.go}><Icon name="arrow" size={18} color={colors.green} /></View>
              </Row>
            </Pressable>
          </Rise>
        ))}
        {!other && upcoming.length ? <Button variant="secondary" label={t('es.which.other')} onPress={() => setOther(true)} testID="esim-other" /> : null}
        {other || !upcoming.length ? (
          <View style={{ gap: 10 }}>
            <H3>{t('es.which.where')}</H3>
            <ChipWrap>{PLACES.map((k) => <Chip key={k} label={nameIn(DESTINATIONS[k]!.name, getLocale())} background={colors.paper} on={false} onPress={() => { buzz('select'); setDest(k); }} testID={`esim-place-${k}`} />)}</ChipWrap>
          </View>
        ) : null}
      </View>,
    );
  }

  if (q.isPending) return wrap(<View style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}><ActivityIndicator color={colors.green} /></View>);
  if (q.isError || !data) {
    const offline = q.error instanceof ApiError && q.error.code === 'OFFLINE';
    return wrap(<Box tone="cream"><Small>{offline ? t('es.offline') : q.error instanceof Error ? q.error.message : t('error.internal')}</Small></Box>);
  }
  const where = whereOf(data);
  if (data.outcome === 'none' || !plan) {
    return wrap(
      <View style={{ gap: 12 }} testID="esim-none">
        <T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('es.none.title', { where: where || nameIn(dest ?? '', getLocale()) })}</T>
        <Small>{t('es.none.body')}</Small>
        <Button label={t('es.none.cta')} variant="secondary" onPress={() => router.push('/support?topic=other' as Href)} />
      </View>,
    );
  }
  const phoneOk = phone === 'iphone' || phone === 'samsung' || phone === 'pixel';
  const country = countryOf(data.where?.countries ?? plan.coverage.countries);
  const shown = [...data.plans, ...(all ? data.more : [])];
  const max = Math.max(1, ...shown.map((p) => (p.gb === null ? 0 : p.daily ? p.gb * p.days : p.gb)));
  const range = data.start ? rangeLabel(data.start, addDays(data.start, data.days - 1), getLocale()) : null;
  const planText = planLabel(plan, t);

  const bar = (
    <View style={[{ gap: 8 }, inline ? styles.barInline : null]} testID="esim-bar">
      <Row style={{ justifyContent: 'space-between' }} align="flex-end">
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T v="tiny" numberOfLines={1}>{count === 1 ? t('es.bar.one', { plan: planText }) : t('es.bar.other', { count, plan: planText })}</T>
          {!phoneOk && phone !== 'no' ? <T v="tiny" color={colors.goldInk} numberOfLines={1}>{t('es.bar.phone')}</T> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Num size={22}>{formatSar(total)}</Num>
          <Approx amount={total} />
        </View>
      </Row>
      <Button testID="esim-review" label={t('es.review', { price: formatSar(total) })} disabled={!count || !phoneOk}
        onPress={() => {
          buzz('tap');
          usePayDraft.getState().set({ draft: { kind: 'esim', count, packageId: plan.id, where: data.where?.code ?? undefined, tripId: data.tripId, travellerIds: chosen, ...(plan.daily ? { days: plan.days } : {}) }, title: t('pay.title.esimFor', { where }) });
          router.push('/pay');
        }} />
    </View>
  );

  const body = (
    <View style={{ gap: 18 }} testID="esim-planner">
      <Rise><EsimHero country={country} where={where} title={t('es.title', { where })} testID="esim-hero" /></Rise>

      <Rise step={1}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={8} style={{ flex: 1, minWidth: 0 }}>
            <Icon name="calendar" size={18} color={colors.ink2} />
            <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1 }} numberOfLines={1}>
              {[t('es.days.yours', { days: data.days }), range].filter(Boolean).join(' · ')}
            </T>
          </Row>
          {!tripId ? <TextLink testID="esim-days-change" label={t('es.days.change')} onPress={() => setChange(!change)} /> : null}
        </Row>
        {!tripId && change ? (
          <ChipWrap style={{ marginTop: 12 }}>{DAYS.map((d) => <Chip key={d} label={t('es.days.n', { n: d })} on={(days ?? 7) === d} background={colors.paper} onPress={() => { buzz('select'); setDays(d); setPick(null); setChange(false); }} testID={`esim-days-${d}`} />)}</ChipWrap>
        ) : null}
      </Rise>

      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {data.plans.map((p, i) => (
          <Rise key={p.id} step={2 + i}>
            <PlanCard p={p} on={plan.id === p.id} best={p.id === data.recommended} max={max} days={data.days} onPress={() => setPick(p.id)} testID={`esim-plan-${p.size}`} />
          </Rise>
        ))}
        {all ? data.more.map((p) => (
          <PickCard key={p.id} radio on={plan.id === p.id} onPress={() => setPick(p.id)} title={planLabel(p, t)} sub={p.fits ? t('es.plan.covers', { days: data.days }) : t('es.plan.short', { days: p.days })} right={formatSar(p.price.amount)} testID={`esim-more-${p.id}`} />
        )) : null}
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          {data.more.length ? <TextLink testID="esim-see-all" label={all ? t('es.plans.fewer') : t('es.plans.all')} onPress={() => setAll(!all)} /> : <View />}
          {data.where && data.where.kind !== 'local' ? <Tiny>{t('es.plan.region', { where })}</Tiny> : null}
        </Row>
      </View>

      {people.length > 1 ? (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 2 }}>
            <H3>{t('es.who')}</H3>
            <Tiny>{t('es.who.sub')}</Tiny>
          </View>
          <ChipWrap>
            {people.map((p) => (
              <PersonChip key={p.id} name={p.name} has={p.has} on={chosen.includes(p.id)} testID={`esim-who-${p.id}`}
                onPress={() => setWho(chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])} />
            ))}
          </ChipWrap>
        </View>
      ) : null}

      <Box testID="esim-phone" gap={14}>
        <Row gap={14} align="center">
          <PhoneArt ok={phoneOk} size={46} />
          <View style={{ flex: 1, gap: 3 }}>
            <H3>{t('es.phone.title')}</H3>
            {phoneOk ? <Tiny color={colors.ok} style={{ fontFamily: ff.ui600 }}>{t('es.phone.this')}</Tiny> : <Tiny>{t('es.saudi')}</Tiny>}
          </View>
        </Row>
        <ChipWrap>
          {(['iphone', 'samsung', 'pixel', 'unsure'] as const).map((k) => (
            <Chip key={k} label={t(`es.phone.${k}` as CopyKey)} on={phone === k} onPress={() => { buzz('select'); setPhone(k); if (k === 'unsure') setCheck(true); }} testID={`esim-phone-${k}`} />
          ))}
        </ChipWrap>
        {phone === 'no' ? <Box tone="cream"><Small>{t('es.check.noBody')}</Small><Button variant="secondary" label={t('es.tr.talk')} onPress={() => router.push('/support?topic=other' as Href)} /></Box> : null}
      </Box>

      {inline ? bar : null}

      <Sheet visible={check} onClose={() => setCheck(false)} label={t('es.check.title')}>
        <View style={{ gap: 14 }} testID="esim-check">
          <Row gap={14}>
            <PhoneArt ok={false} size={40} />
            <T style={[font('displaySmall'), { flex: 1, fontSize: 28, lineHeight: 32 }]}>{t('es.check.title')}</T>
          </Row>
          {(['es.check.iphone', 'es.check.android'] as const).map((k, i) => (
            <Row key={k} gap={12} align="flex-start">
              <View style={styles.num}><T style={{ fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.green }}>{String(i + 1)}</T></View>
              <Small style={{ flex: 1, color: colors.green }}>{t(k)}</Small>
            </Row>
          ))}
          <Tiny>{t('es.check.locked')}</Tiny>
          <Button label={t('es.check.yes')} testID="esim-check-yes" onPress={() => { setPhone('iphone'); setCheck(false); }} />
          <Button variant="secondary" label={t('es.check.no')} testID="esim-check-no" onPress={() => { setPhone('no'); setCheck(false); }} />
        </View>
      </Sheet>
    </View>
  );
  return layout ? layout(body, bar) : body;
}

const styles = StyleSheet.create({
  barInline: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16 },
  tripTile: { height: 132, borderRadius: radii.card, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.stage },
  go: { width: 36, height: 36, borderRadius: 99, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  num: { width: 26, height: 26, borderRadius: 99, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
});
