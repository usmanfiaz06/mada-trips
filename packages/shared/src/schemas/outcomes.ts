import { z } from 'zod';
import { Id, IsoDateTime, IsoDay, Money } from './common';
import type { CopyKey, Vars } from '../copy';
import { dayLabel, timeLabel, todayIn, zonedParts } from '../dates';
import type { Lang } from '../locale';

/*
 * How a request ends, and what Mada is doing until it does (critique items 5 and 6).
 *
 * Every request the traveller sends (a booking, a change, a refund, a special request, an ask to Mada, a visa or an
 * Umrah) ends in one explicit outcome: issued, refused, partial, cancelled, or withdrawn by the traveller. Each carries
 * a reason, what happens to the money, and the next step. While it is open, the traveller always sees what is being
 * done, by when, and what it costs; when the time passes they see that too, with a nudge and a call.
 *
 * Everything here is codes and numbers, never words: the app (and the inbox, at read time) puts them in the reader's
 * language through the copy keys below. The only free text is the agent's own note, shown as theirs.
 */

export const OutcomeKind = z.enum(['issued', 'refused', 'partial', 'cancelled', 'withdrawn']);
export type OutcomeKind = z.infer<typeof OutcomeKind>;

/** Why it ended. The desk picks one; the traveller reads it in plain words (oc.why.*). */
export const OutcomeReason = z.enum([
  'done', 'sold_out', 'rules', 'price', 'documents', 'no_reply', 'too_late', 'payment', 'part', 'you_asked', 'mada', 'other',
  // The embassy said no (an appeal deadline, apply again, and the flights and hotel to change or refund); the
  // request's dates passed before it could be done (closed by the job, nothing charged).
  'visa_refused', 'dates_passed',
]);
export type OutcomeReason = z.infer<typeof OutcomeReason>;

/** The buttons under an outcome. */
export const OutcomeNext = z.enum(['book_again', 'other_dates', 'talk', 'see_trip', 'appeal', 'reapply', 'trip_options']);
export type OutcomeNext = z.infer<typeof OutcomeNext>;

/**
 * What happens to the money. none: nothing was charged (a card hold is released). refund: back to the card by `by`.
 * credit: back as Mada credit, at once. kept: charged for the part that was done. charged: paid in full.
 */
export const OutcomeMoney = z.object({
  kind: z.enum(['none', 'refund', 'credit', 'kept', 'charged']),
  amount: Money.nullable(),
  by: IsoDay.nullable(),
});
export type OutcomeMoney = z.infer<typeof OutcomeMoney>;

export const RequestResult = z.object({
  kind: OutcomeKind,
  reason: OutcomeReason,
  /**
   * What was done, in a line the traveller can't misread: "UK ETA issued for you and Hessa". The desk must write it to
   * close a request as issued (CRITIQUE-2 #7); older results have none, and the app falls back to the request's title.
   */
  what: z.string().max(160).nullable().optional(),
  /** A refused visa: the last day to appeal, when the embassy gave one. */
  appealBy: IsoDay.nullable().optional(),
  /** Who said yes or no: an airline, a hotel ("Swissôtel Makkah"), an embassy. */
  with: z.string().nullable(),
  /** The agent's own words, shown as theirs. */
  note: z.string().nullable(),
  money: OutcomeMoney,
  next: z.array(OutcomeNext).max(3),
  /** The person who decided it, only when a real person did (COPY.md §1). */
  by: z.string().nullable(),
  at: IsoDateTime,
});
export type RequestResult = z.infer<typeof RequestResult>;

/** What Mada is doing right now, in one step. */
export const OnItStep = z.enum(['reading', 'asking_airline', 'asking_hotel', 'asking_embassy', 'searching', 'pricing', 'booking', 'issuing', 'refunding', 'applying', 'renewing']);
export type OnItStep = z.infer<typeof OnItStep>;

/**
 * An open request: what is being done, by when (a time the desk promised, or Mada's usual time), and the cost
 * (free · quoted, with the amount · later: the price comes with the answer · paid). nudgedAt: the traveller nudged.
 */
export const RequestProgress = z.object({
  step: OnItStep,
  with: z.string().nullable(),
  dueAt: IsoDateTime,
  promised: z.boolean(),
  cost: z.object({ kind: z.enum(['free', 'quoted', 'later', 'paid']), amount: Money.nullable() }),
  nudgedAt: IsoDateTime.nullable(),
});
export type RequestProgress = z.infer<typeof RequestProgress>;

