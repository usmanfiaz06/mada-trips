import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, Platform } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AIRPORT_NAMES, CATALOGUE_HOTELS, catalogueStay, DESTINATIONS, addDays, daysBetween, familyRank, formatSar, hasLittleOnes, householdOf, monthLongName, nameIn, permitAnswers, quickDates,
  type AskIntent, type FlightOption, type FlightSearchRequest, type FlightSearchResponse, type Household, type Person, flightWishKey, flightWishLabel, parseFlightWishes, refineFlights, type FlightWish } from '@mada/shared';
import { bookingApi, useDemo, usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import { Pill } from '../Pill';
import { Sheet } from '../Sheet';
import { SupplierDown } from '../states/SupplierDown';
import { GaveUp, STAGES_SUPPLIER, Waiting, localTimeFact, useStagedLine } from '../states/Waiting';
import { SUPPLIER_GIVE_UP_MS, useGiveUp } from '@/lib/net/give-up';
import { isOffline } from '@/lib/net/state';
import { T } from '../Text';
import { AirlineMark } from './AirlineMark';
import { EntryChecks, blockLabel } from './EntryChecks';
import { BundleStayLines } from './CatalogueStay';
import { dayName, rangeName } from './format';
import { ArtCalendar, Ask1, Leg, MadaDot, useWho, enter } from './parts';
import { ByHand, RequestFlow, SentRequest } from './Requests';
import { Answered } from './Conversation';
import { PhoneGate, usePhoneNeeded } from './PhoneSheet';
import { FlightRequestForm } from './FlightRequest';
import { useFlightsByRequest } from '@/lib/beta';
import { SearchSheet, type TripSearch } from './SearchSheet';
import { TravellerChips } from './Travellers';
import { FareBreakdown, PartyStep } from './Party';
import { ASK_RESUME, requireAccount } from '@/lib/signin-ask';
import { DemoFare } from './DemoFare';
import { flightPickKey, noteAskPick, pendingPick, usedPendingPick } from '@/lib/resume';

/* Flights in Ask: one question at a time (where, when, back when, who), then Mada shows its work and three options. */

/** The one action at the bottom of Ask; with refine, the box above it says what matters for these results. */
export type Cta = {
  label: string; disabled?: boolean; onPress: () => void; testID?: string; refine?: { hint: string; onSubmit: (text: string) => boolean | void; testID?: string };
  /** A layer over the results that fills the space between the top bar and the action (the stays map): nothing scrolls under it. */
  stage?: React.ReactNode;
  /** The action and the box step aside (a hotel's card on the map does their job); the stage runs to the bottom. */
  bare?: boolean;
} | null;
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const ASK_CITIES: [string, string][] = [['Istanbul', 'istanbul'], ['Dubai', 'dubai'], ['Cairo', 'cairo'], ['London', 'london']];

/** The weeks of a month still ahead, Sunday to Saturday as Saudi weeks run, cut to the month: "1–5 Dec", "6–12 Dec"… */
function monthWeeks(year: number, month: number, today: string): [string, string][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`, -1);
  const out: [string, string][] = [];
  let a = first;
  while (a <= last) {
    const sat = addDays(a, 6 - new Date(`${a}T00:00:00Z`).getUTCDay());
    const b = sat < last ? sat : last;
    if (b > today) out.push([a < today ? addDays(today, 1) : a, b]);
    a = addDays(b, 1);
  }
  return out.filter(([x, y]) => y > x).slice(0, 5);
}

/* The first search of a flow, built the same way here and in useFlightHeadStart, so a search started early is the one the flow shows. */
const tripOf = (intent: AskIntent): TripSearch => ({ from: intent.from ?? 'RUH', type: intent.tripType ?? 'return', dep: intent.depart, ret: intent.return, cabin: intent.cabin ?? 'economy', infants: intent.infants, flex: false });
const whoOf = (intent: AskIntent, H: Household): string[] => (intent.travellerIds?.length ? intent.travellerIds : H.nonHelper.length ? H.nonHelper.map((p) => p.id) : H.me ? [H.me] : []);
const flightsKey = (dest: string | undefined, trip: TripSearch, who: string[], flex: boolean, runKey: number, flags: string) => ['booking', 'flights', dest, trip, who.join(), flex, runKey, flags];
const flightsBody = (dest: string, trip: TripSearch, who: string[], flex: boolean): FlightSearchRequest => ({ from: trip.from, destination: dest, depart: trip.dep!, return: trip.type === 'oneway' ? null : trip.ret, travellerIds: who, infants: trip.infants, cabin: trip.cabin, flexibleDays: flex || trip.flex ? 2 : 0 });
const entryKey = (dest: string | undefined, who: string[], depart: string | null, ret: string | null, answers: Record<string, string>, permit: boolean, flags: string) => ['booking', 'entry', dest, who.join(), depart, ret, answers, permit, flags];

/**
 * Ask starts the flight search and the entry check from the words as the phone reads them (the same rules as the
 * server), while the server reads them too. When the server's reading opens the same search, the flow finds it already
 * on its way; when it doesn't, nothing shown changes (the flow runs its own).
 */
export function useFlightHeadStart(people: Person[], today: string) {
  const qc = useQueryClient();
  const demo = useDemo((s) => s.on);
  const byRequest = useFlightsByRequest();
  const phoneNeeded = usePhoneNeeded();
  return (intent: AskIntent) => {
    if (byRequest || phoneNeeded || intent.kind !== 'flight' || intent.ask || !people.length || isOffline()) return;
    const dest = intent.destination ? DESTINATIONS[intent.destination] : undefined;
    const trip = tripOf(intent);
    if (!dest || dest.byHand || !trip.dep || (trip.type === 'return' && !trip.ret)) return;
    const H = householdOf(people, today);
    // Who is going is settled without asking (FlightFlow's whoDone): named, or a household of one.
    if ((intent.party && !intent.travellerIds?.length) || !(intent.travellerIds?.length || H.nonHelper.length <= 1)) return;
    const who = whoOf(intent, H);
    if (!who.length) return;
    const flags = [...demo].sort().join(',');
    const ret = trip.type === 'oneway' ? null : trip.ret;
    const permit = !!intent.answers.permit?.length;
    void qc.prefetchQuery({ queryKey: flightsKey(dest.key, trip, who, false, 0, flags), queryFn: () => bookingApi.searchFlights(flightsBody(dest.key, trip, who, false)), staleTime: 600_000 });
    void qc.prefetchQuery({
      queryKey: entryKey(dest.key, who, trip.dep, ret, {}, permit, flags), staleTime: 60_000,
      queryFn: () => bookingApi.entry({ destination: dest.key, travellerIds: who, depart: trip.dep!, return: ret, answers: permitAnswers(intent, who, dest.key) }),
    });
  };
}

export function FlightFlow({ intent, query, people, selfName, today, setCta, onSync }: {
  intent: AskIntent; query: string; people: Person[]; selfName: string; today: string; setCta: (c: Cta) => void;
  /** What this flow has settled (asked here, not typed), so a correction typed later starts from it. */
  onSync?: (patch: Partial<AskIntent>) => void;
}) {
  const router = useRouter();
  const demo = useDemo((s) => s.on);
  const H = useMemo(() => householdOf(people, today), [people, today]);
  const [where, setWhere] = useState<{ key: string | null; other: string | null }>({ key: intent.destination && intent.destination !== 'other' ? intent.destination : null, other: intent.destination === 'other' ? intent.destinationName : null });
  const [askingCity, setAskingCity] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const [trip, setTrip] = useState<TripSearch>(() => tripOf(intent));
  const nonHelper = H.nonHelper.map((p) => p.id);
  const [who, setWho] = useWho(() => whoOf(intent, H));
  // Asked only for a household of more than one, which may arrive after the flow opens.
  const [whoDoneSet, setWhoDone] = useState<boolean | null>(intent.travellerIds?.length ? true : null);
  // Counts or ages said that the household doesn't cover ("2 adults and 3 kids aged 2, 6 and 13"): the stepper asks first.
  const [needParty, setNeedParty] = useState(!!intent.party && !intent.travellerIds?.length);
  const whoDone = !needParty && (whoDoneSet ?? nonHelper.length <= 1);
  const [mode, setMode] = useState<'normal' | 'others' | 'byhand' | 'flex'>('normal');
  const [editing, setEditing] = useState<{ month?: { month: number; year: number } | null } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  // The fare rules (bags, change, refund) of one option, in a sheet over the results.
  const [rulesOf, setRulesOf] = useState<string | null>(null);
  const [bundle, setBundle] = useState(false);
  const [sort, setSort] = useState<'best' | 'cheapest' | 'fastest' | 'earliest'>('best');
  // Wishes said in the box under the results ("morning, direct, with bags"): chips that filter, and one line back.
  const [fwishes, setFwishes] = useState<FlightWish[]>([]);
  const [funread, setFunread] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Flights by request (the beta): no live fares; the form goes to Mada and the fares come back in the request.
  const byRequest = useFlightsByRequest();
  // Booking needs a verified phone (the server says so): asked here, before the search, not at the payment.
  const phoneNeeded = usePhoneNeeded();
  // Questions this flow asked (not ones the words answered): they stay above as the traveller's answers, tap to change.
  const [asked] = useState(() => ({ where: !intent.destination, when: !intent.depart }));
  const [sentId, setSentId] = useState<string | null | undefined>(undefined);

  const dest = where.key ? DESTINATIONS[where.key] ?? null : null;
  // The airlines too slow to answer, and "Ask Mada to find it for you" tapped: the desk finds the flights by hand.
  const [deskFind, setDeskFind] = useState(false);
  const byHand = !!where.other || !!dest?.byHand || deskFind;
  const needRet = trip.type === 'return' && !!trip.dep && !trip.ret;
  const ready = (!!dest || !!where.other) && !!trip.dep && !needRet && (whoDone || byRequest);
  const live = ready && !byHand && !!dest && !byRequest && !phoneNeeded;
  // Never "for 0": with nobody loaded yet (offline, or the household still on its way) the line names no count.
  const flags = [...demo].sort().join(',');
  const search = useQuery({
    queryKey: flightsKey(dest?.key, trip, who, mode === 'flex', runKey, flags),
    enabled: live,
    staleTime: 600_000,
    queryFn: () => bookingApi.searchFlights(flightsBody(dest!.key, trip, who, mode === 'flex')),
  });
  const s: FlightSearchResponse | undefined = search.data;
  // No endless "Checking…": a search that fails or takes too long says so, with Try again and Talk to Mada.
  const searchKey = flightsKey(dest?.key, trip, who, mode === 'flex', runKey, flags);
  const wait = useGiveUp(search, { key: searchKey, queryKey: searchKey, active: live, giveUpMs: SUPPLIER_GIVE_UP_MS });
  // While the airlines answer: the options to come, and a line that says what is being done as the seconds pass.
  const flightDates = trip.dep ? (trip.type === 'oneway' || !trip.ret ? rangeName(trip.dep, null, today) : rangeName(trip.dep, trip.ret, today)) : '';
  const flightLines = [t('waiting.flights.0', { city: dest?.name ?? '', dates: flightDates }), t('waiting.flights.1'), t('waiting.flights.2'), t('waiting.flights.3')];
  const waitLine = useStagedLine(flightLines, STAGES_SUPPLIER, live && !s ? JSON.stringify(searchKey) : null);
  // "I have a permit", typed as a correction: the visa and re-entry checks count as in hand.
  const permit = !!intent.answers.permit?.length;
  // Checked alongside the search, for the days asked; again only if the search moved the days (a day either side).
  const entryDep = s?.depart ?? trip.dep;
  const entryRet = s ? s.return : trip.type === 'oneway' ? null : trip.ret;
  const entry = useQuery({
    queryKey: entryKey(dest?.key, who, entryDep, entryRet, answers, permit, flags),
    enabled: live && !!entryDep,
    queryFn: () => bookingApi.entry({ destination: dest!.key, travellerIds: who, depart: entryDep!, return: entryRet, answers: { ...permitAnswers(intent, who, dest?.key), ...answers } }),
    placeholderData: (prev) => prev,
  });


  const travellers = useMemo(() => who.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p), [who, people]);
  // A child under 5 or a baby going: a 02:10 departure is never "best" or "earliest"; night flights go last.
  const littleOnes = !!trip.dep && hasLittleOnes(travellers, trip.infants, trip.dep);
  const options = useMemo(() => {
    const list = [...(s?.options ?? [])];
    if (sort === 'cheapest') list.sort((a, b) => a.total.amount - b.total.amount);
    if (sort === 'fastest') list.sort((a, b) => a.out.durationMin - b.out.durationMin);
    if (sort === 'earliest') list.sort((a, b) => a.out.dep.localeCompare(b.out.dep));
    const ranked = familyRank(list, littleOnes);
    return sort === 'best' || sort === 'earliest' ? ranked : list.map((o) => ranked.find((r) => r.id === o.id)!);
  }, [s, sort, littleOnes]);
  const nightIds = useMemo(() => new Set(options.filter((o) => o.night).map((o) => o.id)), [options]);
  useEffect(() => {
    onSync?.({ destination: where.key ?? (where.other ? 'other' : null), destinationName: where.other, from: trip.from, depart: trip.dep, return: trip.ret, tripType: trip.type, cabin: trip.cabin, infants: trip.infants, travellerIds: whoDone ? who : intent.travellerIds });
  }, [where.key, where.other, trip, who.join(), whoDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const refinedF = useMemo(() => refineFlights(options, fwishes), [options, fwishes]);
  const shownOptions = fwishes.length && refinedF.matches.length ? refinedF.matches : options;
  const current: FlightOption | undefined = shownOptions.find((o) => o.id === pick) ?? shownOptions[0] ?? s?.options[0];
  const showBundle = !!s?.bundle && trip.type === 'return';
  const total = (current?.total.amount ?? 0) + (bundle && showBundle ? s!.bundle!.total.amount : 0);
  const blocking = entry.data?.checks.filter((c) => c.blocking) ?? [];
  const results = live && !!s && !(s.outcome === 'partial' && mode === 'normal') && s.outcome !== 'none' && options.length > 0;
  // Back after signing in, a language switch or a reload: the flight that was picked, picked again (lib/resume.ts).
  useEffect(() => {
    const want = results ? pendingPick('flight') : null;
    if (!want) return;
    usedPendingPick();
    const o = options.find((x) => flightPickKey(x) === want);
    // Once, when the results arrive: the saved pick is outside React (lib/resume.ts), so it can't be derived in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (o) setPick(o.id);
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (results && current) noteAskPick({ kind: 'flight', key: flightPickKey(current) }); }, [results, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (byRequest) return; // the request form owns the action (FlightRequest.tsx)
    if (!results || !current) { setCta(null); return; }
    const block = blockLabel(entry.data);
    setCta({
      label: block ?? t('search.review', { price: formatSar(total) }), disabled: !!block || entry.isFetching && !entry.data, testID: 'ask-review',
      onPress: () => {
        // A guest signs in here, and comes back to this very option (lib/resume.ts).
        if (!requireAccount('book', ASK_RESUME)) return;
        usePayDraft.getState().set({ draft: { kind: 'trip', flightOfferId: current.id, bundle: bundle && showBundle, travellerIds: who }, title: dest!.name, destination: dest!.key, askAgain: query });
        router.push('/pay');
      },
      refine: {
        hint: t('flights.ask.hint'), testID: 'flights-refine',
        onSubmit: (text) => {
          const p = parseFlightWishes(text);
          buzz('tap');
          if (!p.wishes.length) { setFunread(true); return false; }
          setFunread(false); setPick(null);
          setFwishes((w) => [...w.filter((x) => !p.wishes.some((y) => flightWishKey(y) === flightWishKey(x))), ...p.wishes]);
          return true;
        },
      },
    });
  }, [results, current?.id, total, entry.data, bundle, who.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = editing ? (
    <SearchSheet visible value={trip} today={today} month={editing.month} adults={who.length} onClose={() => setEditing(null)}
      onDone={(v) => { setTrip(v); setEditing(null); setRunKey((k) => k + 1); setPick(null); }} />
  ) : null;

  // Asked to change who's going ("What should Mada change?" → Who's going): the stepper comes first.
  if (needParty && intent.party && intent.ask === 'who') {
    return (
      <PartyStep party={intent.party} people={people} today={today} selfName={selfName}
        onDone={(ids, lap) => { setWho(ids); setTrip((x) => ({ ...x, infants: lap })); setNeedParty(false); setWhoDone(true); setPick(null); }} />
    );
  }
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

  const cityName = dest ? nameIn(dest.name, getLocale()) : where.other ?? '';
  const whereRow = asked.where ? <Answered q={t('ask.q.where')} a={cityName} onChange={() => { setWhere({ key: null, other: null }); setRunKey((k) => k + 1); }} testID="flight-where-answer" /> : null;
  const whenRow = asked.when && trip.dep ? <Answered q={t('ask.q.when')} a={trip.type === 'oneway' || !trip.ret ? rangeName(trip.dep, null, today) : rangeName(trip.dep, trip.ret, today)} onChange={() => setTrip({ ...trip, dep: null, ret: null })} testID="flight-when-answer" /> : null;

  if (!trip.dep) {
    const mo = intent.monthOnly;
    const quick = quickDates(today);
    const inMonth = mo ? quick.filter((q) => Number(q.dates[0].slice(5, 7)) === mo.month) : [];
    // "December" said: its weeks as the answers (critique 2, #2), not just "I'll pick dates".
    const weeks = mo && !mo.label ? monthWeeks(mo.year, mo.month, today) : [];
    const opts: [string, string][] = mo
      ? [...inMonth.map((q): [string, string] => [`${q.name} · ${rangeName(q.dates[0], q.dates[1], today)}`, q.id]), ...weeks.map((w): [string, string] => [rangeName(w[0], w[1], today), `week:${w[0]}:${w[1]}`]), [t('ask.q.pickDates'), 'pick']]
      : [...quick.map((q): [string, string] => [`${q.name} · ${rangeName(q.dates[0], q.dates[1], today)}`, q.id]), [t('ask.q.pickDates'), 'pick']];
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        <Ask1 q={mo ? t('ask.q.whenIn', { month: mo.label ?? monthLongName(mo.month - 1) }) : t('ask.q.when')} options={opts} onPick={(v) => {
          if (v === 'pick') { setEditing({ month: mo }); return; }
          if (v.startsWith('week:')) { const [, a, b] = v.split(':'); setTrip({ ...trip, dep: a!, ret: trip.type === 'oneway' ? null : b! }); return; }
          const q = quick.find((x) => x.id === v)!;
          setTrip({ ...trip, dep: q.dates[0], ret: trip.type === 'oneway' ? null : q.dates[1] });
        }} />
        {sheet}
      </View>
    );
  }
  if (needRet) {
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        <Ask1 q={t('ask.q.return', { day: dayName(trip.dep, today) })} options={[[t('ask.q.after3', { day: dayName(addDays(trip.dep, 3), today) }), '3'], [t('ask.q.afterWeek', { day: dayName(addDays(trip.dep, 7), today) }), '7'], [t('ask.q.oneWay'), 'oneway'], [t('ask.q.pickDates'), 'pick']]}
          onPick={(v) => (v === 'pick' ? setEditing({}) : v === 'oneway' ? setTrip({ ...trip, type: 'oneway', ret: null }) : setTrip({ ...trip, ret: addDays(trip.dep!, Number(v)) }))} />
        {sheet}
      </View>
    );
  }
  if (needParty && intent.party) {
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        {whenRow}
        <PartyStep party={intent.party} people={people} today={today} selfName={selfName}
          onDone={(ids, lap) => { setWho(ids); setTrip((x) => ({ ...x, infants: lap })); setNeedParty(false); setWhoDone(true); setPick(null); }} />
      </View>
    );
  }
  if (byRequest) {
    if (sentId !== undefined) return <SentRequest id={sentId} people={people} selfName={selfName} />;
    return (
      <>
        <FlightRequestForm city={dest?.name ?? where.other ?? ''} destKey={dest?.key ?? null} trip={trip} who={who} setWho={setWho} people={people} selfName={selfName} today={today} query={query}
          onEdit={() => setEditing({})} setCta={setCta} onSent={(id) => { setCta(null); setSentId(id); }} />
        {sheet}
      </>
    );
  }
  if (!whoDone) {
    const self = people.find((p) => p.id === who[0]);
    return (
      <Animated.View entering={enter(0)} style={{ gap: 12 }}>
        {whereRow}
        {whenRow}
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

  if (phoneNeeded && !byHand) {
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        {whenRow}
        <PhoneGate why={t('ask.phone.beforeFlights', { city: cityName })} />
      </View>
    );
  }
  if (!s && wait.view !== 'loading' && wait.view !== 'ready') return <GaveUp wait={wait} kind="flights" onFind={() => { buzz('tap'); setDeskFind(true); }} testID={`flights-${wait.view}`} />;
  if (search.isLoading || !s) return <Waiting kind="flights" line={waitLine} fact={localTimeFact(dest?.key)} testID="flights-waiting" />;

  if (s.outcome === 'partial' && mode === 'normal') {
    const airline = s.unavailable[0]?.airline ?? '';
    return (
      <Animated.View entering={enter(0)} style={{ gap: 12 }}>
        <SupplierDown supplier={airline} body={t('search.down.body', { airline })} testID="search-supplier-down" actions={<>
          <Button size="small" block={false} label={t('search.down.others')} onPress={() => setMode('others')} />
          <Button size="small" block={false} variant="secondary" label={t('search.down.byHand')} onPress={() => setMode('byhand')} />
        </>} />
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
  // The bundle's hotel, by name, opens its page.
  const bundleHotel = s.bundle ? Object.values(CATALOGUE_HOTELS).flat().find((h) => h.name === s.bundle!.hotelName) ?? null : null;
  return (
    <View style={{ gap: 12 }}>
      <Animated.View entering={enter(0)} style={styles.rowTiny}><Icon name="check" color={colors.ok} size={16} width={2.4} /><T v="tiny">{t('search.checked', { count: s.checked, people: who.length })}</T></Animated.View>
      {blocking.length ? <T v="small" color={colors.goldInk}>{blocking.length === 1 ? t('search.blocking.one') : t('search.blocking.other', { count: blocking.length })}</T> : null}
      <Animated.View entering={enter(1)}><T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{words[Math.min(options.length, 3) - 1]}</T></Animated.View>
      {intent.cabinNote ? <T v="small">{intent.cabinNote}</T> : null}
      {littleOnes && options.some((o) => o.night) ? <T v="small" testID="family-first">{t('search.family.first')}</T> : null}
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
      {fwishes.length || funread ? (
        <View style={{ gap: 8 }} testID="flights-wishes">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {fwishes.map((w) => (
              <Pressable key={flightWishKey(w)} accessibilityRole="button" accessibilityLabel={t('stays.wishes.remove', { wish: flightWishLabel(w, options.find((o) => o.carrier === w.carrier)?.airline) })}
                onPress={() => { buzz('select'); setFunread(false); setFwishes((x) => x.filter((y) => flightWishKey(y) !== flightWishKey(w))); }} style={styles.wish} testID={`fwish-${flightWishKey(w)}`}>
                <T v="small" color={colors.mist} style={{ fontFamily: ff.ui600 }}>{flightWishLabel(w, options.find((o) => o.carrier === w.carrier)?.airline)}</T>
                <Icon name="close" size={14} color={colors.mist} />
              </Pressable>
            ))}
          </View>
          <View style={styles.answer} testID="flights-answer">
            <MadaDot size={26} />
            <T v="small" color={colors.green} style={{ flex: 1 }}>{funread ? t('fix.notRead') : `${refinedF.answer}${fwishes.length && !refinedF.matches.length ? ` ${t('refine.closest')}` : ''}`}</T>
          </View>
        </View>
      ) : null}
      {shownOptions.map((f, i) => {
        const on = current?.id === f.id;
        return (
          <Animated.View key={f.id} entering={enter(i + 2)}>
            <Card padding={0} selected={on} style={{ gap: 0 }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${f.airline}, ${formatSar(f.total.amount)}`}
                onPress={() => { buzz('select'); setPick(f.id); }} style={styles.opt} testID={`flight-${f.out.flightNumber}`}>
                <View style={styles.spread}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <AirlineMark carrier={f.carrier} brand={f.brand} label={f.airline} />
                    <View style={{ gap: 2 }}>
                      <T v="h3" style={{ fontSize: 15 }}>{f.airline}</T>
                      <Pill label={nightIds.has(f.id) ? t('search.label.night') : t(`search.label.${f.label}`)} variant={on && !nightIds.has(f.id) ? 'gold' : 'default'} height={22} />
                    </View>
                  </View>
                  <T style={styles.price}>{formatSar(f.total.amount)}</T>
                </View>
                <Leg dep={f.out.dep} arr={f.out.arr} from={f.out.from} to={f.out.to} durationMin={f.out.durationMin} stop={f.stop} />
                <T v="small">{nightIds.has(f.id) ? t('search.family.night', { time: f.out.dep }) : f.reason}</T>
                {f.demo ? <DemoFare testID={`demo-fare-${f.out.flightNumber}`} /> : null}
                {on && (travellers.length > 1 || f.infants) ? <FareBreakdown option={f} travellers={travellers} onDay={f.out.date} testID="fare-breakdown" /> : null}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('search.rules.a11y', { airline: f.airline })} hitSlop={8}
                onPress={() => { buzz('tap'); setRulesOf(f.id); }} style={styles.rulesLink} testID={`flight-rules-${f.out.flightNumber}`}>
                <Icon name="doc" size={14} color={colors.green} />
                <T v="small" color={colors.green} style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }}>{t('search.rules')}</T>
              </Pressable>
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
            <T v="h3">{t(who.some((id) => people.find((p) => p.id === id)?.relation === 'helper') ? 'search.bundle.helper' : who.length > 2 ? 'search.bundle.family' : who.length === 2 ? 'search.bundle.two' : 'search.bundle.one', { hotel: s.bundle!.hotelName })}</T>
            {bundleHotel ? (
              <Pressable accessibilityRole="link" accessibilityLabel={t('search.bundle.hotelA11y', { hotel: s.bundle!.hotelName })} hitSlop={6} testID="bundle-hotel"
                onPress={() => { buzz('tap'); router.push(`/hotel/${bundleHotel.key}?city=${dest!.key}&guests=${who.length}&in=${s.depart}${s.return ? `&out=${s.return}` : ''}&bundle=1` as Href); }}>
                <T v="small" color={colors.green} style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }}>{s.bundle!.hotelName}</T>
              </Pressable>
            ) : null}
            {/* The same facts as the hotel page (CatalogueStay.tsx): room × rooms, board, rating, a night, the cancel date. */}
            {bundleHotel ? <BundleStayLines s={catalogueStay(bundleHotel.key, who.length, s.depart, s.return)!} /> : null}
            <T v="small">{tn('search.bundle.nights', nights, { price: formatSar(s.bundle!.total.amount) })}</T>
          </View>
          <Button size="small" block={false} variant={bundle ? 'primary' : 'secondary'} style={bundle ? undefined : { backgroundColor: colors.mist }} label={bundle ? t('search.bundle.added') : t('search.bundle.add')} haptic="select" onPress={() => setBundle(!bundle)} testID="bundle-add" />
        </Card>
      ) : null}
      <View style={{ height: 60 }} />
      {sheet}
      <FareRules option={rulesOf ? options.find((o) => o.id === rulesOf) ?? null : null} today={today} onClose={() => setRulesOf(null)} />
    </View>
  );
}

