import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  AIRPORT_NAMES, FLIGHT_PREFS, fareStops, fareTotal, formatSar, legMinutes, tn,
  type BagsWanted, type BookingRequestView, type Cabin, type FareOption, type FlightPref, type Person,
} from '@mada/shared';
import { useRouter } from 'expo-router';
import { sendRequest, usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Pill } from '../Pill';
import { T } from '../Text';
import { AirlineMark } from './AirlineMark';
import { rangeName } from './format';
import { ChipWrap, Leg, MadaDot, Toggle, enter, useNow } from './parts';
import { TravellerChips } from './Travellers';
import type { Cta } from './FlightFlow';
import type { TripSearch } from './SearchSheet';

/*
 * Flights by request (the beta, GET /config features.flightsByRequest): instead of live fares, "Tell us where and
 * when". Where, dates and who come from Ask; here the traveller adds how flexible they are, the cabin, bags and what
 * they'd like, then sends it to Mada. A person books it in Mada's own system and sends fares back to the request
 * (FlightFares below), where the traveller picks one and pays.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const FLEX = [0, 1, 3] as const;
const CABINS: Cabin[] = ['economy', 'premium', 'business', 'first'];
const BAGS: BagsWanted[] = ['cabin', 'one', 'two'];

export function FlightRequestForm({ city, destKey, trip, who, setWho, people, selfName, today, query, onEdit, setCta, onSent }: {
  city: string; destKey: string | null; trip: TripSearch; who: string[]; setWho: (ids: string[]) => void; people: Person[]; selfName: string; today: string; query: string;
  onEdit: () => void; setCta: (c: Cta) => void; onSent: (id: string | null) => void;
}) {
  const [flex, setFlex] = useState<number>(trip.flex ? 3 : 0);
  const [cabin, setCabin] = useState<Cabin>(trip.cabin);
  const [bags, setBags] = useState<BagsWanted>('one');
  const [prefs, setPrefs] = useState<FlightPref[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const dates = trip.type === 'oneway' || !trip.ret ? t('beta.fr.oneWay', { date: rangeName(trip.dep!, null, today) }) : rangeName(trip.dep!, trip.ret, today);

  const send = async () => {
    if (!who.length) return;
    setBusy(true);
    try {
      const r = await sendRequest({
        kind: 'flight', query, answers: {}, needs: {}, travellerIds: who, note: note.trim(),
        search: { destination: destKey, destinationName: destKey ? null : city, from: trip.from, depart: trip.dep, return: trip.type === 'oneway' ? null : trip.ret, cabin, carrier: null, flexDays: flex, bags, prefs },
      });
      buzz('success');
      onSent(r?.id ?? null);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };

  useEffect(() => {
    setCta({ label: t('beta.fr.send'), disabled: busy || !who.length, onPress: () => { void send(); }, testID: 'flight-request-send' });
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View entering={enter(0)} style={{ gap: 18 }} testID="flight-request">
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <MadaDot size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h2" accessibilityRole="header">{t('beta.fr.title')}</T>
          <T v="small">{t('beta.fr.body')}</T>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('beta.fr.change')} onPress={onEdit} style={styles.summary} testID="flight-request-edit">
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3" style={{ fontSize: 15 }}>{t('beta.fr.route', { from: AIRPORT_NAMES[trip.from] ?? trip.from, to: city })}</T>
          <T v="tiny">{dates}</T>
        </View>
        <T v="h3" style={{ fontSize: 14, textDecorationLine: 'underline' }}>{t('beta.fr.change')}</T>
      </Pressable>
      <View style={{ gap: 10 }}>
        <T v="h3">{tn('beta.fr.travellers', who.length)}</T>
        <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
      </View>
      <View style={{ gap: 10 }}>
        <T v="h3">{t('beta.fr.flex.title')}</T>
        <ChipWrap>{FLEX.map((d) => <Toggle key={d} label={t(`beta.fr.flex.${d}`)} on={flex === d} onPress={() => { buzz('select'); setFlex(d); }} />)}</ChipWrap>
      </View>
      <View style={{ gap: 10 }}>
        <T v="h3">{t('beta.fr.cabin.title')}</T>
        <ChipWrap>{CABINS.map((c) => <Toggle key={c} label={t(`cal.cabin.${c}`)} on={cabin === c} onPress={() => { buzz('select'); setCabin(c); }} />)}</ChipWrap>
      </View>
      <View style={{ gap: 10 }}>
        <T v="h3">{t('beta.fr.bags.title')}</T>
        <ChipWrap>{BAGS.map((b) => <Toggle key={b} label={t(`beta.fr.bags.${b}`)} on={bags === b} onPress={() => { buzz('select'); setBags(b); }} />)}</ChipWrap>
      </View>
      <View style={{ gap: 10 }}>
        <T v="h3">{t('beta.fr.prefs.title')}</T>
        <ChipWrap>
          {FLIGHT_PREFS.map((p) => {
            const on = prefs.includes(p);
            return <Toggle key={p} small label={t(`beta.fr.pref.${p}`)} on={on} onPress={() => { buzz('select'); setPrefs(on ? prefs.filter((x) => x !== p) : [...prefs, p]); }} />;
          })}
        </ChipWrap>
      </View>
      <View style={{ gap: 6 }}>
        <T v="small" style={{ fontFamily: ff.ui600 }}>{t('beta.fr.note.label')}</T>
        <TextInput accessibilityLabel={t('beta.fr.note.label')} multiline value={note} onChangeText={setNote} placeholder={t('beta.fr.note.hint')} placeholderTextColor={colors.muted}
          style={[styles.note, font('body', colors.green), { fontSize: 15 }, webNoOutline]} testID="flight-request-note" />
      </View>
      <View style={{ height: 40 }} />
    </Animated.View>
  );
}

/* ───────────── the fares the desk sent ───────────── */