/** POST /requests/:id/nudge */
export const NudgeResponse = z.object({ progress: RequestProgress });

/** The desk's outcome form (Ops: request page). Amounts in halalas. */
export const DeskOutcomeInput = z.object({
  requestId: Id,
  kind: OutcomeKind.exclude(['withdrawn']),
  reason: OutcomeReason,
  with: z.string().trim().max(60).nullable(),
  note: z.string().trim().max(300).nullable(),
  money: z.enum(['none', 'refund', 'credit', 'kept', 'charged']),
  amount: z.number().int().min(0).max(100_000_000).nullable(),
  by: IsoDay.nullable(),
  next: z.array(OutcomeNext).max(3),
  /** What was done, for an issued outcome (required there): "UK ETA issued for you and Hessa". */
  what: z.string().trim().max(160).nullable().optional(),
  /** A refused visa: the last day to appeal. */
  appealBy: IsoDay.nullable().optional(),
});
export type DeskOutcomeInput = z.infer<typeof DeskOutcomeInput>;

/** The desk's "what we're doing" form: the step, the time promised, and the cost. */
export const DeskPromiseInput = z.object({
  requestId: Id,
  step: OnItStep,
  with: z.string().trim().max(60).nullable(),
  dueAt: IsoDateTime,
  cost: z.enum(['free', 'quoted', 'later', 'paid']),
  amount: z.number().int().min(0).max(100_000_000).nullable(),
});
export type DeskPromiseInput = z.infer<typeof DeskPromiseInput>;

/* ───────── rules ───────── */

/** Mada's usual time for each kind of work when the desk hasn't promised one (platform desk/sla.ts keeps the desk's). */
export const ON_IT_MINUTES = { request: 120, supplier: 60, refund: 24 * 60, order: 15 } as const;

/** A nudge is allowed once the promised time has passed, and again every 30 minutes. */
export const NUDGE_EVERY_MS = 30 * 60_000;
export const isLate = (p: Pick<RequestProgress, 'dueAt'>, now = Date.now()) => Date.parse(p.dueAt) < now;
export const canNudge = (p: Pick<RequestProgress, 'dueAt' | 'nudgedAt'>, now = Date.now()) =>
  isLate(p, now) && (!p.nudgedAt || now - Date.parse(p.nudgedAt) >= NUDGE_EVERY_MS);

/** The buttons an outcome gets when the desk didn't choose: always a way on, and Mada for anything else. */
export function defaultNext(kind: OutcomeKind, o: { booking?: boolean; trip?: boolean; reason?: OutcomeReason } = {}): OutcomeNext[] {
  if (kind === 'issued') return o.trip ? ['see_trip'] : [];
  // A refused visa: appeal, apply again, and what to do about the flights and hotel.
  if (kind === 'refused' && o.reason === 'visa_refused') return ['appeal', 'reapply', 'trip_options'];
  if (o.reason === 'dates_passed') return o.booking ? ['other_dates', 'talk'] : ['talk'];
  if (kind === 'withdrawn') return o.booking ? ['book_again'] : [];
  if (kind === 'partial') return o.trip ? ['see_trip', 'talk'] : ['talk'];
  return o.booking ? ['other_dates', 'talk'] : ['talk'];
}

/** The reason that goes with each outcome when the desk didn't say. */
export const defaultReason = (kind: OutcomeKind): OutcomeReason =>
  kind === 'issued' ? 'done' : kind === 'partial' ? 'part' : kind === 'withdrawn' ? 'you_asked' : kind === 'cancelled' ? 'mada' : 'other';

const nothing: OutcomeMoney = { kind: 'none', amount: null, by: null };

/**
 * A request written before outcomes existed, read as one: a 'no' from the scripted desk is refused (its `alt` is what
 * Mada offers instead), a taken-back request is withdrawn, a closed one is issued or cancelled. Null while open.
 */
