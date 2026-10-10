import { z } from 'zod';
import { AirportCode, HalalasAmount, Id, IsoDateTime, IsoDay, Money } from './common';
import { Cabin, FlightSegment, Pickup, Stay, Trip } from './trips';
import { NEED_KEYS } from './booking-data';
import { CardBrand } from './wallet';

/*
 * Booking (M2): Ask → search → entry check → order sheet → payment → the desk → a booked trip.
 * Every price in these payloads came from a supplier response or the desk's price table, never from the model.
 */

export * from './booking-data';
export * from './booking-logic';

/* ───────────── Ask ───────────── */

export const AskKind = z.enum(['flight', 'stay', 'plan', 'esim', 'visa', 'umrah', 'car', 'food', 'todo', 'general']);
export type AskKind = z.infer<typeof AskKind>;
export const HomeAirport = z.enum(['RUH', 'JED', 'DMM']);
export type HomeAirport = z.infer<typeof HomeAirport>;
export const TripType = z.enum(['return', 'oneway']);
export type TripType = z.infer<typeof TripType>;
export const NeedKeySchema = z.enum(NEED_KEYS);

export const AskParseRequest = z.object({
  text: z.string().trim().min(1).max(500),
  /** The trip already booked, so "a hotel" means a hotel there. */
  tripCity: z.string().max(60).nullish(),
});
export type AskParseRequest = z.input<typeof AskParseRequest>;

/** What Mada understood. Structure only: no prices, no availability (SCOPE.md §6). */
export const AskIntent = z.object({
  kind: AskKind,
  /** A DESTINATIONS key ("istanbul"), "other" for a city we don't sell live, or null. */
  destination: z.string().max(40).nullable(),
  /** The city as typed when destination is "other" ("Tbilisi" is known; "Muscat" is not). */
  destinationName: z.string().max(60).nullable(),
  from: HomeAirport.nullable(),
  depart: IsoDay.nullable(),
  return: IsoDay.nullable(),
  tripType: TripType.nullable(),
  /** "in March": only the days are asked. */
  monthOnly: z.object({ month: z.number().int().min(1).max(12), year: z.number().int(), label: z.string().nullable() }).nullable(),
  cabin: Cabin.nullable(),
  /** "First isn't sold on these routes." */
  cabinNote: z.string().nullable(),
  /** People in the household named or implied ("the family", "Sara"). */
  travellerIds: z.array(Id).nullable(),
  /** "for 4" when the household is smaller: the app asks for the others' names. */
  travellerCount: z.number().int().min(1).max(9).nullable(),
  infants: z.number().int().min(0).max(4),
  /** Needs said in the same sentence as a name ("Hessa needs a wheelchair"). */
  needs: z.record(z.string(), z.array(NeedKeySchema)),
  /** Needs mentioned without a person, for the app to offer. */
  needsMentioned: z.array(NeedKeySchema),
  /** Request form answers already given in the text. */
  answers: z.record(z.string(), z.array(z.string())),
  /** The one detail that changes the outcome and is still missing. */
  ask: z.enum(['where', 'when', 'return', 'who']).nullable(),
  /** rules = deterministic parser; model = Claude through a strict tool schema. */
  source: z.enum(['rules', 'model']),
});
export type AskIntent = z.infer<typeof AskIntent>;
export const AskParseResponse = z.object({ intent: AskIntent });
export type AskParseResponse = z.infer<typeof AskParseResponse>;

/* ───────────── search ───────────── */

export const OptionLabel = z.enum(['best', 'lowest', 'earliest', 'fastest', 'bags', 'quiet', 'water']);

/** Demo switches (FLOWS.md): honoured only when the supplier runs in mock mode. Sent as ?demo=a,b or X-Mada-Demo. */
export const DemoFlag = z.enum(['offline', 'decline', 'priceUp', 'noResults', 'supplierDown', 'agentQuestion', 'passportProblem', 'needs3ds', 'fareGone', 'ticketingFails', 'slowAgent', 'faceIdFails']);
export type DemoFlag = z.infer<typeof DemoFlag>;

