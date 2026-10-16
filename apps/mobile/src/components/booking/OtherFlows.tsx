import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { DESTINATIONS, permitAnswers, addDays, ageOn, daysBetween, formatSar, householdOf, nameIn, personName, quickDates, weekendDates, type AskIntent, type Person, type StayOption } from '@mada/shared';
import { bookingApi, useDemo, usePayDraft, usePlans } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t, tn } from '@/lib/i18n';
import { useRecentCities, type RecentCity } from '@/lib/recent-cities';
import { colors, font, radii, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { Icon } from '../Icon';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../states/ErrorState';
import { Pill } from '../Pill';
import { T } from '../Text';
import { VGradient } from '../Gradient';
import { EntryChecks, blockLabel } from './EntryChecks';
import type { Cta } from './FlightFlow';
import { Answered, SummaryChips } from './Conversation';
import { dayName, rangeName } from './format';
import { PhoneSheet, usePhoneNeeded } from './PhoneSheet';
import { SearchSheet } from './SearchSheet';
import { ArtSuitcase, Ask1, ChipWrap, CityStage, CityTiles, Photo, Working, useSequence, useWho, enter } from './parts';
import { ByHand, RequestFlow } from './Requests';
import { TravellerChips } from './Travellers';
import { StayResults } from './StayResults';
import { PartyStep, StayGuests } from './Party';

/* Stays, curated plans and eSIMs in Ask. */

/** Where people stay most, after their own recent cities. Live cities first; the rest Mada books by hand. */
const POPULAR = ['dubai', 'istanbul', 'london', 'jeddah', 'alula', 'abha', 'cairo', 'baku'];
/** Cities the search knows besides the ones sold live (Mada finds rooms there by hand). */
const MORE_CITIES = ['Riyadh', 'Makkah', 'Madinah', 'Dammam', 'Khobar', 'Taif', 'Doha', 'Muscat', 'Manama', 'Bahrain', 'Kuala Lumpur', 'Rome', 'Milan', 'Vienna', 'Zurich', 'Geneva', 'Prague', 'Sarajevo', 'Trabzon', 'Antalya', 'Bodrum', 'Abu Dhabi'];

type City = RecentCity;
type Phase = 'where' | 'when' | 'nights' | 'who' | 'results';

const cityLabel = (c: City) => nameIn(c.name, getLocale());
const destOf = (c: City | null) => (c?.key ? DESTINATIONS[c.key] ?? null : null);
/** A photo for cities Mada books by hand; any other city gets a room, which is what's being chosen. */
const HAND_PHOTOS: Record<string, string> = { Makkah: 'makkah-clock-tower', Madinah: 'madinah-green-dome', Riyadh: 'riyadh-diriyah' };
const cityPhoto = (c: City) => destOf(c)?.photo ?? HAND_PHOTOS[c.name] ?? 'hotel-room';

/** The days a stay is usually for, with the year when it isn't this year. Weekends here are Thursday to Saturday. */
function stayDates(today: string): { id: string; label: string; dates: [string, string] }[] {
  const sun = addDays(today, ((7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7) || 7);
  const q = quickDates(today);
  const eid = q.find((x) => x.id === 'eid');
  const school = q.find((x) => x.id === 'school');
  return [
    { id: 'thisWeekend', label: t('ask.when.thisWeekend'), dates: weekendDates(today, 0) },
    { id: 'nextWeek', label: t('ask.when.nextWeek'), dates: [sun, addDays(sun, 4)] as [string, string] },
    { id: 'nextWeekend', label: t('ask.when.nextWeekend'), dates: weekendDates(today, 1) },
    ...(eid ? [{ id: 'eid', label: t('ask.when.eid', { year: eid.dates[0].slice(0, 4) }), dates: eid.dates }] : []),
    ...(school ? [{ id: 'school', label: t('ask.when.school'), dates: school.dates }] : []),
  ];
}

export function StayFlow({ intent, query, people, selfName, today, setCta, onSync }: {
  intent: AskIntent; query: string; people: Person[]; selfName: string; today: string; setCta: (c: Cta) => void;
  /** What this flow has settled (asked here, not typed), so a correction typed later starts from it. */
  onSync?: (patch: Partial<AskIntent>) => void;
}) {
  const router = useRouter();
  const demo = useDemo((s) => s.on);
  const H = useMemo(() => householdOf(people, today), [people, today]);
  const recent = useRecentCities();
  useEffect(() => { void recent.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // What was typed answers what it can: "a hotel in Dubai next weekend for 4" asks nothing but who and rooms.
  const [city, setCity] = useState<City | null>(() => (intent.destination && intent.destination !== 'other' ? { key: intent.destination, name: DESTINATIONS[intent.destination]?.name ?? intent.destination } : intent.destination === 'other' && intent.destinationName ? { key: null, name: intent.destinationName } : null));
  const [checkIn, setCheckIn] = useState<string | null>(intent.depart && intent.depart >= today ? intent.depart : null);
  const [checkOut, setCheckOut] = useState<string | null>(intent.depart && intent.return && intent.return > intent.depart ? intent.return : null);
  const said = intent.travellerIds?.filter((id) => people.some((p) => p.id === id)) ?? [];
  const [who, setWho] = useWho(() => (said.length ? said : H.me ? [H.me] : []));
  // Counts or ages said that the household doesn't cover: the stepper asks who they are before the rooms are searched.
  const [needParty, setNeedParty] = useState(!!intent.party && !said.length);
  const [lap, setLap] = useState(intent.infants);
  const [editing, setEditing] = useState<'where' | 'when' | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [go, setGo] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const phoneNeeded = usePhoneNeeded();
  const [pick, setPick] = useState<string | null>(null);
  const [byHand, setByHand] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** What the traveller asked for that the list couldn't show: it goes to the desk with the search. */
  const [deskNote, setDeskNote] = useState<string | null>(null);

  const dest = destOf(city);
  const live = !!dest && !dest.byHand;
  const nights = checkIn && checkOut ? Math.max(1, daysBetween(checkIn, checkOut)) : 0;
  const n = who.length;
  const rooms = n > 2 ? t('search.rooms.connecting') : n === 2 ? t('search.rooms.forTwo') : t('search.rooms.one');
  const phase: Phase = !city || editing === 'where' ? 'where' : !checkIn || editing === 'when' ? 'when' : !checkOut ? 'nights' : !go ? 'who' : 'results';
  const datesLabel = checkIn && checkOut ? `${rangeName(checkIn, checkOut, today)} · ${tn('ask.stay.nights', nights)}` : '';
  const whoLabel = `${tn('ask.stay.guests', n)} · ${rooms}`;

  const flags = [...demo].sort().join(',');
  const searching = phase === 'results' && live && !byHand;
  const steps = [t('search.working.stays'), n > 2 ? t('search.working.together') : t('search.working.quiet')];
  const step = useSequence(2, 700, searching ? `${city?.key}${checkIn}${checkOut}${who.join()}` : null);
  const search = useQuery({ queryKey: ['booking', 'stays', dest?.key, checkIn, nights, who.join(), flags], enabled: searching, staleTime: 600_000, queryFn: () => bookingApi.searchStays({ destination: dest!.key, checkIn: checkIn!, nights, travellerIds: who }) });
  // Entry checks don't depend on the rooms: asked at the same time as the search, not after it.
  // "I have a permit", typed as a correction: the visa and re-entry checks count as in hand.
  const entry = useQuery({ queryKey: ['booking', 'entry', dest?.key, who.join(), checkIn, checkOut, answers, !!intent.answers.permit, flags], enabled: searching, placeholderData: (p) => p, queryFn: () => bookingApi.entry({ destination: dest!.key, travellerIds: who, depart: checkIn!, return: checkOut, answers: { ...permitAnswers(intent, who, dest?.key), ...answers } }) });
  // A city can answer with a couple of hundred hotels: draw a page at a time, cheapest first.
  const s = search.data;
  const cur = s?.options.find((o) => o.id === pick) ?? s?.options[0];
  const ready = searching && step >= 2 && s?.outcome === 'ok' && !!cur;
  const start = () => { if (phoneNeeded) { setPhoneOpen(true); return; } buzz('tap'); if (city) recent.add(city); setGo(true); };

  useEffect(() => {
    onSync?.({ destination: city ? city.key ?? 'other' : null, destinationName: city && !city.key ? city.name : null, depart: checkIn, return: checkOut, travellerIds: needParty ? intent.travellerIds : who, infants: lap });
  }, [city?.key, city?.name, checkIn, checkOut, who.join(), needParty, lap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'who' && needParty) { setCta(null); return; }
    if (phase === 'who') {
      setCta({ label: phoneNeeded ? t('ask.phone.thenSearch') : live ? t('ask.stay.search', { guests: tn('ask.stay.guests', n) }) : t('ask.stay.askMada'), testID: 'stays-search', onPress: start });
      return;
    }
    // Results set their own action (StayResults: Review, and the box to say what matters).
    if (!ready) setCta(null);
  }, [phase, ready, who.join(), phoneNeeded, live, needParty]); // eslint-disable-line react-hooks/exhaustive-deps
  const review = (o: StayOption) => { usePayDraft.getState().set({ draft: { kind: 'stay', stayOfferId: o.id, travellerIds: who }, title: o.name, destination: dest!.key, askAgain: query }); router.push('/pay'); };
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (what: 'where' | 'when') => { setGo(false); setPick(null); setByHand(false); setDeskNote(null); setEditing(what); };
  const summary = city && checkIn && checkOut ? (
    <SummaryChips items={[
      { label: cityLabel(city), onPress: () => change('where'), testID: 'stay-chip-where', icon: 'pin' },
      { label: datesLabel, onPress: () => change('when'), testID: 'stay-chip-when', icon: 'calendar' },
      { label: whoLabel, onPress: () => { setGo(false); setPick(null); }, testID: 'stay-chip-who', icon: 'user' },
    ]} />
  ) : null;
  const sheet = calendar ? (
    <SearchSheet stay visible value={{ from: 'RUH', type: 'return', dep: checkIn, ret: checkOut, cabin: 'economy', infants: 0, flex: false }} today={today} adults={n}
      onClose={() => setCalendar(false)} onDone={(v) => { setCheckIn(v.dep); setCheckOut(v.ret); setCalendar(false); setEditing(null); }} />
  ) : null;

  // Asked to change who's going, or counts that don't map: the stepper, before anything else is asked again.
  if (needParty && intent.party && (phase === 'who' || intent.ask === 'who')) {
    return (
      <View style={{ gap: 16 }}>
        {summary}
        <PartyStep party={intent.party} people={people} today={checkIn ?? today} selfName={selfName} title={t('ask.stay.q.who')}
          onDone={(ids, lapInfants) => { setWho(ids); setLap(lapInfants); setNeedParty(false); }} />
      </View>
    );
  }
  /* 1. Where. */
  if (phase === 'where') {
    return (
      <View style={{ gap: 14 }}>
        <CityPicker recent={recent.list} onPick={(c) => { setCity(c); setEditing(null); setGo(false); buzz('select'); }} />
      </View>
    );
  }
  const whereRow = <Answered q={t('ask.stay.q.where')} a={cityLabel(city!)} onChange={() => change('where')} testID="stay-where-answer" />;
  // The city's photo stands between the answer and the next question: the place, while the dates and the guests are picked.
  const stage = <CityStage photo={cityPhoto(city!)} testID="stay-stage" />;

  /* 2. When: quick picks or the calendar; a check-in without a check-out asks how many nights. */
  if (phase === 'when') {
    // The year is said once: in the label for Eid ("Eid al-Fitr 2027 · 9–15 Mar"), in the dates otherwise.
    const opts: [string, string][] = [...stayDates(today).map((q): [string, string] => [`${q.label} · ${rangeName(q.dates[0], q.dates[1], q.id === 'eid' ? q.dates[0] : today)}`, q.id]), [t('ask.q.pickDates'), 'pick']];
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        {stage}
        <Ask1 q={t('ask.stay.q.when', { city: cityLabel(city!) })} options={opts} line={t('ask.stay.whenLine')} onPick={(v) => {
          if (v === 'pick') { setCalendar(true); return; }
          const q = stayDates(today).find((x) => x.id === v)!;
          setCheckIn(q.dates[0]); setCheckOut(q.dates[1]); setEditing(null);
        }} />
        {sheet}
      </View>
    );
  }
  if (phase === 'nights') {
    const opts: [string, string][] = [2, 3, 5, 7].map((k): [string, string] => [`${tn('ask.stay.nights', k)} · ${t('ask.stay.until', { day: dayName(addDays(checkIn!, k), today) })}`, String(k)]);
    return (
      <View style={{ gap: 18 }}>
        {whereRow}
        {stage}
        <Ask1 q={t('ask.stay.q.nights', { day: dayName(checkIn!, today) })} options={[...opts, [t('ask.q.pickDates'), 'pick']]} line={t('ask.stay.whenLine')}
          onPick={(v) => (v === 'pick' ? setCalendar(true) : setCheckOut(addDays(checkIn!, Number(v))))} />
        {sheet}
      </View>
    );
  }

  /* 3. Who, and the rooms that makes: the household from the profile, children with their ages. Then search. */
  if (phase === 'who') {
    const kids = who.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p && (ageOn(p, checkIn!) ?? 30) < 18);
    return (
      <View style={{ gap: 16 }}>
        <Animated.View entering={enter(0)} style={{ gap: 12 }}>
          <T style={font('displaySmall')} accessibilityRole="header">{t('ask.stay.q.who')}</T>
          {summary}
        </Animated.View>
        {intent.travellerCount && intent.travellerCount > who.length ? <T v="small">{t('ask.q.whoSaid', { count: intent.travellerCount })}</T> : null}
        <TravellerChips people={people} value={who} onChange={setWho} selfName={selfName} agesOn={checkIn!} />
        {kids.length ? <T v="small" testID="stay-rooms">{t('ask.stay.kids', { names: joinAnd(kids.map((k) => t('ask.flow.childAge', { name: personName(k, selfName), age: ageOn(k, checkIn!) ?? '' }))) })}</T> : <T v="small">{t('ask.stay.whoLine')}</T>}
        {!live ? <T v="small">{t('ask.stay.byHandNote', { city: cityLabel(city!) })}</T> : null}
        {phoneNeeded ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} testID="stay-phone-note">
            <Icon name="phone" size={20} />
            <T v="small" style={{ flex: 1 }}>{t('ask.phone.beforeSearch')}</T>
          </View>
        ) : null}
        <PhoneSheet visible={phoneOpen} onClose={() => setPhoneOpen(false)} onDone={() => { setPhoneOpen(false); if (city) recent.add(city); setGo(true); }} />
        {stage}
        <View style={{ height: 40 }} />
      </View>
    );
  }

  /* 4. Places, or Mada finding rooms by hand. */
  if (!live || byHand || s?.outcome === 'by_hand') {
    return (
      <View style={{ gap: 14 }}>
        {summary}
        <ByHand city={cityLabel(city!)} stay queued={demo.has('offline')} />
        <RequestFlow kind="stay" query={deskNote ? `${query} · ${deskNote}` : query} intent={null} people={people} selfName={selfName} autoSend travellerIds={who}
          search={{ destination: dest?.key ?? null, destinationName: dest ? null : city!.name, from: null, depart: checkIn, return: checkOut, cabin: null, carrier: null }} />
      </View>
    );
  }
  if (!s && search.isError) return <View style={{ gap: 14 }}>{summary}<ErrorState variant="card" error={search.error} onRetry={() => { void search.refetch(); }} testID="stays-error" /></View>;
  if (step < 2 || !s) return <View style={{ gap: 18 }}>{summary}<Working lines={steps} step={Math.min(step, 1)} /></View>;
  if (s.outcome === 'none') {
    return <EmptyState art={<ArtSuitcase />} title={t('search.stays.none.title')} body={t('search.stays.none.body', { rooms: s.options[0]?.roomsLabel ?? rooms })} action={<Button label={t('search.stays.byHand')} onPress={() => { buzz('tap'); setByHand(true); }} />} />;
  }
  return (
    <StayResults guestLines={(o) => <StayGuests option={o} travellers={people.filter((p) => who.includes(p.id))} lapInfants={lap} onDay={checkIn!} testID="stay-guests" />} s={s} city={dest!.key} cityName={cityLabel(city!)} dates={rangeName(checkIn!, checkOut!, today)} people={people} who={who} checkIn={checkIn!} summary={summary}
      block={blockLabel(entry.data)} setCta={setCta} onReview={review} onDesk={(note) => { buzz('tap'); setDeskNote(note); setByHand(true); }}
      entry={<EntryChecks result={entry.data} destination={dest!.key} travellerIds={who} depart={checkIn!} ret={checkOut} answer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} remove={(id) => setWho((w) => w.filter((x) => x !== id))} />} />
  );
}

