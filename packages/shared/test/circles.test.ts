import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
});
