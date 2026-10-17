import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Animated from 'react-native-reanimated';
import {
  UMRAH_BANDS, UMRAH_SLOTS, UMRAH_WHEN, ageOn, addDays, checkInFor, checkInForWhen, formatSar, householdOf, inLastTen, nameIn, personName, rangeLabel,
  sarToHalalas, slotLabel, umrahAirports, umrahHotel, umrahHotelsIn, umrahPlan, umrahStaySar,
  type AskIntent, type CopyKey, type NeedKey, type Person, type UmrahBand, type UmrahCity,
} from '@mada/shared';
import { sendRequest } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff, font } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { T } from '../Text';
import { Answered } from './Conversation';
import type { Cta } from './FlightFlow';
import { PartyStep } from './Party';
import { NeedsPicker, SentRequest } from './Requests';
import { SearchSheet } from './SearchSheet';
import { TravellerChips } from './Travellers';
import { ChipWrap, Notice, Toggle, enter, useWho } from './parts';

/*
 * Umrah, built around the permit (critique: a pilgrim plans from the Nusuk day and slot, not from a form). First the
 * permit: its day and time slot, or, without one, what it is and that Mada helps get one when slots open. Then who,
 * Makkah by how far from the Haram (each hotel named, its page a tap away), Madinah before or after, the Haramain
 * train, the flights, and the plan priced with its dates. The last ten nights of Ramadan are said plainly. Needs
 * (a wheelchair, oxygen) wait behind one chip. Everything chosen is the request's answers, so a correction typed in
 * Ask ("I have a permit", "we are 5") keeps it.
 */

type A = Record<string, string[]>;
const NIGHTS = [2, 3, 4, 5];
const BAND_KEY: Record<UmrahBand, CopyKey> = { steps: 'umrah.band.steps', walk: 'umrah.band.walk', shuttle: 'umrah.band.shuttle' };
const SLOT_ID: Record<string, string> = { 'Before Fajr': 'night', Morning: 'morning', Afternoon: 'afternoon', Evening: 'evening' };
const WHEN_KEY: Record<string, CopyKey> = { 'Early Ramadan': 'umrah.when.early', 'The last ten nights': 'umrah.when.lastTen', 'After Eid': 'umrah.when.afterEid' };

