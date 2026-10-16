import { describe, expect, it } from 'vitest';
import {
  ageAt, askIntentOfRules, correctAsk, dobFromAge, dobOfTyped, familyRank, fareLines, hasLittleOnes, matchParty, parseAskRules, parseParty, weekendDates, type AskIntent, type Person,
} from '../src';

const TODAY = '2026-10-16';
const person = (id: string, firstName: string, relation: Person['relation'], extra: Partial<Person> = {}): Person => ({
  id, isSelf: relation === 'self', givenNames: firstName, surname: 'Alharbi', firstName, relation, dateOfBirth: null, sex: null, nationality: null, passport: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
});
const OMAR = person('00000000-0000-4000-8000-000000000001', 'Omar', 'self', { dateOfBirth: '1984-03-11' });
const HESSA = person('00000000-0000-4000-8000-000000000002', 'Hessa', 'spouse', { dateOfBirth: '1988-07-24' });
const SARA = person('00000000-0000-4000-8000-000000000003', 'Sara', 'child', { dateOfBirth: '2013-05-12' });
const AHMED = person('00000000-0000-4000-8000-000000000004', 'Ahmed', 'child', { dateOfBirth: '2016-09-03' });
const LINA = person('00000000-0000-4000-8000-000000000005', 'Lina', 'helper');
const FAMILY = [OMAR, HESSA, SARA, AHMED, LINA];
const ctx = { today: TODAY, people: FAMILY };
const intentOf = (text: string) => askIntentOfRules(parseAskRules(text, ctx));

describe('who was said to be going', () => {
  it('reads adults, children with their ages, and babies, in English', () => {
    expect(parseParty('Istanbul for Eid, 2 adults and 3 kids aged 2, 6 and 13')).toEqual({ adults: 2, childAges: [2, 6, 13], infants: 0, total: 5 });
    expect(parseParty('me and my wife with a 6 year old and a baby')).toEqual({ adults: 2, childAges: [6], infants: 1, total: 4 });
    expect(parseParty('two adults, three children')).toEqual({ adults: 2, childAges: [null, null, null], infants: 0, total: 5 });
    expect(parseParty('3 kids aged 1, 6 and 13')).toMatchObject({ childAges: [6, 13], infants: 1 });
    expect(parseParty('we are 5')).toEqual({ adults: null, childAges: [], infants: 0, total: 5 });
    expect(parseParty('a family of 6')).toMatchObject({ total: 6 });
    expect(parseParty('Dubai for 3 nights')).toBeNull();
    expect(parseParty('Flights to Istanbul next weekend')).toBeNull();
  });
  it('reads the same in spoken Saudi Arabic, with Arabic-Indic digits', () => {
    expect(parseParty('اسطنبول في العيد، شخصين بالغين و٣ عيال أعمارهم ٢ و٦ و١٣')).toEqual({ adults: 2, childAges: [2, 6, 13], infants: 0, total: 5 });
    expect(parseParty('احنا ٥')).toEqual({ adults: null, childAges: [], infants: 0, total: 5 });
    expect(parseParty('أنا وزوجتي وطفلين ورضيع')).toEqual({ adults: 2, childAges: [null, null], infants: 1, total: 5 });
    expect(parseParty('عندنا ٣ اطفال')).toMatchObject({ childAges: [null, null, null] });
  });
  it('maps the party onto the household, leaving places nobody fits', () => {
    const m = matchParty(parseParty('2 adults and 3 kids aged 2, 6 and 13')!, FAMILY, TODAY);
    expect(m.complete).toBe(false);
    expect(m.seats).toBe(5);
    expect(m.ids).toEqual([OMAR.id, HESSA.id, SARA.id]);
    expect(m.slots.filter((x) => !x.personId)).toEqual([{ kind: 'child', age: 6, personId: null }, { kind: 'child', age: 2, personId: null }]);
    const all = matchParty(parseParty('2 adults and 2 kids aged 10 and 13')!, FAMILY, TODAY);
    expect(all).toMatchObject({ complete: true, ids: [OMAR.id, HESSA.id, SARA.id, AHMED.id] });
    expect(matchParty({ adults: null, childAges: [], infants: 0, total: 6 }, FAMILY, TODAY)).toMatchObject({ complete: false, seats: 6 });
  });
  it('never drops a traveller: the Eid family of five asks instead of booking one adult', () => {
    const i = intentOf('Istanbul for Eid, 2 adults and 3 kids aged 2, 6 and 13');
    expect(i).toMatchObject({ kind: 'flight', destination: 'istanbul', depart: '2027-03-09', travellerIds: null, travellerCount: 5, ask: 'who' });
    expect(i.party).toEqual({ adults: 2, childAges: [2, 6, 13], infants: 0, total: 5 });
    const ar = intentOf('اسطنبول في العيد، شخصين بالغين و٣ عيال أعمارهم ٢ و٦ و١٣');
    expect(ar.party).toEqual(i.party);
    expect(ar.travellerIds).toBeNull();
    // More than the household holds, by total alone.
    expect(intentOf('Flights to Dubai next weekend, we are 6')).toMatchObject({ travellerIds: null, travellerCount: 6, ask: 'who' });
    // What already worked still works.
    expect(intentOf('Flights to Istanbul in March for 2')).toMatchObject({ travellerCount: 2, travellerIds: [OMAR.id, HESSA.id], ask: 'when' });
    expect(intentOf('Istanbul for Eid, all of us').travellerIds).toEqual([OMAR.id, HESSA.id, SARA.id, AHMED.id]);
  });
});