export function resultFromLegacy(r: {
  status: string; outcome?: 'yes' | 'no' | null; alt?: string | null; yesText?: string | null; withdrawn?: boolean; withName?: string | null;
  quote?: { amount: number; currency: 'SAR' } | null; updatedAt: string; agent?: string | null; booking?: boolean; tripId?: string | null;
  /** What was done, when the caller can say (a service the scripted desk issued). */
  what?: string | null;
}): RequestResult | null {
  const base = { with: r.withName ?? null, by: null, at: r.updatedAt };
  const ctx = { booking: !!r.booking, trip: !!r.tripId };
  if (r.withdrawn) return { ...base, kind: 'withdrawn', reason: 'you_asked', note: null, money: nothing, next: defaultNext('withdrawn', ctx) };
  if (r.outcome === 'no') return { ...base, kind: 'refused', reason: 'rules', note: r.alt ?? null, money: nothing, next: defaultNext('refused', ctx) };
  if (r.status === 'done' || r.status === 'confirmed' || r.status === 'paid') {
    const paid = r.quote && r.quote.amount > 0 ? { kind: 'charged' as const, amount: r.quote, by: null } : nothing;
    return { ...base, kind: 'issued', reason: 'done', what: r.what ?? null, note: r.yesText ?? null, money: paid, next: defaultNext('issued', ctx) };
  }
  if (r.status === 'cancelled') return { ...base, kind: 'cancelled', reason: 'mada', note: null, money: nothing, next: defaultNext('cancelled', ctx) };
  return null;
}

/**
 * A refund read as an outcome: sent is issued (back to the card by the expected day, or Mada credit at once), declined
 * is refused with the desk's reason as their note, taken back is withdrawn. Null while it's still being decided.
 */
export function refundResult(f: {
  stage: string; withdrawn?: boolean; destination: string; amount: { amount: number; currency: 'SAR' }; reject: string | null;
  expectedBy: string | null; airline?: string | null; law?: boolean; updatedAt: string; tripId?: string | null;
}): RequestResult | null {
  const base = { with: f.airline ?? null, by: null, at: f.updatedAt };
  if (f.withdrawn) return { ...base, kind: 'withdrawn', reason: 'you_asked', note: null, money: nothing, next: [] };
  if (f.stage === 'rejected') return { ...base, kind: 'refused', reason: 'rules', note: f.reject, money: nothing, next: ['talk'] };
  if (f.stage === 'sent') {
    const money: OutcomeMoney = f.destination === 'credit' ? { kind: 'credit', amount: f.amount, by: null } : { kind: 'refund', amount: f.amount, by: f.expectedBy ? f.expectedBy.slice(0, 10) : null };
    return { ...base, kind: 'issued', reason: 'done', note: null, money, next: f.tripId ? ['see_trip'] : [] };
  }
  return null;
}

/** The scripted desk's partial yes (mock mode, both backends): what it could do, charged only for that. */
export function partialResult(o: { with: string | null; note: string; quote?: { amount: number; currency: 'SAR' } | null; at: string; tripId?: string | null }): RequestResult {
  return {
    kind: 'partial', reason: 'part', with: o.with, note: o.note, by: null, at: o.at, next: defaultNext('partial', { trip: !!o.tripId }),
    money: o.quote && o.quote.amount > 0 ? { kind: 'kept', amount: o.quote, by: null } : { kind: 'none', amount: null, by: null },
  };
}

/** The step for an entry service: a renewal is booked with the passport office, the rest are applications. */
export const serviceStep = (service: string): OnItStep => (service === 'passport_renewal' ? 'renewing' : 'applying');

/** What an issued entry service did, as words the reader's language picks: "UK ETA issued for you and Hessa". */
export function serviceWhat(service: string | null | undefined, o: { names: string; need?: string | null }): CopyRef | null {
  if (!service) return null;
  if (service === 'uk_eta') return ['oc.what.uk_eta', { names: o.names }];
  if (service === 'evisa') return ['oc.what.evisa', { names: o.names, need: o.need || 'Visa' }];
  if (service === 'reentry') return ['oc.what.reentry', { names: o.names }];
  if (service === 'passport_renewal') return ['oc.what.passport_renewal', { names: o.names }];
  return null;
}

/** Where an open request stands when the desk hasn't said: who Mada is asking, Mada's usual time, the cost so far. */
export function progressFromStatus(r: {
  status: string; withWhom?: 'airline' | 'hotel' | 'faisal' | null; withName?: string | null; kind?: string | null; area?: string | null;
  quote?: { amount: number; currency: 'SAR' } | null; createdAt: string; promisedBy?: string | null;
  /** The entry service asked for (a passport renewal, a UK ETA): its own step, never "Checking the visa rules". */
  service?: string | null;
}): RequestProgress | null {
  if (!['queued', 'sent', 'reviewing', 'with_agent'].includes(r.status)) return null;
  const supplier = r.withWhom === 'airline' || r.withWhom === 'hotel';
  const refund = r.area === 'refund' || r.kind === 'refund';
  const step: OnItStep = refund ? 'refunding' : r.service ? serviceStep(r.service) : r.withWhom === 'airline' ? 'asking_airline' : r.withWhom === 'hotel' ? 'asking_hotel'
    : r.kind === 'visa' ? 'asking_embassy' : r.status === 'sent' || r.status === 'queued' ? 'reading' : r.kind === 'flight' || r.kind === 'stay' || r.kind === 'package' ? 'searching' : 'pricing';
  const minutes = refund ? ON_IT_MINUTES.refund : supplier ? ON_IT_MINUTES.supplier : ON_IT_MINUTES.request;
  const dueAt = r.promisedBy ?? new Date(Date.parse(r.createdAt) + minutes * 60_000).toISOString();
  const cost = r.quote ? { kind: 'quoted' as const, amount: r.quote } : refund ? { kind: 'free' as const, amount: null } : { kind: 'later' as const, amount: null };
  return { step, with: r.withName ?? null, dueAt, promised: false, cost, nudgedAt: null };
}

