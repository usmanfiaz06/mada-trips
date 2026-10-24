import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { DESTINATIONS, addDays, formatSar, type Plan, type PlanItem, type PlanOp, type StayOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { DemoFare } from '@/components/booking/DemoFare';
import { Rise, SmallButton, TripScreen } from '@/components/trips/ui';
import { AddForm, Banner, DaySection, OriginForm, PlanHero, RowActTag, StatusTag, TodoCard, itemWords, placeName, rowActKind, rowActLabel, type RowAct } from '@/components/plan/PlanParts';
import { ApiError } from '@/lib/api';
import { bookingApi, usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useNet } from '@/lib/net';
import { isBooked, moveOp, withQueued } from '@/lib/plan-logic';
import { dismissConflict, editPlan, planKey, plansApi, usePlan, usePlanQueue, usePlanSync } from '@/lib/plans';
import { queryClient, usePeople } from '@/lib/queries';
import { useTrip } from '@/lib/trips';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';

/*
 * The plan screen (docs/app/ASK-INTEGRATED.md §9.3, U8): the living plan of one trip, day by day. Each day shows its
 * legs (a drive with the km and time the drive interface measured, borders), the stay for each night (a gap says so),
 * the car, the stops; the to-do card is the plan's checks. Tap an item for its sheet: what it is, where it stands, and
 * Book / Price again / Ask Mada about this / Move / Remove. Edits go through the plan's own endpoints with the version
 * read, so a change made in the chat or on another phone is never overwritten: offline they wait and sync, and if the
 * plan moved on meanwhile the latest shows with "Changed elsewhere". Every change made here is in the chat's next
 * context (§3.6). Someone on the trip who can suggest sends a change request to the owner instead; who can view reads.
 */

type SheetState = { kind: 'item'; itemId: string; find?: boolean } | { kind: 'add'; day: number } | { kind: 'origin' } | null;

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = usePlan(id);
  // The trip page's photo for the header (a trip shared with you may not have one here: the default photo then).
  const photo = useTrip(id).data?.trip.imageUrl ?? null;
  // Back on the plan after booking or a chat: read it again (the event map, §1.3: picked up on focus).
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  usePlanSync(id);
  const queue = usePlanQueue((s) => s.edits);
  const conflict = usePlanQueue((s) => (s.conflict?.tripId === id ? s.conflict : null));
  const online = useNet((s) => s.online) !== false;
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const data = q.data;
  const access = data?.access ?? { role: 'owner' as const, prices: true, ownerName: null };
  const waiting = queue.filter((e) => e.tripId === id);
  // The plan on screen: the server's, with edits still waiting to sync on top.
  const plan = useMemo(() => (data ? withQueued(data.plan, waiting) : null), [data, waiting]);
  const canEdit = access.role !== 'view';
  const owner = access.role === 'owner';

  if (!plan) {
    return (
      <TripScreen title={t('plan.screen.title')}>
        {q.isPending ? <View style={{ padding: 24 }}><ActivityIndicator color={colors.green} /></View>
          : <EmptyState title={q.error instanceof ApiError && q.error.code === 'NOT_FOUND' ? t('plan.screen.none') : t('plan.error')} />}
        {q.error instanceof ApiError && q.error.code === 'NOT_FOUND' ? (
          <SmallButton tone="primary" icon="plus" label={t('trip.plan.make')} onPress={() => router.push({ pathname: '/ask', params: { tripId: id, prefill: t('trip.plan.makeSay') } })} testID="plan-make" />
        ) : null}
      </TripScreen>
    );
  }

  const item = sheet?.kind === 'item' ? plan.items.find((i) => i.id === sheet.itemId) ?? null : null;
  const skippedCount = plan.items.filter((i) => i.status === 'skipped').length;
  const askAbout = (words: string) => { setSheet(null); router.push({ pathname: '/ask', params: { tripId: id, prefill: words } }); };

  /** One edit: the owner's to the plan (queued offline), a companion's as a change request. */
  const edit = async (ops: PlanOp[], title: string, summary?: string) => {
    setBusy(true);
    const r = await editPlan(id, ops, title, summary);
    setBusy(false);
    setSheet(null);
    if (r.result === 'asked') { buzz('success'); toast(t('plan.suggested', { name: access.ownerName ?? '' })); }
    else if (r.result === 'applied') { buzz('success'); toast(t('plan.applied')); }
    else if (r.result === 'failed') { buzz('warn'); toast(r.error instanceof Error ? r.error.message : t('error.internal')); }
    else if (r.result === 'saved' || r.result === 'queued') buzz('select');
  };

  const setOrigin = async (name: string) => {
    if (!online) { toast(t('plan.offline')); return; }
    setBusy(true);
    try {
      const r = await plansApi.origin(id, { version: plan.version, origin: { name } });
      queryClient.setQueryData(planKey(id), { ...data!, plan: r.plan });
      setSheet(null);
      buzz('success');
      if (r.untouched.length) toast(t('plan.origin.kept', { items: r.untouched.map((u) => u.title).join(', ') }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PLAN_CHANGED') { usePlanQueue.setState({ conflict: { tripId: id, lost: [t('plan.origin.title')], at: Date.now() } }); void q.refetch(); setSheet(null); }
      else toast(e instanceof Error ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  const ready = owner && plan.totals?.ready ? plan.totals : null;
  /** The right side of a row: Search (Mada finds the leg's flights), Find a stay, View, the price (pay), Pending, Booked. */
  const actOf = (i: PlanItem): RowAct | undefined => {
    const a = rowActKind(i, access.prices, owner);
    if (!a) return undefined;
    const open = () => setSheet({ kind: 'item', itemId: i.id });
    const onPress = a.kind === 'search' ? () => router.push({ pathname: '/ask', params: { tripId: id, prefill: t('plan.row.searchSay', { title: itemWords(i, access.prices).main }) } })
      : a.kind === 'findStay' ? () => setSheet({ kind: 'item', itemId: i.id, find: true })
      : a.kind === 'price' && owner ? () => router.push({ pathname: '/pay', params: { plan: id } })
      : open;
    return { ...rowActLabel(a), onPress, testID: `plan-item-act-${a.kind}` };
  };
  const onBack = () => (router.canGoBack() ? router.back() : router.replace(`/trip/${id}` as Href));
  return (
    <TripScreen
      title={t('plan.screen.title')}
      onBack={onBack}
      hero={(
        <PlanHero plan={plan} people={data?.people ?? []} photo={photo} onBack={onBack}
          onDates={owner ? () => askAbout(t('plan.meta.datesSay')) : undefined}
          onPeople={() => router.push(`/trip/${id}/travellers` as Href)}
          onOrigin={owner ? () => setSheet({ kind: 'origin' }) : undefined} />
      )}
      act={(
        <View style={{ gap: 8 }}>
          {ready ? (
            <>
              {ready.demo ? <DemoFare testID="plan-demo-fare" /> : null}
              <Button variant="gold" label={t('plan.screen.bookReady', { amount: formatSar(ready.priced) })} onPress={() => { buzz('tap'); router.push({ pathname: '/pay', params: { plan: id } }); }} testID="plan-book-ready" />
            </>
          ) : null}
          <Button variant={ready ? 'ghost' : 'primary'} label={t('plan.screen.askPlan')} onPress={() => { buzz('tap'); router.push({ pathname: '/ask', params: { tripId: id } }); }} testID="plan-ask" />
        </View>
      )}
    >
      <View style={{ gap: 14 }} testID="plan-screen">
        {!online ? <Banner icon="wifi" text={t('plan.offline')} testID="plan-banner-offline" /> : null}
        {waiting.length ? <Banner icon="refund" text={t('plan.queued', { n: waiting.length })} testID="plan-banner-queued" /> : null}
        {conflict ? (
          <Banner icon="refund" tone="gold" onClose={dismissConflict} testID="plan-banner-conflict"
            text={[t('plan.conflict'), conflict.lost.length ? t('plan.conflictLost', { title: conflict.lost.join(', ') }) : null].filter(Boolean).join(' ')} />
        ) : null}
        {q.isError && online ? <Banner icon="wifi" text={t('plan.error')} testID="plan-banner-error" /> : null}
        {!owner ? (
          <Banner icon="lock" testID="plan-role"
            text={access.role === 'view' ? t('plan.role.view') : access.role === 'edit' ? t('plan.role.edit', { name: access.ownerName ?? '' }) : t('plan.role.suggest', { name: access.ownerName ?? '' })} />
        ) : null}
        <Rise step={1}><TodoCard checks={plan.checks} /></Rise>
        {/* Whole-trip items (an eSIM, insurance) before the days. */}
        {plan.items.some((i) => i.day == null) ? (
          <View style={{ gap: 4 }} testID="plan-whole-trip">
            <T v="eyebrow">{t('plan.screen.wholeTrip')}</T>
            {plan.items.filter((i) => i.day == null && (skipped || i.status !== 'skipped')).map((i) => <SheetRow key={i.id} item={i} prices={access.prices} act={actOf(i)} onPress={() => setSheet({ kind: 'item', itemId: i.id })} />)}
          </View>
        ) : null}
        {Array.from({ length: plan.days }, (_, d) => (
          <Rise key={d} step={Math.min(d + 2, 6)}>
            <DaySection plan={plan} day={d} prices={access.prices} canEdit={canEdit} showSkipped={skipped}
              onItem={(i) => setSheet({ kind: 'item', itemId: i.id })} onAdd={() => setSheet({ kind: 'add', day: d })} actOf={actOf} />
          </Rise>
        ))}
        {skippedCount ? (
          <Pressable onPress={() => setSkipped((v) => !v)} accessibilityRole="button" testID="plan-skipped" style={{ alignSelf: 'center', paddingVertical: 8 }}>
            <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{skipped ? t('plan.screen.hideSkipped') : t('plan.screen.showSkipped', { n: skippedCount })}</T>
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={sheet?.kind === 'item' && !!item} onClose={() => setSheet(null)} label={item ? itemWords(item, access.prices).main : ''}>
        {item ? <ItemSheet key={`${item.id}-${sheet?.kind === 'item' && sheet.find ? 'find' : ''}`} autoFind={sheet?.kind === 'item' && !!sheet.find} plan={plan} item={item} tripId={id} role={access.role} prices={access.prices} busy={busy} onEdit={edit} onAsk={askAbout} onClose={() => setSheet(null)} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === 'add'} onClose={() => setSheet(null)} label={t('plan.add.title', { n: sheet?.kind === 'add' ? sheet.day + 1 : 1 })}>
        {sheet?.kind === 'add' ? (
          <AddForm day={sheet.day} busy={busy} onSave={(x) => {
            const dayItems = plan.items.filter((i) => i.day === sheet.day).sort((a, b) => a.sort - b.sort);
            void edit([{ op: 'add', day: sheet.day, afterItemId: dayItems.at(-1)?.id ?? null, item: { kind: x.kind, title: x.title, at: x.at } }], x.title, `${t('plan.add.title', { n: sheet.day + 1 })}: ${x.title}`);
          }} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === 'origin'} onClose={() => setSheet(null)} label={t('plan.origin.title')}>
        {sheet?.kind === 'origin' ? <OriginForm busy={busy} onSave={(name) => { void setOrigin(name); }} /> : null}
      </Sheet>
    </TripScreen>
  );
}

function SheetRow({ item, prices, onPress, act }: { item: PlanItem; prices: boolean; onPress: () => void; act?: RowAct }) {
  const w = itemWords(item, prices);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="plan-item" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.paper, borderRadius: 16, padding: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{w.main}</T>
        {w.sub ? <T v="tiny" color={colors.ink2}>{w.sub}</T> : null}
      </View>
      {act ? <RowActTag act={act} /> : <StatusTag status={item.status} />}
    </Pressable>
  );
}

/** A destination the stay search knows (DESTINATIONS), from the item's place. */
const destinationOf = (i: PlanItem) => {
  const name = (i.place?.city || i.place?.name || '').toLowerCase();
  return Object.values(DESTINATIONS).find((d) => d.name.toLowerCase() === name || d.key === name)?.key ?? null;
};

/**
 * One item's sheet: what and when, where it stands, and what can be done from here. A booked item stays where it is
 * (the change flow moves it); priced items book from "Book what's ready"; a stay idea finds rooms for its nights.
 */
function ItemSheet({ plan, item, tripId, role, prices, busy, onEdit, onAsk, onClose, autoFind }: {
  autoFind?: boolean; plan: Plan; item: PlanItem; tripId: string; role: 'owner' | 'view' | 'suggest' | 'edit'; prices: boolean; busy: boolean;
  onEdit: (ops: PlanOp[], title: string, summary?: string) => Promise<void>; onAsk: (words: string) => void; onClose: () => void;
}) {
  const router = useRouter();
  const people = usePeople();
  const w = itemWords(item, prices);
  const booked = isBooked(item);
  const canEdit = role !== 'view' && !booked;
  const owner = role === 'owner';
  const [stays, setStays] = useState<StayOption[] | 'none' | null>(null);
  const [finding, setFinding] = useState(false);
  const up = moveOp(plan, item.id, 'up');
  const down = moveOp(plan, item.id, 'down');
  const dayWords = item.day != null ? t('chat.plan.day', { n: item.day + 1 }) : t('plan.screen.wholeTrip');
  const askWords = item.day != null ? t('plan.item.askSay', { title: w.main, n: item.day + 1 }) : t('plan.item.askSayTrip', { title: w.main });

  const findStay = async () => {
    const dest = destinationOf(item);
    const self = people.data?.find((p) => p.isSelf);
    const travellerIds = plan.travellerIds.length ? plan.travellerIds : self ? [self.id] : [];
    // A night anywhere in the world: the same instant search, by the place's name and its point when the plan has one.
    const p = item.place;
    const name = p ? [p.city || p.name, p.country].filter(Boolean).join(', ') : '';
    if ((!dest && name.length < 2) || item.day == null || !travellerIds.length) { setStays('none'); return; }
    setFinding(true);
    try {
      const place = dest ? null : { name, lat: p?.lat ?? null, lng: p?.lng ?? null };
      const r = await bookingApi.searchStays({ destination: dest ?? 'other', place, checkIn: addDays(plan.startDate, item.day), nights: Math.max(1, item.nights ?? 1), travellerIds });
      setStays(r.options.length ? r.options.slice(0, 3) : 'none');
    } catch { setStays('none'); } finally { setFinding(false); }
  };
  // "Find a stay" on the row: the sheet opens already looking (the same search as its button).
  const started = useRef(false);
  useEffect(() => {
    if (!autoFind || started.current || !owner || item.kind !== 'stay' || item.status !== 'idea' || item.priceExpired) return;
    started.current = true;
    void findStay();
  });
  const book = (o: StayOption) => {
    const self = people.data?.find((p) => p.isSelf);
    const travellerIds = plan.travellerIds.length ? plan.travellerIds : self ? [self.id] : [];
    buzz('tap');
    usePayDraft.getState().set({ draft: { kind: 'stay', stayOfferId: o.id, travellerIds, tripId, planItemIds: [item.id] }, title: o.name });
    onClose();
    router.push('/pay');
  };

  return (
    <View style={{ gap: 14 }} testID="plan-sheet">
      <View style={{ gap: 4 }}>
        <T v="tiny" color={colors.ink3}>{[dayWords, item.startsAt ? item.startsAt.slice(11, 16) : null].filter(Boolean).join(' · ')}</T>
        <T v="h2" testID="plan-sheet-title">{w.main}</T>
        {w.sub ? <T v="small" color={colors.ink2}>{w.sub}</T> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="small" color={colors.ink2}>{t('plan.item.status')}</T>
        <StatusTag status={item.status} testID="plan-sheet-status" />
        {item.booking?.ref && prices ? <T v="tiny" color={colors.ink3} selectable>{t('plan.item.ref', { ref: item.booking.ref })}</T> : null}
      </View>
      {item.place && item.kind !== 'stay' ? <T v="small" color={colors.ink2}>{`${t('plan.item.where')}: ${placeName(item.place)}`}</T> : null}
      {item.note ? <T v="small" color={colors.ink2}>{`${t('plan.item.note')}: ${item.note}`}</T> : null}
      {item.price?.demo && prices ? <DemoFare /> : null}
      {booked ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="lock" size={16} color={colors.ink3} /><T v="small" color={colors.ink2} style={{ flex: 1 }}>{t('plan.item.booked')}</T></View>
          {owner ? <Button variant="secondary" label={t('plan.item.changeBooking')} onPress={() => { onClose(); router.push(`/trip/${tripId}/change` as Href); }} testID="plan-sheet-change" /> : null}
        </View>
      ) : null}

      {/* Booking from the plan (U7): priced items from "Book what's ready", rooms for a stay's nights, or Mada. */}
      {owner && item.status === 'priced' ? <Button label={t('plan.item.book')} onPress={() => { onClose(); router.push({ pathname: '/pay', params: { plan: tripId } }); }} testID="plan-sheet-book" /> : null}
      {owner && item.priceExpired ? <Button variant="secondary" label={t('plan.item.priceAgain')} onPress={() => onAsk(t('plan.item.priceSay', { title: w.main }))} testID="plan-sheet-price-again" /> : null}
      {owner && item.kind === 'stay' && item.status === 'idea' && !item.priceExpired ? (
        stays === null ? <Button label={t('plan.item.findStay')} busy={finding} onPress={() => { buzz('tap'); void findStay(); }} testID="plan-sheet-find-stay" />
        : stays === 'none' ? (
          <View style={{ gap: 8 }}>
            <T v="small" color={colors.ink2}>{t('plan.item.noStays')}</T>
            <Button variant="secondary" label={t('plan.item.byHand')} onPress={() => onAsk(t('plan.item.bookSay', { title: w.main }))} testID="plan-sheet-by-hand" />
          </View>
        ) : (
          <View style={{ gap: 8 }} testID="plan-stays">
            <T v="small" color={colors.ink2}>{t('plan.item.stays', { nights: (item.nights ?? 1) === 1 ? t('chat.plan.night') : t('chat.plan.nights', { n: item.nights ?? 1 }) })}</T>
            {stays.map((o, i) => (
              <Pressable key={o.id} onPress={() => book(o)} accessibilityRole="button" testID={`plan-stay-${i}`}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }, pressed ? { opacity: 0.85 } : null]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{o.name}</T>
                  <T v="tiny" color={colors.ink2} numberOfLines={1}>{o.area}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{formatSar(o.total.amount)}</T>
                  <T v="tiny" color={colors.green} style={{ textDecorationLine: 'underline' }}>{t('plan.item.choose')}</T>
                </View>
              </Pressable>
            ))}
          </View>
        )
      ) : null}
      {owner && item.kind === 'leg' && item.status === 'idea' && !item.priceExpired ? <Button variant="secondary" label={t('plan.item.book')} onPress={() => onAsk(t('plan.item.bookSay', { title: w.main }))} testID="plan-sheet-book-ask" /> : null}

      <Button variant="secondary" label={t('plan.item.ask')} onPress={() => onAsk(askWords)} testID="plan-sheet-ask" />

      {canEdit ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {up ? <Chip label={t('plan.item.moveUp')} icon={(c) => <Icon name="up" size={16} color={c} />} onPress={() => { void onEdit([up], w.main, t('plan.item.moveUp') + `: ${w.main}`); }} testID="plan-sheet-up" /> : null}
            {down ? <Chip label={t('plan.item.moveDown')} icon={(c) => <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="up" size={16} color={c} /></View>} onPress={() => { void onEdit([down], w.main, t('plan.item.moveDown') + `: ${w.main}`); }} testID="plan-sheet-down" /> : null}
          </View>
          {item.day != null && plan.days > 1 ? (
            <View style={{ gap: 6 }}>
              <T v="tiny" color={colors.ink3}>{t('plan.item.moveDay')}</T>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {Array.from({ length: plan.days }, (_, d) => d).filter((d) => d !== item.day).map((d) => (
                  <Chip key={d} label={t('plan.item.moveTo', { n: d + 1 })} onPress={() => { void onEdit([{ op: 'move', itemId: item.id, day: d }], w.main, `${t('plan.item.moveTo', { n: d + 1 })}: ${w.main}`); }} testID={`plan-sheet-day-${d + 1}`} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <SmallButton tone="soft" label={item.status === 'skipped' ? t('plan.item.unskip') : t('plan.item.skip')} busy={busy}
              onPress={() => { void onEdit([{ op: item.status === 'skipped' ? 'unskip' : 'skip', itemId: item.id }], w.main, `${item.status === 'skipped' ? t('plan.item.unskip') : t('plan.item.skip')}: ${w.main}`); }} testID="plan-sheet-skip" />
            <SmallButton tone="ghost" label={t('plan.item.remove')} busy={busy} onPress={() => { void onEdit([{ op: 'remove', itemId: item.id }], w.main, `${t('plan.item.remove')}: ${w.main}`); }} testID="plan-sheet-remove" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
