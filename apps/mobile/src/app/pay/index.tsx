import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CARRIERS, RENEWAL_DAYS, formatSar, householdOf, normalizeContactPhone, personName, shortDay, todayIn, type BookingLoyalty, type BookingPrefs, type OrderPreview, type PayPlan } from '@mada/shared';
import { circlesApi } from '@/lib/circles';
import { Button, LinkButton } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { PayMark } from '@/components/PayMark';
import { Sheet } from '@/components/Sheet';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { T } from '@/components/Text';
import { ApplePaySheet, CardsSheet, ThreeDsSheet, type PayMethod } from '@/components/booking/PaySheets';
import { ChipWrap, Notice, Photo, useNow } from '@/components/booking/parts';
import { TravellerChips } from '@/components/booking/Travellers';
import { PhoneSheet, usePhoneNeeded } from '@/components/booking/PhoneSheet';
import { HotelRequestsField, NO_HOTEL_REQUESTS } from '@/components/booking/HotelRequests';
import { TravellerPassports } from '@/components/passport/TravellerPassports';
import { AskSomeoneSheet, ExtrasCard, LoyaltyRow, LoyaltySheet, PrefsRow, PrefsSheet } from '@/components/booking/PrefsRows';
import { Approx } from '@/components/wallet/Approx';
import { ApiError } from '@/lib/api';
import { useBookingNeedsPhone } from '@/lib/beta';
import { bookingApi, bookingKeys, demoOn, newIdempotencyKey, useBookingRequest, useDemo, useInvalidateBooking, usePayDraft, type PayDraft } from '@/lib/booking';
import { HAS_APPLE_PAY } from '@/lib/device';
import { SHOW_DEMO_HINTS, SHOW_DEMO_SWITCHES } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { listSep, t, tn } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useCards } from '@/lib/wallet';
import { useBookingBack } from '@/lib/hardware-back';
import { travelEnds } from '@/lib/travel-ends';
import { colors, font, radii, ff } from '@/theme';

