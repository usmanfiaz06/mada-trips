import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { cardBrandOf, cardProblems, todayIn, type SavedCard } from '@mada/shared';
import { tokenizeCard, useDemo } from '@/lib/booking';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useCards, walletApi, walletKeys } from '@/lib/wallet';
import { colors, ff } from '@/theme';
import { Button } from '../Button';
import { Field } from '../Field';
import { Icon } from '../Icon';
import { PayMark, type PayBrand } from '../PayMark';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { sar } from './parts';

/* The order sheet's own sheets: how to pay (saved cards, Apple Pay, a new card), Apple Pay, the bank's code. */

export type PayMethod = { kind: 'card'; id: string; label: string; brand: PayBrand } | { kind: 'applepay'; label: string; brand: 'applepay' } | { kind: 'new_card'; token: string; last4: string; label: string; brand: 'visa' | 'mastercard' | 'mada' };

export function CardsSheet({ visible, current, credit, onPick, onClose }: { visible: boolean; current: PayMethod | null; credit: number; onPick: (m: PayMethod) => void; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const qc = useQueryClient();
  const cards = useCards();
  const [adding, setAdding] = useState(false);
  const [num, setNum] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [save, setSave] = useState(true);
  const [touched, setTouched] = useState<{ number?: boolean; expiry?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const c = cardProblems({ number: num, expiry: exp, cvv, name }, todayIn(), touched);
  const use = async () => {
    if (!c.ok || !c.brand) return;
    setBusy(true);
    try {
      // The number goes to the payment provider and comes back as a token. Mada never sees it.
      const { token, last4 } = await tokenizeCard({ number: num, expiry: exp, cvv, name });
      const label = t('pay.card.label', { brand: c.brand === 'visa' ? 'Visa' : c.brand === 'mastercard' ? 'Mastercard' : 'mada', last: last4.slice(-2) });
      if (save) {
        const out = await walletApi.addCard({ token, brand: c.brand, last4, exp, makeDefault: false });
        qc.setQueryData(walletKeys.cards, out);
        // A card new to its bank asks for a code on its first payment.
        onPick({ kind: 'new_card', token, last4, label, brand: c.brand });
      } else onPick({ kind: 'new_card', token, last4, label, brand: c.brand });
    } catch (e) { toast(e instanceof Error ? e.message : t('pay.card.provider')); } finally { setBusy(false); }
  };
  const selected = (id: string) => (current?.kind === 'card' && current.id === id) || (current?.kind === 'applepay' && id === 'applepay');
  return (
    <Sheet visible={visible} onClose={onClose} label={t('pay.cards.title')}>
      <ScrollView style={{ maxHeight: height * 0.78 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        <T v="h2">{t('pay.cards.title')}</T>
        {credit > 0 ? <View style={styles.row}><PayMark brand="credit" size={22} /><T v="small" color={colors.green} style={{ flex: 1 }}>{t('pay.credit.first', { price: sar(credit) })}</T></View> : null}
        {(cards.data?.cards ?? []).map((card: SavedCard) => (
          <Pressable key={card.id} accessibilityRole="button" accessibilityState={{ selected: selected(card.id) }} onPress={() => { buzz('select'); onPick({ kind: 'card', id: card.id, label: card.label, brand: card.brand }); }}
            style={[styles.card, selected(card.id) ? styles.sel : null]} testID={`card-${card.last4}`}>
            <PayMark brand={card.brand} size={30} />
            <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{card.label}</T><T v="tiny">{t('pay.cards.expires', { date: card.exp })}</T></View>
            {selected(card.id) ? <Icon name="check" color={colors.ok} width={2.4} /> : null}
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityState={{ selected: selected('applepay') }} onPress={() => { buzz('select'); onPick({ kind: 'applepay', label: 'Apple Pay', brand: 'applepay' }); }} style={[styles.card, selected('applepay') ? styles.sel : null]} testID="card-applepay">
          <PayMark brand="applepay" size={30} /><T v="h3" style={{ fontSize: 15, flex: 1 }}>Apple Pay</T>{selected('applepay') ? <Icon name="check" color={colors.ok} width={2.4} /> : null}
        </Pressable>
        {adding ? (
          <View style={{ gap: 12 }}>
            <Field label={t('pay.card.number')} value={num} keyboardType="number-pad" placeholder="4000 0000 0000 0000" autoComplete="cc-number" testID="card-number"
              onBlur={() => setTouched({ ...touched, number: true })} onChangeText={(v) => setNum(v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '))}
              error={c.problems.number} hint={c.brand ? <View style={{ position: 'absolute', end: 12, top: 38 }}><PayMark brand={cardBrandOf(c.digits) ?? 'card'} size={24} /></View> : null} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label={t('pay.card.expiry')} value={exp} placeholder="MM/YY" keyboardType="number-pad" autoComplete="cc-exp" error={c.problems.expiry} testID="card-exp"
                onBlur={() => setTouched({ ...touched, expiry: true })} onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 4); setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d); }} /></View>
              <View style={{ flex: 1 }}><Field label={t('pay.card.cvv')} value={cvv} placeholder={t('pay.card.cvvHint')} keyboardType="number-pad" autoComplete="cc-csc" secureTextEntry onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, 3))} testID="card-cvv" /></View>
            </View>
            <Field label={t('pay.card.name')} value={name} onChangeText={setName} autoComplete="cc-name" placeholder="OMAR ALHARBI" autoCapitalize="characters" testID="card-name" />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: save }} onPress={() => setSave(!save)} style={styles.row}>
              <View style={[styles.box, save ? { backgroundColor: colors.green } : null]}>{save ? <Icon name="check" size={14} color={colors.mist} width={2.4} /> : null}</View>
              <T v="small" color={colors.green}>{t('pay.card.save')}</T>
            </Pressable>
            <T v="tiny">{t('pay.card.note')}{SHOW_DEMO_HINTS ? ` ${t('pay.card.test')}` : ''}</T>
            <Button label={t('pay.card.use')} disabled={!c.ok} busy={busy} onPress={use} testID="card-use" />
          </View>
        ) : <Button variant="secondary" style={{ backgroundColor: colors.mist }} icon={<Icon name="plus" />} label={t('pay.cards.add')} onPress={() => setAdding(true)} testID="card-add" />}
      </ScrollView>
    </Sheet>
  );
}

