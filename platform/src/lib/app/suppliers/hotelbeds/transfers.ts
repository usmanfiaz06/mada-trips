import { HotelbedsClient, HotelbedsError, type HotelbedsClientOptions } from "./client";
import { feeHalalas, pricingRules, sellHalalas, type PricingRules } from "./money";

/*
 * Transfers on Hotelbeds (Transfer Booking API 1.0). Confirmed on developer.hotelbeds.com (docs/app/HOTELBEDS.md):
 *
 *   availability  GET    /transfer-api/1.0/availability/{lang}/from/{fromType}/{fromCode}/to/{toType}/{toCode}/{outbound}[/{inbound}]/{adults}/{children}/{infants}
 *                 fromType/toType: IATA (airports), ATLAS (Hotelbeds hotel codes), GPS ("lat,lng"), PORT, STATION
 *   book          POST   /transfer-api/1.0/bookings   { language, holder, transfers[{ rateKey, transferDetails[] }], clientReference, welcomeMessage, remark }
 *   detail        GET    /transfer-api/1.0/bookings/{lang}/reference/{reference}   (assumed from the cancel path)
 *   cancel        DELETE /transfer-api/1.0/bookings/{lang}/reference/{reference}[?simulation=true]
 *
 * Arrival pickups only for now (airport → hotel); the return leg is the same call with the ends swapped.
 */

export type HbTransferEnd = { code: string; description?: string; type?: string };
export type HbTransferService = {
  id: number; serviceId?: string; direction: "ARRIVAL" | "DEPARTURE"; transferType: "PRIVATE" | "SHARED" | string;
  vehicle: { code: string; name: string }; category: { code: string; name: string };
  pickupInformation: { from: HbTransferEnd; to: HbTransferEnd; date: string; time: string; pickup?: { description?: string | null; latitude?: number | null; longitude?: number | null; checkPickup?: { mustCheckPickupTime?: boolean; url?: string | null; hoursBeforeConsulting?: number | null } } };
  minPaxCapacity: number; maxPaxCapacity: number;
  content?: { images?: { url: string; type?: string }[]; transferDetailInfo?: { id: string; name?: string; description?: string; type?: string; value?: string }[]; transferRemarks?: { type?: string; description: string; mandatory?: boolean }[] };
  price: { totalAmount: number; netAmount?: number | null; currencyId: string };
  rateKey: string;
  cancellationPolicies?: { amount: number; from: string; currencyId?: string }[];
};
export type HbTransferAvailability = { search?: unknown; services?: HbTransferService[] };
export type HbTransferBooking = {
  reference: string; status: string; clientReference?: string; totalAmount?: number | string; totalNetAmount?: number | string; currency?: string;
  transfers?: (Partial<HbTransferService> & { status?: string; id?: number })[];
};
export type HbTransferBookingResponse = { bookings: HbTransferBooking[] };

export type TransferEnd = { type: "IATA" | "ATLAS" | "GPS" | "PORT" | "STATION"; code: string };
export type TransferQuery = {
  from: TransferEnd;
  to: TransferEnd;
  /** Local time at the pickup, YYYY-MM-DDTHH:MM (an arrival: when the flight lands). */
  outbound: string;
  adults: number;
  children?: number;
  infants?: number;
  language?: string;
};

export function availabilityPath(q: TransferQuery): string {
  const seg = (s: string) => encodeURIComponent(s);
  const when = `${q.outbound.slice(0, 16)}:00`;
  return `/transfer-api/1.0/availability/${seg(q.language ?? "en")}/from/${q.from.type}/${seg(q.from.code)}/to/${q.to.type}/${seg(q.to.code)}/${seg(when)}/${q.adults}/${q.children ?? 0}/${q.infants ?? 0}`;
}

/** What the app shows for one service, before we give it our own offer id. */
export type TransferQuote = {
  rateKey: string; kind: "private" | "shared"; vehicle: string; category: string; maxPax: number; minutes: number | null;
  total: number; net: number; currency: string; freeCancelUntil: string | null; refundable: boolean; cancelFee: number;
  pickupNote: string | null; imageUrl: string | null; direction: "ARRIVAL" | "DEPARTURE"; date: string; time: string;
};

const title = (s: string) => s.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());

export function quoteOf(s: HbTransferService, opts: { rules?: PricingRules; now?: Date } = {}): TransferQuote {
  const rules = opts.rules ?? pricingRules();
  const net = Number(s.price.totalAmount);
  const total = sellHalalas(net, s.price.currencyId, "transfer", { rules });
  const policies = [...(s.cancellationPolicies ?? [])].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const first = policies.find((p) => Number(p.amount) > 0);
  const now = opts.now ?? new Date();
  const passed = !!first && Date.parse(first.from) <= now.getTime();
  const minutes = Number(s.content?.transferDetailInfo?.find((i) => i.id === "TRFTIME")?.value);
  const image = s.content?.images?.find((i) => i.type === "EXTRALARGE" || i.type === "LARGE")?.url ?? s.content?.images?.[0]?.url ?? null;
  return {
    rateKey: s.rateKey, kind: /PRIVATE/i.test(s.transferType) ? "private" : "shared", vehicle: title(s.vehicle?.name ?? ""), category: title(s.category?.name ?? ""),
    maxPax: s.maxPaxCapacity, minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null, total, net, currency: s.price.currencyId,
    freeCancelUntil: first && !passed ? first.from.slice(0, 10) : null, refundable: !passed,
    cancelFee: first ? feeHalalas(Number(first.amount), net, total) : 0,
    pickupNote: s.pickupInformation?.pickup?.description?.trim().slice(0, 400) || null, imageUrl: image,
    direction: s.direction, date: s.pickupInformation?.date ?? "", time: (s.pickupInformation?.time ?? "").slice(0, 5),
  };
}

