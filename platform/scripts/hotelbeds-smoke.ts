/*
 * npm run hotelbeds:smoke: one real round trip on the Hotelbeds TEST environment with the account's own keys.
 *
 *   search → check rate → book → voucher → cancel (simulation, then for real)
 *
 * It uses the same adapter the Core API uses (suppliers/hotelbeds/hotels.ts, voucher.ts), nothing from Next or the
 * database, so it runs in any shell that has HOTELBEDS_HOTEL_API_KEY and HOTELBEDS_HOTEL_SECRET. It never runs against
 * the live host: a live booking is a real contract with a hotel. Every call the test host answers counts towards the
 * evaluation quota (50 a day), and a full run is six calls.
 *
 *   npm run hotelbeds:smoke                                 Dubai, check-in in six weeks, two nights, two adults
 *   npm run hotelbeds:smoke -- --city istanbul --nights 3   another of our cities (HB_PLACES)
 *   npm run hotelbeds:smoke -- --destination PMI            a Hotelbeds destination code instead
 *   npm run hotelbeds:smoke -- --in 2026-12-10 --adults 1
 *   npm run hotelbeds:smoke -- --out ./smoke                where the vouchers and the raw answers go (default: a temp folder)
 *   npm run hotelbeds:smoke -- --keep                       leave the booking in place (cancel it in the extranet yourself)
 *
 * Exit code 0 when every step passed. If booking succeeded but cancelling did not, the reference is printed in capitals:
 * cancel it by hand in the Hotelbeds extranet so the test booking does not sit there.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays } from "@mada/shared";
import { HotelbedsError, hotelbedsCredentials, hotelbedsEnv, hotelbedsEnvNames, type HotelbedsLogLine } from "../src/lib/app/suppliers/hotelbeds/client";
import {
  HB_PLACES, HotelbedsHotels, offerOf, splitParty, stayRule,
  type HbBooking, type HbHotel, type HbRate, type HbRoom,
} from "../src/lib/app/suppliers/hotelbeds/hotels";
import { buildVoucher, voucherHtml } from "../src/lib/app/suppliers/hotelbeds/voucher";

/* ───────────── arguments ───────────── */

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback; };

const city = opt("city", "dubai").toLowerCase();
const destination = opt("destination", "");
const checkIn = opt("in", addDays(new Date().toISOString().slice(0, 10), 42));
const nights = Math.max(1, Number(opt("nights", "2")) || 2);
const adults = Math.max(1, Math.min(4, Number(opt("adults", "2")) || 2));
const keep = flag("keep");
const outDir = opt("out", join(tmpdir(), `hotelbeds-smoke-${Date.now().toString(36)}`));
const checkOut = addDays(checkIn, nights);

/* ───────────── the report ───────────── */

type Step = { step: string; ok: boolean; ms: number; note: string };
const steps: Step[] = [];
const calls: HotelbedsLogLine[] = [];
let bookedReference: string | null = null;

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
function record(step: string, ok: boolean, ms: number, note: string) {
  steps.push({ step, ok, ms, note });
  console.log(`${ok ? "✓" : "✗"} ${pad(step, 12)} ${pad(`${ms} ms`, 9)} ${note}`);
}
function save(name: string, data: unknown) {
  writeFileSync(join(outDir, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}
const said = (e: unknown) => (e instanceof HotelbedsError ? `${e.code}${e.info.status ? ` (${e.info.status})` : ""}${e.info.supplierCode ? ` ${e.info.supplierCode}` : ""}: ${e.message}` : e instanceof Error ? e.message : String(e));

async function step<T>(name: string, run: () => Promise<T>, note: (r: T) => string): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await run();
    record(name, true, Date.now() - t0, note(r));
    return r;
  } catch (e) {
    record(name, false, Date.now() - t0, said(e));
    throw e;
  }
}

/* ───────────── which rate to book ───────────── */

type Pick = { hotel: HbHotel; room: HbRoom; rate: HbRate; refundable: boolean };

/**
 * The cheapest AT_WEB rate for one room that can still be cancelled for free well after today, so the cancellation at
 * the end costs nothing on the account. Falls back to any refundable rate, then to the cheapest rate at all (a
 * non-refundable test booking still cancels on the test host; the fee it reports is not charged).
 */