export function UmrahFlow({ intent, query, people, selfName, today, setCta, onSync }: {
  intent: AskIntent; query: string; people: Person[]; selfName: string; today: string; setCta: (c: Cta) => void; onSync?: (patch: Partial<AskIntent>) => void;
}) {
  const router = useRouter();
  const lang = getLocale();
  const H = useMemo(() => householdOf(people, today), [people, today]);
  const [a, setA] = useState<A>(() => {
    const x: A = { ...intent.answers };
    // Typed "after Eid" or "the last ten nights": the day is already known.
    const w = x.when?.[0];
    if (w && WHEN_KEY[w] && !x.checkIn) { const d = checkInForWhen(w, today); if (d) x.checkIn = [d]; }
    return x;
  });
  const set = (patch: A, drop: string[] = []) => { buzz('tap'); setA((cur) => { const n = { ...cur, ...patch }; drop.forEach((k) => delete n[k]); return n; }); };
  const named = (intent.travellerIds ?? []).filter((id) => people.some((p) => p.id === id));
  const [who, setWho] = useWho(() => (named.length ? named : H.nonHelper.length ? H.nonHelper.map((p) => p.id) : H.me ? [H.me] : []));
  const [lap, setLap] = useState(intent.infants ?? 0);
  const [needPartySet, setNeedParty] = useState<boolean | null>(null);
  const needParty = needPartySet ?? (!!intent.party && !named.length);
  // Read from the household as it loads: a first render before the people arrive must not settle who's going.
  const [whoDoneSet, setWhoDone] = useState<boolean | null>(null);
  const whoDone = whoDoneSet ?? (!!named.length || H.nonHelper.length <= 1);
  const [needs, setNeeds] = useState<Record<string, NeedKey[]>>(() => ({ ...(intent.needs ?? {}) }) as Record<string, NeedKey[]>);
  // A wheelchair or oxygen said in the words opens the needs; otherwise they wait behind the chip.
  const [needsOpen, setNeedsOpen] = useState(!!intent.needsMentioned?.length || Object.values(intent.needs ?? {}).some((x) => x.length));
  const [dayOpen, setDayOpen] = useState(false);
  const [sent, setSent] = useState<{ id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => personName(people.find((p) => p.id === id), selfName);
  const v = (k: string) => a[k]?.[0] ?? null;

  const permit = v('permit');
  const checkIn = v('checkIn');
  const mkNights = Number(v('makkahNights')) || 3;
  const mdNights = Number(v('madinahNights')) || 2;
  const order = v('madinah') as 'before' | 'after' | 'no' | null;
  const ages = useMemo(() => [...who.map((id) => ageOn(people.find((p) => p.id === id) ?? { dateOfBirth: null }, today) ?? 30), ...Array.from({ length: lap }, () => 0)], [who, lap, people, today]);
  const guests = Math.max(1, ages.filter((x) => x >= 2).length);
  const plan = checkIn && v('makkahHotel') ? umrahPlan({
    checkIn, makkah: { key: v('makkahHotel')!, nights: mkNights },
    madinah: order && order !== 'no' && v('madinahHotel') ? { key: v('madinahHotel')!, nights: mdNights, order } : null,
    flyFrom: v('flyFrom') && v('flyFrom') !== 'none' ? v('flyFrom') : null, ages,
  }) : null;
  const lastTen = !!checkIn && inLastTen(plan?.dates.leave ?? checkIn, plan?.dates.home ?? addDays(checkIn, mkNights + (order === 'after' ? mdNights : 0)));

  // Where the conversation is: the first thing not yet answered.
  const step = !permit || permit === 'no' ? 'permit'
    : permit === 'has' && !v('permitDay') ? 'day'
      : permit === 'has' && !v('permitSlot') ? 'slot'
        : !checkIn ? 'when'
          : needParty && intent.party ? 'party'
            : !whoDone ? 'who'
              : !v('makkahHotel') ? 'makkah'
                : !order ? 'madinah'
                  : order !== 'no' && !v('madinahHotel') ? 'madinahHotel'
                    : !v('flyFrom') ? 'fly' : 'plan';

  useEffect(() => { onSync?.({ answers: a, travellerIds: whoDone ? who : intent.travellerIds }); }, [a, who.join(), whoDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const band = umrahHotel(v('makkahHotel'))?.band;
      const answers: A = { ...a, stay: [band === 'steps' ? 'Steps from the Haram' : 'Good value, short ride'] };
      if (order === 'no') { delete answers.madinahHotel; delete answers.madinahNights; }
      const r = await sendRequest({ kind: 'umrah', query, answers, travellerIds: who, needs, note: '' });
      buzz('success');
      setSent({ id: r?.id ?? null });
      setCta(null);
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (step !== 'plan' || !plan || sent) { setCta(null); return; }
    setCta({ label: t('umrah.plan.send', { price: formatSar(sarToHalalas(plan.totalSar)) }), disabled: busy, onPress: () => { void send(); }, testID: 'umrah-send' });
  }, [step, plan?.totalSar, busy, sent, needs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (sent) return <SentRequest id={sent.id} people={people} selfName={selfName} />;

  const day = (iso: string) => rangeLabel(iso, null, lang);
  const openHotel = (key: string, city: UmrahCity) => { buzz('tap'); router.push(`/hotel/${key}?city=${city}&guests=${guests}` as Href); };
  const stayAnswer = (key: string | null, nights: number) => (key ? `${umrahHotel(key)?.name ?? ''} · ${tn('umrah.nights', nights)}` : '');
  const rows: ReactNode[] = [];

  // ── the permit ──
  if (permit && permit !== 'no') {
    rows.push(<Answered key="permit" q={t('umrah.permit.q')} a={permit === 'has' ? t('umrah.permit.yes') : `${t('umrah.permit.no')} · ${t(permit === 'help' ? 'umrah.permit.help' : 'umrah.permit.self')}`}
      onChange={() => set({}, ['permit', 'permitDay', 'permitSlot', 'checkIn', 'when'])} testID="umrah-answered-permit" />);
    if (permit !== 'has') rows.push(<Notice key="permit-line" icon="umrah"><T v="small" testID="umrah-permit-line">{permit === 'help' ? t('umrah.permit.helpLine') : t('umrah.permit.selfLine')}</T></Notice>);
  }
  if (v('permitDay') && v('permitSlot')) {
    rows.push(<Answered key="day" q={t('umrah.permit.day')} a={`${day(v('permitDay')!)} · ${slotLabel(v('permitSlot'))}`} onChange={() => set({}, ['permitDay', 'permitSlot', 'checkIn'])} testID="umrah-answered-day" />);
    rows.push(<T key="checkin" v="small" color={colors.green} testID="umrah-checkin">{t(checkIn && checkIn < v('permitDay')! ? 'umrah.checkInBefore' : 'umrah.checkInSame', { day: day(checkIn ?? v('permitDay')!) })}</T>);
  } else if (permit && permit !== 'has' && permit !== 'no' && checkIn) {
    rows.push(<Answered key="when" q={t('umrah.when.q')} a={v('when') && WHEN_KEY[v('when')!] ? `${t(WHEN_KEY[v('when')!]!)} · ${t('umrah.when.from', { day: day(checkIn) })}` : t('umrah.when.from', { day: day(checkIn) })}
      onChange={() => set({}, ['when', 'checkIn'])} testID="umrah-answered-when" />);
  }
  if (lastTen) {
    rows.push(<Notice key="lastten" icon="umrah" warn title={t('umrah.lastTen.title')}><T v="small" testID="umrah-lastten">{t('umrah.lastTen.body')}</T></Notice>);
  }
  if (checkIn && whoDone && !needParty && step !== 'who') {
    rows.push(<Answered key="who" q={t('request.q.whoGoing')} a={joinAnd(who.map(nameOf))} onChange={() => setWhoDone(false)} testID="umrah-answered-who" />);
  }
  if (v('makkahHotel') && step !== 'makkah') {
    rows.push(<Answered key="makkah" q={t('umrah.makkah.q')} a={stayAnswer(v('makkahHotel'), mkNights)} onChange={() => set({}, ['makkahHotel'])} testID="umrah-answered-makkah" />);
  }
  if (order && step !== 'madinah') {
    rows.push(<Answered key="madinah" q={t('umrah.madinah.q')} a={order === 'no' ? t('umrah.madinah.no') : order === 'before' ? t('umrah.madinah.before') : t('umrah.madinah.after')}
      onChange={() => set({}, ['madinah', 'madinahHotel'])} testID="umrah-answered-madinah" />);
  }
  if (order && order !== 'no' && v('madinahHotel') && step !== 'madinahHotel') {
    rows.push(<Answered key="madinahHotel" q={t('umrah.madinah.where')} a={stayAnswer(v('madinahHotel'), mdNights)} onChange={() => set({}, ['madinahHotel'])} testID="umrah-answered-madinah-hotel" />);
  }
  if (v('flyFrom') && step === 'plan') {
    const f = v('flyFrom');
    rows.push(<Answered key="fly" q={t('umrah.fly.q')} a={f === 'none' ? t('umrah.fly.none') : t(f === 'DMM' ? 'umrah.fly.dmm' : 'umrah.fly.ruh')} onChange={() => set({}, ['flyFrom'])} testID="umrah-answered-fly" />);
  }

  // ── the open question ──
  let open: ReactNode = null;
  if (step === 'permit') {
    open = (
      <Q q={t('umrah.permit.q')}>
        <ChipWrap>
          <Toggle label={t('umrah.permit.yes')} on={false} onPress={() => set({ permit: ['has'] })} testID="umrah-permit-yes" />
          <Toggle label={t('umrah.permit.no')} on={permit === 'no'} onPress={() => set({ permit: ['no'] })} testID="umrah-permit-no" />
        </ChipWrap>
        {permit === 'no' ? (
          <Animated.View entering={enter(0)} style={{ gap: 10 }}>
            <Notice icon="umrah"><T v="small" testID="umrah-permit-why">{t('umrah.permit.why')}</T></Notice>
            <ChipWrap>
              <Toggle label={t('umrah.permit.help')} on={false} onPress={() => set({ permit: ['help'] })} testID="umrah-permit-help" />
              <Toggle label={t('umrah.permit.self')} on={false} onPress={() => set({ permit: ['self'] })} testID="umrah-permit-self" />
            </ChipWrap>
          </Animated.View>
        ) : null}
      </Q>
    );
  } else if (step === 'day') {
    open = (
      <Q q={t('umrah.permit.day')}>
        <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('umrah.permit.pickDay')} onPress={() => setDayOpen(true)} testID="umrah-day-pick" />
      </Q>
    );
  } else if (step === 'slot') {
    open = (
      <Q q={t('umrah.permit.slot')} line={day(v('permitDay')!)}>
        <ChipWrap>
          {UMRAH_SLOTS.map((s) => <Toggle key={s} label={slotLabel(s)} on={false} testID={`umrah-slot-${SLOT_ID[s]}`} onPress={() => set({ permitSlot: [s], checkIn: [checkInFor(v('permitDay')!, s)] })} />)}
        </ChipWrap>
      </Q>
    );
  } else if (step === 'when') {
    // "In Ramadan" typed: which part of it; otherwise the three, and a day of their own.
    const opts = v('when') === 'In Ramadan' ? UMRAH_WHEN.filter((w) => w !== 'After Eid') : UMRAH_WHEN;
    open = (
      <Q q={t('umrah.when.q')}>
        <ChipWrap>
          {opts.map((w) => <Toggle key={w} label={t(WHEN_KEY[w]!)} on={false} testID={`umrah-when-${w === 'Early Ramadan' ? 'early' : w === 'After Eid' ? 'eid' : 'lastten'}`} onPress={() => set({ when: [w], checkIn: [checkInForWhen(w, today)!] })} />)}
          <Toggle label={t('umrah.when.pick')} on={false} onPress={() => setDayOpen(true)} testID="umrah-when-pick" />
        </ChipWrap>
      </Q>
    );
  } else if (step === 'party' && intent.party) {
    open = <PartyStep party={intent.party} people={people} today={today} selfName={selfName} onDone={(ids, babies) => { setWho(ids); setLap(babies); setNeedParty(false); setWhoDone(true); }} />;
  } else if (step === 'who') {
    open = (
      <Q q={t('request.q.whoGoing')}>
        <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
        <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} disabled={!who.length} label={who.length === 1 ? t('ask.q.just', { name: nameOf(who[0]!) }) : t('ask.q.these', { count: who.length })} onPress={() => { buzz('tap'); setWhoDone(true); }} testID="umrah-who-done" />
      </Q>
    );
  } else if (step === 'makkah' || step === 'madinahHotel') {
    const city: UmrahCity = step === 'makkah' ? 'makkah' : 'madinah';
    const nk = city === 'makkah' ? 'makkahNights' : 'madinahNights';
    const nights = city === 'makkah' ? mkNights : mdNights;
    open = (
      <Q q={t(city === 'makkah' ? 'umrah.makkah.q' : 'umrah.madinah.where')}>
        <ChipWrap>
          {NIGHTS.map((n) => <Toggle key={n} small label={tn('umrah.nights', n)} on={n === nights} accessibilityLabel={`${t('umrah.nights.a11y', { city: nameIn(city === 'makkah' ? 'Makkah' : 'Madinah', lang) })}: ${tn('umrah.nights', n)}`}
            onPress={() => setA((cur) => ({ ...cur, [nk]: [String(n)] }))} testID={`umrah-nights-${city}-${n}`} />)}
        </ChipWrap>
        {UMRAH_BANDS.map((b) => {
          const list = umrahHotelsIn(city, b);
          if (!list.length) return null;
          return (
            <View key={b} style={{ gap: 8 }} testID={`umrah-band-${city}-${b}`}>
              <T v="eyebrow">{city === 'madinah' && b === 'steps' ? t('umrah.band.nabawi') : t(BAND_KEY[b])}</T>
              {list.map((h) => (
                <Pressable key={h.key} accessibilityRole="button" accessibilityLabel={`${h.name}, ${formatSar(sarToHalalas(umrahStaySar(h, nights, guests)))}`}
                  onPress={() => set({ [city === 'makkah' ? 'makkahHotel' : 'madinahHotel']: [h.key], [nk]: [String(nights)] })}
                  style={({ pressed }) => [styles.hotel, pressed ? { opacity: 0.7 } : null]} testID={`umrah-hotel-${h.key}`}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Pressable accessibilityRole="link" accessibilityLabel={t('umrah.hotel.see', { hotel: h.name })} hitSlop={6} onPress={() => openHotel(h.key, city)} style={{ alignSelf: 'flex-start' }} testID={`umrah-hotel-open-${h.key}`}>
                      <T v="h3" style={{ fontSize: 15, textDecorationLine: 'underline' }}>{h.name}</T>
                    </Pressable>
                    <T v="tiny">{h.area} · {t(b === 'shuttle' ? 'umrah.hotel.shuttle' : 'umrah.hotel.walk', { min: h.minutes })}</T>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <T style={styles.price}>{formatSar(sarToHalalas(umrahStaySar(h, nights, guests)))}</T>
                    <T v="tiny">{tn('umrah.nights', nights)}</T>
                  </View>
                </Pressable>
              ))}
            </View>
          );
        })}
      </Q>
    );
  } else if (step === 'madinah') {
    open = (
      <Q q={t('umrah.madinah.q')}>
        <ChipWrap>
          <Toggle label={t('umrah.madinah.before')} on={false} onPress={() => set({ madinah: ['before'] })} testID="umrah-madinah-before" />
          <Toggle label={t('umrah.madinah.after')} on={false} onPress={() => set({ madinah: ['after'] })} testID="umrah-madinah-after" />
          <Toggle label={t('umrah.madinah.no')} on={false} onPress={() => set({ madinah: ['no'] })} testID="umrah-madinah-no" />
        </ChipWrap>
      </Q>
    );
  } else if (step === 'fly') {
    open = (
      <Q q={t('umrah.fly.q')}>
        <ChipWrap>
          <Toggle label={t('umrah.fly.ruh')} on={false} onPress={() => set({ flyFrom: ['RUH'] })} testID="umrah-fly-RUH" />
          <Toggle label={t('umrah.fly.dmm')} on={false} onPress={() => set({ flyFrom: ['DMM'] })} testID="umrah-fly-DMM" />
          <Toggle label={t('umrah.fly.none')} on={false} onPress={() => set({ flyFrom: ['none'] })} testID="umrah-fly-none" />
        </ChipWrap>
      </Q>
    );
  } else if (step === 'plan' && plan && checkIn) {
    open = <Plan a={a} plan={plan} count={ages.length} lang={lang} openHotel={openHotel} />;
  }

  const airports = umrahAirports(order === 'before' || order === 'after' ? order : null);
  return (
    <View style={{ gap: 18 }}>
      {rows}
      {open}
      {step === 'plan' ? (
        <View style={{ gap: 10 }}>
          {/* Needs: optional, one chip; open when the words already said one. */}
          <ChipWrap>
            <Toggle label={t('umrah.needs')} on={needsOpen} onPress={() => setNeedsOpen(!needsOpen)} accessibilityLabel={`${t('umrah.needs')}: ${t('umrah.needs.hint')}`} testID="umrah-needs" />
          </ChipWrap>
          {needsOpen ? (
            <Animated.View entering={enter(0)} style={{ gap: 8 }}>
              <T v="small">{t('umrah.needs.hint')}</T>
              <NeedsPicker who={who} needs={needs} onChange={setNeeds} hinted={intent.needsMentioned ?? []} nameOf={nameOf} />
            </Animated.View>
          ) : null}
          {v('flyFrom') && v('flyFrom') !== 'none' ? <T v="tiny">{t('umrah.fly.line', { into: nameIn(airports.into === 'MED' ? 'Madinah' : 'Jeddah', lang), home: nameIn(airports.home === 'MED' ? 'Madinah' : 'Jeddah', lang) })}</T> : null}
        </View>
      ) : null}
      <SearchSheet visible={dayOpen} day={{ title: step === 'day' ? t('umrah.permit.day') : t('umrah.when.pick') }} value={{ from: 'RUH', type: 'oneway', dep: v('permitDay') ?? checkIn, ret: null, cabin: 'economy', infants: 0, flex: false }}
        today={today} adults={1} onClose={() => setDayOpen(false)}
        onDone={(x) => { setDayOpen(false); if (!x.dep) return; if (step === 'day') set({ permitDay: [x.dep] }); else set({ checkIn: [x.dep] }, ['when']); }} />
    </View>
  );
}

/** One question: the serif line, then its choices. */
function Q({ q, line, children }: { q: string; line?: string; children: ReactNode }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: 12 }}>
      <T style={font('displaySmall')} accessibilityRole="header">{q}</T>
      {line ? <T v="small">{line}</T> : null}
      {children}
    </Animated.View>
  );
}