const hhmm = (ms: number) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}`;

/** The fares a person at Mada is holding: choose one, see what's in it, pay. Shown in the request. */
export function FlightFares({ r, today }: { r: BookingRequestView; today: string }) {
  const router = useRouter();
  const now = useNow(1000);
  const q = r.quote!;
  const options = q.flight?.options ?? [];
  const [pick, setPick] = useState<string>(options[0]?.id ?? '');
  const chosen = options.find((o) => o.id === pick) ?? options[0];
  const until = q.expiresAt ? Date.parse(q.expiresAt) : null;
  const left = until ? Math.max(0, until - now) : null;
  const ended = q.status === 'expired' || left === 0;
  const payable = r.status === 'quoted' && q.status === 'open' && !ended && !!chosen;
  const agent = r.agent?.name ?? 'Mada';
  return (
    <View style={{ gap: 12 }} testID="flight-fares">
      {left !== null && !ended && q.status === 'open' ? (
        <View style={[styles.hold]} accessibilityLiveRegion="polite">
          <T v="caption" color={colors.ok} style={{ fontFamily: ff.ui600, fontVariant: ['tabular-nums'] }}>
            {left > 3 * 3_600_000 ? t('beta.fq.heldUntil', { time: new Date(until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('beta.fq.held', { time: hhmm(left) })}
          </T>
        </View>
      ) : null}
      {ended && r.status === 'quoted' ? <T v="small" color={colors.goldInk} testID="fares-ended">{t('beta.fq.ended', { agent })}</T> : null}
      {options.map((o, i) => <FareCard key={o.id} o={o} i={i} on={o.id === chosen?.id} today={today} onPick={() => { buzz('select'); setPick(o.id); }} disabled={!payable} />)}
      {payable ? (
        <Button label={t('beta.fq.pay', { price: formatSar(fareTotal(chosen!)) })} testID="fares-pay"
          onPress={() => { usePayDraft.getState().set({ draft: { kind: 'quote', requestId: r.id, optionId: chosen!.id }, title: r.title }); router.push('/pay'); }} />
      ) : null}
    </View>
  );
}

function FareCard({ o, i, on, today, onPick, disabled }: { o: FareOption; i: number; on: boolean; today: string; onPick: () => void; disabled: boolean }) {
  const ways = (['out', 'back'] as const).filter((d) => o.legs.some((l) => l.direction === d));
  return (
    <Animated.View entering={enter(i + 1)}>
      <Card padding={0} selected={on && !disabled} style={{ gap: 0 }}>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${o.airline}, ${formatSar(fareTotal(o))}`} onPress={onPick} style={styles.fare} testID={`fare-${o.id}`}>
          <View style={styles.spread}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 }}>
              <AirlineMark carrier={o.carrier} label={o.airline} />
              <View style={{ gap: 2, flexShrink: 1 }}>
                <T v="h3" style={{ fontSize: 15 }}>{o.airline}</T>
                <Pill label={on ? t('beta.fq.chosen') : t(`cal.cabin.${o.cabin}`)} variant={on ? 'gold' : 'default'} height={22} />
              </View>
            </View>
            <T style={styles.price}>{formatSar(fareTotal(o))}</T>
          </View>
          {ways.map((d) => {
            const legs = o.legs.filter((l) => l.direction === d);
            const a = legs[0]!, z = legs[legs.length - 1]!;
            const stops = fareStops(o, d);
            const minutes = legs.length === 1 ? legMinutes(a) : Math.max(1, Math.round((Date.parse(`${z.arrDate ?? z.date}T${z.arr}:00Z`) - Date.parse(`${a.date}T${a.dep}:00Z`)) / 60_000));
            return (
              <View key={d} style={{ gap: 4 }}>
                <T v="tiny">{d === 'out' ? t('beta.fq.out') : t('beta.fq.back')} · {rangeName(a.date, null, today)} · {legs.map((l) => l.flightNumber).join(', ')}</T>
                <Leg dep={a.dep} arr={z.arr} from={a.from} to={z.to} durationMin={minutes} stop={stops ? tn('beta.fq.stops', stops) : null} />
              </View>
            );
          })}
          {o.note ? <T v="small">{o.note}</T> : null}
          {on ? (
            <View style={{ gap: 6 }}>
              <View style={styles.divider} />
              {([[t('beta.fq.bags'), o.baggage], [t('beta.fq.change'), o.changeRule], [t('beta.fq.refund'), o.refundRule]] as [string, string][]).map(([k, v]) => (
                <View key={k} style={styles.spread}><T v="small">{k}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1, textAlign: 'right' }}>{v}</T></View>
              ))}
              <View style={styles.table} accessibilityLabel={t('beta.fq.each')}>
                {o.prices.map((p, k) => (
                  <View key={`${p.personId ?? ''}${k}`} style={styles.spread}><T v="small" style={{ flex: 1 }}>{p.name}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{formatSar(p.amount.amount)}</T></View>
                ))}
                <View style={[styles.spread, styles.total]}><T v="h3" style={{ fontSize: 14 }}>{t('beta.fq.total')}</T><T v="h3" style={{ fontSize: 14 }}>{formatSar(fareTotal(o))}</T></View>
              </View>
            </View>
          ) : null}
        </Pressable>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.paper },
  note: { minHeight: 76, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16, paddingVertical: 12, textAlignVertical: 'top' },
  hold: { alignSelf: 'flex-start', height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(47,122,75,0.12)', justifyContent: 'center' },
  fare: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontFamily: ff.ui600, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.line },
  table: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.mist },
  total: { paddingTop: 6, borderTopWidth: 1, borderColor: colors.line },
});
