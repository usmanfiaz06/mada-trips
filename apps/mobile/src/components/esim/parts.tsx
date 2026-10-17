import { useRouter, type Href } from 'expo-router';
import { gbText, shortDay, type CopyKey, type EsimView } from '@mada/shared';
import { Box, H3, Row, SmallButton, Spread, Tag, Tiny } from '@/components/trips/ui';
import { useEsims } from '@/lib/esim';
import { getLocale, t } from '@/lib/i18n';

/* Small pieces of an eSIM shared by its screen, the list and the trip: the status tag and what's left. */

const TONE: Record<EsimView['status'], 'default' | 'ok' | 'warn' | 'gold' | 'bad'> = {
  ordering: 'default', ready: 'gold', installed: 'ok', active: 'ok', used_up: 'warn', expired: 'default', refunded: 'warn', stuck: 'warn',
};

export function EsimStatusTag({ e }: { e: EsimView }) {
  return <Tag tone={TONE[e.status]} label={t(`es.st.${e.status}` as CopyKey)} />;
}

export function usageLine(e: EsimView): string | null {
  const u = e.usage;
  if (!u || u.state === 'not_active') return e.installedAt ? t('es.notOn') : null;
  if (u.unlimited) return t('es.unlimited');
  if (u.leftMb === null || u.totalMb === null) return null;
  return t('es.left', { left: gbText(u.leftMb), total: gbText(u.totalMb) });
}


/** On the trip: each eSIM's GB left and end date, Top up, and "Not connecting?". Nothing when none was bought. */
export function EsimTripCard({ tripId }: { tripId: string }) {
  const router = useRouter();
  const list = (useEsims({ trip: tripId }).data?.esims ?? []).filter((e) => e.install && e.status !== 'refunded');
  if (!list.length) return null;
  return (
    <Box testID="esim-trip" gap={10}>
      <Spread><H3 size={16}>{t('es.card.title', { where: list[0]!.where })}</H3><EsimStatusTag e={list[0]!} /></Spread>
      {list.map((e) => (
        <Tiny key={e.id}>{[list.length > 1 ? e.travellerName ?? t('es.list.forYou') : null, usageLine(e) ?? (e.installedAt ? null : t('es.st.ready')), e.usage?.expiresAt ? t('es.ends', { date: shortDay(e.usage.expiresAt.slice(0, 10), getLocale()) }) : null].filter(Boolean).join(' · ')}</Tiny>
      ))}
      <Row gap={8}>
        {list[0]!.plan.topup ? <SmallButton testID="esim-trip-topup" label={t('es.topup')} tone="soft" onPress={() => router.push(`/esim/${list[0]!.id}?open=topup` as Href)} grow /> : null}
        <SmallButton testID="esim-trip-trouble" label={t('es.trouble')} tone="soft" onPress={() => router.push(`/esim/${list[0]!.id}?open=trouble` as Href)} grow />
      </Row>
    </Box>
  );
}
