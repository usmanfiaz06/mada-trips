import { vi } from "vitest";

/*
 * A stand-in for TBO Air, answering in TBO's JSON shapes (suppliers/live/tbo-air.ts lists what's confirmed and what's
 * assumed). RUH→IST for a family of five (2 adults, 2 children, a baby on a lap): Saudia SV263 (full-service, held
 * with Book, then ticketed) and flynas XY125 to SAW (low-cost, ticketed straight away). Never calls TBO.
 *
 * Switches on the returned state: priceRise (FareQuote and Book say the fare rose), ticketFails, ticketInProgress
 * (Ticket answers InProgress, then GetBookingDetails has the tickets), ticketPriceChanged (a full-service Ticket says the fare
 * rose until it's sent again with IsPriceChangeAccepted), ticketTimesOut (Ticket throws, but issues),
 * sessionExpiresOnce (the next air call answers ErrorCode 6), soldOut (FareQuote: no seats), badLogin.
 */

export const TBO_ENV = {
  TBO_AIR_BASE_URL: "https://tbo.test/BookingEngineService_Air/AirService.svc/rest",
  TBO_AUTH_URL: "https://tbo.test/SharedServices/SharedData.svc/rest/Authenticate",
  TBO_CLIENT_ID: "ApiIntegrationNew",
  TBO_USERNAME: "mada-test",
  TBO_PASSWORD: "test-password-not-real",
  TBO_END_USER_IP: "203.0.113.7",
  SUPPLIER_MODE_FLIGHTS: "tbo",
};

const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
const NO_ERROR = { ErrorCode: 0, ErrorMessage: "" };

const airport = (code: string, city: string, country: string, terminal = "") => ({ AirportCode: code, AirportName: city, Terminal: terminal, CityCode: code, CityName: city, CountryCode: country, CountryName: country });

function seg(o: { code: string; name: string; num: string; from: [string, string, string, string?]; to: [string, string, string, string?]; dep: string; arr: string; dur: number; bag: string; trip: 1 | 2; seats?: number }) {
  return {
    Baggage: o.bag, CabinBaggage: "7 KG", TripIndicator: o.trip, SegmentIndicator: 1,
    Airline: { AirlineCode: o.code, AirlineName: o.name, FlightNumber: o.num, FareClass: "Y", OperatingCarrier: "" },
    NoOfSeatAvailable: o.seats ?? 9,
    Origin: { Airport: airport(...o.from), DepTime: o.dep }, Destination: { Airport: airport(...o.to), ArrTime: o.arr },
    Duration: o.dur, GroundTime: 0, Mile: 0, StopOver: false, StopPoint: "", StopPointArrivalTime: o.arr, StopPointDepartureTime: o.dep, Craft: "789", IsETicketEligible: true, FlightStatus: "Confirmed", Status: "",
  };
}

type Party = { adults: number; children: number; infants: number };

/** A fare breakdown for this party: per type totals, as TBO sends them (BaseFare and Tax for PassengerCount people). */
function fare(p: Party, adult: [number, number], child: [number, number], infant: [number, number], other = 40, rise = 0) {
  const rows = [
    { PassengerType: 1, PassengerCount: p.adults, BaseFare: (adult[0] + rise) * p.adults, Tax: adult[1] * p.adults },
    ...(p.children ? [{ PassengerType: 2, PassengerCount: p.children, BaseFare: (child[0] + rise) * p.children, Tax: child[1] * p.children }] : []),
    ...(p.infants ? [{ PassengerType: 3, PassengerCount: p.infants, BaseFare: infant[0] * p.infants, Tax: infant[1] * p.infants }] : []),
  ].map((r) => ({ Currency: "SAR", YQTax: 0, AdditionalTxnFeeOfrd: 0, AdditionalTxnFeePub: 0, PGCharge: 0, ...r }));
  const base = rows.reduce((a, r) => a + r.BaseFare, 0);
  const tax = rows.reduce((a, r) => a + r.Tax, 0);
  const published = base + tax + other;
  return {
    Fare: { Currency: "SAR", BaseFare: base, Tax: tax, YQTax: 0, AdditionalTxnFeeOfrd: 0, AdditionalTxnFeePub: 0, OtherCharges: other, ChargeBU: [], Discount: 0, PublishedFare: published, CommissionEarned: 120, PLBEarned: 0, IncentiveEarned: 0, OfferedFare: published - 120, TdsOnCommission: 0, TdsOnPLB: 0, TdsOnIncentive: 0, ServiceFee: 0 },
    FareBreakdown: rows,
  };
}