describe('ages without a passport', () => {
  it('turns an age into a date of birth that reads as that age', () => {
    for (const a of [0, 1, 2, 6, 13, 40]) expect(ageAt(dobFromAge(a, TODAY), TODAY)).toBe(a);
  });
  it('reads an age or a date of birth as typed, in either language', () => {
    expect(ageAt(dobOfTyped('6', TODAY), TODAY)).toBe(6);
    expect(ageAt(dobOfTyped('٦', TODAY), TODAY)).toBe(6);
    expect(ageAt(dobOfTyped('2 years', TODAY), TODAY)).toBe(2);
    expect(dobOfTyped('2019-04-02', TODAY)).toBe('2019-04-02');
    expect(dobOfTyped('2030-01-01', TODAY)).toBeNull();
    expect(dobOfTyped('six', TODAY)).toBeNull();
  });
});

describe('corrections while Ask is answering', () => {
  const base = intentOf('Istanbul for Eid, all of us');
  it('changes who is going', () => {
    const a = correctAsk(base, 'we are 5', ctx);
    expect(a.type).toBe('apply');
    if (a.type !== 'apply') return;
    expect(a.changed).toEqual(['who']);
    expect(a.intent).toMatchObject({ travellerIds: null, travellerCount: 5, ask: 'who', destination: 'istanbul', depart: '2027-03-09' });
    const b = correctAsk(base, '3 kids', ctx);
    expect(b.type === 'apply' && b.intent.party).toEqual({ adults: null, childAges: [null, null, null], infants: 0, total: null });
    const c = correctAsk(base, 'just me', ctx);
    expect(c.type === 'apply' && c.intent.travellerIds).toEqual([OMAR.id]);
    const d = correctAsk(base, 'احنا ٥', ctx);
    expect(d.type === 'apply' && d.intent.travellerCount).toBe(5);
  });
  it('keeps the adults when only the children change', () => {
    const first = intentOf('Istanbul for Eid, 2 adults and 2 kids aged 10 and 13');
    const r = correctAsk(first, 'actually 3 kids aged 2, 10 and 13', ctx);
    expect(r.type === 'apply' && r.intent.party).toMatchObject({ adults: 2, childAges: [2, 10, 13], total: 5 });
  });
  it('changes when', () => {
    const dec = correctAsk(base, 'December', ctx);
    expect(dec.type === 'apply' && dec.intent).toMatchObject({ depart: null, return: null, monthOnly: { month: 12, year: 2026 }, ask: 'when' });
    const nw = correctAsk(base, 'next week', ctx);
    // Sunday 18 Oct, keeping the six nights.
    expect(nw.type === 'apply' && [nw.intent.depart, nw.intent.return]).toEqual(['2026-10-18', '2026-10-24']);
    const now = correctAsk(base, 'right now', ctx);
    expect(now.type === 'apply' && now.intent.depart).toBe(TODAY);
    const ar = correctAsk(base, 'الأسبوع الجاي', ctx);
    expect(ar.type === 'apply' && ar.intent.depart).toBe('2026-10-18');
    const arMonth = correctAsk(base, 'خلها ديسمبر', ctx);
    expect(arMonth.type === 'apply' && arMonth.intent.monthOnly).toMatchObject({ month: 12 });
    const wk = correctAsk(base, 'الويكند الجاي', ctx);
    expect(wk.type === 'apply' && [wk.intent.depart, wk.intent.return]).toEqual(weekendDates(TODAY, 1));
  });
  it('changes where, and notes a permit', () => {
    const w = correctAsk(base, 'Dubai', ctx);
    expect(w.type === 'apply' && w.intent.destination).toBe('dubai');
    const arW = correctAsk(base, 'خلها دبي', ctx);
    expect(arW.type === 'apply' && arW.intent.destination).toBe('dubai');
    const umrah: AskIntent = { ...intentOf('Umrah after Eid'), kind: 'umrah' };
    const p = correctAsk(umrah, 'I have a permit', ctx);
    expect(p.type === 'apply' && p.changed).toEqual(['permit']);
    expect(p.type === 'apply' && p.intent.answers.permit).toEqual(['has']);
    const pa = correctAsk(umrah, 'عندي تصريح', ctx);
    expect(pa.type === 'apply' && pa.intent.answers.permit).toEqual(['has']);
  });
  it('works in stays and requests too, and switches between flights and a hotel', () => {
    const stay: AskIntent = { ...intentOf('A hotel in Istanbul for Eid'), kind: 'stay' };
    const r = correctAsk(stay, 'we are 5', ctx);
    expect(r.type === 'apply' && r.intent.kind).toBe('stay');
    const sw = correctAsk(base, 'a hotel', ctx);
    expect(sw.type === 'apply' && sw.intent.kind).toBe('stay');
  });
  it('asks which thing to change when it can’t tell, and starts again for a different request', () => {
    expect(correctAsk(base, 'that’s wrong', ctx)).toEqual({ type: 'unclear' });
    expect(correctAsk(base, 'غيّرها', ctx)).toEqual({ type: 'unclear' });
    expect(correctAsk(base, 'a visa for Sara', ctx)).toEqual({ type: 'new' });
    // A wish about the results ("closer to Sultanahmet") is left to the results, not read as a new place.
    expect(correctAsk(base, 'closer to Sultanahmet', ctx).type).not.toBe('apply');
    expect(correctAsk(base, 'with a pool', ctx).type).not.toBe('apply');
    expect(correctAsk(base, 'قريب من السلطان أحمد', ctx).type).not.toBe('apply');
  });
});