/** The plan in one card: the permit, each stay with its days and price, the train, the flights, the total. */
function Plan({ a, plan, count, lang, openHotel }: { a: A; plan: NonNullable<ReturnType<typeof umrahPlan>>; count: number; lang: ReturnType<typeof getLocale>; openHotel: (k: string, c: UmrahCity) => void }) {
  const price = (n: number) => formatSar(sarToHalalas(n));
  const line = (k: string) => plan.lines.find((l) => l.k === k)?.sar ?? 0;
  const d = plan.dates;
  const permit = a.permit?.[0] === 'has' && a.permitDay?.[0] ? `${rangeLabel(a.permitDay[0], null, lang)} · ${slotLabel(a.permitSlot?.[0])}` : a.permit?.[0] === 'help' ? t('umrah.sum.permitHelp') : t('umrah.sum.permitSelf');
  const stay = (city: UmrahCity) => {
    const key = a[city === 'makkah' ? 'makkahHotel' : 'madinahHotel']?.[0];
    const h = umrahHotel(key);
    const from = city === 'makkah' ? d.makkahIn : d.madinahIn;
    const to = city === 'makkah' ? d.makkahOut : d.madinahOut;
    if (!h || !from || !to) return null;
    return (
      <Row key={city} label={t(city === 'makkah' ? 'umrah.plan.makkah' : 'umrah.plan.madinah')} price={price(line(city))}>
        <Pressable accessibilityRole="link" accessibilityLabel={t('umrah.hotel.see', { hotel: h.name })} onPress={() => openHotel(h.key, city)} style={{ alignSelf: 'flex-start' }} testID={`umrah-plan-hotel-${h.key}`}>
          <T v="small" color={colors.green} style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }}>{h.name}</T>
        </Pressable>
        <T v="tiny">{rangeLabel(from, to, lang)} · {tn('umrah.nights', Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000))}</T>
      </Row>
    );
  };
  const first = a.madinah?.[0] === 'before' ? ['madinah', 'makkah'] : ['makkah', 'madinah'];
  return (
    <Animated.View entering={enter(0)} testID="umrah-plan">
      <Card style={{ gap: 12 }}>
        <T v="h2">{t('umrah.plan.title')}</T>
        <Row label={t('umrah.plan.permit')}><T v="small" color={colors.green}>{permit}</T></Row>
        {stay(first[0] as UmrahCity)}
        {line('train') ? <Row label={t('umrah.plan.train')} price={price(line('train'))}><T v="small" color={colors.green}>{t(a.madinah?.[0] === 'before' ? 'umrah.train.toMakkah' : 'umrah.train.toMadinah')}</T></Row> : null}
        {stay(first[1] as UmrahCity)}
        {line('flights') ? <Row label={t('umrah.plan.flights')} price={price(line('flights'))}><T v="small" color={colors.green}>{t(a.flyFrom?.[0] === 'DMM' ? 'umrah.fly.dmm' : 'umrah.fly.ruh')} · {rangeLabel(d.leave, d.home, lang)}</T></Row> : null}
        <View style={styles.total}>
          <Icon name="umrah" size={18} color={colors.green} />
          <T v="h3" style={{ flex: 1, fontSize: 15 }} testID="umrah-total">{tn('umrah.plan.total', count, { price: price(plan.totalSar) })}</T>
        </View>
        <T v="tiny">{t('umrah.plan.confirm')}</T>
      </Card>
    </Animated.View>
  );
}

function Row({ label, price, children }: { label: string; price?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="tiny" style={{ fontFamily: ff.ui600 }}>{label}</T>
        {children}
      </View>
      {price ? <T style={styles.price}>{price}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hotel: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  price: { fontFamily: ff.ui600, fontSize: 15, color: colors.green, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.line },
  total: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
