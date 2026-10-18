import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { commaList, dobFromAge, fareLines, formatSar, localizeDigits, matchParty, partyOfPeople, personName, type Person, type SaidParty } from '@mada/shared';
import { api, ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t, tn } from '@/lib/i18n';
import { keys } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { colors, font, ff, radii } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { T } from '../Text';
import { ChipWrap, Seg, Toggle, enter } from './parts';

/*
 * Who is going, by count: adults, children with an age each, babies on a lap or their own seat. Shown when what was said
 * ("2 adults and 3 kids aged 2, 6 and 13", "we are 5") doesn't map to the household, or when someone asks to change who.
 * Every place needs a person: one from the household, or a first name (a child needs an age, not a passport). Mada never
 * searches with fewer people than the count.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const digits = (n: number | string) => localizeDigits(String(n), getLocale());

/** "2 adults, 3 children (13, 6, 2)", in the reader's language. */
export function partySummary(p: SaidParty): string {
  const parts: string[] = [];
  if (p.adults) parts.push(tn('party.n.adults', p.adults));
  if (p.childAges.length) {
    const ages = p.childAges.filter((a): a is number => a != null);
    parts.push(`${tn('party.n.children', p.childAges.length)}${ages.length ? ` ${t('party.ages', { ages: digits(ages.join(', ')) })}` : ''}`);
  }
  if (p.infants) parts.push(tn('party.n.infants', p.infants));
  if (!parts.length && p.total) parts.push(tn('search.people', p.total));
  return joinAnd(parts);
}

function Stepper({ label, hint, value, min, max, onChange, testID }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void; testID: string }) {
  const btn = (d: -1 | 1) => (
    <Pressable accessibilityRole="button" accessibilityLabel={t(d < 0 ? 'party.a11y.less' : 'party.a11y.more', { what: label })} disabled={d < 0 ? value <= min : value >= max}
      onPress={() => { buzz('select'); onChange(value + d); }} style={[styles.step, (d < 0 ? value <= min : value >= max) ? { opacity: 0.35 } : null]} testID={`${testID}-${d < 0 ? 'less' : 'more'}`}>
      <T style={[font('h3'), { fontSize: 20, lineHeight: 22 }]}>{d < 0 ? '−' : '+'}</T>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 1 }}>
        <T v="h3" style={{ fontSize: 15 }}>{label}</T>
        {hint ? <T v="tiny">{hint}</T> : null}
      </View>
      {btn(-1)}
      <T style={styles.count} testID={`${testID}-value`}>{digits(value)}</T>
      {btn(1)}
    </View>
  );
}

type SlotView = { key: string; kind: 'adult' | 'child' | 'infant'; age: number | null; auto: string | null };

