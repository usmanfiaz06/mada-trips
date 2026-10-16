import { describe, expect, it } from 'vitest';
import { t } from '../src/copy';
import {
  canNudge, defaultNext, isLate, onItCost, onItStep, outcomeHead, outcomeMoney, outcomeWhy, progressFromStatus, resultFromLegacy,
  RequestResult, TripRequestView, OrderView, type OutcomeKind,
} from '../src/schemas';

const fmt = { amount: (h: number) => `${h / 100} SAR`, day: (d: string) => d };
const render = ([k, v]: [string, Record<string, string | number>?], l: 'en' | 'ar' = 'en') => t(k as never, v, l);

describe('outcomes', () => {
  it('reads an old refusal as refused, with what Mada offers instead and nothing charged', () => {
    const r = resultFromLegacy({ status: 'cancelled', outcome: 'no', alt: 'A cot instead', withName: 'Saudia', updatedAt: '2026-10-16T10:00:00Z', tripId: 't' });
    expect(r).toMatchObject({ kind: 'refused', reason: 'rules', with: 'Saudia', note: 'A cot instead', money: { kind: 'none' }, next: ['talk'] });
    expect(RequestResult.safeParse(r).success).toBe(true);
    expect(render(outcomeWhy(r!))).toBe('Saudia’s rules don’t allow it this time.');
  });
  it('reads a taken-back request as withdrawn, a booking with a way to book again', () => {
    expect(resultFromLegacy({ status: 'cancelled', withdrawn: true, updatedAt: '2026-10-16T10:00:00Z', booking: true })).toMatchObject({ kind: 'withdrawn', next: ['book_again'] });
  });
  it('is null while a request is open', () => {
    expect(resultFromLegacy({ status: 'reviewing', updatedAt: '2026-10-16T10:00:00Z' })).toBeNull();
  });
  it('always says what is being done, by when and the cost while open', () => {
    const p = progressFromStatus({ status: 'reviewing', withWhom: 'hotel', withName: 'Swissôtel Makkah', createdAt: '2026-10-16T10:00:00Z' })!;
    expect(p.step).toBe('asking_hotel');
    expect(p.dueAt).toBe('2026-10-16T11:00:00.000Z');
    expect(p.promised).toBe(false);
    expect(render(onItStep(p))).toBe('Asking Swissôtel Makkah');
    expect(render(onItCost(p, fmt))).toMatch(/Nothing is charged until you say yes/);
    const quoted = progressFromStatus({ status: 'sent', createdAt: '2026-10-16T10:00:00Z', promisedBy: '2026-10-16T12:30:00Z', quote: { amount: 15000, currency: 'SAR' } })!;
    expect(quoted.dueAt).toBe('2026-10-16T12:30:00Z');
    expect(render(onItCost(quoted, fmt))).toBe('150 SAR, as quoted.');
    expect(progressFromStatus({ status: 'done', createdAt: '2026-10-16T10:00:00Z' })).toBeNull();
  });
  it('is late once the time has passed, and a nudge waits 30 minutes before the next', () => {
    const p = { dueAt: '2026-10-16T11:00:00Z', nudgedAt: null };
    const at = (s: string) => Date.parse(s);
    expect(isLate(p, at('2026-10-16T10:59:00Z'))).toBe(false);
    expect(canNudge(p, at('2026-10-16T11:01:00Z'))).toBe(true);
    expect(canNudge({ ...p, nudgedAt: '2026-10-16T11:01:00Z' }, at('2026-10-16T11:20:00Z'))).toBe(false);
    expect(canNudge({ ...p, nudgedAt: '2026-10-16T11:01:00Z' }, at('2026-10-16T11:31:00Z'))).toBe(true);
  });
  it('words every outcome, reason and money line in English and Arabic', () => {
    const kinds: OutcomeKind[] = ['issued', 'refused', 'partial', 'cancelled', 'withdrawn'];
    for (const k of kinds) for (const l of ['en', 'ar'] as const) expect(render(outcomeHead({ kind: k }), l)).not.toMatch(/⟦/);
    expect(render(outcomeMoney({ kind: 'refund', amount: { amount: 42000, currency: 'SAR' }, by: '2026-10-30' }, fmt))).toBe('420 SAR back to your card by 2026-10-30.');
    expect(render(outcomeMoney({ kind: 'none', amount: null, by: null }, fmt), 'ar')).toBe('ما انخصم شي.');
    expect(render(outcomeMoney({ kind: 'kept', amount: { amount: 30000, currency: 'SAR' }, by: null }, fmt))).toBe('300 SAR paid for the part that’s done.');
  });
  it('always leaves a way on', () => {
    expect(defaultNext('refused', { booking: true })).toEqual(['other_dates', 'talk']);
    expect(defaultNext('partial', { trip: true })).toEqual(['see_trip', 'talk']);
  });
  it('older servers still parse (result and progress are optional)', () => {
    const shape = TripRequestView.shape;
    expect(shape.result.safeParse(undefined).success).toBe(true);
    expect(OrderView.shape.result.safeParse(undefined).success).toBe(true);
  });
});

describe('refund outcomes', () => {
  it('reads a sent refund as issued with when the money lands, a declined one as refused with the reason', async () => {
    const { refundResult } = await import('../src/schemas');
    const base = { destination: 'original', amount: { amount: 50000, currency: 'SAR' as const }, reject: null, expectedBy: '2026-10-30T09:00:00Z', updatedAt: '2026-10-16T10:00:00Z' };
    expect(refundResult({ ...base, stage: 'sent' })).toMatchObject({ kind: 'issued', money: { kind: 'refund', by: '2026-10-30' } });
    expect(refundResult({ ...base, stage: 'sent', destination: 'credit' })!.money.kind).toBe('credit');
    expect(refundResult({ ...base, stage: 'rejected', reject: 'Non-refundable fare' })).toMatchObject({ kind: 'refused', note: 'Non-refundable fare', money: { kind: 'none' } });
    expect(refundResult({ ...base, stage: 'requested' })).toBeNull();
  });
});