/* ───────── words (copy keys; the reader's language picks them) ───────── */

export type CopyRef = [CopyKey, Vars?];
const WITH_REASONS: OutcomeReason[] = ['sold_out', 'rules', 'no_reply', 'visa_refused'];

/** The headline: "It's done." · "Not this time." · "Some of it is done." */
export const outcomeHead = (r: Pick<RequestResult, 'kind' | 'what'>, title?: string | null): CopyRef => {
  const what = r.what?.trim().replace(/[.。]+$/, '');
  if (what && (r.kind === 'issued' || r.kind === 'partial')) return ['oc.head.what', { what }];
  // An older issued result with no line: at least name the thing that was done, never a bare "It's done."
  if (r.kind === 'issued' && title) return ['oc.head.issuedTitle', { title }];
  return [`oc.head.${r.kind}` as CopyKey];
};

/** The reason in plain words, naming who said no when we know. */
export const outcomeWhy = (r: Pick<RequestResult, 'reason' | 'with'>): CopyRef =>
  r.with && WITH_REASONS.includes(r.reason) ? [`oc.why.${r.reason}.with` as CopyKey, { with: r.with }] : [`oc.why.${r.reason}` as CopyKey];

/** The money line. Formatted amounts and days come in `fmt`, so each app formats in its own way. */
export function outcomeMoney(m: OutcomeMoney, fmt: { amount: (halalas: number) => string; day: (iso: string) => string }): CopyRef {
  const amount = m.amount ? fmt.amount(m.amount.amount) : '';
  if (m.kind === 'refund') return m.by ? ['oc.money.refund', { amount, day: fmt.day(m.by) }] : ['oc.money.refundSoon', { amount }];
  if (m.kind === 'credit') return ['oc.money.credit', { amount }];
  if (m.kind === 'kept') return ['oc.money.kept', { amount }];
  if (m.kind === 'charged') return amount ? ['oc.money.charged', { amount }] : ['oc.money.chargedNone'];
  return ['oc.money.none'];
}

/** "Asking Saudia" · "Pricing it for you". */
export const onItStep = (p: Pick<RequestProgress, 'step' | 'with'>): CopyRef =>
  (p.step === 'asking_airline' || p.step === 'asking_hotel') && p.with ? ['oi.step.asking', { with: p.with }] : [`oi.step.${p.step}` as CopyKey];

/** The cost line while it's open. */
export function onItCost(p: Pick<RequestProgress, 'cost'>, fmt: { amount: (halalas: number) => string }): CopyRef {
  const amount = p.cost.amount ? fmt.amount(p.cost.amount.amount) : '';
  if (p.cost.kind === 'quoted' && amount) return ['oi.cost.quoted', { amount }];
  if (p.cost.kind === 'paid' && amount) return ['oi.cost.paid', { amount }];
  if (p.cost.kind === 'free') return ['oi.cost.free'];
  return ['oi.cost.later'];
}

/** The notification an outcome sends: notify.oc.<kind>.title / .body, with the reason as a nested key (read-time language). */
export const outcomeNotifyKey = (kind: OutcomeKind) => `notify.oc.${kind === 'withdrawn' ? 'cancelled' : kind}` as const;

/** "14:30" today, "Thu 22 Oct, 14:30" another day (Riyadh time): the by-when on an open request. */
export function dueLabel(iso: string, opts: { locale?: Lang; now?: Date } = {}): string {
  const time = timeLabel(iso, { locale: opts.locale });
  const day = zonedParts(iso).date;
  const today = todayIn(undefined, opts.now);
  return day === today ? time : `${dayLabel(day, { today, locale: opts.locale })}, ${time}`;
}