export const FlightSearchRequest = z.object({
  from: HomeAirport,
  /** A DESTINATIONS key. */
  destination: z.string().min(2).max(40),
  depart: IsoDay,
  return: IsoDay.nullable(),
  travellerIds: z.array(Id).min(1).max(9),
  infants: z.number().int().min(0).max(4).default(0),
  cabin: Cabin.default('economy'),
  /** ±days the traveller allows; with no flights on the day, 1 moves the search a day later. */
  flexibleDays: z.number().int().min(0).max(3).default(0),
});
export type FlightSearchRequest = z.input<typeof FlightSearchRequest>;

export const FlightOptionLeg = z.object({
  flightNumber: z.string(),
  from: AirportCode,
  to: AirportCode,
  date: IsoDay,
  dep: z.string(),
  arr: z.string(),
  durationMin: z.number().int().positive(),
});

/** One card in Ask. The id is ours (app_offers), opaque to the app, and expires with the price hold. */
export const FlightOption = z.object({
  id: Id,
  label: OptionLabel,
  carrier: z.string(),
  airline: z.string(),
  /** Brand colour for the airline mark. */
  brand: z.string(),
  out: FlightOptionLeg,
  back: FlightOptionLeg.nullable(),
  stop: z.string().nullable(),
  reason: z.string(),
  bags: z.string(),
  changeRule: z.string(),
  refundRule: z.string(),
  refundable: z.boolean(),
  cabin: Cabin,
  adults: z.number().int(),
  infants: z.number().int(),
  pricePerPerson: Money,
  infantPrice: Money,
  total: Money,
  expiresAt: IsoDateTime,
});
export type FlightOption = z.infer<typeof FlightOption>;

export const BundleQuote = z.object({ nights: z.number().int(), stay: Money, pickup: Money, total: Money, hotelName: z.string(), rooms: z.number().int() });
export type BundleQuote = z.infer<typeof BundleQuote>;

export const FlightSearchResponse = z.object({
  outcome: z.enum(['ok', 'none', 'partial', 'by_hand']),
  destination: z.string(),
  destinationName: z.string(),
  from: HomeAirport,
  depart: IsoDay,
  return: IsoDay.nullable(),
  cabin: Cabin,
  /** How many fares were looked at ("Checked 14 flights"). */
  checked: z.number().int(),
  options: z.array(FlightOption),
  /** Carriers that didn't answer (FLOWS.md: "Saudia's system isn't answering"). */
  unavailable: z.array(z.object({ carrier: z.string(), airline: z.string() })),
  /** Rooms and pickups that can be added in one tap, priced for these dates and travellers. */
  bundle: BundleQuote.nullable(),
  cachedUntil: IsoDateTime,
});
export type FlightSearchResponse = z.infer<typeof FlightSearchResponse>;

export const StaySearchRequest = z.object({
  destination: z.string().min(2).max(40),
  checkIn: IsoDay,
  nights: z.number().int().min(1).max(60),
  travellerIds: z.array(Id).min(1).max(12),
});
export type StaySearchRequest = z.input<typeof StaySearchRequest>;

export const StayOption = z.object({
  id: Id,
  label: OptionLabel,
  name: z.string(),
  area: z.string(),
  address: z.string(),
  note: z.string(),
  rating: z.string(),
  photo: z.string(),
  focal: z.string(),
  checkIn: IsoDay,
  nights: z.number().int(),
  rooms: z.number().int(),
  /** "2 connecting rooms", "1 room for 2". */
  roomsLabel: z.string(),
  total: Money,
  cancellation: z.string(),
  freeCancelUntil: IsoDay.nullable(),
  expiresAt: IsoDateTime,
});
export type StayOption = z.infer<typeof StayOption>;

export const StaySearchResponse = z.object({
  outcome: z.enum(['ok', 'none', 'by_hand']),
  destination: z.string(),
  destinationName: z.string(),
  options: z.array(StayOption),
  cachedUntil: IsoDateTime,
});
export type StaySearchResponse = z.infer<typeof StaySearchResponse>;

