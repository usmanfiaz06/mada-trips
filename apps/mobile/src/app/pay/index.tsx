import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatSar, householdOf, personName, todayIn, type OrderPreview, type PayPlan } from '@mada/shared';
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
import { ApiError } from '@/lib/api';
import { bookingApi, demoOn, newIdempotencyKey, useDemo, useInvalidateBooking, usePayDraft } from '@/lib/booking';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useCards } from '@/lib/wallet';
import { colors, font, radii, ff } from '@/theme';

/*
 * The order sheet (Pay.jsx): lines, the all-in total, the cancellation rule from the dates, who's travelling, passports
 * still missing, promo codes, Mada credit, how to pay (cards, Apple Pay, Tabby, Tamara), the price hold, and slide to
 * book. The server prices everything; the slide sends the total the traveller saw. Card numbers go to the provider.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
type SheetName = null | 'people' | 'cards' | 'offline' | 'declined' | 'price' | 'blocked' | '3ds' | 'applepay';

export default function Pay() {
  const router = useRouter();
  const qc = useQueryClient();
  const invalidate = useInvalidateBooking();
  const { height } = useWindowDimensions();
  const bottom = useBottomInset();
  const pd = usePayDraft((s) => s.current);
  const demo = useDemo((s) => s.on);
  const user = useSession((s) => s.user);
  const people = usePeople();
  const cards = useCards();
  const now = useNow(1000);
  const initialTravellers = pd && 'travellerIds' in pd.draft ? pd.draft.travellerIds : [];
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
  const [attempt, setAttempt] = useState(0); // remounts the slider so the sun goes home after a try that stays here
  const [holdSkip, setHoldSkip] = useState(0);
  const [acceptedState, setAcceptedState] = useState<{ key: string; preview: OrderPreview } | null>(null);
  const [blocked, setBlocked] = useState('');
  const [threeDs, setThreeDs] = useState<{ orderId: string; triesLeft: number; stopped: boolean; amount: number } | null>(null);
  const key = useRef(newIdempotencyKey());

  const draft = useMemo(() => {
    if (!pd) return null;
    const d = pd.draft;
    return 'travellerIds' in d ? { ...d, travellerIds: travellers } : d;
  }, [pd, travellers]);
  const flags = [...demo].sort().join(',');
  const previewQ = useQuery({
    queryKey: ['booking', 'preview', draft, promo, useCredit, flags],
    enabled: !!draft,
    placeholderData: (p) => p,
    queryFn: async () => (await bookingApi.preview({ draft: draft!, promo, useCredit })).preview,
  });
  // A price the traveller accepted after it moved holds until they change what they're booking.
  const choiceKey = `${travellers.join()}|${promo}|${useCredit}`;
  const accepted = acceptedState?.key === choiceKey ? acceptedState.preview : null;
  const setAccepted = (pv: OrderPreview | null) => setAcceptedState(pv ? { key: choiceKey, preview: pv } : null);
  const p = accepted ?? previewQ.data;
  // The default way to pay: the default card, else Apple Pay.
  const def = cards.data?.cards.find((c) => c.id === cards.data!.defaultId);
  const method: PayMethod | null = chosen ?? (!cards.data ? null : def ? { kind: 'card', id: def.id, label: def.label, brand: def.brand } : { kind: 'applepay', label: 'Apple Pay', brand: 'applepay' });

  if (!pd || !draft) {
    return (
      <Screen><TopBar onBack={() => router.back()} /><View style={{ padding: 24 }}><Notice title={t('pay.missing')} /></View></Screen>
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
  const slideLabel = total === 0 ? t('pay.slideCredit') : effPlan === 'tabby' ? t('pay.slideTabby', { price: formatSar(charge) }) : effPlan === 'tamara' ? t('pay.slideTamara', { price: formatSar(charge) }) : p?.agent === false ? t('pay.slidePay', { price: formatSar(total) }) : t('pay.slide', { price: formatSar(total) });
  const household = people.data ?? [];
  const H = householdOf(household, todayIn());
  const selfName = user?.name ?? '';
  const hasPeople = 'travellerIds' in pd.draft;

  const tryCode = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setCodeErr(null); return; }
    try {
      const out = (await bookingApi.preview({ draft, promo: c, useCredit })).preview;
      if (out.promo?.status === 'applied') { setPromo(c); setCodeErr(null); setPromoOpen(false); buzz('success'); }
      else setCodeErr(`${out.promo?.message ?? t('pay.promo.unknown')}${out.promo?.status === 'unknown' && SHOW_DEMO_HINTS ? ` (${t('pay.promo.demo')})` : ''}`);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };

  const place = async (payment: Parameters<typeof bookingApi.createOrder>[0]['payment'], expected = total) => {
    const out = await bookingApi.createOrder({ draft, promo, useCredit, payment, plan: effPlan, expectedTotal: expected, idempotencyKey: key.current });
    key.current = newIdempotencyKey();
    if (out.outcome === 'created') { buzz('knock'); invalidate(); router.replace({ pathname: '/waiting/[id]', params: { id: out.order.id } }); return; }
    if (out.outcome === 'paid') {
      buzz('success'); invalidate(); usePayDraft.getState().clear();
      router.back();
      toast(pd.draft.kind === 'esim' ? t('pay.esimToast') : t('pay.paidToast'));
      return;
    }
    if (out.outcome === 'requires_action') { setThreeDs({ orderId: out.order.id, triesLeft: out.order.action?.triesLeft ?? 3, stopped: false, amount: charge }); setSheet('3ds'); buzz('knock'); return; }
    if (out.outcome === 'declined') { setSheet('declined'); buzz('soft'); return; }
    if (out.outcome === 'price_changed') { setAccepted(out.preview); setSheet('price'); buzz('soft'); return; }
    if (out.outcome === 'hold_ended') { setHoldSkip(24 * 3600_000); return; }
    setBlocked(out.message); setSheet('blocked'); buzz('soft');
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 900));
      if (demoOn('offline')) { setSheet('offline'); buzz('soft'); return; }
      if (total === 0) { await place({ method: 'credit' }); return; }
      if (isApple) { setSheet('applepay'); return; }
      if (method?.kind === 'new_card') await place({ method: 'new_card', token: method.token, brand: method.brand, last4: method.last4 });
      else if (method?.kind === 'card') await place({ method: 'card', cardId: method.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') { setSheet('offline'); buzz('soft'); } else toast(e instanceof Error ? e.message : t('error.internal'));
    } finally { setBusy(false); setAttempt((a) => a + 1); }
  };

  const recheck = async () => {
    buzz('tap');
    const offerId = pd.draft.kind === 'trip' ? pd.draft.flightOfferId : pd.draft.kind === 'stay' ? pd.draft.stayOfferId : null;
    try {
      const r = offerId ? await bookingApi.reprice(offerId) : null;
      setHoldSkip(0); setAccepted(null);
      await qc.invalidateQueries({ queryKey: ['booking', 'preview'] });
      toast(r?.changedBy ? t('pay.recheckMoved', { price: formatSar(Math.abs(r.changedBy)) }) : t('pay.recheckSame'));
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
  };

  const otp = async (c: string) => {
    if (!threeDs) return;
    const { order } = await bookingApi.otp(threeDs.orderId, c);
    if (order.status === 'pending_agent') { setSheet(null); buzz('success'); invalidate(); router.replace({ pathname: '/waiting/[id]', params: { id: order.id } }); return; }
    if (order.status === 'confirmed') { setSheet(null); buzz('success'); invalidate(); router.back(); toast(t('pay.paidToast')); return; }
    if (order.status === 'declined') { setThreeDs({ ...threeDs, stopped: true, triesLeft: 0 }); buzz('warn'); return; }
    setThreeDs({ ...threeDs, triesLeft: order.action?.triesLeft ?? 0 }); buzz('warn');
  };

  const names = travellers.map((id) => personName(household.find((x) => x.id === id), selfName));
  const missing = (p?.missingPassports ?? []).map((id) => household.find((x) => x.id === id)).filter(Boolean);
  const holdText = left === null ? null : expired ? t('pay.holdEnded') : t('pay.held', { time: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` });

  return (
    <Screen background={colors.night}>
      <View style={styles.hero}>
        <Photo name={p?.photo ?? 'istanbul-galata'} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,26,22,0.45)' }]} />
      </View>
      <TopBar onBack={() => router.back()} dark backLabel={t('pay.back')} />
      <Animated.View entering={FadeInDown.duration(500)} style={[styles.sheet, { top: 128, height: height - 128 }]}>
        <View style={styles.grab} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 170 + bottom, gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.spread}>
            <T v="h2" style={{ flex: 1 }} accessibilityRole="header">{p?.title ?? pd.title}</T>
            {holdText ? <View style={[styles.pill, expired ? null : styles.pillOk]} accessibilityLiveRegion="polite"><T v="caption" color={expired ? colors.green : colors.ok} style={{ fontFamily: ff.ui600, fontVariant: ['tabular-nums'] }}>{holdText}</T></View> : null}
          </View>
          {(p?.lines ?? []).map((l) => (
            <View key={l.key + l.text} style={styles.spread}>
              <View style={[styles.row, { flex: 1 }]}><Icon name={l.icon as IconName} size={20} /><T v="callout" color={colors.green} style={{ flex: 1, fontSize: 15 }}>{l.text}</T></View>
              <T v="small" color={colors.green} style={{ fontVariant: ['tabular-nums'] }}>{formatSar(l.amount, { bare: true })}</T>
            </View>
          ))}
          {hasPeople ? (
            <View style={styles.well}>
              <T v="small" style={{ flex: 1 }}>{travellers.length === 1 && travellers[0] === H.me ? t('pay.justYou') : names.join(', ')}</T>
              <LinkButton label={t('pay.edit')} onPress={() => setSheet('people')} />
            </View>
          ) : null}
          {p?.promo?.status === 'applied' ? (
            <View style={styles.spread}>
              <View style={styles.row}><Icon name="star" size={20} /><T v="callout" color={colors.green} style={{ fontSize: 15 }}>{t('pay.promo.line', { code: p.promo.code })}</T><LinkButton label={t('pay.promo.remove')} size={13} onPress={() => { setPromo(null); setCode(''); }} /></View>
              <T v="small" color={colors.ok}>−{formatSar(p.promo.discount.amount, { bare: true })}</T>
            </View>
          ) : null}
          {p && p.credit.balance.amount > 0 ? (
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
          {p?.promo?.status !== 'applied' ? (promoOpen ? (
            <View style={{ gap: 6 }}>
              <View style={styles.row}>
                <TextInput accessibilityLabel={t('pay.promo.label')} placeholder={t('pay.promo.label')} placeholderTextColor={colors.muted} value={code} autoCapitalize="characters" onChangeText={(v) => { setCode(v); setCodeErr(null); }}
                  style={[styles.input, codeErr ? { borderColor: colors.bad } : null, webNoOutline]} testID="promo-input" />
                <Button size="small" block={false} variant="secondary" style={{ backgroundColor: colors.mist }} label={t('pay.promo.apply')} onPress={tryCode} testID="promo-apply" />
              </View>
              {codeErr ? <T v="small" color={colors.badInk} accessibilityRole="alert">{codeErr}</T> : null}
            </View>
          ) : <View style={{ alignSelf: 'flex-start' }}><LinkButton label={t('pay.promo.open')} onPress={() => setPromoOpen(true)} /></View>) : null}
          {missing.length ? (
            <Notice icon="visa" iconColor={colors.goldInk} title={t('pay.passports.title', { names: missing.map((x) => (x!.isSelf ? 'you' : personName(x))).join(', ').replace(/, ([^,]*)$/, ' and $1') })}>
              <T v="small">{t('pay.passports.body')}</T>
              <View style={{ alignSelf: 'flex-start' }}><LinkButton label={missing[0]!.isSelf ? t('pay.passports.scanYours') : t('pay.passports.scan', { name: personName(missing[0]) })} onPress={() => router.push('/wallet')} /></View>
            </Notice>
          ) : null}
          <View style={styles.divider} />
          <View style={{ gap: 2 }}>
            <T style={styles.total} testID="pay-total">{formatSar(total)}</T>
            <T v="small">{t('pay.allIn')}</T>
            <T v="small">{p?.rule ?? ''}</T>
          </View>
          <View style={styles.spread}>
            <View style={styles.row}>
              {total === 0 ? <><PayMark brand="credit" /><T v="callout" color={colors.green} style={{ fontFamily: ff.ui500, fontSize: 15 }}>{t('pay.paidCredit')}</T></>
                : <><PayMark brand={method?.brand ?? 'card'} /><T v="callout" color={colors.green} style={{ fontFamily: ff.ui500, fontSize: 15 }}>{method?.label ?? ''}</T></>}
            </View>
            <LinkButton label={t('pay.change')} onPress={() => setSheet('cards')} />
          </View>
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
      <View style={[styles.act, { paddingBottom: 18 + bottom }]}>
        {expired ? <Button label={t('pay.recheck')} onPress={recheck} testID="pay-recheck" /> : (
          <SlideToConfirm key={attempt} label={slideLabel} busy={busy} busyLabel={t('pay.busy')} disabled={!p || previewQ.isFetching && !p} onConfirm={confirm} />
        )}
        <T v="tiny" style={{ textAlign: 'center' }}>
          {p?.agent === false ? t('pay.nowNote') : t('pay.agentNote')}
          {SHOW_DEMO_HINTS && hold ? <T v="tiny" style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }} onPress={() => setHoldSkip(24 * 3600_000)}> {t('pay.demoHold')}</T> : null}
        </T>
      </View>

      <Sheet visible={sheet === 'people'} label={t('pay.people.title')} onClose={() => setSheet(null)}>
        <T v="h2">{t('pay.people.title')}</T>
        <TravellerChips people={household} value={travellers} onChange={setTravellers} selfName={selfName} />
        <T v="small">{t('pay.people.note')}</T>
        <Button label={t('pay.people.done', { price: formatSar(total) })} onPress={() => setSheet(null)} />
      </Sheet>
      {sheet === 'cards' ? <CardsSheet visible current={method} credit={p?.credit.balance.amount ?? 0} onPick={(m) => { setMethod(m); setSheet(null); }} onClose={() => setSheet(null)} /> : null}
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
          try { await place(method?.kind === 'card' ? { method: 'card', cardId: method.id } : method?.kind === 'new_card' ? { method: 'new_card', token: method.token, brand: method.brand, last4: method.last4 } : { method: 'applepay', token: `applepay_mock_${Date.now()}` }, accepted?.total.amount); }
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
        onDone={async () => { setSheet(null); setBusy(true); try { await place({ method: 'applepay', token: `applepay_mock_${Date.now()}` }); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); } }} /> : null}
      {threeDs && sheet === '3ds' ? (
        <ThreeDsSheet visible label={method?.label ?? ''} brand={method?.brand ?? 'card'} amount={threeDs.amount} triesLeft={threeDs.triesLeft} stopped={threeDs.stopped}
          onCode={otp} onOther={() => setSheet('cards')} onClose={() => { setSheet(null); toast(t('pay.cancelled')); }} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  act: { position: 'absolute', start: 20, end: 20, bottom: 0, gap: 10, zIndex: 6 },
});