/** Bags, change and refund for one fare, over the results; the return flight and a lap infant's price when they apply. */
function FareRules({ option: f, today, onClose }: { option: FlightOption | null; today: string; onClose: () => void }) {
  if (!f) return null;
  const rows = [[t('search.rule.bags'), f.bags], [t('search.rule.change'), f.changeRule], [t('search.rule.cancel'), f.refundRule],
    ...(f.back ? [[t('search.rule.return'), `${f.back.flightNumber} · ${dayName(f.back.date, today)}`]] : []),
    ...(f.infants ? [[t('search.rule.lap'), t('search.rule.lapValue', { price: formatSar(f.infantPrice.amount) })]] : [])] as [string, string][];
  return (
    <Sheet visible label={t('search.rules.title', { airline: f.airline })} onClose={onClose}>
      <View style={{ gap: 12 }} testID="fare-rules">
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <AirlineMark carrier={f.carrier} brand={f.brand} label={f.airline} />
          <T v="h2" style={{ flex: 1 }}>{t('search.rules.title', { airline: f.airline })}</T>
        </View>
        {rows.map(([k, v]) => (
          <View key={k} style={[styles.spread, { alignItems: 'flex-start' }]}><T v="small">{k}</T><T v="small" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1 }}>{v}</T></View>
        ))}
        <Button label={t('request.done')} onPress={onClose} testID="fare-rules-done" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rulesLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 16, paddingBottom: 14, marginTop: -4 },
  input: { height: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16, fontSize: 17 },
  rowTiny: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.paper },
  sortTab: { paddingVertical: 4, borderBottomWidth: 2, borderColor: 'transparent' },
  sortOn: { borderColor: colors.gold },
  wish: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 99, backgroundColor: colors.green },
  answer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 18, backgroundColor: colors.paper },
  opt: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontFamily: ff.ui600, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.line },
});
