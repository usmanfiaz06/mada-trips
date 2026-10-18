import { ActivityIndicator, View } from 'react-native';
import { type CopyKey } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { T } from '@/components/Text';
import { usageLine } from '@/components/esim/parts';
import { EsimSummary } from '@/components/esim/look';
import { OutcomeCard } from '@/components/outcome/Outcome';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, H3, Rise, Row, Small, SmallButton, Tiny, TripScreen } from '@/components/trips/ui';
import { useEsims } from '@/lib/esim';
import { t } from '@/lib/i18n';
import { colors, font } from '@/theme';

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
  const live = list.filter((e) => e.status !== 'refunded');
  return (
    <TripScreen title={t('es.list.title')}>
      <Rise><T style={font('displaySmall')} accessibilityRole="header">{list[0] ? t('es.card.title', { where: list[0].where }) : t('es.list.title')}</T></Rise>
      {q.isPending ? <View style={{ paddingTop: 30 }}><ActivityIndicator color={colors.green} /></View> : null}
      {!q.isPending && !list.length ? <EmptyState art={<ArtSuitcase />} title={t('es.list.empty')} body="" /> : null}
      {list.some((e) => e.status === 'ready') ? <Rise step={1}><Small style={{ marginTop: -8 }}>{t('es.ins.title')}</Small></Rise> : null}
      {refunded?.result ? <><Box tone="cream"><H3>{t('es.refunded.title')}</H3></Box><OutcomeCard result={refunded.result} tripId={refunded.tripId} why={refunded.result.reason === 'sold_out' ? t('es.why.sold_out') : null} testID="esim-outcome" /></> : null}
      {live.length > 1 ? (
        <>
          <Rise step={2}><EsimSummary e={live[0]!} who={t('es.count', { count: live.length })} /></Rise>
          <Rise step={3}>
            <Box padding={6} gap={0}>
              {live.map((e, i) => (
                <View key={e.id} testID={`esim-${e.id}`} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }, i ? { borderTopWidth: 1, borderTopColor: colors.line } : null]}>
                  <Avatar initial={e.travellerName ?? undefined} tone={e.installedAt ? 'gold' : 'default'} size={40} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <H3 lines={1}>{e.travellerName ?? t('es.list.forYou')}</H3>
                    <Tiny lines={1}>{[t(`es.st.${e.status}` as CopyKey), usageLine(e), e.iccid ? `•••• ${e.iccid.slice(-4)}` : null].filter(Boolean).join(' · ')}</Tiny>
                  </View>
                  {e.status === 'ordering' ? <ActivityIndicator color={colors.green} /> : null}
                  {e.install ? <SmallButton testID="esim-open" label={e.installedAt ? t('es.card.see') : t('es.card.install')} tone={e.installedAt ? 'secondary' : 'primary'} onPress={() => router.push(`/esim/${e.id}` as Href)} /> : null}
                </View>
              ))}
            </Box>
          </Rise>
        </>
      ) : live.map((e) => (
        <Rise key={e.id} step={2}>
          <View testID={`esim-${e.id}`} style={{ gap: 10 }}>
            <EsimSummary e={e} />
            {e.status === 'ordering' ? <Row><ActivityIndicator color={colors.green} /><Small>{t('es.ordering')}</Small></Row> : null}
            {e.install ? <Button testID="esim-open" label={e.installedAt ? t('es.card.see') : t('es.card.install')} variant={e.installedAt ? 'secondary' : 'primary'} onPress={() => router.push(`/esim/${e.id}` as Href)} /> : null}
          </View>
        </Rise>
      ))}
    </TripScreen>
  );
}