/** Offers keep their price for the hold; "Check the price again" re-prices with the supplier. */
export const OfferResponse = z.object({
  kind: z.enum(['flight', 'stay']),
  flight: FlightOption.nullable(),
  stay: StayOption.nullable(),
  expired: z.boolean(),
  /** Set by a re-price: how much it moved (0 when the same). */
  changedBy: HalalasAmount.nullable(),
});
export type OfferResponse = z.infer<typeof OfferResponse>;

/* ───────────── entry checks ───────────── */

/** Answers the traveller gave: "<personId>:<country>:visa" → has|asked, "<personId>:reentry" → has|asked, "<personId>:iqama" → a day. */
export const EntryAnswers = z.record(z.string().max(120), z.string().max(20));
export type EntryAnswers = z.infer<typeof EntryAnswers>;

export const EntryCheckRequest = z.object({
  destination: z.string().min(2).max(40),
  travellerIds: z.array(Id).min(1).max(12),
  depart: IsoDay,
  return: IsoDay.nullable(),
  answers: EntryAnswers.default({}),
});
export type EntryCheckRequest = z.input<typeof EntryCheckRequest>;

export const EntryCheck = z.object({
  personId: Id.nullable(),
  name: z.string().nullable(),
  key: z.enum(['passport', 'visa', 'iqama', 'reentry', 'manual', 'eta']),
  blocking: z.boolean(),
  done: z.boolean(),
  info: z.boolean(),
  title: z.string().nullable(),
  text: z.string(),
  /** "Türkiye e-Visa": what Mada can get. */
  need: z.string().nullable(),
  /** The answer key to send back when the traveller answers. */
  answerKey: z.string().nullable(),
  /** Everyone but the account holder can be left off the booking. */
  removable: z.boolean(),
  /** What the "Mada gets it" button asks for. */
  service: z.enum(['uk_eta', 'evisa', 'reentry', 'passport_renewal']).nullable(),
});
export type EntryCheck = z.infer<typeof EntryCheck>;

export const EntryCheckResponse = z.object({
  countryName: z.string(),
  domestic: z.boolean(),
  /** "Saudi and Philippine" */
  nationalities: z.array(z.string()),
  /** "Visa-free for 90 days." when nothing else needs saying. */
  okText: z.string().nullable(),
  checks: z.array(EntryCheck),
  blocking: z.number().int(),
  checkedOn: IsoDay,
});
export type EntryCheckResponse = z.infer<typeof EntryCheckResponse>;

/* ───────────── plans ───────────── */

export const PlanStopSchema = z.object({ time: z.string(), icon: z.enum(['flight', 'stay', 'star', 'food', 'car']), title: z.string(), note: z.string() });
export const BookingPlan = z.object({
  id: z.string(), title: z.string(), sub: z.string(), photo: z.string(), city: z.string(), days: z.number().int(), stops: z.number().int(),
  /** For the household's travellers. */
  total: Money, travellers: z.number().int(),
});
export type BookingPlan = z.infer<typeof BookingPlan>;
export const PlanDetail = BookingPlan.extend({ plan: z.array(z.object({ day: z.string(), stops: z.array(PlanStopSchema) })) });
export type PlanDetail = z.infer<typeof PlanDetail>;
export const PlansResponse = z.object({ plans: z.array(BookingPlan) });
export const PlanResponse = z.object({ plan: PlanDetail });

/* ───────────── requests ───────────── */

export const BookingRequestKind = z.enum(['visa', 'umrah', 'car', 'food', 'todo', 'flight', 'stay', 'general', 'package']);
export type BookingRequestKind = z.infer<typeof BookingRequestKind>;
export const BookingRequestStatus = z.enum(['queued', 'sent', 'reviewing', 'quoted', 'paid', 'done', 'cancelled']);
export type BookingRequestStatus = z.infer<typeof BookingRequestStatus>;