/** One per vehicle and kind, cheapest first, private before shared at the same price; at most `limit`. */
export function quotesFrom(res: HbTransferAvailability, people: number, opts: { rules?: PricingRules; now?: Date; limit?: number } = {}): TransferQuote[] {
  const seen = new Map<string, TransferQuote>();
  for (const s of res.services ?? []) {
    if (s.maxPaxCapacity && s.maxPaxCapacity < people) continue;
    if (s.minPaxCapacity && s.minPaxCapacity > people) continue;
    let q: TransferQuote;
    try { q = quoteOf(s, opts); } catch { continue; }
    const k = `${q.kind}|${q.vehicle}`;
    const had = seen.get(k);
    if (!had || q.total < had.total) seen.set(k, q);
  }
  return [...seen.values()].sort((a, b) => a.total - b.total || (a.kind === "private" ? -1 : 1)).slice(0, opts.limit ?? 5);
}

export type BookTransferInput = {
  rateKey: string;
  holder: { name: string; surname: string; email: string; phone: string };
  flight?: { number: string; direction: "ARRIVAL" | "DEPARTURE"; companyName?: string | null } | null;
  clientReference: string;
  remark?: string | null;
  welcomeMessage?: string | null;
  language?: string;
};

export type TransferCancelResult = { reference: string; status: string; simulated: boolean; amount: number; currency: string | null };

export class HotelbedsTransfers {
  readonly name = "hotelbeds-transfers";
  constructor(readonly client: HotelbedsClient) {}

  static create(opts: Partial<HotelbedsClientOptions> = {}) {
    return new HotelbedsTransfers(new HotelbedsClient({ product: "transfers", ...opts }));
  }

  availability(q: TransferQuery) {
    if (q.adults < 1) throw new HotelbedsError("INVALID_REQUEST", "A transfer needs at least one adult");
    return this.client.request<HbTransferAvailability>({ method: "GET", path: availabilityPath(q), safe: true });
  }

  async quotes(q: TransferQuery, opts: { rules?: PricingRules; now?: Date; limit?: number } = {}) {
    try {
      return quotesFrom((await this.availability(q)) ?? {}, q.adults + (q.children ?? 0), opts);
    } catch (e) {
      // Their "nothing for that route and hour" comes back as a 4xx with no services.
      if (e instanceof HotelbedsError && (e.code === "NOT_FOUND" || e.code === "NO_AVAILABILITY")) return [];
      throw e;
    }
  }

  book(b: BookTransferInput) {
    return this.client.request<HbTransferBookingResponse>({
      method: "POST", path: "/transfer-api/1.0/bookings", safe: false, timeoutMs: 45_000,
      body: {
        language: b.language ?? "en",
        holder: b.holder,
        transfers: [{
          rateKey: b.rateKey,
          transferDetails: b.flight ? [{ type: "FLIGHT", direction: b.flight.direction, code: b.flight.number, companyName: b.flight.companyName ?? null }] : [],
        }],
        clientReference: b.clientReference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20),
        ...(b.welcomeMessage ? { welcomeMessage: b.welcomeMessage.slice(0, 120) } : {}),
        ...(b.remark ? { remark: b.remark.slice(0, 500) } : {}),
      },
    });
  }

  detail(reference: string, language = "en") {
    return this.client.request<HbTransferBookingResponse>({ method: "GET", path: `/transfer-api/1.0/bookings/${language}/reference/${encodeURIComponent(reference)}` });
  }

  /** Simulate first to see the fee; a booking cancelled with a non-zero totalAmount means that amount is charged. */
  async cancel(reference: string, simulate: boolean, language = "en"): Promise<TransferCancelResult> {
    const r = await this.client.request<HbTransferBookingResponse>({
      method: "DELETE", path: `/transfer-api/1.0/bookings/${language}/reference/${encodeURIComponent(reference)}`, query: simulate ? { simulation: true } : undefined, safe: simulate,
    });
    const b = r.bookings?.[0];
    if (!b) throw new HotelbedsError("REJECTED", "Hotelbeds sent no booking back for the cancellation");
    return { reference: b.reference, status: b.status, simulated: simulate, amount: Number(b.totalAmount ?? 0) || 0, currency: b.currency ?? null };
  }
}
