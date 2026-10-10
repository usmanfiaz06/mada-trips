import { z } from 'zod';
import {
  AgentRef, AirportCode, BookingRef, CarrierCode, FlightNumber, HalalasAmount, Id, IsoDateTime, IsoDay, LocalDateTime, Money, TimeZone,
} from './common';
import { Invoice, PaymentMethod, RefundStage } from './commerce';

export const Cabin = z.enum(['economy', 'premium', 'business', 'first']);
export type Cabin = z.infer<typeof Cabin>;

/** Live status of a flight, always with where it came from (SCOPE.md §7: every status says its source). */
export const FlightStatus = z.enum(['scheduled', 'on_time', 'delayed', 'boarding', 'departed', 'in_air', 'landed', 'cancelled', 'diverted']);
export type FlightStatus = z.infer<typeof FlightStatus>;

export const FlightSegment = z.object({
  id: Id,
  carrier: CarrierCode,
  carrierName: z.string(),
  flightNumber: FlightNumber,
  from: AirportCode,
  to: AirportCode,
  /** Local wall-clock times at each airport, with the airport's zone. "Lands 16:40 Istanbul time". */
  departLocal: LocalDateTime,
  departTz: TimeZone,
  arriveLocal: LocalDateTime,
  arriveTz: TimeZone,
  durationMin: z.number().int().positive(),
  cabin: Cabin,
  terminal: z.string().nullable(),
  gate: z.string().nullable(),
  seats: z.array(z.string()),
  baggage: z.string().nullable(),
  status: FlightStatus,
  statusSource: z.string().nullable(),
  /** Airline booking reference for this segment. */
  pnr: BookingRef.nullable(),
  direction: z.enum(['out', 'back', 'connection']),
});
export type FlightSegment = z.infer<typeof FlightSegment>;

export const Stay = z.object({
  id: Id,
  name: z.string(),
  area: z.string().nullable(),
  address: z.string().nullable(),
  checkIn: IsoDay,
  nights: z.number().int().positive(),
  rooms: z.number().int().positive(),
  price: Money,
  cancellation: z.string().nullable(),
  status: z.enum(['held', 'booked', 'cancelled']),
  confirmation: z.string().nullable(),
});
export type Stay = z.infer<typeof Stay>;

export const Pickup = z.object({
  id: Id,
  direction: z.enum(['to_airport', 'from_airport']),
  at: IsoDateTime,
  driverName: z.string().nullable(),
  car: z.string().nullable(),
  plate: z.string().nullable(),
  meetingPoint: z.string().nullable(),
  phone: z.string().nullable(),
  price: Money,
  status: z.enum(['held', 'booked', 'cancelled', 'completed']),
});
export type Pickup = z.infer<typeof Pickup>;

export const TripStatus = z.enum(['planning', 'booked', 'in_progress', 'completed', 'cancelled']);

export const Trip = z.object({
  id: Id,
  city: z.string(),
  country: z.string().nullable(),
  imageUrl: z.string().nullable(),
  startDate: IsoDay,
  endDate: IsoDay.nullable(),
  travellerIds: z.array(Id),
  segments: z.array(FlightSegment),
  stays: z.array(Stay),
  pickups: z.array(Pickup),
  status: TripStatus,
  bookingRef: BookingRef.nullable(),
  confirmedBy: AgentRef.nullable(),
  /** Booked somewhere else and imported, so Mada only tracks it. */
  imported: z.boolean(),
  createdAt: IsoDateTime,
});
export type Trip = z.infer<typeof Trip>;

/** A flight on the radar, booked with Mada or not ("Just track a flight"). */
export const TrackedFlight = z.object({
  id: Id,
  flightNumber: FlightNumber,
  carrierName: z.string().nullable(),
  date: IsoDay,
  from: AirportCode.nullable(),
  to: AirportCode.nullable(),
  departLocal: LocalDateTime.nullable(),
  arriveLocal: LocalDateTime.nullable(),
  status: FlightStatus,
  gate: z.string().nullable(),
  terminal: z.string().nullable(),
  /** "Live · airline", "FlightAware". */
  source: z.string().nullable(),
  updatedAt: IsoDateTime,
});
export type TrackedFlight = z.infer<typeof TrackedFlight>;