export const CreateRequestBody = z.object({
  kind: BookingRequestKind.exclude(['package']),
  /** What the traveller typed. */
  query: z.string().trim().max(500).default(''),
  answers: z.record(z.string().max(20), z.array(z.string().max(80)).max(8)).default({}),
  travellerIds: z.array(Id).max(12).default([]),
  needs: z.record(z.string(), z.array(NeedKeySchema)).default({}),
  note: z.string().trim().max(1000).default(''),
  /** A flight or stay Mada searches by hand (a city we don't sell live, or an airline not answering). */
  search: z.object({
    destination: z.string().max(40).nullable(),
    destinationName: z.string().max(60).nullable(),
    from: HomeAirport.nullable(),
    depart: IsoDay.nullable(),
    return: IsoDay.nullable(),
    cabin: Cabin.nullable(),
    carrier: z.string().max(3).nullable(),
  }).nullish(),
  /** Asked from an entry check. */
  service: z.enum(['uk_eta', 'evisa', 'reentry', 'passport_renewal']).nullish(),
  /** Who the service is for, and the country, for its title. */
  serviceFor: z.object({ personId: Id.nullable(), need: z.string().max(60).nullable(), destination: z.string().max(40).nullable() }).nullish(),
  /** Set by the app when it sends a request it saved offline, so a retry never makes two. */
  clientId: z.string().min(8).max(64).optional(),
});
export type CreateRequestBody = z.input<typeof CreateRequestBody>;

export const QuoteBreakdownLine = z.object({ label: z.string(), amount: HalalasAmount });
export const RequestQuote = z.object({
  id: Id,
  total: Money,
  /** Per person, so the traveller sees where every riyal goes. */
  breakdown: z.array(z.object({ personId: Id.nullable(), name: z.string(), lines: z.array(QuoteBreakdownLine) })),
  /** The agent's words. */
  text: z.string(),
  lead: z.string().nullable(),
  needLines: z.array(z.string()),
  expiresAt: IsoDateTime.nullable(),
  status: z.enum(['open', 'accepted', 'expired', 'withdrawn']),
});
export type RequestQuote = z.infer<typeof RequestQuote>;

export const AgentInfo = z.object({ name: z.string() });

export const BookingRequestView = z.object({
  id: Id,
  kind: BookingRequestKind,
  status: BookingRequestStatus,
  title: z.string(),
  /** "Hessa, Sara · In Ramadan" */
  summary: z.string(),
  detail: z.string(),
  note: z.string().nullable(),
  travellerIds: z.array(Id),
  /** The person on duty for it, from the desk. */
  agent: AgentInfo.nullable(),
  quote: RequestQuote.nullable(),
  promisedBy: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BookingRequestView = z.infer<typeof BookingRequestView>;
export const RequestResponse = z.object({ request: BookingRequestView });
export const RequestsResponse = z.object({ requests: z.array(BookingRequestView) });

export const ThreadMessage = z.object({
  id: Id,
  from: z.enum(['me', 'agent', 'mada']),
  authorName: z.string().nullable(),
  text: z.string(),
  /** An offer the agent made in the thread ("A hotel at the King Abdulaziz Gate"). */
  offer: z.object({ label: z.string(), perPerson: Money, accepted: z.boolean() }).nullable(),
  createdAt: IsoDateTime,
});
export type ThreadMessage = z.infer<typeof ThreadMessage>;
export const MessagesResponse = z.object({ messages: z.array(ThreadMessage), agentTyping: z.boolean() });
export type MessagesResponse = z.infer<typeof MessagesResponse>;
export const PostMessageBody = z.object({ text: z.string().trim().min(1).max(2000), clientId: z.string().min(8).max(64).optional() });
export const AcceptOfferBody = z.object({ messageId: Id });

/* Cards and credit: the Wallet's /cards and /credit (schemas/wallet.ts). Orders pay with a saved card's id. */
/* ───────────── orders ───────────── */

export const OrderKind = z.enum(['trip', 'stay', 'package', 'quote', 'esim', 'share']);
export type OrderKind = z.infer<typeof OrderKind>;

export const OrderDraft = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trip'), flightOfferId: Id, bundle: z.boolean().default(false), travellerIds: z.array(Id).min(1).max(9) }),
  z.object({ kind: z.literal('stay'), stayOfferId: Id, travellerIds: z.array(Id).min(1).max(12), tripId: Id.nullish() }),
  z.object({ kind: z.literal('package'), planId: z.string().max(40), travellerIds: z.array(Id).min(1).max(12) }),
  z.object({ kind: z.literal('quote'), requestId: Id }),
  z.object({ kind: z.literal('esim'), count: z.number().int().min(1).max(12) }),
  /** Your share of a split in a circle, paid by card. The amount comes from the circle, never from the app. */
  z.object({ kind: z.literal('share'), circleId: Id, messageId: Id, shareKey: z.string().min(1).max(64) }),
]);
export type OrderDraft = z.input<typeof OrderDraft>;

