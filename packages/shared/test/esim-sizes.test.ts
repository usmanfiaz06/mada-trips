import { describe, expect, it } from 'vitest';
import { esimSizes, withSizes, type EsimPlan } from '../src';

/* The size words on eSIM cards: each card its own, honest next to the others shown. */

const plan = (gb: number | null, days = 30, extra: Partial<EsimPlan> = {}) => ({ gb, days, size: 'regular' as const, ...extra });

describe('eSIM size labels', () => {
  it('a 4-day trip offered 3, 10 and 20 GB: Light, Most people, Heavy (never two Heavy)', () => {
    // What staging showed: 3 GB "Most people", 10 GB and 20 GB both "Heavy".
    const shown = [{ ...plan(3), size: 'regular' as const }, { ...plan(10), size: 'heavy' as const }, { ...plan(20), size: 'heavy' as const }];
    expect(withSizes(shown, 4).map((p) => p.size)).toEqual(['light', 'regular', 'heavy']);
  });

  it('every card has a different word, whatever order they come in', () => {
    expect(esimSizes([plan(20), plan(3), plan(10)], 7)).toEqual(['heavy', 'light', 'regular']);
    expect(new Set(esimSizes([plan(1), plan(5), plan(null)], 7)).size).toBe(3);
  });

  it('unlimited is the biggest; a daily plan counts all its days', () => {
    expect(esimSizes([plan(null, 7), plan(10), plan(1, 7, { daily: true })], 7)).toEqual(['heavy', 'regular', 'light']);
  });

  it('two plans: Most people and Heavy when the smaller covers the trip, else Light and Most people', () => {
    expect(esimSizes([plan(5), plan(10)], 4)).toEqual(['regular', 'heavy']);
    expect(esimSizes([plan(3), plan(10)], 7)).toEqual(['light', 'regular']);
    expect(esimSizes([plan(3), plan(10)])).toEqual(['light', 'regular']);
  });

  it('one plan is Most people; none is nothing', () => {
    expect(esimSizes([plan(5)], 7)).toEqual(['regular']);
    expect(esimSizes([], 7)).toEqual([]);
  });

  it('keeps a plan as it is when its word was already right', () => {
    const p = { ...plan(3), size: 'light' as const };
    expect(withSizes([p, plan(10), { ...plan(20), size: 'heavy' as const }], 4)[0]).toBe(p);
  });
});