/* ═══════════════════════════ the trip companion (M3) ═══════════════════════════
 * Everything below is what the app reads while a trip is booked, under way and just over. GET /trips/{id} is the one
 * source of truth for seats, terminal, gate, drivers, pickup times and the hotel address: every screen reads it.
 */

/** Where the traveller is in the trip. Derived on the server from the dates (the "trip clock"). */
export const TripPhase = z.enum(['none', 'booked', 'daybefore', 'travelday', 'delayed', 'cancelled', 'inair', 'landed', 'home']);
export type TripPhase = z.infer<typeof TripPhase>;

/** The trip clock: what moment the app is living in. `now` is the clock's instant (virtual in a demo). */
export const TripClock = z.object({
  phase: TripPhase,
  now: IsoDateTime,
  /** The day the app shows in the header: on travel day it's the travel day, not the phone's calendar. */
  today: IsoDay,
  /** True when a demo override set the phase (mock mode only). */
  demo: z.boolean(),
});
export type TripClock = z.infer<typeof TripClock>;

/** A traveller on the trip, as the trip screens need them. Never a passport number. */
export const TripTraveller = z.object({
  id: Id,
  firstName: z.string(),
  fullName: z.string(),
  initial: z.string(),
  relation: z.string(),
  isSelf: z.boolean(),
  birthYear: z.number().int().nullable(),
  passportExpiry: IsoDay.nullable(),
});
export type TripTraveller = z.infer<typeof TripTraveller>;

export const SegmentDetail = FlightSegment.extend({
  /** The gate at booking or the last one shown, so a change can be said out loud. */
  bookedGate: z.string().nullable(),
  /** Minutes late, from the airline or predicted from the inbound aircraft. */
  delayMin: z.number().int().nullable(),
  /** The delay is ours (inbound aircraft late), not yet announced by the airline. */
  predictedDelay: z.boolean(),
  statusAt: IsoDateTime.nullable(),
  /** Airline colour for the mark when there is no logo. */
  brand: z.string().nullable(),
});
export type SegmentDetail = z.infer<typeof SegmentDetail>;

export const StayDetail = Stay.extend({
  phone: z.string().nullable(),
  addressShort: z.string().nullable(),
  walk: z.string().nullable(),
  /** Drive from the arrival airport, "45 min". */
  fromAirport: z.string().nullable(),
  roomType: z.string().nullable(),
  /** How the stay was paid: in full, or in instalments. */
  plan: z.enum(['full', 'tabby', 'tamara']),
});
export type StayDetail = z.infer<typeof StayDetail>;

export const PickupDetail = Pickup.extend({
  /** "room for 4 bags" */
  room: z.string().nullable(),
  /** How long the driver waits at no cost, "10 min" or "60 min". */
  waits: z.string().nullable(),
  /** For the ride to the airport: minutes before take-off the driver comes (negative). */
  offsetMin: z.number().int().nullable(),
  /** "Riyadh", "Istanbul". */
  city: z.string().nullable(),
});
export type PickupDetail = z.infer<typeof PickupDetail>;

/** What the fare allows, read from the airline's rules for the outbound flight. Amounts per person. */
export const FareRules = z.object({
  changeFee: HalalasAmount,
  refundable: z.boolean(),
  refundFee: HalalasAmount.nullable(),
  bagFee: HalalasAmount,
  bagKg: z.number().int(),
  bags: z.string(),
  /** Airport and government taxes per person on a return ticket: refundable even when the fare isn't. */
  taxPerPerson: HalalasAmount,
});
export type FareRules = z.infer<typeof FareRules>;

export const NoStay = z.object({ label: z.string().trim().min(2).max(60), address: z.string().trim().min(6).max(200) });
export type NoStay = z.infer<typeof NoStay>;

/** A company for a full tax invoice. Saudi VAT numbers have 15 digits, start and end with 3; CR numbers have 10. */
export const Company = z.object({
  name: z.string().trim().min(2).max(120),
  vat: z.string().regex(/^3\d{13}3$/, 'A Saudi VAT number has 15 digits and starts and ends with 3'),
  cr: z.string().regex(/^\d{10}$/, 'A CR number has 10 digits'),
  address: z.string().trim().min(10).max(200),
});
export type Company = z.infer<typeof Company>;

export const Voucher = z.object({ id: z.string(), kind: z.enum(['hotel', 'meal']), title: z.string(), body: z.string(), code: z.string() });
export type Voucher = z.infer<typeof Voucher>;