export const PayPlan = z.enum(['full', 'tabby', 'tamara']);
export type PayPlan = z.infer<typeof PayPlan>;

export const PreviewBody = z.object({
  draft: OrderDraft,
  promo: z.string().trim().max(20).nullish(),
  useCredit: z.boolean().default(true),
});
export type PreviewBody = z.input<typeof PreviewBody>;

export const OrderLine = z.object({ key: z.string(), icon: z.enum(['flight', 'stay', 'car', 'star', 'doc', 'globe']), text: z.string(), amount: HalalasAmount });
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderPreview = z.object({
  kind: OrderKind,
  title: z.string(),
  /** Photo for the sheet's hero. */
  photo: z.string(),
  lines: z.array(OrderLine),
  subtotal: Money,
  promo: z.object({ code: z.string(), status: z.enum(['applied', 'ended', 'unknown']), message: z.string().nullable(), discount: Money }).nullable(),
  credit: z.object({ balance: Money, used: Money }),
  total: Money,
  /** Cancellation rule worked out from this booking's own dates. */
  rule: z.string(),
  /** Whether an agent confirms it (authorised now, captured on issue) or it's charged now. */
  agent: z.boolean(),
  /** Price hold: when it ends the price must be re-checked. */
  holdExpiresAt: IsoDateTime.nullable(),
  instalments: z.object({ tabby: Money, tamara: Money }).nullable(),
  travellerIds: z.array(Id),
  /** People on the booking without a passport yet: book now, add within 48 hours. */
  missingPassports: z.array(Id),
});
export type OrderPreview = z.infer<typeof OrderPreview>;
export const PreviewResponse = z.object({ preview: OrderPreview });

export const PaymentChoice = z.discriminatedUnion('method', [
  z.object({ method: z.literal('card'), cardId: Id }),
  /** A card added just now and not saved: the provider's one-time token. */
  z.object({ method: z.literal('new_card'), token: z.string().min(8).max(200), brand: CardBrand, last4: z.string().regex(/^\d{4}$/) }),
  z.object({ method: z.literal('applepay'), token: z.string().min(8).max(400) }),
  /** Mada credit covers it all. */
  z.object({ method: z.literal('credit') }),
]);
export type PaymentChoice = z.infer<typeof PaymentChoice>;

