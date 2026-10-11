/*
 * npm run hotelbeds:smoke  (from the repo root or platform/)
 *
 * Runs the certification path against the Hotelbeds TEST environment with the keys in the environment, and prints a
 * report: Hotels status → availability → checkrates (only for a RECHECK rate) → booking → booking detail →
 * cancellation simulation → cancellation; then Transfers availability → booking → simulation → cancellation.
 * Every booking it makes is cancelled before it ends. Skips cleanly (exit 0) when the keys aren't set.
 *
 *   HOTELBEDS_HOTEL_API_KEY / HOTELBEDS_HOTEL_SECRET           Hotels test keys
 *   HOTELBEDS_TRANSFERS_API_KEY / HOTELBEDS_TRANSFERS_SECRET   Transfers test keys (optional: that half is skipped)
 *   HOTELBEDS_SMOKE_DESTINATION   Hotelbeds destination code (default IST)
 *   --record                       also save the answers (guest names removed) to scratch/hotelbeds-recorded/ for fixtures
 *   --no-book                      search and check only (no booking, no cancellation)
 *
 * Never against live: HOTELBEDS_ENV=live is refused.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HotelbedsClient, HotelbedsError, hotelbedsCredentials } from "../src/lib/app/suppliers/hotelbeds/client";
import { HotelbedsHotels, bestRate, type HbHotel, type HbRate } from "../src/lib/app/suppliers/hotelbeds/hotels";
import { HotelbedsTransfers, quotesFrom } from "../src/lib/app/suppliers/hotelbeds/transfers";

type Step = { step: string; ok: boolean; ms: number; note: string };
const steps: Step[] = [];
const args = new Set(process.argv.slice(2));
const record = args.has("--record");
const book = !args.has("--no-book");
const outDir = join(process.cwd(), "scratch", "hotelbeds-recorded");

function save(name: string, body: unknown) {
  if (!record) return;
  mkdirSync(outDir, { recursive: true });
  const clean = JSON.stringify(body, (k, v) => (["name", "surname", "email", "phone"].includes(k) && typeof v === "string" && /holder|pax/i.test(name + k) ? "REDACTED" : v), 2);
  writeFileSync(join(outDir, `${name}.json`), clean);
}

async function step<T>(name: string, run: () => Promise<T>, note: (r: T) => string): Promise<T | null> {
  const t0 = Date.now();
  try {
    const r = await run();
    steps.push({ step: name, ok: true, ms: Date.now() - t0, note: note(r) });
    return r;
  } catch (e) {
    const msg = e instanceof HotelbedsError ? `${e.code}${e.info.status ? ` ${e.info.status}` : ""}${e.info.supplierCode ? ` ${e.info.supplierCode}` : ""}: ${e.message}` : e instanceof Error ? e.message : String(e);
    steps.push({ step: name, ok: false, ms: Date.now() - t0, note: msg.slice(0, 160) });
    return null;
  }
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function pickRate(hotels: HbHotel[]): { hotel: HbHotel; rate: HbRate; room: string } | null {
  // Something we can cancel for free: no NRF, first penalty at least 3 days away.
  const soon = Date.now() + 3 * 86_400_000;
  for (const h of hotels) {
    for (const room of h.rooms ?? []) {
      for (const rate of room.rates ?? []) {
        if (rate.paymentType && rate.paymentType !== "AT_WEB") continue;
        if (rate.rateClass === "NRF" || rate.packaging) continue;
        const first = (rate.cancellationPolicies ?? []).map((p) => Date.parse(p.from)).sort()[0];
        if (first !== undefined && first < soon) continue;
        return { hotel: h, rate, room: room.name };
      }
    }
  }
  const any = hotels.map((h) => ({ h, b: bestRate(h, 1) })).find((x) => x.b);
  return any ? { hotel: any.h, rate: any.b!.rate, room: any.b!.room.name } : null;
}

async function main() {
  if (process.env.HOTELBEDS_ENV?.toLowerCase() === "live") {
    console.error("hotelbeds:smoke runs against the TEST environment only. Unset HOTELBEDS_ENV or set it to test.");
    process.exit(2);
  }
  const hotelsCreds = hotelbedsCredentials("hotels");
  const transfersCreds = hotelbedsCredentials("transfers");
  if (!hotelsCreds && !transfersCreds) {
    console.log("hotelbeds:smoke skipped: no keys (set HOTELBEDS_HOTEL_API_KEY and HOTELBEDS_HOTEL_SECRET, and/or the TRANSFERS pair).");
    return;
  }
  const opts = { env: "test" as const, retries: 1, log: () => {} };
  const checkIn = day(60), checkOut = day(62);
  let hotelCode: number | null = null;

  if (hotelsCreds) {
    const hb = new HotelbedsHotels(new HotelbedsClient({ product: "hotels", ...opts }));
    await step("hotels: status", () => hb.client.request<{ status?: string }>({ method: "GET", path: "/hotel-api/1.0/status" }), (r) => String(r?.status ?? "ok"));
    const dest = process.env.HOTELBEDS_SMOKE_DESTINATION ?? "IST";
    const avail = await step("hotels: availability", () => hb.availability({ checkIn, checkOut, rooms: [{ adults: 2, childAges: [] }], destination: dest }), (r) => `${r.hotels?.total ?? 0} hotels in ${dest}, ${checkIn} → ${checkOut}`);
    if (avail) save("hotels-availability", avail);
    const pick = avail ? pickRate(avail.hotels?.hotels ?? []) : null;
    if (avail && !pick) steps.push({ step: "hotels: pick a rate", ok: false, ms: 0, note: "no bookable AT_WEB rate in the answer" });
    if (pick) {
      hotelCode = pick.hotel.code;
      steps.push({ step: "hotels: pick a rate", ok: true, ms: 0, note: `${pick.hotel.name} (${pick.hotel.code}), ${pick.room}, ${pick.rate.boardCode}, ${pick.rate.net} ${pick.hotel.currency}, ${pick.rate.rateType}` });
      let rateKey = pick.rate.rateKey;
      if (pick.rate.rateType === "RECHECK") {
        const cr = await step("hotels: checkrates (RECHECK)", () => hb.checkRate([rateKey]), (r) => `${r.hotel?.rooms?.[0]?.rates?.[0]?.net ?? "?"} ${r.hotel?.currency ?? ""}, comments: ${(r.hotel?.rooms?.[0]?.rates?.[0]?.rateComments ?? "none").slice(0, 60)}`);
        if (cr) { save("hotels-checkrate", cr); rateKey = cr.hotel?.rooms?.[0]?.rates?.[0]?.rateKey ?? rateKey; }
      } else {
        steps.push({ step: "hotels: checkrates", ok: true, ms: 0, note: "not called: the rate is BOOKABLE (certification 2.5)" });
        if (pick.rate.rateCommentsId) await step("hotels: rate comments", () => hb.rateCommentDetails(pick.rate.rateCommentsId!, checkIn), (r) => (r ?? "none").slice(0, 80));
      }
      if (book) {
        const ref = `MADASMOKE${Date.now().toString().slice(-8)}`;
        const b = await step("hotels: booking", () => hb.book({ rateKey, holder: { name: "Test", surname: "Mada" }, paxes: [{ roomId: 1, type: "AD", name: "Test", surname: "Mada" }, { roomId: 1, type: "AD", name: "Second", surname: "Mada" }], clientReference: ref, remark: "Mada Trips smoke test on the test environment. Cancelled straight away." }), (r) => `${r.booking.reference} ${r.booking.status} (client ${ref})`);
        if (b) {
          save("hotels-booking", b);
          const reference = b.booking.reference;
          await step("hotels: booking detail", () => hb.bookingDetail(reference), (r) => `${r.booking.status}, holder ${r.booking.holder?.surname ?? "?"}`);
          const sim = await step("hotels: cancellation simulation", () => hb.cancel(reference, true), (r) => `fee ${r.amount} ${r.currency ?? ""}`);
          if (sim) save("hotels-cancel-simulation", sim);
          const c = await step("hotels: cancellation", () => hb.cancel(reference, false), (r) => `${r.status} ${r.cancellationReference ?? ""} fee ${r.amount} ${r.currency ?? ""}`);
          if (c) save("hotels-cancel", c);
        }
      }
    }
  } else steps.push({ step: "hotels", ok: true, ms: 0, note: "skipped: no Hotels keys" });

  if (transfersCreds) {
    const tr = new HotelbedsTransfers(new HotelbedsClient({ product: "transfers", ...opts }));
    const to = hotelCode ? { type: "ATLAS" as const, code: String(hotelCode) } : { type: "GPS" as const, code: "41.0256,28.9744" };
    const q = { from: { type: "IATA" as const, code: "IST" }, to, outbound: `${checkIn}T14:00`, adults: 2 };
    const avail = await step("transfers: availability", () => tr.availability(q), (r) => `${r?.services?.length ?? 0} services IST → ${to.type} ${to.code}`);
    if (avail) save("transfers-availability", avail);
    const best = avail ? quotesFrom(avail, 2)[0] : null;
    if (best && book) {
      const b = await step("transfers: booking", () => tr.book({ rateKey: best.rateKey, holder: { name: "Test", surname: "Mada", email: "desk@madatrips.com", phone: "+966500000000" }, flight: { number: "SV263", direction: "ARRIVAL", companyName: "Saudia" }, clientReference: `MADASMOKET${Date.now().toString().slice(-6)}`, remark: "Mada Trips smoke test. Cancelled straight away." }), (r) => `${r.bookings[0]?.reference} ${r.bookings[0]?.status} (${best.vehicle}, ${best.kind})`);
      const reference = b?.bookings[0]?.reference;
      if (reference) {
        save("transfers-booking", b);
        await step("transfers: cancellation simulation", () => tr.cancel(reference, true), (r) => `fee ${r.amount} ${r.currency ?? ""}`);
        await step("transfers: cancellation", () => tr.cancel(reference, false), (r) => `${r.status} fee ${r.amount} ${r.currency ?? ""}`);
      }
    }
  } else steps.push({ step: "transfers", ok: true, ms: 0, note: "skipped: no Transfers keys" });

  const w = Math.max(...steps.map((s) => s.step.length));
  console.log(`\nHotelbeds smoke test · TEST environment · ${new Date().toISOString()}\n`);
  for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.step.padEnd(w)}  ${String(s.ms).padStart(5)} ms  ${s.note}`);
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n${steps.length - failed} passed, ${failed} failed${record ? ` · answers saved to ${outDir}` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

void main();