export const TripRating = z.object({
  hotel: z.enum(['yes', 'no']).nullable(),
  driver: z.enum(['great', 'fine', 'poor']).nullable(),
  agent: z.enum(['great', 'fine', 'poor']).nullable(),
  note: z.string().max(600).nullable(),
  sentAt: IsoDateTime.nullable(),
});
export type TripRating = z.infer<typeof TripRating>;

/** Weather on landing, only when a forecast supplier gave one. */
export const TripWeather = z.object({ tempC: z.number().int(), summary: z.string(), tip: z.string(), rain: z.boolean() });

/** Something about the flight that needs the traveller: a predicted delay or a cancellation, with the plan. */
export const DisruptionKind = z.enum(['delay', 'cancel', 'night']);
export type DisruptionKind = z.infer<typeof DisruptionKind>;

export const TripDisruption = z.object({
  kind: DisruptionKind,
  segmentId: Id,
  /** "The plane coming from Cairo is late." */
  cause: z.string().nullable(),
  /** "Predicted from the inbound plane at 08:02", "Saudia confirmed the cancellation at 06:12". */
  source: z.string(),
  /** Set once the traveller chose; the trip already reflects it. */
  decided: z.string().nullable(),
});
export type TripDisruption = z.infer<typeof TripDisruption>;

export const TripPrices = z.object({ flights: Money, stays: Money, pickups: Money, discount: Money, total: Money });

export const TripDetail = Trip.extend({
  segments: z.array(SegmentDetail),
  stays: z.array(StayDetail),
  pickups: z.array(PickupDetail),
  clock: TripClock,
  travellers: z.array(TripTraveller),
  fare: FareRules.nullable(),
  prices: TripPrices,
  noStay: NoStay.nullable(),
  /** Moved to another flight after a disruption. */
  rebooked: z.boolean(),
  vouchers: z.array(Voucher),
  bagReport: z.string().nullable(),
  rating: TripRating.nullable(),
  company: Company.nullable(),
  weather: TripWeather.nullable(),
  disruption: TripDisruption.nullable(),
  openRequests: z.number().int(),
  /** The named agent looking after the trip, for "Talk to Faisal". */
  agentName: z.string(),
  bookedAt: IsoDateTime,
});
export type TripDetail = z.infer<typeof TripDetail>;

/** A trip on the Trips list. */
export const TripCard = z.object({
  id: Id,
  city: z.string(),
  country: z.string().nullable(),
  imageUrl: z.string().nullable(),
  startDate: IsoDay,
  endDate: IsoDay.nullable(),
  status: TripStatus,
  phase: TripPhase,
  travellerNames: z.array(z.string()),
  justYou: z.boolean(),
  flight: z.object({ code: z.string(), date: IsoDay, depart: z.string(), oneWay: z.boolean() }).nullable(),
  stayName: z.string().nullable(),
  /** "Eid with the four of you" */
  note: z.string().nullable(),
  /** "Last Eid" */
  when: z.string().nullable(),
  travellerCount: z.number().int(),
});
export type TripCard = z.infer<typeof TripCard>;

/* ───────── requests to Faisal from the trip: special requests, hotel options, changes ───────── */

export const RequestArea = z.enum(['special', 'hotel', 'change', 'refund', 'trip', 'other']);
/** Who Faisal is asking. */
export const RequestWith = z.enum(['airline', 'hotel', 'faisal']);