export const CreateOrderBody = PreviewBody.extend({
  payment: PaymentChoice,
  plan: PayPlan.default('full'),
  /** The total the traveller saw and slid to accept. If the supplier's price moved, we ask again. */
  expectedTotal: HalalasAmount,
  /** One per slide: a retried request never books twice. */
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateOrderBody = z.input<typeof CreateOrderBody>;

export const OrderStatus = z.enum([
  'requires_action', 'pending_agent', 'held', 'price_locked', 'issuing', 'needs_answer', 'fare_changed', 'ticketing_failed', 'confirmed', 'cancelled', 'declined',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderView = z.object({
  id: Id,
  kind: OrderKind,
  status: OrderStatus,
  /** 0 holding seats · 1 price locked · 2 issuing · 3 done. */
  step: z.number().int().min(0).max(3),
  title: z.string(),
  /** "Istanbul" */
  place: z.string(),
  /** "Tue 9 Mar · 09:40 from Riyadh" pieces. */
  depart: IsoDay.nullable(),
  departTime: z.string().nullable(),
  from: z.string().nullable(),
  oneway: z.boolean(),
  photo: z.string(),
  carrier: z.string().nullable(),
  airline: z.string().nullable(),
  flightNumber: z.string().nullable(),
  cabin: Cabin.nullable(),
  seats: z.array(z.string()),
  travellerIds: z.array(Id),
  lines: z.array(OrderLine),
  total: Money,
  /** The fare went up while Mada held the seats and the traveller said yes. */
  extra: Money,
  plan: PayPlan,
  paymentLabel: z.string(),
  creditUsed: Money,
  bundle: z.boolean(),
  ref: z.string().nullable(),
  /** The person on duty for this booking, from the desk. */
  agent: AgentInfo.nullable(),
  /** Set only when that person confirmed it (COPY.md §1). */
  confirmedBy: AgentInfo.nullable(),
  question: z.object({ text: z.string(), options: z.array(z.enum(['yes', 'call'])), calling: z.boolean() }).nullable(),
  fareChange: z.object({ perPerson: Money, total: Money, newTotal: Money }).nullable(),
  problem: z.string().nullable(),
  /** Over 8 seconds without finishing: "Taking longer than usual". */
  slow: z.boolean(),
  tripId: Id.nullable(),
  requestId: Id.nullable(),
  /** 3-D Secure: the bank wants a code before authorising. */
  action: z.object({ kind: z.literal('otp'), triesLeft: z.number().int(), label: z.string(), amount: Money }).nullable(),
  createdAt: IsoDateTime,
  confirmedAt: IsoDateTime.nullable(),
});
export type OrderView = z.infer<typeof OrderView>;
export const OrderResponse = z.object({ order: OrderView });
export const OrdersResponse = z.object({ orders: z.array(OrderView) });

/** POST /orders answers with an outcome: a business result, not an error. */
export const CreateOrderResponse = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('created'), order: OrderView }),
  z.object({ outcome: z.literal('requires_action'), order: OrderView }),
  z.object({ outcome: z.literal('declined'), message: z.string() }),
  z.object({ outcome: z.literal('price_changed'), previousTotal: Money, preview: OrderPreview, changedBy: Money }),
  z.object({ outcome: z.literal('hold_ended'), preview: OrderPreview }),
  z.object({ outcome: z.literal('blocked'), message: z.string() }),
  /** Charged now (requests, eSIMs): nothing for an agent to confirm. */
  z.object({ outcome: z.literal('paid'), order: OrderView }),
]);
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

export const ThreeDsBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const OrderAnswerBody = z.object({ answer: z.enum(['yes', 'call', 'accept_fare', 'stop', 'retry_by_phone', 'cancel']) });

/* ───────────── what a confirmed booking writes into Trips ───────────── */

/** The money side of a booked trip, kept with it for the receipt, the refund rules and the VAT invoice. */
export const TripBooking = z.object({
  orderId: Id,
  ref: z.string(),
  lines: z.array(OrderLine),
  paid: z.object({
    subtotal: Money, discount: Money, promo: z.string().nullable(), creditUsed: Money, charged: Money,
    /** "Visa ending 41", "Apple Pay", "Mada credit" */
    card: z.string(),
  }),
  payPlan: PayPlan,
  bookedAt: IsoDateTime,
});
export type TripBooking = z.infer<typeof TripBooking>;

/** A trip as the booking flow writes it: the M0 Trip shape plus its booking. Trips reads app_trips/app_segments/app_stays/app_pickups and app_trip_bookings. */
export const BookedTrip = Trip.extend({ booking: TripBooking.nullable() });
export type BookedTrip = z.infer<typeof BookedTrip>;
export { FlightSegment as BookedSegment, Stay as BookedStay, Pickup as BookedPickup };

/** POST /payments/webhook (MyFatoorah-style). Idempotent by eventId. */
export const PaymentWebhookBody = z.object({
  eventId: z.string().min(4).max(120),
  type: z.enum(['payment.authorized', 'payment.captured', 'payment.voided', 'payment.declined', 'payment.refunded']),
  providerRef: z.string().min(4).max(120),
  amount: HalalasAmount.optional(),
});
export type PaymentWebhookBody = z.infer<typeof PaymentWebhookBody>;
