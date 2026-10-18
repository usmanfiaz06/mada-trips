import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { formatSar, gbText, shortDay, type EsimPlansResponse, type EsimView } from '@mada/shared';
import { Box, H3, Row, SmallButton, Tiny } from '@/components/trips/ui';
import { useEsimPlans, useEsims, useMyEsims } from '@/lib/esim';
import { colors, ff, font } from '@/theme';
import { EsimSummary, FlagDisc, countryOf } from './look';
import { buzz } from '@/lib/haptics';
import { whereOf } from './EsimPlanner';
import { getLocale, t } from '@/lib/i18n';

/* Small pieces of an eSIM shared by its screen, the list, the trip and the wallet: what's left, the trip's row and card. */

export function usageLine(e: EsimView): string | null {
  const u = e.usage;
  if (!u || u.state === 'not_active') return e.installedAt ? t('es.notOn') : null;
  if (u.unlimited) return t('es.unlimited');
  if (u.leftMb === null || u.totalMb === null) return null;
  return t('es.left', { left: gbText(u.leftMb), total: gbText(u.totalMb) });
}


/** On the trip: the eSIM as its card (what's left on a small ring), each one's line, Top up, and "Not connecting?". Nothing when none was bought. */
export function EsimTripCard({ tripId }: { tripId: string }) {
  const router = useRouter();
  const list = (useEsims({ trip: tripId }).data?.esims ?? []).filter((e) => e.install && e.status !== 'refunded');
  if (!list.length) return null;
  const e0 = list[0]!;
  return (
    <View testID="esim-trip" style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('es.card.title', { where: e0.where })} onPress={() => { buzz('tap'); router.push(`/esim/${e0.id}` as Href); }}
        style={({ pressed }) => (pressed ? { transform: [{ scale: 0.985 }] } : null)}>
        <EsimSummary e={e0} who={list.length > 1 ? t('es.count', { count: list.length }) : undefined} />
      </Pressable>
      {list.map((e) => (
        <Tiny key={e.id}>{[list.length > 1 ? e.travellerName ?? t('es.list.forYou') : null, usageLine(e) ?? (e.installedAt ? null : t('es.st.ready')), e.usage?.expiresAt ? t('es.ends', { date: shortDay(e.usage.expiresAt.slice(0, 10), getLocale()) }) : null].filter(Boolean).join(' · ')}</Tiny>
      ))}
      <Row gap={8}>
        {e0.plan.topup ? <SmallButton testID="esim-trip-topup" label={t('es.topup')} icon="plus" tone="paper" onPress={() => router.push(`/esim/${e0.id}?open=topup` as Href)} grow /> : null}
        <SmallButton testID="esim-trip-trouble" label={t('es.trouble')} icon="wifi" tone="paper" onPress={() => router.push(`/esim/${e0.id}?open=trouble` as Href)} grow />
      </Row>
    </View>
  );
}

/** The cheapest plan for the trip, for "from SAR X"; null when there is none (or it is at home, where the Saudi line works). */
export function fromPrice(p: EsimPlansResponse | undefined): number | null {
  if (!p || p.outcome !== 'ok' || p.where?.countries.every((c) => c === 'SA')) return null;
  const all = [...p.plans, ...p.more].map((x) => x.price.amount);
  return all.length ? Math.min(...all) : null;
}

/**
 * The trip page's internet row: the eSIM card (what's left) once bought; before that, the flag, "Internet in Türkiye",
 * "Get an eSIM · from SAR 29", opening the plans for this trip. Nothing for a trip at home or a place with no plans.
 */