export function PartyStep({ party, people, today, selfName, onDone, title }: {
  party: SaidParty; people: Person[]; today: string; selfName: string; title?: string;
  /** The travellers (household ids, new people included) and how many babies sit on a lap. */
  onDone: (ids: string[], lapInfants: number) => void;
}) {
  const qc = useQueryClient();
  const firstMatch = useMemo(() => matchParty(party, people, today), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [adults, setAdults] = useState(party.adults ?? Math.max(1, firstMatch.slots.filter((s) => s.kind === 'adult').length));
  // Ages as said, or as the household's children have them ("3 kids": the two saved ones' ages, then one to set).
  const [ages, setAges] = useState<(number | null)[]>(() => firstMatch.slots.filter((s) => s.kind === 'child').map((s) => s.age));
  const [infants, setInfants] = useState(party.infants);
  const [seat, setSeat] = useState((party.infantSeats ?? 0) > 0);
  // A place can be given to someone else in the household ('' leaves it empty), or a new first name.
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const said: SaidParty = { adults, childAges: ages, infants, infantSeats: seat ? infants : 0, total: null };
  const m = matchParty(said, people, today);
  const counters: Record<string, number> = {};
  const slots: SlotView[] = m.slots.map((s) => { const i = (counters[s.kind] = (counters[s.kind] ?? -1) + 1); return { key: `${s.kind}-${i}`, kind: s.kind, age: s.age, auto: s.personId }; });
  const personOf = (s: SlotView) => (s.key in assign ? assign[s.key] || null : s.auto);
  const used = new Set(slots.map(personOf).filter((x): x is string => !!x));
  const filled = (s: SlotView) => !!personOf(s) || (names[s.key] ?? '').trim().length >= 2;
  const agesSet = ages.every((a) => a != null);
  const ready = slots.length > 0 && slots.every(filled) && agesSet;
  const going = slots.length + (seat ? 0 : infants);
  const kidOf = (p: Person) => !p.isSelf && (p.relation === 'child' || (p.dateOfBirth ? Number(today.slice(0, 4)) - Number(p.dateOfBirth.slice(0, 4)) < 18 : false));
  const candidates = (s: SlotView) => people.filter((p) => p.relation !== 'helper' && !used.has(p.id) && (s.kind === 'adult' ? !kidOf(p) : kidOf(p)));
  const self = people.find((p) => p.isSelf);
  const surnameFor = (typed: string) => {
    const w = typed.trim().split(/\s+/);
    if (w.length > 1) return { given: w.slice(0, -1).join(' '), surname: w.at(-1)! };
    return { given: w[0]!, surname: self?.surname || selfName.trim().split(/\s+/).at(-1) || w[0]! };
  };

  const done = async () => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const s of slots) {
        const id = personOf(s);
        if (id) { ids.push(id); continue; }
        const { given, surname } = surnameFor(names[s.key] ?? '');
        const age = s.kind === 'infant' ? 0 : s.age;
        const { person } = await api.addPerson({ givenNames: given, surname, relation: s.kind === 'adult' ? 'family' : 'child', ...(age != null ? { dateOfBirth: dobFromAge(age, today) } : {}) });
        ids.push(person.id);
      }
      await qc.invalidateQueries({ queryKey: keys.people });
      buzz('success');
      onDone(ids, seat ? 0 : infants);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  const slotLabel = (s: SlotView) => (s.kind === 'adult' ? t('party.slot.adult') : s.kind === 'infant' ? t('party.slot.infant') : s.age != null ? t('party.slot.child', { age: digits(s.age) }) : t('party.slot.childNoAge'));

  return (
    <Animated.View entering={enter(0)} style={{ gap: 14 }} testID="party-step">
      <T style={font('displaySmall')} accessibilityRole="header">{title ?? t('ask.q.who')}</T>
      <T v="small" testID="party-said">{party.adults != null || party.childAges.length || party.infants || party.total ? t('party.said', { said: partySummary(party) }) : t('party.check')}</T>
      <Card variant="well" style={{ gap: 12 }}>
        <Stepper label={t('party.adults')} hint={t('party.adultsHint')} value={adults} min={1} max={9} onChange={(v) => { setAdults(v); setAssign({}); }} testID="party-adults" />
        <Stepper label={t('party.children')} hint={t('party.childrenHintFare')} value={ages.length} min={0} max={8}
          onChange={(v) => { setAges((a) => (v > a.length ? [...a, null] : a.slice(0, v))); setAssign({}); }} testID="party-children" />
        {ages.map((a, i) => (
          <View key={i} style={[styles.row, { paddingStart: 14 }]}>
            <View style={{ flex: 1, gap: 1 }}>
              <T v="small">{a == null ? t('party.slot.childNoAge') : t('party.age', { age: digits(a) })}</T>
              {/* Children are counted to 17, but airlines price 12 and over as adults: said where the age is set. */}
              {a != null && a >= 12 ? <T v="tiny" testID={`party-age-${i}-adult`}>{t('party.adultAge')}</T> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('party.a11y.younger', { n: i + 1 })} disabled={a != null && a <= 2} onPress={() => { buzz('select'); setAges((x) => x.map((y, j) => (j === i ? Math.max(2, (y ?? 7) - 1) : y))); setAssign({}); }} style={[styles.step, styles.stepSmall]} testID={`party-age-${i}-less`}>
              <T style={[font('h3'), { fontSize: 18 }]}>−</T>
            </Pressable>
            <T style={[styles.count, { minWidth: 28 }]} testID={`party-age-${i}-value`}>{a == null ? '–' : digits(a)}</T>
            <Pressable accessibilityRole="button" accessibilityLabel={t('party.a11y.older', { n: i + 1 })} disabled={a != null && a >= 17} onPress={() => { buzz('select'); setAges((x) => x.map((y, j) => (j === i ? Math.min(17, (y ?? 5) + 1) : y))); setAssign({}); }} style={[styles.step, styles.stepSmall]} testID={`party-age-${i}-more`}>
              <T style={[font('h3'), { fontSize: 18 }]}>+</T>
            </Pressable>
          </View>
        ))}
        <Stepper label={t('party.infants')} hint={t('party.infantsHint')} value={infants} min={0} max={4} onChange={(v) => { setInfants(v); setAssign({}); }} testID="party-infants" />
        {infants ? <Seg label={t('party.infants')} value={seat ? 'seat' : 'lap'} options={[['lap', t('party.lap')], ['seat', t('party.seat')]]} onChange={(v) => { setSeat(v === 'seat'); setAssign({}); }} /> : null}
      </Card>
      <T v="h3">{t('party.who')}</T>
      {slots.map((s) => {
        const id = personOf(s);
        const p = id ? people.find((x) => x.id === id) : null;
        const others = candidates(s);
        return (
          <View key={s.key} style={{ gap: 8 }} testID={`party-slot-${s.key}`}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{slotLabel(s)}</T>
            {p ? (
              <ChipWrap><Toggle label={`${personName(p, selfName)} ✓`} on onPress={() => setAssign((a) => ({ ...a, [s.key]: '' }))} accessibilityLabel={personName(p, selfName)} /></ChipWrap>
            ) : (
              <>
                {others.length ? <ChipWrap>{others.map((o) => <Toggle key={o.id} small label={personName(o, selfName)} on={false} onPress={() => setAssign((a) => ({ ...a, [s.key]: o.id }))} />)}</ChipWrap> : null}
                <TextInput value={names[s.key] ?? ''} onChangeText={(v) => setNames((n) => ({ ...n, [s.key]: v }))} placeholder={t('party.nameHint')} placeholderTextColor={colors.muted}
                  accessibilityLabel={`${slotLabel(s)}: ${t('party.nameHint')}`} autoCapitalize="words" style={[styles.input, font('body', colors.green), webNoOutline]} testID={`party-name-${s.key}`} />
              </>
            )}
          </View>
        );
      })}
      {!ready ? <T v="tiny">{t('party.missing')}</T> : null}
      <Button label={t('party.continue', { count: digits(going) })} disabled={!ready} busy={busy} onPress={done} testID="party-continue" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 40, height: 40, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(30,53,45,0.25)', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  stepSmall: { width: 34, height: 34 },
  count: { minWidth: 24, textAlign: 'center', fontFamily: ff.ui600, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  input: { height: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, fontSize: 16 },
});

/** The price per person by fare band (adults, children, babies), for the chosen flight. Adds up to the option's total. */
export function FareBreakdown({ option, travellers, onDay, testID }: { option: Parameters<typeof fareLines>[0]; travellers: Person[]; onDay: string; testID?: string }) {
  const lines = fareLines(option, travellers, onDay);
  const kids = lines.some((l) => l.band !== 'adult');
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <T v="small" style={{ fontFamily: ff.ui600 }}>{t('fare.title')}</T>
      {lines.map((l) => (
        <View key={l.band} style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, gap: 1 }}>
            <T v="small">{t(`fare.band.${l.band}`)}</T>
            {l.band === 'child' && l.ages.length ? <T v="tiny">{t('fare.ages', { ages: digits(commaList(l.ages.map(String))) })}</T> : null}
          </View>
          <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('fare.each', { count: digits(l.count), price: formatSar(l.each) })}</T>
        </View>
      ))}
      {kids ? <T v="tiny">{t('fare.together')}</T> : null}
    </View>
  );
}

/** Who the rooms are for (adults, children with ages, babies in a cot) and the price per person a night, for a stay. */
export function StayGuests({ option, travellers, lapInfants = 0, onDay, testID }: { option: { total: { amount: number }; nights: number }; travellers: Person[]; lapInfants?: number; onDay: string; testID?: string }) {
  const party = partyOfPeople(travellers, travellers.map((p) => p.id), onDay, lapInfants);
  const heads = Math.max(1, travellers.length);
  const each = Math.round(option.total.amount / Math.max(1, option.nights) / heads);
  return (
    <View testID={testID}>
      <Card variant="well" style={{ gap: 4 }}>
        <T v="small" style={{ fontFamily: ff.ui600 }}>{t('stay.guests.title')}</T>
        <T v="small" color={colors.green}>{partySummary(party)}</T>
        {party.infants ? <T v="tiny">{t('stay.guests.cot')}</T> : null}
        <T v="tiny">{t('stay.guests.perPerson', { price: formatSar(each) })}</T>
      </Card>
    </View>
  );
}
