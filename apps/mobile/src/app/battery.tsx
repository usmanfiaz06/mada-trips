import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DESK_PHONE, DESK_TEL, hhmm as localTime, type Ride, type SupportThreadResponse } from '@mada/shared';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { essentials, savedAt } from '@/lib/low-power';
import { isOffline } from '@/lib/net/state';
import { queryClient } from '@/lib/queries';
import { sendToMada } from '@/lib/support-chat';
import { useTrip, useTrips } from '@/lib/trips';
import { hhmm } from '@/lib/wallet-model';
import { walletApi } from '@/lib/wallet';
import { ff } from '@/theme';

/*
 * Low battery (critique item 14): one dark screen, large type, no images, no animation. Only the next flight (the
 * boarding details), the driver if a car is booked or on its way, the hotel in Arabic and English to show a driver,
 * and Mada: the number and a call-back. Everything comes from what's saved on this phone, so it works with no signal.
 */

const BG = '#000000';
const FG = '#f4efe6';
const DIM = '#a9a296';
const LINE = '#2a2722';
const GOLD = '#d9b77a';
const tel = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;
const call = (phone: string) => { void Linking.openURL(tel(phone)).catch(() => {}); };

export default function Battery() {
  const insets = useSafeAreaInsets();
  const trips = useTrips();
  const id = trips.data?.currentId ?? null;
  const q = useTrip(id);
  const trip = q.data?.trip ?? null;
  // The moment the screen opened: it doesn't tick, so it never redraws on its own.
  const [opened] = useState(Date.now);
  const now = trip ? Date.parse(trip.clock.now) : opened;
  const rides = queryClient.getQueriesData<{ ride: Ride }>({ queryKey: ['rides'] }).map(([, d]) => d?.ride).filter((r): r is Ride => !!r);
  const e = essentials(trip, now, rides);
  const at = q.dataUpdatedAt || trips.dataUpdatedAt;
  const [cb, setCb] = useState<{ line: string; busy?: boolean } | null>(null);

  const askCallback = async () => {
    if (cb?.busy) return;
    const body = t('lp.callbackBody');
    if (isOffline()) {
      // A conversation already saved on this phone takes the message; it goes the moment there's a connection.
      const saved = queryClient.getQueriesData<SupportThreadResponse>({ queryKey: ['support', 'thread'] }).find(([, d]) => d?.thread?.id);
      if (!saved) { setCb({ line: t('lp.callbackNoNet') }); return; }
      const [key, data] = saved;
      sendToMada(String(key[2]), data!.thread.id, { body, topic: 'urgent' }, t('lp.callback'));
      setCb({ line: t('off.willSend') });
      return;
    }
    setCb({ line: '', busy: true });
    try {
      const { thread } = await walletApi.openThread(trip ? { tripId: trip.id } : {});
      const r = await walletApi.sendMessage(thread.id, { body, topic: 'urgent' });
      const by = r.messages.map((m) => m.card?.callback?.by).find(Boolean);
      setCb({ line: by ? t('lp.callbackBy', { time: hhmm(by) }) : t('lp.callbackSent') });
    } catch {
      setCb({ line: t('lp.callbackNoNet') });
    }
  };

  const f = e.flight;
  const d = e.driver;
  const st = e.stay;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]} testID="battery-screen">
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 28 }}>
        <View style={{ gap: 4 }}>
          <T style={styles.title} accessibilityRole="header">{t('lp.title')}</T>
          <T style={styles.dim}>{t('lp.sub')}</T>
          {at ? <T style={styles.dim} testID="battery-saved">{t('off.saved', { time: savedAt(at) })}</T> : null}
        </View>

        {f ? (
          <View style={styles.block} testID="battery-flight">
            <T style={styles.label}>{t('lp.flight')}</T>
            <T style={styles.big}>{f.flightNumber}</T>
            <T style={styles.mid}>{t('lp.flightLine', { from: f.from, to: f.to, time: localTime(f.departLocal) })}</T>
            <T style={styles.mid}>{[f.terminal ? t('lp.terminal', { terminal: f.terminal }) : null, f.gate ? t('lp.gate', { gate: f.gate }) : null, f.seats.length ? t('lp.seat', { seat: f.seats.join(', ') }) : null].filter(Boolean).join(' · ')}</T>
            {f.pnr ? <T style={styles.mid} selectable>{t('lp.ref', { ref: f.pnr })}</T> : null}
          </View>
        ) : null}

        {d ? (
          <View style={styles.block} testID="battery-driver">
            <T style={styles.label}>{t('lp.driver')}</T>
            <T style={styles.big}>{d.name ?? t('lp.driver')}</T>
            {d.car ? <T style={styles.mid}>{d.car}</T> : null}
            {d.at || d.place ? <T style={styles.mid}>{t('lp.driverAt', { time: d.at ? hhmm(d.at) : '', place: d.place ?? '' })}</T> : null}
            {d.phone ? <Btn label={t('lp.callDriver', { driver: d.name ?? t('lp.driver') })} onPress={() => call(d.phone!)} testID="battery-call-driver" /> : null}
          </View>
        ) : null}

        {st ? (
          <View style={styles.block} testID="battery-hotel">
            <T style={styles.label}>{t('lp.hotel')}</T>
            {/* As booked, never put into Arabic by <T>: this is what the hotel and a driver who reads Latin see. */}
            <Text style={[styles.big, styles.ltr]}>{st.name}</Text>
            {st.address ? <Text style={[styles.mid, styles.ltr]} selectable>{st.address}</Text> : null}
            {st.nameAr || st.addressAr ? (
              <View style={styles.ar} testID="battery-hotel-ar">
                {st.nameAr ? <T style={[styles.big, styles.rtl]}>{st.nameAr}</T> : null}
                {st.addressAr ? <T style={[styles.mid, styles.rtl]} selectable>{st.addressAr}</T> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {!f && !d && !st ? <T style={styles.mid}>{t('lp.nothing')}</T> : null}

        <View style={styles.block} testID="battery-mada">
          <T style={styles.label}>{t('lp.mada')}</T>
          <T style={styles.big} selectable>{DESK_PHONE}</T>
          <Btn label={t('lp.callMada')} onPress={() => { void Linking.openURL(DESK_TEL).catch(() => {}); }} testID="battery-call-mada" primary />
          <Btn label={t('lp.callback')} onPress={() => { void askCallback(); }} testID="battery-callback" />
          {cb?.line ? <T style={styles.mid} testID="battery-callback-line" accessibilityLiveRegion="polite">{cb.line}</T> : null}
        </View>

        <Pressable accessibilityRole="button" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/today' as Href); }} hitSlop={12} testID="battery-back">
          <T style={[styles.dim, { textDecorationLine: 'underline' }]}>{t('lp.back')}</T>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Btn({ label, onPress, testID, primary }: { label: string; onPress: () => void; testID: string; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={[styles.btn, primary ? styles.btnPrimary : null]}>
      <T style={[styles.btnText, primary ? { color: BG } : null]}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  title: { color: FG, fontFamily: ff.ui700, fontSize: 30, lineHeight: 38 },
  label: { color: GOLD, fontFamily: ff.ui600, fontSize: 15, lineHeight: 20 },
  big: { color: FG, fontFamily: ff.ui700, fontSize: 28, lineHeight: 36 },
  mid: { color: FG, fontFamily: ff.ui500, fontSize: 20, lineHeight: 28 },
  dim: { color: DIM, fontFamily: ff.ui500, fontSize: 16, lineHeight: 22 },
  block: { gap: 6, paddingTop: 18, borderTopWidth: 1, borderTopColor: LINE },
  ar: { gap: 4, paddingTop: 8 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  ltr: { writingDirection: 'ltr', textAlign: 'left' },
  btn: { marginTop: 8, minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: FG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: FG },
  btnText: { color: FG, fontFamily: ff.ui700, fontSize: 20, lineHeight: 26 },
});
