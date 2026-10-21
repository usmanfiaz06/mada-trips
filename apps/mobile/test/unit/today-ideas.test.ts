import { describe, expect, it } from 'vitest';
import { addDays } from '@mada/shared';
import { candidates, holidaysAhead, homeFromText, nextWeekend, pickIdeas, ramadanAhead, type IdeaInput } from '@/lib/today-ideas';

const base = (o: Partial<IdeaInput> = {}): IdeaInput => ({ today: '2026-10-21', guest: false, home: null, ...o });
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe('today ideas: season', () => {
  it('offers AlUla in the cool months and Abha in summer, never the other way round', () => {
    const oct = ids(candidates(base({ today: '2026-10-21' })));
    expect(oct).toContain('idea:alula');
    expect(oct).not.toContain('idea:abha');
    const jul = ids(candidates(base({ today: '2027-07-10' })));
    expect(jul).toContain('idea:abha');
    expect(jul).not.toContain('idea:alula');
  });
  it('gives Riyadh Season only in winter', () => {
    expect(ids(candidates(base({ today: '2026-12-01' })))).toContain('event:season');
    expect(ids(candidates(base({ today: '2027-06-01' })))).not.toContain('event:season');
  });
});

describe('today ideas: holidays', () => {
  it('knows the fixed public holidays and the Umm al-Qura Eids', () => {
    expect(holidaysAhead('2026-09-10', 30).map((h) => h.id)).toContain('national');
    expect(holidaysAhead('2027-02-10', 30).map((h) => h.id)).toContain('founding');
    const eid = holidaysAhead('2027-02-20', 60).find((h) => h.id === 'fitr');
    expect(eid).toBeTruthy();
    expect(eid!.date >= '2027-03-05' && eid!.date <= '2027-03-15').toBe(true);
    expect(ramadanAhead('2027-02-20', 30)).not.toBeNull();
  });
  it('turns the weekend tile into the holiday weekend, with its dates', () => {
    const cards = candidates(base({ today: '2026-09-12' }));
    const nd = cards.find((c) => c.id === 'event:national');
    expect(nd?.vars.date).toBe('2026-09-23');
    const wk = cards.filter((c) => c.kind === 'weekend');
    for (const w of wk) expect(w.title).toBe('ti.weekend.national');
  });
  it('raises Umrah in and before Ramadan', () => {
    const umrah = (today: string) => candidates(base({ today })).find((c) => c.kind === 'umrah')!;
    expect(umrah('2027-02-20').score).toBeGreaterThan(umrah('2026-10-21').score);
    expect(umrah('2027-02-20').body).toMatch(/ramadan/);
  });
  it('leaves Thursday for Saturday on the coming weekend', () => {
    expect(nextWeekend('2026-10-21')).toEqual({ from: '2026-10-22', to: '2026-10-24' }); // a Wednesday
    expect(nextWeekend('2026-10-22')).toEqual({ from: '2026-10-29', to: '2026-10-31' }); // a Thursday: the next one
  });
});

describe('today ideas: home city', () => {
  it('reads the home airport from what Mada remembers', () => {
    expect(homeFromText('Flies from Jeddah')).toBe('JED');
    expect(homeFromText('السفر من جدة')).toBe('JED');
    expect(homeFromText('Usually RUH')).toBe('RUH');
    expect(homeFromText('Aisle seat')).toBeNull();
  });
  it('gives a flight time only from a known home, and from that home', () => {
    const none = candidates(base()).filter((c) => c.durationMin !== null);
    expect(none).toEqual([]);
    const jed = candidates(base({ home: 'JED' })).find((c) => c.id === 'idea:alula')!;
    const ruh = candidates(base({ home: 'RUH' })).find((c) => c.id === 'idea:alula')!;
    expect(jed.durationMin).toBe(75);
    expect(ruh.durationMin).toBe(80);
  });
  it('omits the time where there is no direct flight we know', () => {
    const dmm = candidates(base({ home: 'DMM' })).find((c) => c.id === 'idea:alula')!;
    expect(dmm.durationMin).toBeNull();
  });
  it('never suggests home as a trip', () => {
    expect(ids(candidates(base({ today: '2026-12-01', home: 'JED' })))).not.toContain('idea:jeddah');
    expect(ids(candidates(base({ today: '2026-12-01', home: 'RUH' })))).toContain('idea:jeddah');
  });
  it('prefers the flight time from their own search over the table', () => {
    const c = candidates(base({ home: 'RUH', searches: [{ dest: 'istanbul', from: 'RUH', fromHalalas: null, durationMin: 250, depart: '2026-11-12' }] }));
    expect(c.find((x) => x.id === 'idea:istanbul')!.durationMin).toBe(250);
  });
});