export const TripRequestView = z.object({
  id: Id,
  tripId: Id.nullable(),
  kind: z.string(),
  area: RequestArea,
  status: z.enum(['queued', 'sent', 'reviewing', 'needs_answer', 'quoted', 'awaiting_payment', 'with_agent', 'confirmed', 'done', 'cancelled']),
  title: z.string(),
  short: z.string().nullable(),
  detail: z.string().nullable(),
  withWhom: RequestWith,
  withName: z.string().nullable(),
  /** 'no': they can't do it, with `alt` saying what Faisal offers instead. */
  outcome: z.enum(['yes', 'no']).nullable(),
  alt: z.string().nullable(),
  yesText: z.string().nullable(),
  quote: Money.nullable(),
  /** What Faisal said with the price. */
  quoteText: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TripRequestView = z.infer<typeof TripRequestView>;

export const SpecialKind = z.enum(['wheelchair', 'meal', 'bassinet', 'seats', 'celebration', 'prayer', 'bags', 'sports', 'pet']);
export const HotelKind = z.enum(['room', 'nights', 'times', 'bed', 'connecting']);
export const OtherAskKind = z.enum(['esim', 'call', 'wider', 'reissue']);

/** One body for every ask from the trip. The server decides the words and any price. */
export const CreateTripAskRequest = z.object({
  area: z.enum(['special', 'hotel', 'other']),
  kind: z.union([SpecialKind, HotelKind, OtherAskKind]),
  option: z.string().max(40).optional(),
  /** Who it's for; empty means everyone on the trip. */
  travellerIds: z.array(Id).max(12).optional(),
  count: z.number().int().min(1).max(20).optional(),
  day: IsoDay.optional(),
  note: z.string().trim().max(200).optional(),
  /** Set by the phone so a request queued offline is sent once, however often it retries. */
  clientKey: z.string().min(8).max(64),
});
export type CreateTripAskRequest = z.infer<typeof CreateTripAskRequest>;

/** Small edits the traveller makes themselves; nothing here costs money. */
export const PatchTripRequest = z.object({
  noStay: NoStay.nullable().optional(),
  /** The driver comes this many minutes before take-off. */
  pickupOffsetMin: z.union([z.literal(-175), z.literal(-155), z.literal(-140), z.literal(-125)]).optional(),
  /** The reference from the airline's baggage desk, "ISTSV12345". */
  bagReport: z.string().regex(/^[A-Z]{5}\d{5}$/, "It's 5 letters then 5 numbers, like ISTSV12345.").optional(),
  rating: TripRating.omit({ sentAt: true }).extend({ send: z.boolean().optional() }).optional(),
  /** First-evening picks chosen in the air; Faisal books them on landing. */
  picks: z.array(z.string().max(20)).max(8).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type PatchTripRequest = z.infer<typeof PatchTripRequest>;

/* ───────── changing a flight ───────── */

export const ChangeKind = z.enum(['date', 'time', 'return', 'one', 'airline', 'name']);
export type ChangeKind = z.infer<typeof ChangeKind>;

export const ChangeOption = z.object({
  id: z.string(),
  title: z.string(),
  sub: z.string(),
  /** Per person, before the change fee. */
  diffPerPerson: HalalasAmount,
  soldOut: z.boolean(),
  /** "You fly on Wed 10 Mar" */
  say: z.string(),
  /** Moves the out date: the hotel and pickup may need to follow. */
  movesOutDate: z.boolean(),
  longer: z.boolean(),
});
export type ChangeOption = z.infer<typeof ChangeOption>;

export const ChangeOptionsResponse = z.object({ kind: ChangeKind, fare: FareRules, options: z.array(ChangeOption), within24: z.boolean() });

export const ChangeFlightRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['date', 'time', 'return']), optionId: z.string().max(20), clientKey: z.string().min(8).max(64) }),
  z.object({ kind: z.literal('one'), optionId: z.string().max(20), travellerId: Id, clientKey: z.string().min(8).max(64) }),
  z.object({ kind: z.literal('name'), travellerId: Id, givenNames: z.string().trim().min(1).max(60), surname: z.string().trim().min(1).max(60), clientKey: z.string().min(8).max(64) }),
  z.object({ kind: z.literal('airline'), offerKey: z.string().max(20), clientKey: z.string().min(8).max(64) }),
]);
export type ChangeFlightRequest = z.infer<typeof ChangeFlightRequest>;

export const ChangeFlightResponse = z.object({
  /** done: changed now. quoted: a price to pay first. sent: with Faisal. */
  result: z.enum(['done', 'quoted', 'sent']),
  say: z.string(),
  total: HalalasAmount,
  request: TripRequestView,
  trip: TripDetail,
});

/** After a date change, the hotel and the home pickup stay on the old day until the traveller says. */
export const MoveNeeded = z.object({
  from: IsoDay,
  to: IsoDay,
  hotel: z.object({ stayId: Id, name: z.string(), fromDay: IsoDay, newNights: z.number().int(), diff: HalalasAmount, back: HalalasAmount }).nullable(),
  pickup: z.object({ pickupId: Id, driver: z.string(), fromDay: IsoDay, time: z.string() }).nullable(),
});
export type MoveNeeded = z.infer<typeof MoveNeeded>;
export const MoveRequest = z.object({ hotel: z.boolean(), pickup: z.boolean() }).refine((v) => v.hotel || v.pickup, { message: 'Pick what to move' });

