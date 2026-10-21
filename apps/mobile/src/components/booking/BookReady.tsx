import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatSar, nameIn, type BookReadyItem, type CreateOrderResponse } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { T } from '@/components/Text';
import { bookingApi, bookingKeys, newIdempotencyKey, useInvalidateBooking } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { useCards } from '@/lib/wallet';
import { colors, ff, font, radii } from '@/theme';
import { DemoFare } from './DemoFare';
import { Notice } from './parts';
import { routeTitle } from './PlanCards';

/*
 * "Book what's ready" (docs/app/ASK-INTEGRATED.md §7.2): every item on the plan with a price a tool or the desk gave,
 * each ticked by default with its own lines, one total that follows the ticks, and the items whose price ran out with
 * "Price again". Sliding books each ticked item as its own order through POST /orders, the same as the order sheet;
 * the plan reads each order's status from there (priced → booked → confirmed). Nothing is charged before the slide.
 */

type Outcome = { itemId: string; ok: boolean; why?: 'price' | 'declined' | 'other' };

const ICON: Record<string, IconName> = { flight: 'flight', drive: 'car', transfer: 'car', stay: 'stay', car: 'car', activity: 'star', meal: 'food', note: 'globe', check: 'globe' };
const iconOf = (i: Pick<BookReadyItem, 'kind' | 'mode'>): IconName => (i.kind === 'leg' ? ICON[i.mode ?? ''] ?? 'map' : ICON[i.kind] ?? 'star');

/** The item in the reader's language: a route with its arrow, a stay in its place, else what the order's first line says. */
function itemTitle(i: Pick<BookReadyItem, 'kind' | 'title' | 'lines'>): string {
  if (i.kind === 'leg') return routeTitle(i.title);
  const stay = /^Stay in (.+)$/.exec(i.title);
  if (i.kind === 'stay' && stay) return t('chat.plan.stayIn', { place: nameIn(stay[1]!, getLocale()) });
  return i.kind === 'note' || i.kind === 'check' ? i.lines[0]?.text ?? i.title : i.title;
}
const dayOf = (d: number | null) => (d == null ? t('ready.whole') : t('ready.day', { n: d + 1 }));
const okOutcome = (o: CreateOrderResponse) => o.outcome === 'created' || o.outcome === 'paid' || o.outcome === 'payment_requested';
const whyOf = (o: CreateOrderResponse): Outcome['why'] => (o.outcome === 'price_changed' || o.outcome === 'hold_ended' ? 'price' : o.outcome === 'declined' ? 'declined' : 'other');