/** "Which city?": type to search, or tap a recent or popular city. */
function CityPicker({ recent, onPick }: { recent: City[]; onPick: (c: City) => void }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const live = Object.values(DESTINATIONS);
  const all: City[] = [...live.map((d) => ({ key: d.key, name: d.name })), ...MORE_CITIES.map((name) => ({ key: null, name }))];
  const matches = term.length < 2 ? [] : all.filter((c) => {
    const d = c.key ? DESTINATIONS[c.key] : null;
    return c.name.toLowerCase().includes(term) || cityLabel(c).includes(q.trim()) || (!!d && d.words.test(term));
  }).slice(0, 6);
  const typed = q.trim().replace(/\s+/g, ' ');
  const exact = matches.some((m) => m.name.toLowerCase() === term || cityLabel(m) === typed);
  const popular = POPULAR.map((k) => DESTINATIONS[k]).filter((d): d is NonNullable<typeof d> => !!d).filter((d) => !recent.some((r) => r.name === d.name));
  const chips = (list: City[], id: string) => <ChipWrap>{list.map((c) => <Chip key={`${id}-${c.name}`} label={cityLabel(c)} background={colors.paper} onPress={() => onPick(c)} />)}</ChipWrap>;
  return (
    <Animated.View entering={enter(0)} style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <T style={font('displaySmall')} accessibilityRole="header">{t('ask.stay.q.where')}</T>
        <T v="small">{t('ask.stay.whereLine')}</T>
      </View>
      <View style={styles.search}>
        <Icon name="pin" size={18} color={colors.ink3} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('ask.stay.cityHint')} placeholderTextColor={colors.muted} accessibilityLabel={t('ask.stay.q.where')} autoCorrect={false}
          returnKeyType="search" onSubmitEditing={() => { if (matches[0]) onPick(matches[0]); else if (typed.length > 1) onPick({ key: null, name: typed.replace(/\b\w/g, (c) => c.toUpperCase()) }); }}
          style={[styles.searchInput, webNoOutline]} testID="stay-city" />
      </View>
      {term.length >= 2 ? (
        <View style={{ gap: 6 }}>
          {matches.map((c) => (
            <Pressable key={c.name} accessibilityRole="button" onPress={() => onPick(c)} style={styles.row} testID={`city-match-${c.key ?? c.name}`}>
              <Icon name="pin" size={18} />
              <View style={{ flex: 1 }}>
                <T v="h3" style={{ fontSize: 15 }}>{cityLabel(c)}</T>
                <T v="tiny">{c.key && !DESTINATIONS[c.key]?.byHand ? t('ask.stay.liveCity') : t('ask.stay.handCity')}</T>
              </View>
            </Pressable>
          ))}
          {!exact && typed.length > 1 ? (
            <Pressable accessibilityRole="button" onPress={() => onPick({ key: null, name: typed.replace(/\b\w/g, (c) => c.toUpperCase()) })} style={styles.row} testID="city-typed">
              <Icon name="plus" size={18} />
              <T v="h3" style={{ fontSize: 15, flex: 1 }}>{t('ask.stay.useTyped', { city: typed })}</T>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {recent.length ? <View style={{ gap: 8 }}><T v="eyebrow">{t('ask.stay.recent')}</T>{chips(recent, 'recent')}</View> : null}
          <View style={{ gap: 8 }}>
            <T v="eyebrow">{t('ask.stay.popular')}</T>
            <CityTiles testID="city-tiles" cities={popular.map((d) => ({ name: d.name, label: cityLabel({ key: d.key, name: d.name }), photo: d.photo }))} onPick={(name) => { const d = popular.find((x) => x.name === name)!; onPick({ key: d.key, name: d.name }); }} />
          </View>
        </>
      )}
    </Animated.View>
  );
}

export function PlanFlow({ query, people, today }: { query: string; people: Person[]; today: string }) {
  const router = useRouter();
  const plans = usePlans();
  const kids = householdOf(people, today).kids.length > 0;
  const step = useSequence(3, 650, 'go');
  const id = /istanbul/i.test(query) ? 'istanbul3' : 'alula2';
  const plan = plans.data?.find((p) => p.id === id);
  const steps = [t('plan.working.open'), kids ? t('plan.working.prayerKids') : t('plan.working.prayer'), t('plan.working.tables')];
  if (step < 3 || !plan) return <Working lines={steps} step={Math.min(step, 2)} />;
  const go = () => router.push({ pathname: '/ask/plan/[id]', params: { id } });
  return (
    <Animated.View entering={enter(0)} style={{ gap: 12 }}>
      <T v="h2">{t('plan.ready')}</T>
      <Pressable accessibilityRole="button" accessibilityLabel={plan.title} onPress={go} style={styles.planCard}>
        <Photo name={plan.photo} />
        <VGradient id="plan-shade" stops={[[0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
        <View style={styles.over}>
          <Pill variant="glass" label={t('plan.stops', { days: plan.days, count: plan.stops })} />
          <T style={[font('displaySmall', colors.paper), { fontSize: 30, lineHeight: 32 }]}>{plan.title}</T>
          <T v="small" color="rgba(255,253,249,0.9)">{plan.sub}</T>
        </View>
      </Pressable>
      <Button label={t('plan.see')} onPress={go} testID="plan-see" />
    </Animated.View>
  );
}

export function EsimFlow() {
  const router = useRouter();
  const n = 1;
  return (
    <Animated.View entering={enter(0)} style={{ gap: 12 }}>
      <T v="h2" style={{ fontSize: 24, lineHeight: 30 }}>{t('esim.title')}</T>
      <Card>
        <View style={styles.spread}><T v="h3">{t('esim.plan')}</T><T style={styles.price}>{t('esim.each', { price: formatSar(3900) })}</T></View>
        <T v="small">{t('esim.body')}</T>
      </Card>
      <Button label={t('search.review', { price: formatSar(3900 * n) })} onPress={() => { usePayDraft.getState().set({ draft: { kind: 'esim', count: n }, title: t('pay.title.esim') }); router.push('/pay'); }} />
    </Animated.View>
  );
}

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const styles = StyleSheet.create({
  search: { height: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.paper },
  photo: { height: 120, position: 'relative', backgroundColor: colors.stage },
  pillTL: { position: 'absolute', top: 10, start: 10 },
  pillTR: { position: 'absolute', top: 10, end: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  price: { fontFamily: ff.ui600, fontSize: 16, color: colors.green, fontVariant: ['tabular-nums'] },
  planCard: { height: 220, borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.stage },
  over: { position: 'absolute', start: 0, end: 0, bottom: 0, padding: 16, gap: 4 },
});