function pickRate(hotels: HbHotel[], rooms: number): Pick | null {
  const all: Pick[] = [];
  for (const hotel of hotels) {
    for (const room of hotel.rooms ?? []) {
      for (const rate of room.rates ?? []) {
        if (rate.paymentType && rate.paymentType !== "AT_WEB") continue;
        if (rate.packaging) continue;
        if (rate.rooms && rate.rooms !== rooms) continue;
        if (!(Number(rate.net) > 0)) continue;
        const rule = stayRule(rate, 100_000);
        const freeForDays = rule.freeCancelUntil ? (Date.parse(rule.freeCancelUntil) - Date.now()) / 86_400_000 : rule.refundable ? Infinity : -1;
        all.push({ hotel, room, rate, refundable: rule.refundable && freeForDays >= 3 });
      }
    }
  }
  all.sort((a, b) => Number(a.refundable) - Number(b.refundable) || Number(a.rate.net) - Number(b.rate.net));
  return all.find((p) => p.refundable) ?? all.sort((a, b) => Number(a.rate.net) - Number(b.rate.net))[0] ?? null;
}

/* ───────────── the run ───────────── */

async function main() {
  const env = hotelbedsEnv();
  if (env !== "test") {
    console.error(`HOTELBEDS_ENV=${env}: the smoke test books and cancels, so it only runs against the test host. Unset HOTELBEDS_ENV (or set it to test).`);
    process.exit(2);
  }
  const names = hotelbedsEnvNames("hotels");
  if (!hotelbedsCredentials("hotels")) {
    console.error(`Hotels keys are missing: set ${names.key} and ${names.secret}.`);
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const place = HB_PLACES[city];
  if (!destination && !place) {
    console.error(`Unknown city "${city}". One of: ${Object.keys(HB_PLACES).join(", ")}; or --destination <code>.`);
    process.exit(2);
  }
  const rooms = 1;
  const party = splitParty(adults, [], rooms);
  const hotels = HotelbedsHotels.create({ env: "test", timeoutMs: 30_000, retries: 1, log: (l) => calls.push(l) });

  console.log(`Hotelbeds smoke test · ${hotels.client.baseUrl} · ${destination ? `destination ${destination}` : city} · ${checkIn} → ${checkOut} (${nights} night${nights === 1 ? "" : "s"}, ${adults} adult${adults === 1 ? "" : "s"}, ${rooms} room)`);
  console.log(`Output: ${outDir}\n`);

  // 1. Search.
  const availability = await step("search", () => hotels.availability({
    checkIn, checkOut, rooms: party,
    ...(destination ? { destination } : { geolocation: { latitude: place!.lat, longitude: place!.lng, radius: place!.radiusKm, unit: "km" as const } }),
    maxHotels: 200,
  }), (r) => `${r.hotels?.hotels?.length ?? 0} hotels (${r.hotels?.total ?? "?"} in total), token ${r.auditData?.token ?? "-"}`);
  save("1-availability.json", availability);
  const list = availability.hotels?.hotels ?? [];
  if (!list.length) throw new Error("No hotels came back: the test host has nothing for this place and these dates. Try --destination PMI or other dates.");

  const picked = pickRate(list, rooms);
  if (!picked) throw new Error("No AT_WEB rate for one room in the answer.");
  const offer = offerOf(picked.hotel, picked.room, picked.rate, { nights, party: adults, rooms, checkIn });
  console.log(`  → ${picked.hotel.name} (${picked.hotel.code}, ${picked.hotel.categoryName ?? picked.hotel.categoryCode ?? "?"}) · ${picked.room.name} · ${picked.rate.boardName ?? picked.rate.boardCode ?? "?"} · ${picked.rate.rateType}${picked.rate.rateClass ? ` ${picked.rate.rateClass}` : ""}`);
  console.log(`    net ${picked.rate.net} ${picked.hotel.currency} → sells at SAR ${(offer.total.amount / 100).toLocaleString("en-US")} · ${offer.cancellation}${picked.refundable ? "" : " · WARNING: no free cancellation found, booking it anyway"}`);

  // 2. Check the rate (required for RECHECK; done for BOOKABLE too so the step is exercised).
  const checked = await step("checkrate", () => hotels.checkRate([picked.rate.rateKey]), (r) => {
    const rate = r.hotel?.rooms?.[0]?.rates?.[0];
    return rate ? `${rate.rateType} · net ${rate.net} ${r.hotel?.currency} · key ${rate.rateKey === picked.rate.rateKey ? "unchanged" : "changed"}` : "no rate in the answer";
  });
  save("2-checkrates.json", checked);
  const checkedRate = checked.hotel?.rooms?.[0]?.rates?.[0];
  if (!checkedRate) throw new Error("checkrates came back without a rate: the room is gone.");
  if (Number(checkedRate.net) !== Number(picked.rate.net)) console.log(`  ! price moved between search and checkrates: ${picked.rate.net} → ${checkedRate.net} ${checked.hotel?.currency}`);

  // 3. Book.
  const clientReference = `SMOKE${Date.now().toString(36).toUpperCase()}`;
  const holder = { name: "Mada", surname: "Smoketest" };
  const paxes = Array.from({ length: adults }, (_, i) => ({ roomId: 1, type: "AD" as const, name: i === 0 ? holder.name : "Guest", surname: i === 0 ? holder.surname : `Smoketest${i + 1}` }));
  const booked = await step("book", () => hotels.book({ rateKey: checkedRate.rateKey, holder, paxes, clientReference, remark: "Mada Trips smoke test. Cancelled straight away." }),
    (r) => `${r.booking.status} · ${r.booking.reference} · net ${r.booking.totalNet ?? r.booking.hotel?.totalNet} ${r.booking.currency ?? r.booking.hotel?.currency} · ours ${r.booking.clientReference}`);
  save("3-booking.json", booked);
  const b: HbBooking = booked.booking;
  bookedReference = b.reference;
  if (b.status !== "CONFIRMED") throw new Error(`Booking status is ${b.status}, not CONFIRMED`);

  // 4. Read it back, then the voucher.
  const detail = await step("detail", () => hotels.bookingDetail(b.reference), (r) => `${r.booking.status} · ${r.booking.hotel?.name ?? "?"} · ${r.booking.hotel?.checkIn} → ${r.booking.hotel?.checkOut} · cancel ${r.booking.modificationPolicies?.cancellation ? "allowed" : "not allowed"}`);
  save("4-detail.json", detail);

  const voucher = buildVoucher({
    id: "smoke", product: "stay", status: "confirmed", supplierRef: b.reference, agencyReference: clientReference, createdAt: new Date(),
    details: { booking: detail.booking, cancellation: offer.cancellation, facts: null, category: picked.hotel.categoryName ?? null },
  });
  const en = voucherHtml(voucher, "en");
  const ar = voucherHtml(voucher, "ar");
  save("5-voucher.json", voucher);
  save("5-voucher-en.html", en);
  save("5-voucher-ar.html", ar);
  const missing = [
    !voucher.reference && "reference", !voucher.hotel?.name && "hotel name", !voucher.holder && "holder", !voucher.paxes.length && "guests",
    !voucher.checkIn && "check-in", !voucher.checkOut && "check-out", !voucher.room && "room", !voucher.board && "board",
    !voucher.payableThrough.includes(b.reference) && "payment statement", !en.includes(b.reference) && "html",
    !voucher.hotel?.address && "address (no content cache in the smoke test: the app fills it from app_hotelbeds_hotels)",
  ].filter(Boolean) as string[];
  record("voucher", !missing.some((m) => !m.startsWith("address")), 0, missing.length ? `missing: ${missing.join(", ")}` : `${voucher.hotel?.name} · ${voucher.paxes.length} guest${voucher.paxes.length === 1 ? "" : "s"} · ${voucher.room} · ${voucher.board} · en + ar written`);

  if (keep) {
    console.log(`\n--keep: booking ${b.reference} left in place. Cancel it in the extranet (client reference ${clientReference}).`);
    return;
  }

  // 5. Cancel: what it would cost, then for real.
  const sim = await step("simulate", () => hotels.cancel(b.reference, true), (r) => `fee ${r.amount} ${r.currency ?? ""} · status ${r.status}`);
  save("6-cancel-simulation.json", sim);
  const cancelled = await step("cancel", () => hotels.cancel(b.reference, false), (r) => `${r.status} · fee ${r.amount} ${r.currency ?? ""}${r.cancellationReference ? ` · ref ${r.cancellationReference}` : ""}`);
  save("7-cancel.json", cancelled);
  if (cancelled.status !== "CANCELLED") throw new Error(`Cancellation status is ${cancelled.status}, not CANCELLED`);
  bookedReference = null;
  if (sim.amount > 0) console.log(`  ! the simulation reported a fee of ${sim.amount} ${sim.currency ?? ""}: the rate was not free to cancel`);
}

main()
  .then(() => finish(0))
  .catch((e) => {
    if (!steps.length || steps[steps.length - 1]!.ok) console.error(`\n✗ ${said(e)}`);
    finish(1);
  });

function finish(code: number) {
  save("calls.json", calls);
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed · ${calls.length} calls to Hotelbeds · ${calls.reduce((a, c) => a + c.ms, 0)} ms on the wire · files in ${outDir}`);
  if (bookedReference) console.error(`\nBOOKING ${bookedReference} IS STILL IN PLACE ON THE TEST ACCOUNT: cancel it in the Hotelbeds extranet.`);
  process.exit(code || (bookedReference ? 1 : 0));
}
