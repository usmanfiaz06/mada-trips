import { describe, expect, it } from 'vitest';
import { addWorkingDays, autoApproveRefund, refundAutoMax, refundBankLate, walletLine, workingDaysSince, type AutoApproveInput } from '../src/refunds';
import { ar, en } from '../src/copy';

const ok: AutoApproveInput = { clear: 'free', destination: 'credit', amount: 440_00, max: 500_00, flagged: false };

describe('auto-approval (APP-FINANCE.md)', () => {
  it('approves when every condition holds, and names the rule', () => {
    const d = autoApproveRefund(ok);
    expect(d).toEqual({ ok: true, rule: 'No fee under the rules, to Mada Wallet, SAR 440 within SAR 500, no open flag' });
    expect(autoApproveRefund({ ...ok, destination: 'original', clear: 'supplier_confirmed' })).toMatchObject({ ok: true, rule: expect.stringMatching(/^Supplier confirmed the cancellation, to the card/) });
  });
  it('turns each condition off on its own', () => {
    expect(autoApproveRefund({ ...ok, clear: null })).toEqual({ ok: false, why: 'not_clear' });
    expect(autoApproveRefund({ ...ok, destination: 'instalments' })).toEqual({ ok: false, why: 'destination' });
    expect(autoApproveRefund({ ...ok, amount: 500_01 })).toEqual({ ok: false, why: 'over_max' });
    expect(autoApproveRefund({ ...ok, amount: 500_00 })).toMatchObject({ ok: true });
    expect(autoApproveRefund({ ...ok, flagged: true })).toEqual({ ok: false, why: 'flagged' });
    expect(autoApproveRefund({ ...ok, amount: 0 })).toEqual({ ok: false, why: 'nothing' });
  });
  it('reads APP_REFUND_AUTO_MAX in SAR, falling back to the agent limit; 0 turns it off', () => {
    expect(refundAutoMax(undefined, 500_00)).toBe(500_00);
    expect(refundAutoMax('750', 500_00)).toBe(750_00);
    expect(refundAutoMax('750.50', 500_00)).toBe(750_50);
    expect(refundAutoMax('lots', 500_00)).toBe(500_00);
    expect(refundAutoMax('0', 500_00)).toBe(0);
    expect(autoApproveRefund({ ...ok, max: refundAutoMax('0', 500_00) })).toEqual({ ok: false, why: 'over_max' });
  });
});