/** RUH→IST on `depart` (return on `back`): Saudia (non-LCC) and flynas to SAW (LCC). */
export function results(p: Party, depart: string, back: string | null, rise = 0) {
  const sv = {
    ResultIndex: "OB1", Source: 4, IsLCC: false, IsRefundable: true, AirlineRemark: "", LastTicketDate: `${depart}T23:59:00`, TicketAdvisory: "", ValidatingAirline: "SV",
    ...fare(p, [1500, 550], [1125, 550], [150, 30], 40, rise),
    Segments: [
      [seg({ code: "SV", name: "Saudia", num: "263", from: ["RUH", "Riyadh", "SA", "3"], to: ["IST", "Istanbul", "TR", "I"], dep: `${depart}T09:40:00`, arr: `${depart}T13:55:00`, dur: 255, bag: "2 PC", trip: 1 })],
      ...(back ? [[seg({ code: "SV", name: "Saudia", num: "264", from: ["IST", "Istanbul", "TR", "I"], to: ["RUH", "Riyadh", "SA", "3"], dep: `${back}T15:10:00`, arr: `${back}T19:20:00`, dur: 250, bag: "2 PC", trip: 2 })]] : []),
    ],
    Penalty: { ReissueCharge: "SAR 300", CancellationCharge: "SAR 400" },
  };
  const xy = {
    ResultIndex: "OB2", Source: 19, IsLCC: true, IsRefundable: false, AirlineRemark: "", LastTicketDate: null, TicketAdvisory: "", ValidatingAirline: "XY",
    ...fare(p, [1200, 470], [900, 470], [120, 20], 0, rise),
    Segments: [
      [seg({ code: "XY", name: "flynas", num: "125", from: ["RUH", "Riyadh", "SA", "1"], to: ["SAW", "Istanbul", "TR"], dep: `${depart}T06:15:00`, arr: `${depart}T10:40:00`, dur: 265, bag: "20 KG", trip: 1, seats: 4 })],
      ...(back ? [[seg({ code: "XY", name: "flynas", num: "126", from: ["SAW", "Istanbul", "TR"], to: ["RUH", "Riyadh", "SA", "1"], dep: `${back}T11:30:00`, arr: `${back}T15:40:00`, dur: 250, bag: "20 KG", trip: 2, seats: 4 })]] : []),
    ],
    Penalty: null,
  };
  return [sv, xy];
}

export const FARE_RULE_SV = "<b>PENALTIES</b><br/>CHANGES<br/>ANY TIME CHARGE SAR 300.00 FOR REISSUE.<br/>CANCELLATIONS<br/>BEFORE DEPARTURE CHARGE SAR 400.00 FOR CANCEL/REFUND.";
export const FARE_RULE_XY = "TICKET IS NON-REFUNDABLE. DATE CHANGE SAR 250 PER PASSENGER PER SECTOR PLUS FARE DIFFERENCE.";

type Body = Record<string, unknown> & { TokenId?: string; TraceId?: string; ResultIndex?: string };