export function EsimTripRow({ tripId }: { tripId: string }) {
  const router = useRouter();
  const mine = useEsims({ trip: tripId });
  const has = (mine.data?.esims ?? []).some((e) => e.status !== 'refunded');
  const plans = useEsimPlans({ tripId }, mine.isSuccess && !has);
  if (has) return <EsimTripCard tripId={tripId} />;
  const from = fromPrice(plans.data);
  if (from === null || !plans.data) return null;
  const country = countryOf(plans.data.where?.countries);
  return (
    <Box testID="esim-trip-row" padding={14} onPress={() => router.push(`/esim/plans?trip=${tripId}` as Href)} label={t('es.trip.row', { where: whereOf(plans.data) })}>
      <Row gap={12}>
        <FlagDisc country={country} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <H3 lines={1}>{t('es.trip.row', { where: whereOf(plans.data) })}</H3>
          <Tiny lines={1}>{t('es.trip.from', { price: formatSar(from) })}</Tiny>
        </View>
        <View style={styles.simTile}><Icon name="sim" size={20} color={colors.green} /></View>
      </Row>
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
  return (
    <Pressable testID="esim-cross" accessibilityRole="link" onPress={() => { buzz('tap'); router.push(`/esim/plans?trip=${tripId}` as Href); }} style={({ pressed }) => [styles.cross, pressed ? { opacity: 0.7 } : null]}>
      <FlagDisc country={countryOf(plans.data?.where?.countries)} size={28} />
      <T v="small" color={colors.green} style={{ flexShrink: 1, fontFamily: ff.ui500 }}>{t('es.cross', { price: formatSar(from) })}</T>
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

/** The wallet's eSIMs: a card for each trip's eSIMs, with what's left; an inviting card to get one when there are none. */
export function WalletEsims() {
  const router = useRouter();
  const q = useMyEsims();
  const list = (q.data?.esims ?? []).filter((e) => e.status !== 'refunded');
  if (q.isPending) return null;
  return (
    <View style={{ gap: 10 }} testID="wallet-esims">
      <T v="eyebrow">{t('es.wallet.title')}</T>
      {list.length ? groups(list).map((g) => {
        const e = g.find((x) => x.usage?.state === 'active') ?? g[0]!;
        const go = g.length < 2 ? `/esim/${e.id}` : e.tripId ? `/esims?trip=${e.tripId}` : `/esims?order=${e.orderId}`;
        return (
          <Pressable key={e.id} testID={`wallet-esim-${g[0]!.id}`} accessibilityRole="button" accessibilityLabel={t('es.card.title', { where: e.where })} onPress={() => { buzz('tap'); router.push(go as Href); }}
            style={({ pressed }) => (pressed ? { transform: [{ scale: 0.985 }] } : null)}>
            <EsimSummary e={e} who={g.length > 1 ? t('es.count', { count: g.length }) : undefined} />
          </Pressable>
        );
      }) : (
        <Box gap={14} padding={18}>
          <Row gap={14}>
            <View style={styles.emptyArt}><Icon name="sim" size={28} color={colors.green} /><View style={styles.emptyGlobe}><Icon name="globe" size={14} color={colors.paper} /></View></View>
            <View style={{ flex: 1, gap: 4 }}>
              <T style={[font('displaySmall'), { fontSize: 22, lineHeight: 26 }]}>{t('es.wallet.empty')}</T>
              <Tiny>{t('es.wallet.emptySub')}</Tiny>
            </View>
          </Row>
          <SmallButton testID="wallet-esim-get" label={t('es.trip.cta')} tone="primary" onPress={() => router.push('/esim/plans' as Href)} />
        </Box>
      )}
    </View>
  );
}

/** One card per trip and place: a family's four eSIMs for Türkiye are one card, opening the trip's eSIMs. */
function groups(list: EsimView[]): EsimView[][] {
  const by = new Map<string, EsimView[]>();
  for (const e of list) {
    const k = `${e.tripId ?? e.orderId}:${e.where}`;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  return [...by.values()];
}

const styles = StyleSheet.create({
  simTile: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.goldWash, alignItems: 'center', justifyContent: 'center' },
  cross: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', paddingVertical: 8, paddingStart: 6, paddingEnd: 12, borderRadius: 999, backgroundColor: colors.paper },
  emptyArt: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.goldWash, alignItems: 'center', justifyContent: 'center' },
  emptyGlobe: { position: 'absolute', end: -4, bottom: -4, width: 24, height: 24, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.paper },
});