/* ───────── money: payments, invoices, refunds ───────── */

export const Instalment = z.object({ seq: z.number().int(), dueOn: IsoDay, amount: Money, paid: z.boolean() });
export const TripPaymentItem = z.enum(['flight', 'stay', 'pickup', 'change', 'extra']);
export type TripPaymentItem = z.infer<typeof TripPaymentItem>;

export const TripPayment = z.object({
  id: Id,
  item: TripPaymentItem,
  title: z.string(),
  sub: z.string(),
  amount: Money,
  method: PaymentMethod,
  /** "Visa ending 41", "Apple Pay". */
  label: z.string().nullable(),
  paidAt: IsoDateTime,
  invoiceId: Id.nullable(),
  invoiceNumber: z.string().nullable(),
  creditNoteId: Id.nullable(),
  plan: z.array(Instalment).nullable(),
  /** How much of this payment has been credited back. */
  refunded: Money.nullable(),
  creditUsed: Money,
});
export type TripPayment = z.infer<typeof TripPayment>;

export const PaymentsResponse = z.object({ payments: z.array(TripPayment), total: Money, refunded: Money, credit: Money });

export const InvoiceKind = z.enum(['simplified', 'tax', 'credit_note']);
export const InvoiceLine = z.object({
  text: z.string(),
  note: z.string().nullable(),
  /** VAT-inclusive amount; negative for discounts. */
  gross: HalalasAmount,
  vatRateBps: z.number().int(),
  net: HalalasAmount,
  vat: HalalasAmount,
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const InvoiceDoc = Invoice.extend({
  kind: InvoiceKind,
  status: z.enum(['draft', 'issued']),
  seller: z.object({ name: z.string(), legal: z.string(), vat: z.string(), cr: z.string(), address: z.string() }),
  /** The traveller who paid; the company when it's a full tax invoice. */
  customer: z.string(),
  company: Company.nullable(),
  lines: z.array(InvoiceLine),
  net: Money,
  /** The invoice a credit note cancels, or the simplified invoice a tax invoice replaces. */
  againstNumber: z.string().nullable(),
  paidWith: z.string().nullable(),
  /** ZATCA QR payload: base64 of TLV (seller, VAT number, time, total, VAT). */
  qr: z.string(),
  /** The related documents for this payment. */
  related: z.array(z.object({ id: Id, number: z.string(), kind: InvoiceKind, status: z.enum(['draft', 'issued']) })),
});
export type InvoiceDoc = z.infer<typeof InvoiceDoc>;
export const InvoiceResponse = z.object({ invoice: InvoiceDoc, html: z.string() });

export const RefundReason = z.enum(['plans', 'ill', 'docs', 'airline', 'else', 'other']);
export type RefundReason = z.infer<typeof RefundReason>;

/** What comes back for one payment if it's cancelled now, and the rule that says so. */
export const RefundQuoteItem = z.object({
  paymentId: Id,
  item: TripPaymentItem,
  title: z.string(),
  paid: Money,
  /** What the rule gives back. */
  back: Money,
  /** What actually returns as money now (with instalments: what was paid so far, less the fee). */
  cash: Money,
  /** Instalments that will not be taken. */
  cancelled: z.object({ count: z.number().int(), amount: Money }).nullable(),
  /** The fee the instalment provider still takes. */
  owe: Money.nullable(),
  rule: z.string(),
  why: z.string(),
  /** Nothing comes back by the rules, but Faisal can ask. */
  askAnyway: z.boolean(),
  /** GACA rules apply (airline cancelled). */
  law: z.boolean(),
  method: PaymentMethod,
  alreadyRefunded: z.boolean(),
});
export type RefundQuoteItem = z.infer<typeof RefundQuoteItem>;

export const RefundQuoteResponse = z.object({
  items: z.array(RefundQuoteItem),
  airlineCancelled: z.boolean(),
  partlyUsed: z.boolean(),
  allUsed: z.boolean(),
  card: z.string(),
});

export const CreateRefundRequest = z.object({
  paymentIds: z.array(Id).min(1).max(10),
  reason: RefundReason,
  destination: z.enum(['original', 'credit']),
  clientKey: z.string().min(8).max(64),
});
export type CreateRefundRequest = z.infer<typeof CreateRefundRequest>;

export const RefundView = z.object({
  id: Id,
  tripId: Id.nullable(),
  title: z.string(),
  amount: Money,
  stage: RefundStage,
  /** card: back to the card. credit: Mada credit, instant. instalments: back through Tabby or Tamara. */
  destination: z.enum(['original', 'credit', 'instalments']),
  provider: z.string().nullable(),
  card: z.string(),
  /** Faisal asked although the rules give nothing back. */
  anyway: z.boolean(),
  reject: z.string().nullable(),
  alt: z.string().nullable(),
  law: z.boolean(),
  airline: z.string().nullable(),
  cancelledInstalments: z.object({ count: z.number().int(), amount: Money }).nullable(),
  expectedBy: IsoDateTime.nullable(),
  sentAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RefundView = z.infer<typeof RefundView>;
export const RefundResponse = z.object({ refund: RefundView });

export const CompanyInvoiceRequest = z.object({ company: Company });

/* ───────── disruption ───────── */

export const DisruptionOption = z.object({
  id: z.string(),
  title: z.string(),
  /** "Leaves 13:30 · lands 17:45 at Istanbul" */
  times: z.string(),
  note: z.string(),
  carrier: CarrierCode.nullable(),
  carrierName: z.string().nullable(),
  /** The time on the button, "13:30"; null for a refund or staying put. */
  departs: z.string().nullable(),
  kind: z.enum(['rebook', 'stay', 'refund']),
});
export type DisruptionOption = z.infer<typeof DisruptionOption>;

export const DisruptionResponse = z.object({
  kind: DisruptionKind,
  headline: z.string(),
  sub: z.string(),
  options: z.array(DisruptionOption),
  /** Night cancellations: what's already sorted for tonight. */
  tonight: z.array(z.object({ icon: z.string(), title: z.string(), body: z.string() })),
  /** Who is on it: Faisal by day, the night desk after hours. */
  agent: z.object({ name: z.string(), initial: z.string(), line: z.string() }),
  source: z.string(),
  refundAmount: Money,
  /** Seats stay held until this time. */
  heldUntil: z.string(),
});
export type DisruptionResponse = z.infer<typeof DisruptionResponse>;

export const DisruptionChoiceRequest = z.object({ kind: DisruptionKind, optionId: z.string().max(20), clientKey: z.string().min(8).max(64) });
export const DisruptionChoiceResponse = z.object({
  optionId: z.string(),
  kind: z.enum(['rebook', 'stay', 'refund']),
  headline: z.string(),
  body: z.string(),
  agentLine: z.string(),
  trip: TripDetail.nullable(),
  refund: RefundView.nullable(),
});

/* ───────── itinerary ───────── */

export const ItineraryItem = z.object({
  id: z.string(),
  time: z.string().nullable(),
  icon: z.string(),
  kind: z.enum(['flight', 'pickup', 'hotel', 'booked', 'pick', 'idea', 'note', 'nostay', 'own']),
  title: z.string(),
  sub: z.string().nullable(),
  facts: z.array(z.tuple([z.string(), z.string()])),
  tags: z.array(z.string()),
  status: z.enum(['done', 'cancelled', 'pending', 'booked']).nullable(),
  pendingText: z.string().nullable(),
  warn: z.string().nullable(),
  driver: z.string().nullable(),
  phone: z.string().nullable(),
  car: z.string().nullable(),
  leg: z.enum(['out', 'back']).nullable(),
  /** An idea Mada can book: the words for Ask. */
  ask: z.string().nullable(),
  requestId: Id.nullable(),
});
export type ItineraryItem = z.infer<typeof ItineraryItem>;

export const ItineraryDay = z.object({ date: IsoDay, title: z.string(), free: z.boolean(), prayer: z.string().nullable(), docs: z.array(z.string()), items: z.array(ItineraryItem) });
export type ItineraryDay = z.infer<typeof ItineraryDay>;

/** A moment worth a calendar entry. Times are instants. */
export const CalendarEvent = z.object({ uid: z.string(), title: z.string(), description: z.string(), location: z.string(), start: IsoDateTime, end: IsoDateTime, day: IsoDay, time: z.string(), key: z.boolean() });
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const ItineraryResponse = z.object({
  tripId: Id,
  title: z.string(),
  datesLong: z.string(),
  days: z.array(ItineraryDay),
  events: z.array(CalendarEvent),
  /** The plan as plain text to share: no passport numbers, no prices, no booking code. */
  shareText: z.string(),
  move: MoveNeeded.nullable(),
  sameTimeAsHome: z.boolean(),
});
export type ItineraryResponse = z.infer<typeof ItineraryResponse>;

/* ───────── lists ───────── */

export const TrackFlightRequest = z.object({
  flightNumber: FlightNumber,
  date: IsoDay,
  alerts: z.boolean(),
});
export type TrackFlightRequest = z.infer<typeof TrackFlightRequest>;
export const ImportTrackedRequest = z.object({ flights: z.array(TrackFlightRequest).max(20) });

export const TrackedFlightView = TrackedFlight.extend({
  alerts: z.boolean(),
  /** The schedule is known (the airline published the route). */
  known: z.boolean(),
  durationMin: z.number().int().nullable(),
  brand: z.string().nullable(),
});
export type TrackedFlightView = z.infer<typeof TrackedFlightView>;
export const TrackedResponse = z.object({ flights: z.array(TrackedFlightView) });

export const FlightStatusResponse = z.object({ flight: TrackedFlightView.omit({ id: true, alerts: true, updatedAt: true }).extend({ updatedAt: IsoDateTime }).nullable() });

export const TripsResponse = z.object({
  clock: TripClock,
  /** The trip Today is about, if any. */
  currentId: Id.nullable(),
  upcoming: z.array(TripCard),
  past: z.array(TripCard),
  requests: z.array(TripRequestView),
  refunds: z.array(RefundView),
  tracked: z.array(TrackedFlightView),
  unread: z.number().int(),
  credit: Money,
  stamps: z.number().int(),
});
export type TripsResponse = z.infer<typeof TripsResponse>;

export const TripResponse = z.object({ trip: TripDetail, move: MoveNeeded.nullable() });
export type TripResponse = z.infer<typeof TripResponse>;

export const TripAskResponse = z.object({ request: TripRequestView, trip: TripDetail });

/** Flight status refresh: what changed since the trip was last read. */
export const TripRefreshResponse = z.object({
  trip: TripDetail,
  changes: z.array(z.object({ kind: z.enum(['gate', 'delay', 'cancelled', 'time']), segmentId: Id, from: z.string().nullable(), to: z.string().nullable(), title: z.string(), body: z.string() })),
});

/** The routes this area serves under /api/app/v1. */
export const TRIP_ROUTES = {
  trips: '/trips',
  trip: (id: string) => `/trips/${id}`,
  itinerary: (id: string) => `/trips/${id}/itinerary`,
  refresh: (id: string) => `/trips/${id}/refresh`,
  payments: (id: string) => `/trips/${id}/payments`,
  refundQuote: (id: string) => `/trips/${id}/refunds/quote`,
  refunds: (id: string) => `/trips/${id}/refunds`,
  cancelStay: (id: string) => `/trips/${id}/stay/cancel`,
  changeOptions: (id: string, kind: string) => `/trips/${id}/changes?kind=${kind}`,
  changes: (id: string) => `/trips/${id}/changes`,
  move: (id: string) => `/trips/${id}/move`,
  asks: (id: string) => `/trips/${id}/requests`,
  disruption: (id: string, kind?: string) => `/trips/${id}/disruption${kind ? `?kind=${kind}` : ''}`,
  demo: '/trips/demo',
  refund: (id: string) => `/refunds/${id}`,
  invoice: (id: string) => `/invoices/${id}`,
  invoiceDocument: (id: string) => `/invoices/${id}/document`,
  invoiceCompany: (id: string) => `/invoices/${id}/company`,
  invoiceIssue: (id: string) => `/invoices/${id}/issue`,
  tracked: '/tracked',
  trackedOne: (id: string) => `/tracked/${id}`,
  trackedImport: '/tracked/import',
  flightStatus: (no: string, date: string) => `/flights/${encodeURIComponent(no)}/status?date=${date}`,
  flightAlerts: '/flights/alerts',
  notifications: '/notifications',
  notification: (id: string) => `/notifications/${id}`,
  devices: '/devices',
} as const;

/** The demo override header: in mock mode the trip clock can be told which moment to show. */
export const DEMO_PHASE_HEADER = 'x-mada-demo-phase';