/*
 * The order sheet (Pay.jsx): lines, the all-in total, the cancellation rule from the dates, who's travelling, passports
 * still missing, promo codes, Mada credit, how to pay (cards, Apple Pay, Tabby, Tamara), the price hold, and slide to
 * book. The server prices everything; the slide sends the total the traveller saw. Card numbers go to the provider.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
type SheetName = null | 'people' | 'cards' | 'offline' | 'declined' | 'price' | 'blocked' | '3ds' | 'applepay' | 'prefs' | 'loyalty' | 'payer';

export default function Pay() {
  const router = useRouter();
  const qc = useQueryClient();
  const invalidate = useInvalidateBooking();
  const { height } = useWindowDimensions();
  const bottom = useBottomInset();
  const stored = usePayDraft((s) => s.current);
  // Opened by a link from another screen: a circle share (Circles), or a quote to pay (Trips, the itinerary).
  const params = useLocalSearchParams<{ kind?: string; circleId?: string; messageId?: string; shareKey?: string; title?: string; requestId?: string }>();
  const linked = useMemo<PayDraft | null>(() => {
    if (params.kind === 'share' && params.circleId && params.messageId && params.shareKey) {
      return { draft: { kind: 'share', circleId: params.circleId, messageId: params.messageId, shareKey: params.shareKey }, title: params.title ?? '' };
    }
    if (params.requestId) return { draft: { kind: 'quote', requestId: params.requestId }, title: '' };
    return null;
  }, [params.kind, params.circleId, params.messageId, params.shareKey, params.title, params.requestId]);
  const pd = linked ?? stored;
  const share = pd?.draft.kind === 'share' ? pd.draft : null;
  // A quote opened again after it was paid (a notification, a reload): say so, never a SAR 0 slide to book.
  const quoteId = pd?.draft.kind === 'quote' ? pd.draft.requestId : null;
  const quoteReq = useBookingRequest(quoteId);
  /** Back where the traveller came from, or Trips when this was opened on its own (a link, a reload). */
  const leave = (to: string = '/trips?tab=requests') => { if (router.canGoBack()) router.back(); else router.replace(to as never); };
  const demo = useDemo((s) => s.on);
  const user = useSession((s) => s.user);
  const people = usePeople();
  const cards = useCards();
  const now = useNow(1000);
  const initialTravellers = pd && 'travellerIds' in pd.draft ? pd.draft.travellerIds ?? [] : [];
  const [travellers, setTravellers] = useState<string[]>(initialTravellers);
  const [promo, setPromo] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [useCredit, setUseCredit] = useState(true);
  const [chosen, setMethod] = useState<PayMethod | null>(null);
  const [plan, setPlan] = useState<PayPlan>('full');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState(false);
  // Android back: never mid-payment, and never out of the app from a booking opened by a link (lib/hardware-back.ts).
  useBookingBack({ busy, canGoBack: router.canGoBack, onLeave: () => leave() });
  const [attempt, setAttempt] = useState(0); // remounts the slider so the sun goes home after a try that stays here
  const [holdSkip, setHoldSkip] = useState(0);
  // After the hold ended and the price was checked again: what it was and what it is now, said once on the sheet.
  const [moved, setMoved] = useState<{ was: number; now: number; key: string } | null>(null);
  const [acceptedState, setAcceptedState] = useState<{ key: string; preview: OrderPreview } | null>(null);
  const [blocked, setBlocked] = useState('');
  const [threeDs, setThreeDs] = useState<{ orderId: string; triesLeft: number; stopped: boolean; amount: number } | null>(null);
  // Preferences, loyalty numbers and paid extras for this booking only (owner audit items 5, 6): null means the saved
  // ones, as the server applies them; the extra is off every time until the traveller adds it on this sheet.
  const [prefs, setPrefs] = useState<BookingPrefs | null>(null);
  const [loyalty, setLoyalty] = useState<BookingLoyalty[] | null>(null);
  const [seatsTogether, setSeatsTogether] = useState(false);
  const [payer, setPayer] = useState<{ userId: string; circleId: string; name: string } | null>(null);
  const key = useRef(newIdempotencyKey());
  // The beta: an account without a verified phone gives a number to reach them (GET /config bookingNeedsPhone off).
  const needsPhone = useBookingNeedsPhone();
  const askContact = !!user && !user.phone && !needsPhone;
  const [contact, setContact] = useState('');
  const [contactErr, setContactErr] = useState<string | null>(null);
  // Booking needs a verified phone and this account has none (Ask asks earlier; a quote paid from a link lands here):
  // said up front, verified in a sheet over the order, and the slide carries on after it.
  const phoneNeeded = usePhoneNeeded();
  const [phoneOpen, setPhoneOpen] = useState(false);
  // The footer (slide or hold-ended card, and the note under it) is solid and measured: the list scrolls clear of it.
  const [footH, setFootH] = useState(170);

  const draft = useMemo(() => {
    if (!pd) return null;
    const d = pd.draft;
    return 'travellerIds' in d ? { ...d, travellerIds: travellers } : d;
  }, [pd, travellers]);
  const flags = [...demo].sort().join(',');
  // A room: what to tell the hotel. Kept out of the preview (no price in it) and sent with the order.
  const [hotelAsks, setHotelAsks] = useState(NO_HOTEL_REQUESTS);
  const applied = useMemo(() => ({ ...(prefs ? { prefs } : null), ...(loyalty ? { loyalty } : null), extras: { seatsTogether } }), [prefs, loyalty, seatsTogether]);
  const previewQ = useQuery({
    queryKey: ['booking', 'preview', draft, promo, useCredit, flags, applied],
    enabled: !!draft,
    placeholderData: (p) => p,
    queryFn: async () => (await bookingApi.preview({ draft: draft!, promo, useCredit, ...applied })).preview,
  });
  // A price the traveller accepted after it moved holds until they change what they're booking.
  const choiceKey = `${travellers.join()}|${promo}|${useCredit}|${seatsTogether}|${JSON.stringify(prefs)}|${JSON.stringify(loyalty)}`;
  const accepted = acceptedState?.key === choiceKey ? acceptedState.preview : null;
  const setAccepted = (pv: OrderPreview | null) => setAcceptedState(pv ? { key: choiceKey, preview: pv } : null);
  const p = accepted ?? previewQ.data;
  // The default way to pay: the default card, else Apple Pay.
  const def = cards.data?.cards.find((c) => c.id === cards.data!.defaultId);
  // Apple Pay only on an iPhone; elsewhere the default card, or the traveller adds one.
  const method: PayMethod | null = chosen ?? (!cards.data ? null : def ? { kind: 'card', id: def.id, label: def.label, brand: def.brand } : HAS_APPLE_PAY ? { kind: 'applepay', label: 'Apple Pay', brand: 'applepay' } : null);

  if (!pd || !draft) {
    return (
      <Screen><TopBar onBack={() => leave()} /><View style={{ padding: 24 }}><Notice title={t('pay.missing')} /></View></Screen>
    );
  }
  const qr = quoteReq.data;
  const paid = !!qr && (qr.status === 'paid' || qr.status === 'done' || qr.quote?.status === 'accepted');
  // An expired hold keeps its own "ask again" line below; a paid, cancelled or withdrawn quote has nothing to pay.
  const closed = !!qr && (paid || qr.status === 'cancelled' || !qr.quote || qr.quote.status === 'withdrawn');
  if (quoteId && qr && closed && !busy) {
    return (
      <Screen>
        <TopBar onBack={() => leave()} />
        <View style={{ padding: 24, gap: 14 }} testID={paid ? 'pay-already-paid' : 'pay-quote-gone'}>
          <Notice icon={paid ? 'check' : 'visa'} iconColor={paid ? colors.ok : colors.goldInk} title={paid ? t('pay.paid.title') : t('pay.gone.title')}>
            <T v="small">{qr.title}</T>
            <T v="small">{paid ? t('pay.paid.body') : t('pay.gone.body')}</T>
          </Notice>
          {paid ? <Button label={t('pay.paid.see')} onPress={() => router.replace('/trips?tab=requests' as never)} testID="pay-paid-trips" />
            : <Button label={t('pay.gone.open')} onPress={() => router.replace({ pathname: '/ask/request/[id]', params: { id: qr.id } })} />}
        </View>
      </Screen>
    );
  }

  const total = p?.total.amount ?? 0;
  const hold = p?.holdExpiresAt ? Date.parse(p.holdExpiresAt) : null;
  const left = hold ? Math.max(0, hold - now - holdSkip) : null;
  const expired = left === 0;
  const isApple = method?.kind === 'applepay';
  const canSplit = !!p?.instalments && !isApple;
  const effPlan: PayPlan = canSplit ? plan : 'full';
  const charge = effPlan === 'tabby' ? p?.instalments?.tabby.amount ?? total : effPlan === 'tamara' ? p?.instalments?.tamara.amount ?? total : total;
  const slideLabel = payer ? t('mp.send', { name: payer.name, price: formatSar(total) }) : total === 0 ? t('pay.slideCredit') : effPlan === 'tabby' ? t('pay.slideTabby', { price: formatSar(charge) }) : effPlan === 'tamara' ? t('pay.slideTamara', { price: formatSar(charge) }) : p?.agent === false ? t('pay.slidePay', { price: formatSar(total) }) : t('pay.slide', { price: formatSar(total) });
  const household = people.data ?? [];
  const H = householdOf(household, todayIn());
  const selfName = user?.name ?? '';
  const hasPeople = 'travellerIds' in pd.draft;

  const tryCode = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setCodeErr(null); return; }
    try {
      const out = (await bookingApi.preview({ draft, promo: c, useCredit, ...applied })).preview;
      if (out.promo?.status === 'applied') { setPromo(c); setCodeErr(null); setPromoOpen(false); buzz('success'); }
      else setCodeErr(`${out.promo?.message ?? t('pay.promo.unknown')}${out.promo?.status === 'unknown' && SHOW_DEMO_HINTS ? ` (${t('pay.promo.demo')})` : ''}`);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };

  /** The server already marked the share paid; this tells Circles too (a no-op if done) and refreshes the chat. */
  const settleShare = async (sh: { circleId: string; messageId: string; shareKey: string }) => {
    try { await circlesApi.paid(sh.circleId, sh.messageId, { key: sh.shareKey, via: 'card' }); } catch { /* the server settled it; the chat catches up on its next read */ }
    await qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes(sh.circleId) });
  };

  const place = async (payment: Parameters<typeof bookingApi.createOrder>[0]['payment'], expected = total) => {
    const sent = draft.kind === 'stay' ? { ...draft, requests: hotelAsks } : draft;
    // Short passports Mada renews in time, not asked yet: asked with this order, so the booking goes ahead.
    const renew = (p?.renewals ?? []).filter((r) => r.inTime && !r.asked).map((r) => r.personId);
    const out = await bookingApi.createOrder({ draft: sent, promo, useCredit, ...applied, payment, plan: effPlan, expectedTotal: expected, idempotencyKey: key.current, ...(askContact ? { contactPhone: contact.trim() } : null), ...(renew.length ? { renewals: renew } : null) });
    key.current = newIdempotencyKey();
    // A friend was asked to pay: nothing charged; the booking waits on the With Mada screen, and Trips shows it.
    if (out.outcome === 'payment_requested') { buzz('success'); await invalidate(); qc.setQueryData(bookingKeys.order(out.order.id), out.order); toast(t('mp.sent', { name: out.order.payRequest?.name ?? '' })); router.replace({ pathname: '/waiting/[id]', params: { id: out.order.id } }); return; }
    // The waiting screen opens on the order we already have, not a blank screen until its first poll answers.
    if (out.outcome === 'created') { buzz('knock'); await invalidate(); qc.setQueryData(bookingKeys.order(out.order.id), out.order); router.replace({ pathname: '/waiting/[id]', params: { id: out.order.id } }); return; }
    if (out.outcome === 'paid') {
      buzz('success'); invalidate(); usePayDraft.getState().clear();
      if (share) await settleShare(share);
      // An eSIM: straight to installing it (or, for a top-up, back to the eSIM); a refund shows there as an outcome.
      if (pd.draft.kind === 'esim' && (pd.draft.packageId || pd.draft.topupOf)) {
        void qc.invalidateQueries({ queryKey: ['esim'] });
        if (pd.draft.topupOf) { router.replace({ pathname: '/esim/[id]', params: { id: pd.draft.topupOf } }); toast(out.order.status === 'cancelled' ? t('es.refunded.title') : t('es.topupToast')); }
        else router.replace({ pathname: '/esims', params: { order: out.order.id } });
        return;
      }
      leave();
      toast(share ? t('pay.shareToast') : pd.draft.kind === 'esim' ? t('pay.esimToast') : t('pay.paidToast'));
      return;
    }
    if (out.outcome === 'requires_action') { setThreeDs({ orderId: out.order.id, triesLeft: out.order.action?.triesLeft ?? 3, stopped: false, amount: charge }); setSheet('3ds'); buzz('knock'); return; }
    if (out.outcome === 'declined') { setSheet('declined'); buzz('soft'); return; }
    if (out.outcome === 'price_changed') { setAccepted(out.preview); setSheet('price'); buzz('soft'); return; }
    if (out.outcome === 'hold_ended') { setHoldSkip(24 * 3600_000); return; }
    setBlocked(out.message); setSheet('blocked'); buzz('soft');
  };

  const confirm = async () => {
    // Read from the session, not this render: right after the sheet verifies the number, the slide carries on.
    if (phoneNeeded && !useSession.getState().user?.phone) { setPhoneOpen(true); buzz('soft'); setAttempt((a) => a + 1); return; }
    if (askContact && !normalizeContactPhone(contact)) {
      setContactErr(contact.trim() ? t('beta.contact.invalid') : t('beta.contact.needed')); buzz('warn'); setAttempt((a) => a + 1);
      return;
    }
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 900));
      if (demoOn('offline')) { setSheet('offline'); buzz('soft'); return; }
      if (total === 0) { await place({ method: 'credit' }); return; }
      if (payer) { await place({ method: 'someone_else', userId: payer.userId, circleId: payer.circleId }); return; }
      if (isApple) { setSheet('applepay'); return; }
      if (!method) { setSheet('cards'); return; }
      if (method?.kind === 'new_card') await place({ method: 'new_card', token: method.token, brand: method.brand, last4: method.last4 });
      else if (method?.kind === 'card') await place({ method: 'card', cardId: method.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') { setSheet('offline'); buzz('soft'); }
      else if (e instanceof ApiError && e.code === 'PHONE_REQUIRED') { setPhoneOpen(true); buzz('soft'); }
      else if (e instanceof ApiError && e.code === 'VALIDATION' && askContact) { setContactErr(e.message); buzz('warn'); }
      else toast(e instanceof Error ? e.message : t('error.internal'));
    } finally { setBusy(false); setAttempt((a) => a + 1); }
  };

  const recheck = async () => {
    buzz('tap');
    const offerId = pd.draft.kind === 'trip' ? pd.draft.flightOfferId : pd.draft.kind === 'stay' ? pd.draft.stayOfferId : null;
    try {
      const r = offerId ? await bookingApi.reprice(offerId) : null;
      setHoldSkip(0); setAccepted(null);
      setMoved(r?.changedBy ? { was: total, now: total + r.changedBy, key: `${travellers.join()}|${useCredit}|${plan}` } : null);
      await qc.invalidateQueries({ queryKey: ['booking', 'preview'] });
      toast(r?.changedBy ? t('pay.recheckMoved', { price: formatSar(Math.abs(r.changedBy)) }) : t('pay.recheckSame'));
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };

  const otp = async (c: string) => {
    if (!threeDs) return;
    const { order } = await bookingApi.otp(threeDs.orderId, c);
    if (order.status === 'pending_agent') { setSheet(null); buzz('success'); await invalidate(); qc.setQueryData(bookingKeys.order(order.id), order); router.replace({ pathname: '/waiting/[id]', params: { id: order.id } }); return; }
    if (order.status === 'confirmed') { setSheet(null); buzz('success'); invalidate(); if (share) await settleShare(share); leave(); toast(share ? t('pay.shareToast') : t('pay.paidToast')); return; }
    if (order.status === 'declined') { setThreeDs({ ...threeDs, stopped: true, triesLeft: 0 }); buzz('warn'); return; }
    setThreeDs({ ...threeDs, triesLeft: order.action?.triesLeft ?? 0 }); buzz('warn');
  };

  const names = travellers.map((id) => personName(household.find((x) => x.id === id), selfName));
  const missing = (p?.missingPassports ?? []).map((id) => household.find((x) => x.id === id)).filter(Boolean);
  const holdText = left === null ? null : expired ? t('pay.holdEnded') : t('pay.heldFor', { time: left >= 3_600_000 ? `${Math.floor(left / 3_600_000)}:${String(Math.floor((left % 3_600_000) / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` });

  return (
    <Screen background={colors.night}>
      <View style={styles.hero}>
        <Photo name={p?.photo ?? (pd.draft.kind === 'quote' ? 'inflight-window' : 'istanbul-galata')} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,26,22,0.45)' }]} />
      </View>
      <TopBar onBack={() => router.back()} dark backLabel={t('pay.back')} />
      <Animated.View entering={FadeInDown.duration(500)} style={[styles.sheet, { top: 150, height: height - 150 }]}>
        <View style={styles.grab} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: footH + 24, gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.spread}>
            <T style={[font('displaySmall'), { flex: 1 }]} accessibilityRole="header">{p?.title ?? pd.title}</T>
            {holdText ? <View style={[styles.pill, expired ? null : styles.pillOk]} accessibilityLiveRegion="polite"><T v="caption" color={expired ? colors.green : colors.ok} style={{ fontFamily: ff.ui600, fontVariant: ['tabular-nums'] }}>{holdText}</T></View> : null}
          </View>
          {(p?.lines ?? []).map((l) => (
            <View key={l.key + l.text} style={styles.spread}>
              <View style={[styles.row, { flex: 1 }]}><Icon name={l.icon as IconName} size={20} /><T v="callout" color={colors.green} style={{ flex: 1, fontSize: 15 }}>{l.text}</T></View>
              <T v="small" color={colors.green} style={{ fontVariant: ['tabular-nums'] }}>{formatSar(l.amount, { bare: true })}</T>
            </View>
          ))}
          {/* The family, said again before paying: bags each, a bassinet, child meals, and why a 13-year-old is an adult fare. */}
          {p?.family ? <FamilyLines f={p.family} /> : null}
          {hasPeople ? (
            <View style={styles.well}>
              <T v="small" style={{ flex: 1 }}>{travellers.length === 1 && travellers[0] === H.me ? t('pay.justYou') : names.join(listSep())}</T>
              <LinkButton label={t('pay.edit')} onPress={() => setSheet('people')} />
            </View>
          ) : null}
          {/* What Mada applies from the saved preferences, the loyalty number the booking earns on, and a paid extra the fare prices: each changeable here, for this booking only. */}
          {p?.applied ? <PrefsRow applied={p.applied} changed={!!prefs} onChange={() => setSheet('prefs')} /> : null}
          {p?.applied ? <LoyaltyRow applied={p.applied} onEdit={() => setSheet('loyalty')} /> : null}
          {p?.applied?.extrasOffer ? <ExtrasCard offer={p.applied.extrasOffer} airline={p.applied.extrasOffer.airline ?? CARRIERS[p.applied.extrasOffer.carrier ?? '']?.name ?? ''} onToggle={(on) => { setSeatsTogether(on); setAccepted(null); }} /> : null}
          {p?.promo?.status === 'applied' ? (
            <View style={styles.spread}>
              <View style={styles.row}><Icon name="star" size={20} /><T v="callout" color={colors.green} style={{ fontSize: 15 }}>{t('pay.promo.line', { code: p.promo.code })}</T><LinkButton label={t('pay.promo.remove')} size={13} onPress={() => { setPromo(null); setCode(''); }} /></View>
              <T v="small" color={colors.ok}>−{formatSar(p.promo.discount.amount, { bare: true })}</T>
            </View>
          ) : null}
          {p && !share && p.credit.balance.amount > 0 ? (
            <View style={styles.spread}>
              <View style={styles.row}><PayMark brand="credit" size={20} /><T v="callout" color={colors.green} style={{ fontSize: 15 }}>{t('pay.credit', { price: formatSar(p.credit.balance.amount) })}</T></View>
              <View style={styles.row}>
                {p.credit.used.amount > 0 ? <T v="small" color={colors.ok}>−{formatSar(p.credit.used.amount, { bare: true })}</T> : null}
                <Pressable accessibilityRole="switch" accessibilityLabel={t('pay.credit.use')} accessibilityState={{ checked: useCredit }} onPress={() => { buzz('select'); setUseCredit(!useCredit); }} style={[styles.switch, useCredit ? { backgroundColor: colors.gold } : null]} testID="credit-toggle">
                  <View style={[styles.knob, useCredit ? { alignSelf: 'flex-end' } : null]} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {!share && p?.promo?.status !== 'applied' ? (promoOpen ? (
            <View style={{ gap: 6 }}>
              <View style={styles.row}>
                <TextInput accessibilityLabel={t('pay.promo.label')} placeholder={t('pay.promo.label')} placeholderTextColor={colors.muted} value={code} autoCapitalize="characters" onChangeText={(v) => { setCode(v); setCodeErr(null); }}
                  style={[styles.input, codeErr ? { borderColor: colors.bad } : null, webNoOutline]} testID="promo-input" />
                <Button size="small" block={false} variant="secondary" style={{ backgroundColor: colors.mist }} label={t('pay.promo.apply')} onPress={tryCode} testID="promo-apply" />
              </View>
              {codeErr ? <T v="small" color={colors.badInk} accessibilityRole="alert">{codeErr}</T> : null}
            </View>
          ) : <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('pay.promo.open')} onPress={() => setPromoOpen(true)} /></View>) : null}
          {/* Passports inside the booking (flights, packages, visas, Umrah): each traveller's, added or checked right here. */}
          <TravellerPassports kind={pd.draft.kind === 'quote' ? qr?.kind : pd.draft.kind} people={household} travellerIds={p?.travellerIds ?? (hasPeople ? travellers : qr?.travellerIds ?? [])}
            travelEnds={travelEnds(qc, pd.draft, qr)} selfName={selfName} note={missing.length ? t('pay.passports.body') : null} renewals={p?.renewals} />
          {/* A passport too short for the trip: Mada renews it alongside, or that person stays home. Never a dead end. */}
          {(p?.renewals ?? []).filter((r) => !r.asked || !r.inTime).map((r) => (
            <View key={r.personId} style={styles.renew} testID={`pay-renewal-${r.personId}`}>
              <T v="eyebrow">{t('rn.eyebrow')}</T>
              <T v="h3" style={{ fontSize: 15 }}>{t('rn.step', { name: r.name })}</T>
              <T v="small" color={r.inTime ? colors.green : colors.goldInk}>{r.inTime ? t('rn.by', { date: shortDay(r.by) }) : t('rn.late', { days: RENEWAL_DAYS, date: shortDay(r.by) })}</T>
              {r.inTime ? <T v="tiny">{t('rn.cost', { price: formatSar(r.fee) })} {t('rn.payNote')}</T> : <T v="tiny">{t('rn.lateNext', { name: r.name })}</T>}
              {r.inTime ? <T v="tiny">{t('rn.alongside')}</T> : null}
              {hasPeople && travellers.length > 1 ? <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('rn.without', { name: r.name })} onPress={() => { buzz('select'); setTravellers((x) => x.filter((id) => id !== r.personId)); }} testID={`pay-without-${r.personId}`} /></View> : null}
            </View>
          ))}
          {phoneNeeded ? (
            <Notice icon="phone" title={t('ask.phone.payTitle')}>
              <T v="small">{t('ask.phone.payBody')}</T>
              <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('auth.verifyPhone.go')} onPress={() => setPhoneOpen(true)} testID="pay-phone-open" /></View>
            </Notice>
          ) : null}
          {askContact ? (
            <View style={[styles.well, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]} testID="pay-contact">
              <T v="h3" style={{ fontSize: 15 }}>{t('beta.contact.title')}</T>
              <T v="small">{t('beta.contact.body')}</T>
              <TextInput accessibilityLabel={t('beta.contact.label')} placeholder={t('beta.contact.hint')} placeholderTextColor={colors.muted} value={contact} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
                onChangeText={(v) => { setContact(v); setContactErr(null); }} onBlur={() => { if (contact.trim() && !normalizeContactPhone(contact)) setContactErr(t('beta.contact.invalid')); }}
                style={[styles.input, { flex: 0, textAlign: 'left', writingDirection: 'ltr' }, contactErr ? { borderColor: colors.bad } : null, webNoOutline]} testID="pay-contact-input" />
              {contactErr ? <T v="small" color={colors.badInk} accessibilityRole="alert">{contactErr}</T> : <T v="tiny">{t('beta.contact.note')}</T>}
            </View>
          ) : null}
          {pd.draft.kind === 'stay' ? <HotelRequestsField value={hotelAsks} onChange={setHotelAsks} /> : null}
          <View style={styles.divider} />
          <View style={{ gap: 2 }}>
            <T style={styles.total} testID="pay-total">{formatSar(total)}</T>
            {moved && moved.key === `${travellers.join()}|${useCredit}|${plan}` ? (
              <T v="small" color={moved.now < moved.was ? colors.ok : colors.goldInk} style={{ fontFamily: ff.ui600 }} testID="pay-price-moved">
                {t(moved.now < moved.was ? 'pay.price.down' : 'pay.price.up', { price: formatSar(moved.now), was: formatSar(moved.was) })}
              </T>
            ) : null}
            <Approx amount={total} testID="pay-approx" />
            {/* A room: the same facts as on its card, said again before paying (nothing new at the last step). */}
            {share ? null : <T v="small" testID="pay-all-in">{p?.stay?.payAtHotel ? t('pay.plusTax', { amount: formatSar(p.stay.payAtHotel.amount, { bare: true }) }) : t('pay.allIn')}</T>}
            {p?.stay ? (
              <View style={{ gap: 4, marginTop: 4 }} testID="pay-stay-rule">
                <View style={styles.row}>
                  <Icon name={p.stay.refundable ? 'check' : 'refund'} size={16} color={p.stay.refundable ? colors.ok : colors.ink3} />
                  <T v="small" color={p.stay.refundable ? colors.ok : colors.ink2} style={{ flex: 1 }}>{p.stay.refundable ? (p.stay.freeCancelUntil ? t('hotel.cancelFree', { date: shortDay(p.stay.freeCancelUntil) }) : t('stay.freeCancelAny')) : t('pay.stayNoRefund')}</T>
                </View>
                {p.stay.essentials ? <T v="tiny">{t('hb.essential', { text: p.stay.essentials })}</T> : null}
              </View>
            ) : <T v="small">{p?.rule ?? ''}</T>}
          </View>
          <View style={styles.spread}>
            <View style={styles.row}>
              {total === 0 ? <><PayMark brand="credit" /><T v="callout" color={colors.green} style={{ fontFamily: ff.ui500, fontSize: 15 }}>{t('pay.paidCredit')}</T></>
                : payer ? <><Icon name="user" size={22} color={colors.green} /><T v="callout" color={colors.green} style={{ fontFamily: ff.ui500, fontSize: 15 }} testID="pay-payer">{t('mp.method', { name: payer.name })}</T></>
                : <><PayMark brand={method?.brand ?? 'card'} /><T v="callout" color={colors.green} style={{ fontFamily: ff.ui500, fontSize: 15 }}>{method?.label ?? (cards.data ? t('pay.method.add') : '')}</T></>}
            </View>
            <LinkButton label={t('pay.change')} onPress={() => { setPayer(null); setSheet('cards'); }} />
          </View>
          {/* Plainly: what is charged and in which currency. The display currency above is only a guide. */}
          {total > 0 && !payer ? <T v="tiny" testID="pay-charged">{t('fx.charged', { amount: formatSar(total) })}{p?.agent === false ? '' : ` ${t('fx.chargedCard')}`}</T> : null}
          {total > 0 && !share && p?.agent !== false && hasPeople && !payer && !p?.credit.used.amount ? <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('mp.ask')} onPress={() => setSheet('payer')} testID="pay-ask-someone" /></View> : null}
          {canSplit ? (
            <ChipWrap>
              {([['full', t('pay.plan.full')], ['tabby', t('pay.plan.tabby', { price: formatSar(p!.instalments!.tabby.amount, { bare: true }) })], ['tamara', t('pay.plan.tamara', { price: formatSar(p!.instalments!.tamara.amount, { bare: true }) })]] as const).map(([id, label]) => (
                <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: plan === id }} onPress={() => { buzz('select'); setPlan(id); }} style={[styles.planChip, plan === id ? { backgroundColor: colors.green } : null]} testID={`plan-${id}`}>
                  {id !== 'full' ? <PayMark brand={id} size={16} /> : null}
                  <T style={[font('h3', plan === id ? colors.mist : colors.green), { fontSize: 15 }]}>{label}</T>
                </Pressable>
              ))}
            </ChipWrap>
          ) : null}
        </ScrollView>
      </Animated.View>
      <View style={[styles.act, { paddingBottom: 18 + bottom }]} onLayout={(e) => setFootH(Math.ceil(e.nativeEvent.layout.height))} testID="pay-footer">
        {expired && pd.draft.kind === 'quote' ? <T v="small" color={colors.goldInk} style={{ textAlign: 'center' }} testID="pay-quote-ended">{t('beta.fq.ended', { agent: 'Mada' })}</T> : expired ? (
          <View style={styles.ended} testID="pay-hold-ended" accessibilityLiveRegion="polite">
            <T v="h3" style={{ fontSize: 16 }}>{t('pay.hold.endedTitle')}</T>
            <T v="small">{t('pay.hold.endedBody')}</T>
            <Button label={t('pay.recheck')} onPress={recheck} testID="pay-recheck" />
          </View>
        ) : (
          <SlideToConfirm key={attempt} label={slideLabel} busy={busy} busyLabel={t('pay.busy')} disabled={!p || previewQ.isFetching && !p} onConfirm={confirm} />
        )}
        <T v="tiny" style={{ textAlign: 'center' }}>
          {p?.agent === false ? t('pay.nowNote') : t('pay.agentNote')}
          {SHOW_DEMO_SWITCHES && hold ? <T v="tiny" style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }} onPress={() => setHoldSkip(24 * 3600_000)}> {t('pay.demoHold')}</T> : null}
        </T>
      </View>

      <PhoneSheet visible={phoneOpen} why={t('ask.phone.payBody')} onClose={() => setPhoneOpen(false)} onDone={() => { setPhoneOpen(false); void confirm(); }} />
      <Sheet visible={sheet === 'people'} label={t('pay.people.title')} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.people.title')}</T>
        <TravellerChips people={household} value={travellers} onChange={setTravellers} selfName={selfName} />
        <T v="small">{t('pay.people.note')}</T>
        <Button label={t('pay.people.done', { price: formatSar(total) })} onPress={() => setSheet(null)} />
      </Sheet>
      {p?.applied ? <PrefsSheet visible={sheet === 'prefs'} value={prefs ?? p.applied.prefs} scope={p.applied.scope} saved={p.applied.prefs} onClose={() => setSheet(null)} onSave={(v) => { setPrefs(v); setAccepted(null); setSheet(null); }} /> : null}
      {p?.applied ? <LoyaltySheet visible={sheet === 'loyalty'} applied={p.applied} people={household} travellerIds={p.travellerIds} selfName={selfName} onClose={() => setSheet(null)} onSave={(l) => { setLoyalty(l); setSheet(null); }} /> : null}
      <AskSomeoneSheet visible={sheet === 'payer'} price={total} onClose={() => setSheet(null)} onPick={(who) => { buzz('success'); setPayer(who); setUseCredit(false); setPlan('full'); setSheet(null); }} />
      {sheet === 'cards' ? <CardsSheet visible current={method} credit={share ? 0 : p?.credit.balance.amount ?? 0} onPick={(m) => { setMethod(m); setSheet(null); }} onClose={() => setSheet(null)} /> : null}
      <Sheet visible={sheet === 'offline'} label={t('pay.offline.title')} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.offline.title')}</T>
        <T v="body">{t('pay.offline.body')}</T>
        <Button label={t('common.okay')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === 'declined'} label={t('pay.declined.title')} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.declined.title')}</T>
        <T v="body">{t('pay.declined.body')}</T>
        <Button label={t('pay.declined.other')} onPress={() => setSheet('cards')} testID="declined-other" />
        <Button variant="ghost" label={t('common.tryAgain')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === 'price'} label={t('pay.price.title', { price: '' })} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.price.title', { price: formatSar(Math.max(0, (accepted?.total.amount ?? 0) - (previewQ.data?.total.amount ?? 0))) })}</T>
        <T v="body">{t('pay.price.body')}</T>
        <Button label={t('pay.price.accept', { price: formatSar(accepted?.total.amount ?? total) })} testID="price-accept" onPress={async () => {
          setSheet(null); setBusy(true);
          try { await place(method?.kind === 'card' ? { method: 'card', cardId: method.id } : method?.kind === 'new_card' ? { method: 'new_card', token: method.token, brand: method.brand, last4: method.last4 } : { method: 'applepay', token: `applepay_mock_${key.current}` }, accepted?.total.amount); }
          catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
        }} />
        <Button variant="ghost" label={t('pay.price.other')} onPress={() => { setSheet(null); router.back(); }} />
      </Sheet>
      <Sheet visible={sheet === 'blocked'} label={t('pay.blocked.title')} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.blocked.title')}</T>
        <T v="body">{blocked}</T>
        <Button label={t('common.back')} onPress={() => { setSheet(null); router.back(); }} />
      </Sheet>
      {sheet === 'applepay' ? <ApplePaySheet visible amount={total} what={p?.title ?? pd.title} onClose={() => { setSheet(null); toast(t('pay.cancelled')); }}
        onDone={async () => { setSheet(null); setBusy(true); try { await place({ method: 'applepay', token: `applepay_mock_${key.current}` }); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); } }} /> : null}
      {threeDs && sheet === '3ds' ? (
        <ThreeDsSheet visible label={method?.label ?? ''} brand={method?.brand ?? 'card'} amount={threeDs.amount} triesLeft={threeDs.triesLeft} stopped={threeDs.stopped}
          onCode={otp} onOther={() => setSheet('cards')} onClose={() => { setSheet(null); toast(t('pay.cancelled')); }}
          onResend={async () => {
            try { await bookingApi.answer(threeDs.orderId, 'resend_code'); return true; }
            catch (e) { if (e instanceof ApiError && e.code === 'RATE_LIMITED') return false; toast(e instanceof Error ? e.message : t('error.internal')); return true; }
          }}
          onTalk={() => { setSheet(null); router.push('/support?topic=other' as Href); }} />
      ) : null}
    </Screen>
  );
}