describe('today ideas: rotation and variety', () => {
  const who: IdeaInput = base({ home: 'RUH', family: true, saved: [{ city: 'Baku', count: 3 }] });
  it('is stable within a day', () => {
    expect(ids(pickIdeas(who))).toEqual(ids(pickIdeas({ ...who })));
  });
  it('changes from day to day and avoids yesterday’s three', () => {
    let changed = 0;
    for (let i = 0; i < 60; i += 1) {
      const day = addDays('2026-11-01', i);
      const a = ids(pickIdeas({ ...who, today: day }));
      const b = ids(pickIdeas({ ...who, today: addDays(day, 1) }));
      if (a.join() !== b.join()) changed += 1;
      expect(a[0]).not.toBe(b[0]);
    }
    expect(changed).toBe(60);
  });
  it('shows a photo hero and three different kinds', () => {
    for (let i = 0; i < 30; i += 1) {
      const cards = pickIdeas({ ...who, today: addDays('2026-10-01', i * 11) });
      expect(cards).toHaveLength(3);
      expect(cards[0]!.photo).toBeTruthy();
      expect(new Set(cards.map((c) => c.kind)).size).toBe(3);
    }
  });
  it('gives guests season, rotation and events only', () => {
    for (let i = 0; i < 30; i += 1) {
      const cards = pickIdeas(base({ guest: true, today: addDays('2026-10-01', i * 7), saved: [{ city: 'Baku', count: 2 }], family: true }));
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) expect(['idea', 'weekend', 'event', 'umrah']).toContain(c.kind);
    }
  });
});

describe('today ideas: what they did and nothing invented', () => {
  it('never suggests where they just went', () => {
    const just = base({ today: '2026-11-20', past: [{ city: 'Istanbul', startDate: '2026-10-30', endDate: '2026-11-05' }] });
    expect(candidates(just).some((c) => c.place === 'istanbul')).toBe(false);
    const long = base({ today: '2026-11-20', past: [{ city: 'Istanbul', startDate: '2025-10-30', endDate: '2025-11-05' }] });
    expect(candidates(long).some((c) => c.place === 'istanbul')).toBe(true);
  });
  it('never suggests a place they already have a trip to', () => {
    const c = candidates(base({ upcoming: [{ id: 't1', city: 'Istanbul', country: 'Türkiye', startDate: '2027-03-09', endDate: '2027-03-15', hasEsim: true }] }));
    expect(c.some((x) => x.place === 'istanbul')).toBe(false);
  });
  it('names only a real member, and only a recent message', () => {
    const none = candidates(base());
    expect(none.every((c) => c.person === null)).toBe(true);
    expect(none.some((c) => c.kind === 'family')).toBe(true);
    const c = candidates(base({ circle: { circleId: 'c1', circleName: 'Istanbul for Eid', person: 'Abdullah', dest: 'Istanbul', at: '2026-10-20T18:00:00Z' } }));
    const card = c.find((x) => x.kind === 'circle')!;
    expect(card.person).toBe('Abdullah');
    expect(card.vars.name).toBe('Abdullah');
    expect(c.some((x) => x.kind === 'family')).toBe(false);
    const old = candidates(base({ circle: { circleId: 'c1', circleName: 'x', person: 'Abdullah', dest: null, at: '2026-09-01T18:00:00Z' } }));
    expect(old.some((x) => x.kind === 'circle')).toBe(false);
  });
  it('shows a price only from a cached search', () => {
    expect(candidates(base()).every((c) => c.fromHalalas === null)).toBe(true);
    const c = candidates(base({ searches: [{ dest: 'dubai', from: 'RUH', fromHalalas: 98_000, durationMin: 120, depart: '2026-11-12' }] }));
    const priced = c.filter((x) => x.fromHalalas !== null);
    expect(priced.map((x) => x.id)).toEqual(['fare:dubai']);
    expect(priced[0]!.fromHalalas).toBe(98_000);
    const demoOnly = candidates(base({ searches: [{ dest: 'dubai', from: 'RUH', fromHalalas: null, durationMin: 120, depart: '2026-11-12' }] }));
    expect(demoOnly.some((x) => x.kind === 'fare')).toBe(false);
  });
  it('nudges an eSIM for an international trip without one, not for a Saudi one', () => {
    const up = (country: string, hasEsim: boolean) => candidates(base({ upcoming: [{ id: 't1', city: 'Baku', country, startDate: '2026-11-10', endDate: '2026-11-15', hasEsim }] })).some((c) => c.kind === 'esim');
    expect(up('Azerbaijan', false)).toBe(true);
    expect(up('Azerbaijan', true)).toBe(false);
    expect(up('Saudi Arabia', false)).toBe(false);
  });
  it('reminds them of saved places with the real count', () => {
    const s = candidates(base({ saved: [{ city: 'Baku', count: 3 }, { city: 'Istanbul', count: 1 }] })).find((c) => c.kind === 'saved')!;
    expect(s.vars).toMatchObject({ count: 3, city: 'Baku' });
    expect(s.title).toBe('ti.saved.many');
  });
});