export function fakeTbo() {
  const s = {
    calls: [] as { method: string; body: Body }[],
    logins: 0,
    traces: 0,
    bookings: new Map<number, { pnr: string; lcc: boolean; pax: { FirstName: string; LastName: string; PaxType: number }[]; tickets: string[] | null }>(),
    nextId: 1_400_000,
    priceRise: false,
    soldOut: false,
    ticketFails: false,
    ticketInProgress: false,
    ticketTimesOut: false,
    ticketPriceChanged: false,
    sessionExpiresOnce: false,
    badLogin: false,
    search: null as null | { party: Party; depart: string; back: string | null },
    count: (m: string) => s.calls.filter((c) => c.method === m).length,
  };
  const tokens = new Set<string>();
  const party = (b: Body): Party => ({ adults: Number(b.AdultCount), children: Number(b.ChildCount), infants: Number(b.InfantCount) });
  const current = (rise = 0) => results(s.search!.party, s.search!.depart, s.search!.back, rise);
  const ticketsFor = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${String(2_100_000 + s.nextId + i).padStart(10, "0")}`.slice(-10));
  const itinerary = (id: number) => {
    const b = s.bookings.get(id)!;
    return {
      BookingId: id, PNR: b.pnr, IsLCC: b.lcc, Status: b.tickets ? 1 : 1, LastTicketDate: s.search ? `${s.search.depart}T23:59:00` : null,
      Fare: current()[b.lcc ? 1 : 0]!.Fare,
      // Tickets still in progress at the airline aren't on the booking yet.
      Passenger: b.pax.map((p, i) => ({ PaxId: id * 10 + i, FirstName: p.FirstName, LastName: p.LastName, PaxType: p.PaxType, Ticket: b.tickets && !s.ticketInProgress ? { TicketId: id * 10 + i, TicketNumber: b.tickets[i], ValidatingAirline: b.lcc ? "" : "065", Status: "OK" } : null })),
    };
  };

  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const method = u.pathname.replace(/\/+$/, "").split("/").pop()!;
    const body = JSON.parse(String(init.body ?? "{}")) as Body;
    s.calls.push({ method, body });
    if (method === "Authenticate") {
      s.logins += 1;
      if (s.badLogin || body.Password !== TBO_ENV.TBO_PASSWORD) return ok({ Status: 2, TokenId: null, Error: { ErrorCode: 2, ErrorMessage: "Invalid credentials" }, Member: null });
      const t = `tok-${s.logins}-0000-0000-000000000000`;
      tokens.add(t);
      return ok({ Status: 1, TokenId: t, Error: NO_ERROR, Member: { FirstName: "Mada", LastName: "Trips", Email: "", MemberId: 1, AgencyId: 2, LoginName: "mada-test", LoginDetails: "", isPrimaryAgent: true } });
    }
    if (!tokens.has(String(body.TokenId)) || s.sessionExpiresOnce) {
      if (s.sessionExpiresOnce) { s.sessionExpiresOnce = false; tokens.clear(); }
      return ok({ Response: { ResponseStatus: 4, Error: { ErrorCode: 6, ErrorMessage: "Session expired" }, TraceId: body.TraceId ?? "" } });
    }
    if (method === "Search") {
      const segs = body.Segments as { PreferredDepartureTime: string }[];
      s.search = { party: party(body), depart: segs[0]!.PreferredDepartureTime.slice(0, 10), back: segs[1]?.PreferredDepartureTime.slice(0, 10) ?? null };
      s.traces += 1;
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: `trace-${s.traces}`, Origin: "RUH", Destination: "IST", Results: [current()] } });
    }
    const pick = () => current(s.priceRise ? 200 : 0).find((r) => r.ResultIndex === body.ResultIndex);
    if (method === "FareRule") {
      const r = pick();
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, FareRules: [{ Origin: "RUH", Destination: "IST", Airline: r?.ValidatingAirline, FareBasisCode: "YOW", FareRuleDetail: r?.IsLCC ? FARE_RULE_XY : FARE_RULE_SV, FareRestriction: "" }] } });
    }
    if (method === "FareQuote") {
      if (s.soldOut) return ok({ Response: { ResponseStatus: 2, Error: { ErrorCode: 25, ErrorMessage: "Seats are not available for the selected flight" }, TraceId: body.TraceId } });
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, IsPriceChanged: s.priceRise, Results: pick() } });
    }
    if (method === "Book") {
      const pax = body.Passengers as { FirstName: string; LastName: string; PaxType: number }[];
      const id = s.nextId++;
      s.bookings.set(id, { pnr: "X7K2QD", lcc: false, pax, tickets: null });
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, Response: { PNR: "X7K2QD", BookingId: id, SSRDenied: false, SSRMessage: null, Status: 1, IsPriceChanged: false, IsTimeChanged: false, FlightItinerary: itinerary(id) } } });
    }
    if (method === "Ticket") {
      let id = Number(body.BookingId ?? 0);
      if (!id) {
        id = s.nextId++;
        s.bookings.set(id, { pnr: "NAS4Q7", lcc: true, pax: body.Passengers as never, tickets: null });
      }
      const b = s.bookings.get(id)!;
      if (s.ticketFails) return ok({ Response: { ResponseStatus: 2, Error: { ErrorCode: 9, ErrorMessage: "Ticketing failed at airline" }, TraceId: body.TraceId, Response: { PNR: b.pnr, BookingId: id, TicketStatus: 9, IsPriceChanged: false, IsTimeChanged: false } } });
      if (s.ticketPriceChanged && !b.lcc && !body.IsPriceChangeAccepted) {
        const it = itinerary(id);
        return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, Response: { PNR: b.pnr, BookingId: id, TicketStatus: 8, IsPriceChanged: true, IsTimeChanged: false, FlightItinerary: { ...it, Fare: { ...it.Fare, PublishedFare: it.Fare.PublishedFare + 1000 } } } } });
      }
      b.tickets = ticketsFor(b.pax.length, b.lcc ? "" : "");
      if (s.ticketTimesOut) throw new TypeError("fetch failed");
      if (s.ticketInProgress) return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, Response: { PNR: b.pnr, BookingId: id, TicketStatus: 5, IsPriceChanged: false, IsTimeChanged: false, FlightItinerary: { ...itinerary(id), Passenger: itinerary(id).Passenger.map((p) => ({ ...p, Ticket: null })) } } } });
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, Response: { PNR: b.pnr, BookingId: id, SSRDenied: false, TicketStatus: 1, IsPriceChanged: false, IsTimeChanged: false, FlightItinerary: itinerary(id) } } });
    }
    if (method === "GetBookingDetails") {
      const id = Number(body.BookingId ?? 0) || [...s.bookings.entries()].find(([, b]) => b.pnr === body.PNR || b.pax[0]?.FirstName === body.FirstName)?.[0];
      if (!id || !s.bookings.has(id)) return ok({ Response: { ResponseStatus: 2, Error: { ErrorCode: 3, ErrorMessage: "No booking found" } } });
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: body.TraceId, FlightItinerary: itinerary(id) } });
    }
    if (method === "ReleasePNRRequest") {
      s.bookings.delete(Number(body.BookingId));
      return ok({ Response: { ResponseStatus: 1, Error: NO_ERROR, TraceId: "" } });
    }
    if (method === "SendChangeRequest") {
      return ok({ Response: { B2B2BStatus: false, ResponseStatus: 1, Error: NO_ERROR, TraceId: "", TicketCRInfo: (body.TicketId as number[]).map((t, i) => ({ ChangeRequestId: 900 + i, TicketId: t, Status: 1, Remarks: "", ChangeRequestStatus: 1 })) } });
    }
    return ok({ Response: { ResponseStatus: 3, Error: { ErrorCode: 1, ErrorMessage: `Unknown method ${method}` } } });
  }));
  return s;
}