describe('working days (Sunday to Thursday, Riyadh)', () => {
  it('skips Friday and Saturday', () => {
    // Thursday 12 Nov 2026, 09:00 Riyadh → the 10th working day is Thursday 26 Nov.
    const thu = new Date('2026-11-12T06:00:00Z');
    expect(addWorkingDays(thu, 1).toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(addWorkingDays(thu, 10).toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(workingDaysSince(thu.toISOString(), Date.parse('2026-11-26T06:00:00Z'))).toBe(10);
  });
  it('says a sent card refund is late only after 10 working days, never for the wallet', () => {
    const r = { stage: 'sent', destination: 'original', sentAt: '2026-11-12T06:00:00Z' };
    expect(refundBankLate(r, Date.parse('2026-11-26T06:00:00Z'))).toBe(false);
    expect(refundBankLate(r, Date.parse('2026-11-29T06:00:00Z'))).toBe(true);
    expect(refundBankLate({ ...r, destination: 'credit' }, Date.parse('2027-01-01T00:00:00Z'))).toBe(false);
    expect(refundBankLate({ ...r, stage: 'approved' }, Date.parse('2027-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('Mada Wallet lines', () => {
  it('reads a movement as what it was and what for', () => {
    expect(walletLine('refund', 'Garden hotel, Istanbul')).toEqual({ what: 'refund', detail: 'Garden hotel, Istanbul' });
    expect(walletLine('refund', 'Refund · Istanbul · the stay')).toEqual({ what: 'refund', detail: 'Istanbul · the stay' });
    expect(walletLine('refund', 'Refund to Mada credit')).toEqual({ what: 'refund', detail: null });
    expect(walletLine('spend', 'Istanbul, 9–15 Mar')).toEqual({ what: 'spend', detail: 'Istanbul, 9–15 Mar' });
    expect(walletLine('odd', null)).toEqual({ what: 'adjustment', detail: null });
  });
});

describe('refund and wallet copy (owner decisions)', () => {
  const both = { ...en } as Record<string, string>;
  const arabic = ar as Record<string, string>;
  it('calls the balance Mada Wallet / محفظة مادا, never Mada credit', () => {
    const old = Object.entries(both).filter(([, v]) => /Mada credit/i.test(v)).map(([k]) => k);
    const oldAr = Object.entries(arabic).filter(([, v]) => /رصيد مادا/.test(v)).map(([k]) => k);
    expect([...old, ...oldAr]).toEqual([]);
    expect(en['money.credit']).toBe('Mada Wallet');
    expect(arabic['money.credit']).toBe('محفظة مادا');
    expect(en['rf.toCredit']).toBe('Mada Wallet · instantly');
    expect(arabic['rf.toCredit']).toBe('محفظة مادا · فورًا');
  });
  it('never offers to move the wallet to a card', () => {
    const moves = Object.entries(both).filter(([, v]) => /move (it|the balance|your (credit|wallet)) to (my|your) card|cash out/i.test(v)).map(([k]) => k);
    expect(moves).toEqual([]);
    for (const k of ['money.credit.move', 'money.credit.moved', 'money.credit.movedTo', 'money.credit.nothing']) { expect(both[k], k).toBeUndefined(); expect(arabic[k], k).toBeUndefined(); }
  });
  it('gives one range for card refunds: 5–10 working days', () => {
    const wrong = Object.entries(both).filter(([k, v]) => /(rf|dz|oc|help|desk|notify|money)\./.test(k) && /7–14|7 to 14|5 to 14|within 14 days/.test(v)).map(([k]) => k);
    const wrongAr = Object.entries(arabic).filter(([, v]) => /7 إلى 14|5 إلى 14|خلال 14 يوم/.test(v)).map(([k]) => k);
    expect([...wrong, ...wrongAr]).toEqual([]);
    expect(en['rf.toCardSub']).toBe('Your bank shows it in 5–10 working days.');
    expect(arabic['rf.toCardSub']).toBe('يوصلك خلال 5–10 أيام عمل حسب بنكك.');
  });
});

describe('the refund_quote chat card (ASK-REFUND.md)', () => {
  it('parses with the refund screen’s fields and the tracker state, and every word is in both languages', async () => {
    const { ChatCard } = await import('../src/schemas/ask-chat');
    const { en } = await import('../src/copy/en');
    const { arSections } = await import('../src/copy/ar');
    const id = '11111111-1111-4111-8111-111111111111';
    const sar = (amount: number) => ({ amount, currency: 'SAR' as const });
    const card = {
      type: 'refund_quote', tripId: id, title: 'Rove Downtown · 4 nights', city: 'Dubai', paymentIds: [id], items: ['stay'], reason: 'plans', clientKey: 'ask-0123456789abcdef',
      paid: sar(2300_00), back: sar(1840_00), kept: sar(460_00), keptBy: 'hotel', rule: 'One night kept inside 7 days', anyway: false, instalments: null, card: 'Visa ending 41', walletInstant: false, refund: null,
    };
    expect(ChatCard.parse(card)).toMatchObject({ type: 'refund_quote', back: { amount: 1840_00 } });
    expect(() => ChatCard.parse({ ...card, clientKey: 'short' })).toThrow();
    const keys = Object.keys(en).filter((k) => k.startsWith('chat.refund.'));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(arSections[k], k).toBeTruthy();
    expect(arSections['chat.refund.state.wallet']).toBe('في محفظة مادا');
  });
});
