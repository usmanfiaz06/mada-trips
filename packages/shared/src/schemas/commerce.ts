import { z } from 'zod';
import { AgentRef, HalalasAmount, Id, IsoDateTime, Money } from './common';

/**
 * Requests are the one pipe for everything a person at Mada completes: bookings, changes, cancellations,
 * refunds, visas, Umrah and anything else (SCOPE.md §6). Each carries a promised response time.
 */
export const RequestKind = z.enum(['flight', 'stay', 'trip', 'visa', 'umrah', 'car', 'restaurant', 'activity', 'change', 'cancel', 'refund', 'general']);
export type RequestKind = z.infer<typeof RequestKind>;

/** queued = saved offline, sends when the connection is back (FLOWS.md §4). */
export const RequestStatus = z.enum(['queued', 'sent', 'reviewing', 'needs_answer', 'quoted', 'awaiting_payment', 'with_agent', 'confirmed', 'done', 'cancelled']);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const TripRequest = z.object({
  id: Id,
  kind: RequestKind,
  status: RequestStatus,
  /** One line the traveller recognises: "Schengen visa for Sara". */
  summary: z.string(),
  travellerIds: z.array(Id),
  tripId: Id.nullable(),
  agent: AgentRef.nullable(),
  /** When the desk promised an answer by. */
  promisedBy: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TripRequest = z.infer<typeof TripRequest>;

export const QuoteLine = z.object({ label: z.string(), amount: HalalasAmount, kind: z.enum(['flight', 'stay', 'pickup', 'visa', 'service', 'discount', 'credit', 'other']) });

/** Prices on a quote come from supplier responses, never from the model (SCOPE.md §6). */
export const Quote = z.object({
  id: Id,
  requestId: Id,
  lines: z.array(QuoteLine),
  total: Money,
  /** "Free to cancel until 3 Mar. After that, SAR 400." */
  cancellation: z.string().nullable(),
  /** The price hold. When it ends, the price must be re-checked. */
  expiresAt: IsoDateTime.nullable(),
  status: z.enum(['open', 'accepted', 'expired', 'withdrawn']),
  createdAt: IsoDateTime,
});
export type Quote = z.infer<typeof Quote>;

export const PaymentMethod = z.enum(['card', 'mada', 'applepay', 'googlepay', 'stcpay', 'tabby', 'tamara', 'credit']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** Authorised on request, captured when the ticket is issued, voided if issuing fails (PRODUCTION.md §2). */
export const PaymentStatus = z.enum(['initiated', 'requires_action', 'authorized', 'captured', 'voided', 'declined', 'failed', 'refunded', 'partially_refunded']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const Payment = z.object({
  id: Id,
  quoteId: Id.nullable(),
  method: PaymentMethod,
  status: PaymentStatus,
  amount: Money,
  /** "Visa ending 41" */
  label: z.string().nullable(),
  /** Instalments for Tabby (4) and Tamara (3). */
  instalments: z.number().int().min(1).max(12),
  provider: z.enum(['myfatoorah', 'tabby', 'tamara', 'mada_credit', 'mock']),
  createdAt: IsoDateTime,
});
export type Payment = z.infer<typeof Payment>;

/** Requested → Approved → Sent to card (FLOWS.md §5). */
export const RefundStage = z.enum(['requested', 'approved', 'sent', 'rejected']);
export const Refund = z.object({
  id: Id,
  paymentId: Id,
  amount: Money,
  stage: RefundStage,
  /** Where the money goes: back to the card, or Mada credit (instant). */
  destination: z.enum(['original', 'credit']),
  reason: z.string().nullable(),
  /** "Usually there by 14 Mar." */
  expectedBy: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Refund = z.infer<typeof Refund>;

/** Simplified tax invoice (ZATCA phase 2 reporting is still to come, INTEGRATIONS.md 0.8). */
export const Invoice = z.object({
  id: Id,
  number: z.string(),
  tripId: Id.nullable(),
  paymentId: Id.nullable(),
  total: Money,
  vat: Money,
  issuedAt: IsoDateTime,
  zatcaStatus: z.enum(['not_required', 'pending', 'reported', 'rejected']),
  pdfUrl: z.string().nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

/** Mada credit: refunds can land here instantly instead of waiting for the bank. A ledger, never a mutable balance. */
export const CreditEntry = z.object({
  id: Id,
  amount: HalalasAmount,
  kind: z.enum(['refund', 'goodwill', 'spend', 'expiry', 'adjustment']),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
});
export const Credit = z.object({ balance: Money, entries: z.array(CreditEntry) });
export type Credit = z.infer<typeof Credit>;
