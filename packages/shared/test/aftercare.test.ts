import { describe, expect, it } from 'vitest';
import { t } from '../src/copy';
import {
  defaultNext, outcomeHead, progressFromStatus, RequestResult, resultFromLegacy, serviceWhat, settledDemoPhase, supportReplies, terminalNo,
  type SupportContext,
} from '../src';

/* CRITIQUE-2 #7, #11, #15: outcomes that say what, one terminal word, the demo after a rebook, "Which flight?". */

const render = ([k, v]: [string, Record<string, string | number>?], l: 'en' | 'ar' = 'en') => t(k as never, v, l);

describe('outcomes that say what was done (#7)', () => {
  it('heads an issued outcome with what was done, never a bare "It’s done."', () => {
    expect(render(outcomeHead({ kind: 'issued', what: 'UK ETA issued for you and Hessa.' }))).toBe('UK ETA issued for you and Hessa.');
    // An older result: the request's title at least.
    expect(render(outcomeHead({ kind: 'issued' }, 'Visa: Schengen'))).toBe('Visa: Schengen: done.');
    expect(render(outcomeHead({ kind: 'refused', what: 'x' }))).toBe('Not this time.');
  });
  it('says what an issued service did, in either language', () => {
    expect(render(serviceWhat('uk_eta', { names: 'you and Hessa' })!)).toBe('UK ETA issued for you and Hessa');
    expect(render(serviceWhat('passport_renewal', { names: 'Noura' })!, 'ar')).toBe('انجدد الجواز: نورة');
    const r = resultFromLegacy({ status: 'done', updatedAt: '2026-10-16T10:00:00Z', what: 'UK ETA issued for you and Hessa' });
    expect(r?.what).toBe('UK ETA issued for you and Hessa');
    expect(RequestResult.safeParse(r).success).toBe(true);
  });
  it('a refused visa offers the appeal, applying again and the trip', () => {
    expect(defaultNext('refused', { reason: 'visa_refused', trip: true })).toEqual(['appeal', 'reapply', 'trip_options']);
    expect(defaultNext('cancelled', { reason: 'dates_passed', booking: true })).toEqual(['other_dates', 'talk']);
    expect(RequestResult.safeParse({ kind: 'refused', reason: 'visa_refused', appealBy: '2026-11-02', with: 'UK Visas', note: null, money: { kind: 'none', amount: null, by: null }, next: ['appeal'], by: 'Noura', at: '2026-10-18T10:00:00Z' }).success).toBe(true);
  });
  it('a passport renewal is never "Checking the visa rules"', () => {
    const at = '2026-10-18T10:00:00Z';
    expect(progressFromStatus({ status: 'reviewing', kind: 'visa', service: 'passport_renewal', createdAt: at })?.step).toBe('renewing');
    expect(progressFromStatus({ status: 'reviewing', kind: 'visa', service: 'uk_eta', createdAt: at })?.step).toBe('applying');
    expect(progressFromStatus({ status: 'reviewing', kind: 'visa', createdAt: at })?.step).toBe('asking_embassy');
    expect(t('oi.step.renewing', undefined, 'ar')).not.toMatch(/التأشيرة/);
  });
});

describe('the terminal said once (#11)', () => {
  it('takes the number from any way the airline writes it', () => {
    expect(terminalNo('Terminal 3')).toBe('3');
    expect(terminalNo('T1')).toBe('1');
    expect(terminalNo('3')).toBe('3');
    expect(terminalNo('TBD')).toBe('TBD');
    expect(terminalNo(null)).toBe('');
    expect(t('lp.terminal', { terminal: terminalNo('Terminal 3') })).toBe('Terminal 3');
  });
});

describe('recovery aftercare (#15)', () => {
  it('a rebooked trip leaves the delay demo for a plain travel day', () => {
    const delay = { kind: 'delay', decided: 'xy' };
    expect(settledDemoPhase({ rebooked: true, disruption: delay }, 'delayed')).toBe('travelday');
    expect(settledDemoPhase({ rebooked: true, disruption: { kind: 'cancel', decided: 'next' } }, 'cancelled')).toBe('travelday');
    // Another disruption on the new flight still shows; nothing decided, nothing settles.
    expect(settledDemoPhase({ rebooked: true, disruption: delay }, 'cancelled')).toBe('cancelled');
    expect(settledDemoPhase({ rebooked: false, disruption: delay }, 'delayed')).toBe('delayed');
    expect(settledDemoPhase({ rebooked: true, disruption: null }, 'delayed')).toBe('delayed');
    expect(settledDemoPhase({ rebooked: true, disruption: delay }, 'inair')).toBe('inair');
  });
  it('the agent line carries no quotes of its own (the screen adds them once)', () => {
    for (const l of ['en', 'ar'] as const) for (const k of ['dz.done.line', 'dz.done.nightLine', 'dz.done.refundLine']) expect(t(k as never, { airline: 'Saudia' }, l)).not.toMatch(/^["“«]|["”»]$/);
  });
  it('a flight problem said days before the booked flight: asks which flight, and still calls back', () => {
    const T0 = Date.parse('2026-10-18T23:00:00Z');
    const ctx: SupportContext = { trip: { id: 'a3c1f3a0-0000-4000-8000-000000000001', bookingRef: null, airline: 'Saudia', travellers: [], city: 'Istanbul', now: false, flight: { code: 'SV263', day: '2026-11-12' } }, refund: null, deskPhone: '+966', now: T0 };
    const [r] = supportReplies({ kind: 'intent', intent: 'urgent', text: 'My flight tomorrow 6am got cancelled, what do I do? Urgent' }, ctx);
    expect(r!.body).toBe(t('support.reply.whichFlight', { flight: 'SV263', day: '12 Nov' }));
    expect(r!.card?.callback?.by).toBeTruthy();
    expect(r!.card?.choices?.map((c) => c.label)).toEqual(['SV263 · 12 Nov', 'Another flight']);
    const [mine] = supportReplies({ kind: 'pick', choice: r!.card!.choices![0]!.key, label: 'SV263 · 12 Nov' }, ctx);
    expect(mine!.body).toBe(`${t('support.reply.whichTrip', { flight: 'SV263' })} ${t('support.dx.next.cancelled')}`);
    const [other] = supportReplies({ kind: 'pick', choice: r!.card!.choices![1]!.key, label: 'Another flight' }, ctx);
    expect(other!.body).toBe(t('support.reply.whichOther'));
    // Within 24 hours it's that trip's flight: straight to the promise.
    const [now] = supportReplies({ kind: 'intent', intent: 'urgent', text: 'my flight got cancelled' }, { ...ctx, trip: { ...ctx.trip!, now: true } });
    expect(now!.card?.callback?.problem).toBe('cancelled');
  });
});
