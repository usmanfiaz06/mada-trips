import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { formatSar, statementHtml, type TripMoney } from '@mada/shared';
import { Button } from '@/components/Button';
import { T } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { Icon, type IconName } from '@/components/Icon';
import { ArtReceipt } from '@/components/trips/Arts';
import { dl } from '@/components/trips/money';
import { Box, Divider, Eyebrow, Grow, H3, IconTile, Num, Rise, Row, Small, Spread, Tag, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { Approx, RatesFoot } from '@/components/wallet/Approx';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useTripMoney } from '@/lib/trips';
import { usePayMethods } from '@/lib/wallet';
import { colors } from '@/theme';

/*
 * The trip's Money screen (owner audit item 7): everything paid, per traveller and in total; refunds; what is priced but
 * not paid yet; who actually paid (a card, Apple Pay, credit, or a friend who was asked to pay); splits in circles for
 * this trip; and a statement to share as text or save as a PDF. Numbers from GET /trips/{id}/money, the same charges
 * as Payments and invoices.
 */

const ICON: Record<TripMoney['items'][number]['item'], IconName> = { flight: 'flight', stay: 'stay', pickup: 'car', change: 'flight', extra: 'star' };

export default function Money() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useTripMoney(id);
  const m = q.data?.money;
  // Who paid, said the way Wallet and Profile say it: a saved card, or one used on this trip and not saved.
  const pm = usePayMethods();
  if (q.data && m && !m.items.length && !m.pending.length) {
    return (
      <TripScreen title={t('money.title')}>
        <EmptyState art={<ArtReceipt />} title={t('money.empty')} body={t('money.emptyBody')} action={<Button label={t('money.invoices')} variant="secondary" onPress={() => router.push(`/trip/${id}/payments` as Href)} />} />
      </TripScreen>
    );
  }
  if (!m) return <TripScreen title={t('money.title')}><View /></TripScreen>;
  const shareText = async () => {
    buzz('tap');
    try { await Share.share({ message: m.statement }); toast(t('money.shared')); } catch { toast(t('money.cantShare')); }
  };
  const sharePdf = async () => {
    buzz('tap');
    try {
      const Print = await import('expo-print');
      const html = statementHtml(m, isRTL() ? 'ar' : 'en');
      if (Platform.OS === 'web') { await Print.printAsync({ html }); return; }
      const { uri } = await Print.printToFileAsync({ html });
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('money.statement.title') });
      else toast(t('money.shared'));
    } catch { toast(t('money.cantShare')); }
  };
  const many = m.travellers.length > 1;
  return (
    <TripScreen title={t('money.title')} act={<><Button testID="money-share" label={t('money.share')} icon={<Icon name="doc" color={colors.mist} size={20} />} onPress={() => void shareText()} /><Button variant="secondary" testID="money-pdf" label={t('money.pdf')} onPress={() => void sharePdf()} /></>}>
      <Rise style={{ gap: 4 }}>
        <Eyebrow>{t('money.head', { city: m.city, ref: m.ref ?? '' })}</Eyebrow>
        <View testID="money-total"><Num size={38} style={{ lineHeight: 40 }}>{formatSar(m.total.amount)}</Num></View>
        <Approx amount={m.total.amount} size={13} />
        <Small>{m.refunded.amount ? t('money.totalRefunded', { amount: formatSar(m.refunded.amount) }) : t('money.total')}</Small>
        <Tiny color={colors.goldInk}>{t('money.warm')}</Tiny>
      </Rise>
      {m.pending.length ? (
        <Rise step={1}>
          <Box tone="focal" gap={8} testID="money-pending">
            <Eyebrow color={colors.sand}>{t('money.pending')}</Eyebrow>
            {m.pending.map((p) => (
              <Spread key={p.id}>
                <Grow><H3 color={colors.mist} size={15}>{p.title}</H3><Tiny color={colors.onDark2}>{p.kind === 'friend' ? t('money.pendingFriend', { name: p.who ?? '' }) : p.kind === 'you' ? t('money.pendingYou') : t('money.pendingDesk')} · {dl(p.since)}</Tiny></Grow>
                <Num size={15} color={colors.mist}>{formatSar(p.amount.amount, { bare: true })}</Num>
              </Spread>
            ))}
          </Box>
        </Rise>
      ) : null}
      {many ? (
        <Rise step={2}>
          <Box gap={6} testID="money-per-person">
            <Eyebrow>{t('money.perPerson')}</Eyebrow>
            {m.travellers.map((p, i) => (
              <Spread key={p.personId} style={i ? styles.line : null}>
                <Row><View style={styles.face}><Small color={colors.sand}>{p.name.charAt(0)}</Small></View><H3 size={15}>{p.name}</H3></Row>
                <View style={{ alignItems: 'flex-end' }}><Num size={17}>{formatSar(p.amount.amount, { bare: true })}</Num><Approx amount={p.amount.amount} short /></View>
              </Spread>
            ))}
            <Tiny>{t('money.perPersonNote')}</Tiny>
          </Box>
        </Rise>
      ) : null}
      {m.payers.length ? (
        <Rise step={3}>
          <Box gap={6} testID="money-payers">
            <Eyebrow>{t('money.perPayer')}</Eyebrow>
            {m.payers.map((p, i) => (
              <Spread key={p.name} style={i ? styles.line : null}>
                <Row style={{ flex: 1 }}><Icon name={p.mine ? 'card' : 'user'} size={18} color={colors.ink3} />
                  <Grow><H3 size={15}>{p.name}</H3>{p.mine && pm.isCard(p.name) ? <T v="tiny" testID={`money-payer-src-${i}`}>{pm.isSaved(p.name) ? t('pm.saved') : t('pm.usedHere')}</T> : null}</Grow>
                </Row>
                <Num size={15}>{formatSar(p.amount.amount, { bare: true })}</Num>
              </Spread>
            ))}
          </Box>
        </Rise>
      ) : null}
      <Rise step={4}>
        <Box padding={6} gap={0}>
          <View style={{ paddingHorizontal: 10, paddingTop: 8 }}><Eyebrow>{t('money.items')}</Eyebrow></View>
          {m.items.map((it, i) => (
            <Pressable key={it.id} testID={`money-item-${it.item}`} accessibilityRole="button" disabled={!it.invoiceId} onPress={() => { buzz('tap'); router.push(`/trip/${id}/invoice/${it.invoiceId}` as Href); }}
              style={({ pressed }) => [styles.item, i ? styles.itemLine : null, pressed ? { backgroundColor: colors.mist } : null]}>
              <IconTile name={ICON[it.item]} />
              <Grow gap={2}>
                <H3 size={15}>{it.title}</H3>
                <Tiny>{dl(it.paidAt)} · {it.paidBy}</Tiny>
                {it.refunded ? <Tag tone="ok" label={t('money.back', { amount: formatSar(it.refunded.amount) })} /> : null}
              </Grow>
              <View style={{ alignItems: 'flex-end', gap: 2 }}><Num size={15}>{formatSar(it.amount.amount, { bare: true })}</Num>{many ? <Tiny>{formatSar(it.perTraveller[0]?.amount.amount ?? 0, { bare: true })} × {it.perTraveller.length}</Tiny> : null}</View>
            </Pressable>
          ))}
        </Box>
      </Rise>
      {m.splits.length ? (
        <Box gap={8} testID="money-splits">
          <Eyebrow>{t('money.splits')}</Eyebrow>
          {m.splits.map((sp) => (
            <View key={sp.messageId} style={{ gap: 4 }}>
              <Spread><H3 size={15}>{sp.what}</H3><Num size={15}>{formatSar(sp.total.amount, { bare: true })}</Num></Spread>
              <Tiny>{sp.circleName} · {t('money.paidBy', { name: sp.paidByName })}</Tiny>
              {sp.shares.filter((s) => s.amount.amount > 0).map((s) => (
                <Spread key={s.key}><Small>{s.names.join(', ')}</Small><Small color={s.paid ? colors.ok : colors.goldInk}>{s.paid ? t('money.splitPaid') : t('money.splitOwes')} · {formatSar(s.amount.amount, { bare: true })}</Small></Spread>
              ))}
              {sp.settled ? <Tag tone="ok" label={t('money.settled')} /> : null}
              <TextLink label={sp.circleName} onPress={() => router.push(`/circle/${sp.circleId}` as Href)} />
            </View>
          ))}
        </Box>
      ) : null}
      {m.credit.amount ? <Box tone="well"><Small color={colors.green}>{t('money.creditLeft', { amount: formatSar(m.credit.amount) })}</Small></Box> : null}
      <Divider />
      <TextLink label={t('money.invoices')} onPress={() => router.push(`/trip/${id}/payments` as Href)} testID="money-invoices" />
      <RatesFoot />
    </TripScreen>
  );
}

const styles = StyleSheet.create({
  line: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  face: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 18 },
  itemLine: { borderTopWidth: 1, borderTopColor: colors.line, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
});
