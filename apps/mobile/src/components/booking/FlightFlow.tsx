import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import {
  AIRPORT_NAMES, DESTINATIONS, addDays, daysBetween, formatSar, householdOf, quickDates,
  type AskIntent, type FlightOption, type FlightSearchResponse, type Person,
} from '@mada/shared';
import { bookingApi, useDemo, usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import { Pill } from '../Pill';
import { T } from '../Text';
import { AirlineMark } from './AirlineMark';
import { EntryChecks, blockLabel } from './EntryChecks';
import { dayName, rangeName } from './format';
import { ArtCalendar, Ask1, Leg, Notice, Working, useSequence, enter } from './parts';
import { ByHand, RequestFlow } from './Requests';
import { SearchSheet, type TripSearch } from './SearchSheet';
import { TravellerChips } from './Travellers';

/* Flights in Ask: one question at a time (where, when, back when, who), then Mada shows its work and three options. */

export type Cta = { label: string; disabled?: boolean; onPress: () => void; testID?: string } | null;
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ASK_CITIES: [string, string][] = [['Istanbul', 'istanbul'], ['Dubai', 'dubai'], ['Cairo', 'cairo'], ['London', 'london']];

export function FlightFlow({ intent, query, people, selfName, today, setCta }: { intent: AskIntent; query: string; people: Person[]; selfName: string; today: string; setCta: (c: Cta) => void }) {
  const router = useRouter();
  const demo = useDemo((s) => s.on);
  const H = useMemo(() => householdOf(people, today), [people, today]);
  const [where, setWhere] = useState<{ key: string | null; other: string | null }>({ key: intent.destination && intent.destination !== 'other' ? intent.destination : null, other: intent.destination === 'other' ? intent.destinationName : null });
  const [askingCity, setAskingCity] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [trip, setTrip] = useState<TripSearch>({ from: intent.from ?? 'RUH', type: intent.tripType ?? 'return', dep: intent.depart, ret: intent.return, cabin: intent.cabin ?? 'economy', infants: intent.infants, flex: false });
  const nonHelper = H.nonHelper.map((p) => p.id);
  const [who, setWho] = useState<string[]>(intent.travellerIds?.length ? intent.travellerIds : nonHelper.length ? nonHelper : H.me ? [H.me] : []);
  const [whoDone, setWhoDone] = useState(!!intent.travellerIds?.length || nonHelper.length <= 1);
  const [mode, setMode] = useState<'normal' | 'others' | 'byhand' | 'flex'>('normal');
  const [editing, setEditing] = useState<{ month?: { month: number; year: number } | null } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [bundle, setBundle] = useState(false);
  const [sort, setSort] = useState<'best' | 'cheapest' | 'fastest' | 'earliest'>('best');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const dest = where.key ? DESTINATIONS[where.key] ?? null : null;
  const byHand = !!where.other || !!dest?.byHand;
  const needRet = trip.type === 'return' && !!trip.dep && !trip.ret;
  const ready = (!!dest || !!where.other) && !!trip.dep && !needRet && whoDone;
  const live = ready && !byHand && !!dest;
  const steps = [t('search.working.checking', { city: dest?.name ?? '' }), t('search.working.holding'), t('search.working.matching', { count: who.length })];
  const step = useSequence(steps.length, 750, live ? `${runKey}` : null);
  const flags = [...demo].sort().join(',');
  const search = useQuery({
    queryKey: ['booking', 'flights', dest?.key, trip, who.join(), mode === 'flex', runKey, flags],
    enabled: live,
    staleTime: 600_000,
    queryFn: () => bookingApi.searchFlights({ from: trip.from, destination: dest!.key, depart: trip.dep!, return: trip.type === 'oneway' ? null : trip.ret, travellerIds: who, infants: trip.infants, cabin: trip.cabin, flexibleDays: mode === 'flex' || trip.flex ? 2 : 0 }),
  });
  const s: FlightSearchResponse | undefined = search.data;
  const entry = useQuery({
    queryKey: ['booking', 'entry', dest?.key, who.join(), trip.dep, trip.ret, answers, flags],
    enabled: live && !!s,
    queryFn: () => bookingApi.entry({ destination: dest!.key, travellerIds: who, depart: s!.depart, return: s!.return, answers }),
    placeholderData: (prev) => prev,
  });

  const options = useMemo(() => {
    const list = [...(s?.options ?? [])];
    if (sort === 'cheapest') list.sort((a, b) => a.total.amount - b.total.amount);
    if (sort === 'fastest') list.sort((a, b) => a.out.durationMin - b.out.durationMin);
    if (sort === 'earliest') list.sort((a, b) => a.out.dep.localeCompare(b.out.dep));
    return list;
  }, [s, sort]);
  const current: FlightOption | undefined = options.find((o) => o.id === pick) ?? s?.options[0];
  const showBundle = !!s?.bundle && trip.type === 'return';
  const total = (current?.total.amount ?? 0) + (bundle && showBundle ? s!.bundle!.total.amount : 0);
  const blocking = entry.data?.checks.filter((c) => c.blocking) ?? [];
  const results = live && step >= steps.length && !!s && !(s.outcome === 'partial' && mode === 'normal') && s.outcome !== 'none' && options.length > 0;

  useEffect(() => {
    if (!results || !current) { setCta(null); return; }
    const block = blockLabel(entry.data);
    setCta({
      label: block ?? t('search.review', { price: formatSar(total) }), disabled: !!block || entry.isFetching && !entry.data, testID: 'ask-review',
      onPress: () => {
        usePayDraft.getState().set({ draft: { kind: 'trip', flightOfferId: current.id, bundle: bundle && showBundle, travellerIds: who }, title: dest!.name, destination: dest!.key, askAgain: query });
        router.push('/pay');
      },
    });
  }, [results, current?.id, total, entry.data, bundle, who.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = editing ? (
    <SearchSheet visible value={trip} today={today} month={editing.month} adults={who.length} onClose={() => setEditing(null)}
      onDone={(v) => { setTrip(v); setEditing(null); setRunKey((k) => k + 1); setPick(null); }} />
  ) : null;

  if (!dest && !where.other) {
    return (
      <View style={{ gap: 12 }}>
        <Ask1 q={t('ask.q.where')} options={[...ASK_CITIES, [t('ask.q.elsewhere'), 'other']]} onPick={(v) => (v === 'other' ? setAskingCity(true) : setWhere({ key: v, other: null }))} />
        {askingCity ? (
          <Animated.View entering={enter(0)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1, gap: 6 }}>
              <T v="small" style={{ fontFamily: ff.ui600 }}>{t('ask.q.whichCity')}</T>
              <TextInput value={cityDraft} onChangeText={setCityDraft} placeholder={t('ask.q.cityHint')} placeholderTextColor={colors.muted} autoFocus={Platform.OS !== 'web'} accessibilityLabel={t('ask.q.whichCity')}
                style={[styles.input, font('body', colors.green), webNoOutline]} onSubmitEditing={() => submitCity()} testID="ask-city" />
            </View>
            <Button size="small" block={false} style={{ height: 52 }} label={t('ask.q.go')} disabled={!cityDraft.trim()} onPress={() => submitCity()} />
          </Animated.View>
        ) : null}
      </View>
    );
  }
  function submitCity() {
    const v = cityDraft.trim();
    if (!v) return;
    const hit = Object.values(DESTINATIONS).find((d) => d.words.test(v.toLowerCase()));
    setWhere(hit ? { key: hit.key, other: null } : { key: null, other: v.replace(/\b\w/g, (c) => c.toUpperCase()) });
    setAskingCity(false);
    buzz('tap');
  }

  if (!trip.dep) {
    const mo = intent.monthOnly;
    const quick = quickDates(today);
    const inMonth = mo ? quick.filter((q) => Number(q.dates[0].slice(5, 7)) === mo.month) : [];
    const opts: [string, string][] = mo
      ? [...inMonth.map((q): [string, string] => [`${q.label.split(' ·')[0]} · ${rangeName(q.dates[0], q.dates[1], today)}`, q.id]), [t('ask.q.pickDates'), 'pick']]
      : [...quick.map((q): [string, string] => [q.id === 'eid' ? `Eid al-Fitr · ${rangeName(q.dates[0], q.dates[1], q.dates[0])}` : `${q.label} · ${rangeName(q.dates[0], q.dates[1], today)}`, q.id]), [t('ask.q.pickDates'), 'pick']];
    return (
      <>
        <Ask1 q={mo ? t('ask.q.whenIn', { month: mo.label ?? MONTH_LONG[mo.month - 1]! }) : t('ask.q.when')} options={opts} onPick={(v) => {
          if (v === 'pick') { setEditing({ month: mo }); return; }
          const q = quick.find((x) => x.id === v)!;
          setTrip({ ...trip, dep: q.dates[0], ret: trip.type === 'oneway' ? null : q.dates[1] });
        }} />
        {sheet}
      </>
    );
  }
  if (needRet) {
    return (
      <>
        <Ask1 q={t('ask.q.return', { day: dayName(trip.dep, today) })} options={[[t('ask.q.after3', { day: dayName(addDays(trip.dep, 3), today) }), '3'], [t('ask.q.afterWeek', { day: dayName(addDays(trip.dep, 7), today) }), '7'], [t('ask.q.oneWay'), 'oneway'], [t('ask.q.pickDates'), 'pick']]}
          onPick={(v) => (v === 'pick' ? setEditing({}) : v === 'oneway' ? setTrip({ ...trip, type: 'oneway', ret: null }) : setTrip({ ...trip, ret: addDays(trip.dep!, Number(v)) }))} />
        {sheet}
      </>
    );
  }
  if (!whoDone) {
    const self = people.find((p) => p.id === who[0]);
    return (
      <Animated.View entering={enter(0)} style={{ gap: 12 }}>
        <T v="h2">{t('ask.q.who')}</T>
        {intent.travellerCount && intent.travellerCount > who.length ? <T v="small">{t('ask.q.whoSaid', { count: intent.travellerCount })}</T> : null}
        <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} />
        <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={who.length === 1 ? t('ask.q.just', { name: self?.firstName || selfName || 'you' }) : t('ask.q.these', { count: who.length })} onPress={() => setWhoDone(true)} testID="ask-who-done" />
      </Animated.View>
    );
  }
  if (byHand) {
    const city = dest?.name ?? where.other ?? '';
    return (
      <View style={{ gap: 14 }}>
        <ByHand city={city} queued={demo.has('offline')} />
        <RequestFlow kind="flight" query={query} intent={null} people={people} selfName={selfName} autoSend
          search={{ destination: dest?.key ?? null, destinationName: where.other, from: trip.from, depart: trip.dep, return: trip.type === 'oneway' ? null : trip.ret, cabin: trip.cabin, carrier: null }} />
      </View>
    );
  }

  if (step < steps.length || search.isLoading || !s) return <Working lines={steps} step={Math.min(step, steps.length - 1)} />;

  if (s.outcome === 'partial' && mode === 'normal') {
    const airline = s.unavailable[0]?.airline ?? '';
    return (
      <Animated.View entering={enter(0)} style={{ gap: 12 }}>
        <Notice icon="flight" warn title={t('search.down.title', { airline })}><T v="small">{t('search.down.body', { airline })}</T></Notice>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button size="small" block={false} label={t('search.down.others')} onPress={() => setMode('others')} />
          <Button size="small" block={false} variant="secondary" label={t('search.down.byHand')} onPress={() => setMode('byhand')} />
        </View>
      </Animated.View>
    );
  }
  if (mode === 'byhand') {
    return (
      <RequestFlow kind="flight" query={t('request.title.airlineByHand', { airline: s.unavailable[0]?.airline ?? '', city: dest!.name, dates: rangeName(trip.dep, trip.ret, today) })} intent={null} people={people} selfName={selfName}
        sysNote={t('search.down.note', { airline: s.unavailable[0]?.airline ?? '' })} autoSend
        search={{ destination: dest!.key, destinationName: null, from: trip.from, depart: trip.dep, return: trip.ret, cabin: trip.cabin, carrier: s.unavailable[0]?.carrier ?? null }} />
    );
  }
  if (s.outcome === 'none' || !options.length) {
    const retry = () => { setMode('flex'); setRunKey((k) => k + 1); };
    return (
      <EmptyState art={<ArtCalendar day={String(Number(trip.dep.slice(8)))} />} title={t('search.none.title')} body={t('search.none.body', { city: dest!.name, day: dayName(trip.dep, today) })}
        action={<Button label={t('search.none.flex')} onPress={retry} />} ideas={[[t('search.none.stop'), retry]]} />
    );
  }

  const nights = s.return ? daysBetween(s.depart, s.return) : 0;
  const dateLabel = trip.type === 'oneway' ? t('search.summaryOneWay', { date: rangeName(s.depart, null, today) }) : rangeName(s.depart, s.return, today);
  const words = [t('search.ways.one'), t('search.ways.two'), t('search.ways.three')];
  return (
    <View style={{ gap: 12 }}>
      <Animated.View entering={enter(0)} style={styles.rowTiny}><Icon name="check" color={colors.ok} size={16} width={2.4} /><T v="tiny">{t('search.checked', { count: s.checked, people: who.length })}</T></Animated.View>
      {blocking.length ? <T v="small" color={colors.goldInk}>{blocking.length === 1 ? t('search.blocking.one') : t('search.blocking.other', { count: blocking.length })}</T> : null}
      <Animated.View entering={enter(1)}><T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{words[Math.min(options.length, 3) - 1]}</T></Animated.View>
      {intent.cabinNote ? <T v="small">{intent.cabinNote}</T> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t('search.a11y.edit')} onPress={() => setEditing({})} style={styles.summary} testID="search-edit">
        <View style={{ flex: 1, gap: 1 }}>
          <T v="h3" style={{ fontSize: 15 }}>{t('search.summary', { from: AIRPORT_NAMES[s.from] ?? s.from, to: dest!.name, dates: dateLabel })}</T>
          <T v="tiny">{tn('search.people', who.length)}{trip.infants ? ` ${t('search.lap', { count: trip.infants })}` : ''} · {t(`cal.cabin.${trip.cabin === 'first' ? 'business' : trip.cabin}`)}{trip.flex ? ` · ${t('search.flex')}` : ''}</T>
        </View>
        <T v="h3" style={{ fontSize: 14, textDecorationLine: 'underline' }}>{t('search.edit')}</T>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 16 }} accessibilityRole="tablist">
        {(['best', 'cheapest', 'fastest', 'earliest'] as const).map((id) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: sort === id }} onPress={() => { buzz('select'); setSort(id); }} style={[styles.sortTab, sort === id ? styles.sortOn : null]}>
            <T style={[font('h3', sort === id ? colors.green : '#7a857f'), { fontSize: 14 }]}>{t(`search.sort.${id}`)}</T>
          </Pressable>
        ))}
      </View>
      {options.map((f, i) => {
        const on = current?.id === f.id;
        return (
          <Animated.View key={f.id} entering={enter(i + 2)}>
            <Card padding={0} selected={on} style={{ gap: 0 }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${f.airline}, ${formatSar(f.total.amount)}`}
                onPress={() => { buzz('select'); if (on) setOpen(open === f.id ? null : f.id); else { setPick(f.id); setOpen(null); } }} style={styles.opt} testID={`flight-${f.out.flightNumber}`}>
                <View style={styles.spread}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <AirlineMark carrier={f.carrier} brand={f.brand} label={f.airline} />
                    <View style={{ gap: 2 }}>
                      <T v="h3" style={{ fontSize: 15 }}>{f.airline}</T>
                      <Pill label={t(`search.label.${f.label}`)} variant={on ? 'gold' : 'default'} height={22} />
                    </View>
                  </View>
                  <T style={styles.price}>{formatSar(f.total.amount)}</T>
                </View>
                <Leg dep={f.out.dep} arr={f.out.arr} from={f.out.from} to={f.out.to} durationMin={f.out.durationMin} stop={f.stop} />
                <T v="small">{f.reason}</T>
              </Pressable>
              {on && open === f.id ? (
                <Animated.View entering={enter(0)} style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
                  <View style={styles.divider} />
                  {([[t('search.rule.bags'), f.bags], [t('search.rule.change'), f.changeRule], [t('search.rule.cancel'), f.refundRule],
                    ...(f.back ? [[t('search.rule.return'), `${f.back.flightNumber} · ${dayName(f.back.date, today)}`]] : []),
                    ...(f.infants ? [[t('search.rule.lap'), t('search.rule.lapValue', { price: formatSar(f.infantPrice.amount) })]] : [])] as [string, string][]).map(([k, v]) => (
                    <View key={k} style={styles.spread}><T v="small">{k}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{v}</T></View>
                  ))}
                </Animated.View>
              ) : on ? <T v="tiny" style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{t('search.tapAgain')}</T> : null}
            </Card>
          </Animated.View>
        );
      })}
      <Card variant="well" style={{ gap: 10 }}>
        <T v="h3">{t('search.travellers')}</T>
        <TravellerChips people={people} value={who} onChange={(ids) => { setWho(ids); setPick(null); }} selfName={selfName} />
      </Card>
      <EntryChecks result={entry.data} destination={dest!.key} travellerIds={who} depart={s.depart} ret={s.return}
        answer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} remove={(id) => { setWho((w) => w.filter((x) => x !== id)); setPick(null); }} />
      {showBundle ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <T v="h3">{who.some((id) => people.find((p) => p.id === id)?.relation === 'helper') ? t('search.bundle.helper') : who.length > 2 ? t('search.bundle.family') : who.length === 2 ? t('search.bundle.two') : t('search.bundle.one')}</T>
            <T v="small">{tn('search.bundle.nights', nights, { price: formatSar(s.bundle!.total.amount) })}</T>
          </View>
          <Button size="small" block={false} variant={bundle ? 'primary' : 'secondary'} style={bundle ? undefined : { backgroundColor: colors.mist }} label={bundle ? t('search.bundle.added') : t('search.bundle.add')} haptic="select" onPress={() => setBundle(!bundle)} testID="bundle-add" />
        </Card>
      ) : null}
      <View style={{ height: 60 }} />
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { height: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16, fontSize: 17 },
  rowTiny: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.paper },
  sortTab: { paddingVertical: 4, borderBottomWidth: 2, borderColor: 'transparent' },
  sortOn: { borderColor: colors.gold },
  opt: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontFamily: ff.ui600, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.line },
});