/** Apple Pay, the way the system sheet behaves: double-click, Face ID, done. (The native sheet comes with expo Apple Pay.) */
export function ApplePaySheet({ visible, amount, what, onDone, onClose }: { visible: boolean; amount: number; what: string; onDone: () => void; onClose: () => void }) {
  const fail = useDemo((s) => s.on.has('faceIdFails'));
  const cards = useCards();
  const walletCard = cards.data?.cards[0]?.label ?? t('pay.apple.card');
  const [stage, setStage] = useState<'wait' | 'ok' | 'failed'>('wait');
  useEffect(() => {
    if (!visible || stage !== 'wait') return undefined;
    const tm = setTimeout(() => { if (fail) { setStage('failed'); buzz('warn'); } else { setStage('ok'); buzz('success'); setTimeout(onDone, 700); } }, 1600);
    return () => clearTimeout(tm);
  }, [visible, stage, fail]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet visible={visible} onClose={onClose} label="Apple Pay">
      <View style={styles.spread}><PayMark brand="applepay" size={30} /><Pressable accessibilityRole="button" onPress={onClose}><T v="h3" style={{ textDecorationLine: 'underline' }}>{t('common.cancel')}</T></Pressable></View>
      <View style={styles.spread}><T v="small" color={colors.green}>{t('pay.apple.inWallet', { card: walletCard })}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{sar(amount)}</T></View>
      <T v="tiny">{t('pay.apple.to', { what })}</T>
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 14 }}>
        <View style={[styles.faceid, stage === 'ok' ? { backgroundColor: '#e3f0e7' } : stage === 'failed' ? { backgroundColor: '#f6e3de' } : null]}>
          {stage === 'ok' ? <Icon name="check" size={34} color={colors.ok} width={2.4} /> : (
            <Svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke={stage === 'failed' ? colors.badInk : colors.green} strokeWidth={1.6} strokeLinecap="round">
              <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.2 4.4 1.2 6 0" />
            </Svg>
          )}
        </View>
        <T v="h3" style={{ fontSize: 15 }}>{stage === 'ok' ? t('pay.apple.done') : stage === 'failed' ? t('pay.apple.failed') : t('pay.apple.double')}</T>
      </View>
      {stage === 'failed' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button size="small" block={false} label={t('common.tryAgain')} onPress={() => setStage('wait')} />
          <Button size="small" block={false} variant="secondary" label={t('pay.apple.passcode')} onPress={() => { setStage('ok'); buzz('success'); setTimeout(onDone, 500); }} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** 3-D Secure: the bank's own code. Three wrong and the bank stops it. */
export function ThreeDsSheet({ visible, label, brand, amount, triesLeft, stopped, onCode, onOther, onClose }: {
  visible: boolean; label: string; brand: PayBrand; amount: number; triesLeft: number; stopped: boolean; onCode: (code: string) => Promise<void>; onOther: () => void; onClose: () => void;
}) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const wrong = triesLeft < 3 && !stopped;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('pay.3ds.title')}>
      <View style={styles.row}><PayMark brand={brand} size={32} /><View><T v="h3" style={{ fontSize: 15 }}>{t('pay.3ds.title')}</T><T v="tiny">{label} · {sar(amount)}</T></View></View>
      <T v="body">{t('pay.3ds.body')}</T>
      <Field label={t('pay.3ds.label')} big value={otp} keyboardType="number-pad" maxLength={6} editable={!stopped && !busy} bad={wrong} testID="otp-3ds"
        onChangeText={async (v) => {
          const d = v.replace(/\D/g, '').slice(0, 6);
          setOtp(d);
          if (d.length === 6) { setBusy(true); try { await onCode(d); } finally { setBusy(false); setOtp(''); } }
        }}
        error={stopped ? t('pay.3ds.stopped') : wrong ? tn('pay.3ds.wrong', triesLeft) : null} />
      {stopped ? <Button label={t('pay.declined.other')} onPress={onOther} /> : SHOW_DEMO_HINTS ? <T v="tiny">{t('pay.3ds.demo')}</T> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.mist },
  sel: { borderWidth: 2, borderColor: colors.green },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  faceid: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist },
});
