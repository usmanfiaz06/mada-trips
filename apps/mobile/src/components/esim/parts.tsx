import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { T } from '@/components/Text';
import { formatSar, gbText, shortDay, type CopyKey, type EsimPlansResponse, type EsimView } from '@mada/shared';
import { Box, H3, ListRow, Row, SmallButton, Spread, Tag, TextLink, Tiny } from '@/components/trips/ui';
import { planLabel, useEsimPlans, useEsims, useMyEsims } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { whereOf } from './EsimPlanner';
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

/** The cheapest plan for the trip, for "from SAR X"; null when there is none (or it is at home, where the Saudi line works). */
export function fromPrice(p: EsimPlansResponse | undefined): number | null {
  if (!p || p.outcome !== 'ok' || p.where?.countries.every((c) => c === 'SA')) return null;
  const all = [...p.plans, ...p.more].map((x) => x.price.amount);
  return all.length ? Math.min(...all) : null;
}

/**
 * The trip page's internet row: the eSIM card (what's left) once bought; before that, "Internet in Türkiye · Get an eSIM
 * from SAR 29" opening the plans for this trip. Nothing for a trip at home or a place with no plans.
 */
export function EsimTripRow({ tripId }: { tripId: string }) {
  const router = useRouter();
  const mine = useEsims({ trip: tripId });
  const has = (mine.data?.esims ?? []).some((e) => e.status !== 'refunded');
  const plans = useEsimPlans({ tripId }, mine.isSuccess && !has);
  if (has) return <EsimTripCard tripId={tripId} />;
  const from = fromPrice(plans.data);
  if (from === null || !plans.data) return null;
  return (
    <Box padding={6} gap={0}>
      <ListRow testID="esim-trip-row" first icon="globe" title={t('es.trip.row', { where: whereOf(plans.data) })} sub={t('es.trip.from', { price: formatSar(from) })}
        onPress={() => { buzz('tap'); router.push(`/esim/plans?trip=${tripId}` as Href); }} />
    </Box>
  );
}

/**
 * After a flight or stay is booked: one quiet line, "Internet when you land? From SAR 29", opening the plans for the
 * trip. Nothing chosen for them, nothing added to what they paid; nothing at all when they already have one.
 */
export function EsimCrossSell({ tripId }: { tripId: string }) {
  const router = useRouter();
  const mine = useEsims({ trip: tripId });
  const has = (mine.data?.esims ?? []).some((e) => e.status !== 'refunded');
  const plans = useEsimPlans({ tripId }, mine.isSuccess && !has);
  const from = has ? null : fromPrice(plans.data);
  if (from === null) return null;
  return <TextLink testID="esim-cross" label={t('es.cross', { price: formatSar(from) })} onPress={() => router.push(`/esim/plans?trip=${tripId}` as Href)} />;
}

/** The wallet's eSIMs: each with where, its state and what's left; "Get one" when there are none. */
export function WalletEsims() {
  const router = useRouter();
  const q = useMyEsims();
  const list = (q.data?.esims ?? []).filter((e) => e.status !== 'refunded');
  if (q.isPending) return null;
  return (
    <View style={{ gap: 10 }} testID="wallet-esims">
      <T v="eyebrow">{t('es.wallet.title')}</T>
      {list.length ? (
        <Box padding={6} gap={0}>
          {list.map((e, i) => (
            <ListRow key={e.id} testID={`wallet-esim-${e.id}`} first={i === 0} icon="globe" title={t('es.card.title', { where: e.where })}
              sub={[e.travellerName ?? null, usageLine(e) ?? planLabel(e.plan, t), t(`es.st.${e.status}` as CopyKey)].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/esim/${e.id}` as Href)} />
          ))}
        </Box>
      ) : (
        <Box padding={6} gap={0}>
          <ListRow testID="wallet-esim-get" first icon="globe" title={t('es.wallet.empty')} sub={t('es.wallet.get')} onPress={() => router.push('/esim/plans' as Href)} />
        </Box>
      )}
    </View>
  );
}