/** "Bags 2 × 23 kg each · bassinet requested · child meals × 2", and who 12 to 17 pays as an adult, and why. */
function FamilyLines({ f }: { f: NonNullable<OrderPreview['family']> }) {
  const bits = [f.bags ? t('pf.bags', { bags: f.bags }) : null, f.bassinets ? tn('pf.bassinet', f.bassinets) : null, f.childMeals ? t('pf.meals', { count: f.childMeals }) : null].filter(Boolean);
  if (!bits.length && !f.adultFares.length) return null;
  return (
    <View style={{ gap: 4 }} testID="pay-family">
      {bits.length ? <View style={styles.row}><Icon name="bag" size={20} /><T v="small" color={colors.green} style={{ flex: 1 }} testID="pay-family-line">{bits.join(' · ')}</T></View> : null}
      {f.adultFares.map((a) => <T key={a.personId} v="tiny" style={{ paddingStart: 30 }} testID={`pay-adult-fare-${a.personId}`}>{t('pf.adultFare', { name: a.name, age: a.age })}</T>)}
    </View>
  );
}

const styles = StyleSheet.create({
  renew: { gap: 4, padding: 14, borderRadius: 18, backgroundColor: colors.warnWash },
  hero: { position: 'absolute', start: 0, end: 0, top: 0, height: 240 },
  sheet: { position: 'absolute', start: 0, end: 0, backgroundColor: colors.paper, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, zIndex: 5 },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: colors.grab, marginTop: 10, marginBottom: 4 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  pillOk: { backgroundColor: 'rgba(47,122,75,0.12)' },
  well: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.mist },
  input: { flex: 1, height: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  divider: { height: 1, backgroundColor: colors.line },
  total: { fontFamily: ff.ui600, fontSize: 40, lineHeight: 42, letterSpacing: -1.2, color: colors.green, fontVariant: ['tabular-nums'] },
  switch: { width: 52, height: 32, borderRadius: 999, backgroundColor: colors.stage, padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.paper },
  planChip: { height: 40, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.mist },
  ended: { gap: 8, padding: 16, borderRadius: 20, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  act: { position: 'absolute', start: 0, end: 0, bottom: 0, gap: 10, zIndex: 6, paddingTop: 12, paddingHorizontal: 20, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
});
