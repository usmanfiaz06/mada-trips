import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resetDisplayPrefs, setDisplayPrefs } from '../src/locale';
import { circleDest, contactHash, CONTACT_SALT, equalAmounts, findPlace, joinNames, madaReply, sha256Hex, shareUnits, splitAmounts, votePhrase } from '../src/schemas/circles';

describe('circles logic', () => {
  it('hashes like SHA-256, for contacts matched on the phone', () => {
    for (const s of ['', 'abc', 'مدى', 'x'.repeat(200)]) expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    expect(contactHash('+966500004127')).toBe(createHash('sha256').update(`${CONTACT_SALT}:+966500004127`).digest('hex'));
  });
  it('splits to the halala, never losing or inventing one', () => {
    expect(equalAmounts(100, 3)).toEqual([34, 33, 33]);
    expect(splitAmounts(100_000, 3)).toEqual([33_400, 33_300, 33_300]);
    expect(splitAmounts(1_001, 3)).toEqual([334, 334, 333]);
    for (const [t, k] of [[114_000, 2], [99_999, 7], [1, 4]] as const) expect(splitAmounts(t, k).reduce((a, b) => a + b, 0)).toBe(t);
    const fam = (id: string) => ({ hessa: 'omar', noor: 'abdullah' } as Record<string, string>)[id] ?? id;
    expect(shareUnits('family', ['omar', 'hessa', 'abdullah', 'noor'], fam)).toEqual([{ key: 'omar', ids: ['omar', 'hessa'] }, { key: 'abdullah', ids: ['abdullah', 'noor'] }]);
  });
  it('knows places, never guesses a destination, and answers by rules', () => {
    expect(findPlace('Eid in Tbilisi?')).toBe('Georgia');
    expect(circleDest({ dest: null, name: 'Cousins', trip: null })).toBeNull();
    expect(circleDest({ dest: null, name: 'Summer in Baku' })).toBe('Baku');
    expect(madaReply({ members: 4, dest: null, text: '@Mada ideas', prevAskedWhere: false })).toMatchObject({ askWhere: true });
    expect(madaReply({ members: 4, dest: 'AlUla', text: '@Mada how much?', prevAskedWhere: false }).text).toContain('For 4 people, 4 nights in AlUla');
    expect(madaReply({ members: 2, dest: null, text: 'Abha', prevAskedWhere: true }).dest).toBe('Abha');
    expect(votePhrase('Wed 10 Mar')).toBe('Wednesday');
    expect(joinNames(['Hessa', 'Abdullah', 'Noor', 'Sara'])).toBe('Hessa, Abdullah and 2 others');
  });
  it('answers @Mada in Arabic when asked in Arabic: place facts, keywords and places typed in Arabic', () => {
    setDisplayPrefs({ locale: 'ar', digits: 'latn' });
    try {
      expect(findPlace('@Mada وش نسوي بإسطنبول')).toBe('Istanbul');
      const ideas = madaReply({ members: 4, dest: null, text: '@Mada أفكار للعلا', prevAskedWhere: false });
      expect(ideas.dest).toBe('AlUla');
      expect(ideas.list).toEqual(['الحِجر وقت الغروب', 'أزقة البلدة القديمة بعد الساعة 16:00', 'سهرة تحت النجوم في غراميل']);
      expect(madaReply({ members: 4, dest: 'Istanbul', text: '@Mada نحتاج تأشيرة؟', prevAskedWhere: false }).text).toContain('الجواز السعودي ياخذ تأشيرة إلكترونية');
      expect(madaReply({ members: 4, dest: 'Georgia', text: '@Mada متى أحلى وقت؟', prevAskedWhere: false }).text).toContain('من مايو إلى أكتوبر');
      expect(madaReply({ members: 4, dest: 'Dubai', text: '@Mada وين نسكن', prevAskedWhere: false }).text).toContain('وسط دبي عشان النوافير');
      expect(madaReply({ members: 4, dest: null, text: '@Mada', prevAskedWhere: false }).actions.map((a) => a.label)).toEqual(['جورجيا', 'باكو', 'العُلا']);
      // Nothing English left in an answer.
      for (const dest of ['Istanbul', 'Georgia', 'Baku', 'AlUla', 'London', 'Dubai', 'Riyadh', 'Abha']) {
        for (const q of ['@Mada', '@Mada طيران', '@Mada فندق', '@Mada الجو', '@Mada تأشيرة']) {
          const r = madaReply({ members: 3, dest, text: q, prevAskedWhere: false });
          for (const line of [r.text, ...r.list, r.foot ?? '']) expect(line, `${dest} ${q}`).not.toMatch(/[A-Za-z]{3,}/);
        }
      }
    } finally { resetDisplayPrefs(); }
  });
});