export function BookReady({ tripId }: { tripId: string }) {
  const router = useRouter();
  const bottom = useBottomInset();
  const invalidate = useInvalidateBooking();
  const cards = useCards();
  const q = useQuery({ queryKey: bookingKeys.planReady(tripId), queryFn: () => bookingApi.planReady(tripId) });
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Outcome[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [footH, setFootH] = useState(180);
  // One key per item, kept across a retry, so a second slide never books an item twice.
  const keys = useRef(new Map<string, string>());
  const leave = () => (router.canGoBack() ? router.back() : router.replace(`/trip/${tripId}` as never));

  const items = q.data?.items ?? [];
  const chosen = useMemo(() => items.filter((i) => !off.has(i.itemId)), [items, off]);
  const total = chosen.reduce((a, i) => a + i.total.amount, 0);
  const demo = chosen.some((i) => i.demo);
  const card = cards.data?.cards.find((c) => c.id === cards.data!.defaultId) ?? cards.data?.cards[0] ?? null;

  const toggle = (id: string) => { buzz('select'); setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const priceAgain = (title: string) => router.push({ pathname: '/ask', params: { prefill: t('ready.priceAgainSay', { title: routeTitle(title) }), tripId } });

  const book = async () => {
    if (!card || !chosen.length) return;
    setBusy(true);
    const out: Outcome[] = [];
    for (const i of chosen) {
      const key = keys.current.get(i.itemId) ?? keys.current.set(i.itemId, newIdempotencyKey()).get(i.itemId)!;
      try {
        const r = await bookingApi.createOrder({ draft: i.draft, useCredit: false, payment: { method: 'card', cardId: card.id }, plan: 'full', expectedTotal: i.total.amount, idempotencyKey: key });
        out.push(okOutcome(r) ? { itemId: i.itemId, ok: true } : { itemId: i.itemId, ok: false, why: whyOf(r) });
      } catch {
        // Offline, a phone to verify first, a fare gone: this one stays on the plan as it was, the others go on.
        out.push({ itemId: i.itemId, ok: false, why: 'other' });
      }
    }
    await invalidate();
    setBusy(false);
    setAttempt((a) => a + 1);
    setDone(out);
  };

  if (done) {
    const booked = done.filter((d) => d.ok);
    const failed = done.filter((d) => !d.ok);
    return (
      <Screen>
        <TopBar onBack={leave} />
        <View style={{ padding: 24, gap: 14 }} testID="ready-done">
          <Notice icon="check" iconColor={colors.ok} title={t('ready.done.title')}>
            {booked.map((d) => { const i = items.find((x) => x.itemId === d.itemId)!; return <T key={d.itemId} v="small" testID="ready-done-item">{itemTitle(i)}</T>; })}
            <T v="small" color={colors.ink2}>{t('ready.done.body')}</T>
          </Notice>
          {failed.map((d) => { const i = items.find((x) => x.itemId === d.itemId)!; return <Notice key={d.itemId} warn title={t('ready.partial', { title: itemTitle(i), why: t(`ready.why.${d.why ?? 'other'}`) })} />; })}
          <Button label={t('ready.done.plan')} onPress={() => router.replace(`/trip/${tripId}` as never)} testID="ready-done-plan" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={leave} backLabel={t('pay.back')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: footH + 24, gap: 14 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 4 }}>
          <T style={font('displaySmall')} accessibilityRole="header" testID="ready-title">{t('ready.title')}</T>
          {q.data ? <T v="small" color={colors.ink2}>{routeTitle(q.data.title)}</T> : null}
        </View>
        {q.isLoading ? <T v="small" color={colors.ink2}>{t('pay.busy')}</T> : null}
        {q.data && !items.length ? <Notice title={t('ready.none.title')}><T v="small">{t('ready.none.body')}</T></Notice> : null}
        {items.length ? <T v="small" color={colors.ink2}>{t('ready.pick')}</T> : null}
        {items.map((i) => {
          const on = !off.has(i.itemId);
          return (
            <Pressable key={i.itemId} onPress={() => toggle(i.itemId)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${itemTitle(i)}, ${formatSar(i.total.amount)}`}
              style={[s.item, on ? s.itemOn : null]} testID={`ready-item-${i.itemId}`}>
              <View style={s.head}>
                <View style={[s.box, on ? s.boxOn : null]}>{on ? <Icon name="check" size={14} color={colors.paper} /> : null}</View>
                <Icon name={iconOf(i)} size={20} color={colors.green} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600 }} numberOfLines={2}>{itemTitle(i)}</T>
                  <T v="tiny" color={colors.ink2}>{[dayOf(i.day), i.quote ? t('ready.quote') : null].filter(Boolean).join(' · ')}</T>
                </View>
                <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600, fontVariant: ['tabular-nums'] }}>{formatSar(i.total.amount)}</T>
              </View>
              {i.demo ? <DemoFare testID="ready-item-demo" /> : null}
              <View style={{ gap: 4, paddingStart: 32 }}>
                {(i.lines.length === 1 && i.lines[0]!.text === itemTitle(i) ? [] : i.lines).map((l) => (
                  <View key={l.key + l.text} style={s.line}>
                    <T v="tiny" color={colors.ink2} style={{ flex: 1 }} numberOfLines={2}>{l.text}</T>
                    <T v="tiny" color={colors.ink2} style={{ fontVariant: ['tabular-nums'] }}>{formatSar(l.amount, { bare: true })}</T>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
        {q.data?.expired.length ? (
          <View style={s.expired} testID="ready-expired">
            <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('ready.expired.title')}</T>
            <T v="tiny" color={colors.ink2}>{t('ready.expired.body')}</T>
            {q.data.expired.map((x) => (
              <View key={x.itemId} style={s.head}>
                <Icon name={iconOf(x)} size={18} color={colors.ink3} />
                <View style={{ flex: 1 }}>
                  <T v="small" color={colors.green}>{x.kind === 'leg' ? routeTitle(x.title) : x.title}</T>
                  <T v="tiny" color={colors.ink2}>{dayOf(x.day)}</T>
                </View>
                <Button size="small" variant="secondary" block={false} label={t('ready.priceAgain')} onPress={() => priceAgain(x.title)} testID={`ready-price-again-${x.itemId}`} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {items.length ? (
        <View style={[s.foot, { paddingBottom: 18 + bottom }]} onLayout={(e) => setFootH(Math.ceil(e.nativeEvent.layout.height))} testID="ready-footer">
          <View style={s.line}>
            <View style={{ gap: 2 }}>
              <T v="small" color={colors.ink2}>{t('ready.total')}</T>
              <T v="tiny" color={colors.ink2} testID="ready-chosen">{t('ready.chosen', { n: chosen.length, all: items.length })}</T>
            </View>
            <T style={s.total} testID="ready-total">{formatSar(total)}</T>
          </View>
          {demo ? <DemoFare testID="ready-demo-fare" /> : null}
          {card ? <T v="tiny" color={colors.ink2}>{t('ready.payWith', { method: card.label })}</T> : <Notice warn title={t('ready.noCard')} />}
          {!chosen.length ? <T v="tiny" color={colors.goldInk}>{t('ready.nothing')}</T> : null}
          <SlideToConfirm key={attempt} label={t('ready.slide')} busy={busy} busyLabel={t('pay.busy')} disabled={!card || !chosen.length} onConfirm={book} />
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper },
  itemOn: { borderColor: colors.green },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.ink3, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.green, borderColor: colors.green },
  expired: { gap: 10, padding: 14, borderRadius: radii.card ?? 18, backgroundColor: colors.mist },
  foot: { position: 'absolute', start: 0, end: 0, bottom: 0, gap: 8, paddingTop: 12, paddingHorizontal: 20, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  total: { fontFamily: ff.ui600, fontSize: 32, lineHeight: 36, letterSpacing: -1, color: colors.green, fontVariant: ['tabular-nums'] },
});
