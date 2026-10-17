import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { T } from '@/components/Text';
import { EsimStatusTag, usageLine } from '@/components/esim/parts';
import { OutcomeCard } from '@/components/outcome/Outcome';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, H3, Rise, Row, Small, Spread, Tiny, TripScreen } from '@/components/trips/ui';
import { planLabel, useEsims } from '@/lib/esim';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';

/*
 * The eSIMs of an order (right after paying) or of a trip: one per phone, each with its status and Install. An order the
 * supplier couldn't give shows its refund as an outcome.
 */
export default function EsimsScreen() {
  const { order, trip } = useLocalSearchParams<{ order?: string; trip?: string }>();
  const router = useRouter();
  const q = useEsims({ order: order ?? null, trip: trip ?? null });
  const list = q.data?.esims ?? [];
  const refunded = list.find((e) => e.status === 'refunded' && e.result);
  return (
    <TripScreen title={t('es.list.title')}>
      <Rise><T v="h1" accessibilityRole="header">{list[0] ? t('es.card.title', { where: list[0].where }) : t('es.list.title')}</T></Rise>
      {q.isPending ? <View style={{ paddingTop: 30 }}><ActivityIndicator color={colors.green} /></View> : null}
      {!q.isPending && !list.length ? <EmptyState art={<ArtSuitcase />} title={t('es.list.empty')} body="" /> : null}
      {list.some((e) => e.status === 'ready') ? <Rise step={1}><Small style={{ marginTop: -8 }}>{t('es.ins.title')}</Small></Rise> : null}
      {refunded?.result ? <><Box tone="cream"><H3>{t('es.refunded.title')}</H3></Box><OutcomeCard result={refunded.result} tripId={refunded.tripId} testID="esim-outcome" /></> : null}
      {list.filter((e) => e.status !== 'refunded').map((e) => (
        <Box key={e.id} testID={`esim-${e.id}`} onPress={() => router.push(`/esim/${e.id}` as Href)} label={t('es.card.title', { where: e.where })}>
          <Spread><H3>{e.travellerName ? t('es.list.for', { name: e.travellerName }) : t('es.list.forYou')}</H3><EsimStatusTag e={e} /></Spread>
          <Tiny>{[planLabel(e.plan, t), usageLine(e)].filter(Boolean).join(' · ')}</Tiny>
          {e.status === 'ordering' ? <Row><ActivityIndicator color={colors.green} /><Small>{t('es.ordering')}</Small></Row> : null}
          {e.install ? <Button testID="esim-open" label={e.installedAt ? t('es.card.see') : t('es.card.install')} variant={e.installedAt ? 'secondary' : 'primary'} onPress={() => router.push(`/esim/${e.id}` as Href)} /> : null}
        </Box>
      ))}
    </TripScreen>
  );
}