describe('fares and options for a family', () => {
  const opt = (label: string, dep: string) => ({ label, out: { dep } });
  it('puts night departures last for a family with a child under 5', () => {
    const list = [opt('best', '09:40'), opt('lowest', '06:15'), opt('earliest', '02:10')];
    expect(familyRank(list, false).map((o) => o.label)).toEqual(['best', 'lowest', 'earliest']);
    const ranked = familyRank(list, true);
    expect(ranked.map((o) => [o.out.dep, o.night])).toEqual([['09:40', false], ['06:15', false], ['02:10', true]]);
    const nightBest = familyRank([opt('best', '01:50'), opt('lowest', '10:00')], true);
    expect(nightBest.map((o) => o.label)).toEqual(['best', 'best']);
    expect(nightBest[0]!.out.dep).toBe('10:00');
    const two = person('x', 'Noura', 'child', { dateOfBirth: dobFromAge(2, TODAY) });
    expect(hasLittleOnes([OMAR, two], 0, TODAY)).toBe(true);
    expect(hasLittleOnes([OMAR, SARA], 0, TODAY)).toBe(false);
    expect(hasLittleOnes([OMAR], 1, TODAY)).toBe(true);
  });
  it('splits the price per person by fare band, adding up to the total', () => {
    const two = person('x', 'Noura', 'child', { dateOfBirth: dobFromAge(2, TODAY) });
    const lines = fareLines({ pricePerPerson: { amount: 216000 }, infantPrice: { amount: 21600 }, infants: 1, total: { amount: 216000 * 4 + 21600 } }, [OMAR, HESSA, SARA, two], '2027-03-09');
    expect(lines.map((l) => [l.band, l.count, l.each])).toEqual([['adult', 3, 216000], ['child', 1, 216000], ['lapInfant', 1, 21600]]);
    expect(lines.reduce((a, l) => a + l.total, 0)).toBe(216000 * 4 + 21600);
  });
});
