/**
 * Demo data for the agent desk, on top of the Ops demo seed (npm run db:seed):
 *   npx tsx --conditions=react-server src/lib/app/desk/seed.ts
 * Needs the desk tables (npm run db:migrate) and APP_DATA_KEY (passports are encrypted as in production).
 * Agents for the seeded Ops users, a rota around now (Faisal on, Noura covering for Omar), travellers, orders in every
 * state, requests, chats, refunds, today's flights (one in the air, two disrupted), tips and reports.
 * Runs once: it stops if desk agents already exist. Local databases only.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import * as ops from "../../../db/schema";
import * as app from "../../../db/app-schema";
import * as desk from "../../../db/app-schema-desk";
import { encryptField, passportAad } from "../crypto";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DESK_SEED !== "yes") throw new Error("The desk demo seed only runs against a local database");
if (!process.env.APP_DATA_KEY) process.env.APP_DATA_KEY = Buffer.alloc(32, 7).toString("base64"); // dev only: the local server must use the same key
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000);
const day = (offsetDays = 0, tz = "Asia/Riyadh") => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW + offsetDays * 86400_000));
const localAt = (minFromNow: number, tz = "Asia/Riyadh") => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(NOW + minFromNow * 60_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:00`;
};
const H = (sar: number) => Math.round(sar * 100);

async function main() {
  const existing = await db.select({ id: desk.appAgents.id }).from(desk.appAgents).limit(1);
  if (existing.length) { console.log("Desk demo data already there. Nothing to do."); return; }
  const users = await db.select().from(ops.users).where(inArray(ops.users.email, ["counter@madatrips.com", "desk1@madatrips.com", "desk2@madatrips.com", "bader@madatrips.com", "abdulaziz@madatrips.com"]));
  const by = (e: string) => users.find((u) => u.email === e);
  const counter = by("counter@madatrips.com"), desk1 = by("desk1@madatrips.com"), desk2 = by("desk2@madatrips.com"), bader = by("bader@madatrips.com"), lead = by("abdulaziz@madatrips.com");
  if (!counter || !desk1 || !desk2 || !bader || !lead) throw new Error("Run the Ops demo seed first (npm run db:seed)");

  /* ── agents and rota ── */
  const [faisal, noura, omar, baderA] = await db.insert(desk.appAgents).values([
    { opsUserId: counter.id, displayName: "Faisal", displayNameAr: "فيصل", languages: ["ar", "en"], pronoun: "he", status: "online", replyMinutes: 2 },
    { opsUserId: desk1.id, displayName: "Noura", displayNameAr: "نورة", languages: ["en", "ar", "ur"], pronoun: "she", status: "online", replyMinutes: 4 },
    { opsUserId: desk2.id, displayName: "Omar", displayNameAr: "عمر", languages: ["en", "ur", "ar"], pronoun: "he", status: "offline", replyMinutes: 3 },
    { opsUserId: bader.id, displayName: "Bader", displayNameAr: "بدر", languages: ["ar", "en"], pronoun: "he", status: "away", replyMinutes: 5 },
  ]).returning();
  const hour = (h: number) => new Date(Math.floor(NOW / 3600_000) * 3600_000 + h * 3600_000);
  await db.insert(desk.appAgentShifts).values([
    { agentId: faisal!.id, startsAt: hour(-4), endsAt: hour(5), note: "Riyadh day desk", createdBy: lead.id },
    { agentId: noura!.id, startsAt: hour(-2), endsAt: hour(7), coveringForId: omar!.id, note: "Pakistan desk", createdBy: lead.id },
    { agentId: omar!.id, startsAt: hour(9), endsAt: hour(17), createdBy: lead.id },
    { agentId: faisal!.id, startsAt: hour(20), endsAt: hour(29), createdBy: lead.id },
    { agentId: noura!.id, startsAt: hour(29), endsAt: hour(38), coveringForId: faisal!.id, note: "Night desk", createdBy: lead.id },
    { agentId: baderA!.id, startsAt: hour(24), endsAt: hour(30), note: "Escalations", createdBy: lead.id },
  ]);
  await db.insert(desk.appDeskCanned).values([
    { title: "On it", bodyEn: "I'm on it. I'll message you here as soon as it's done.", bodyAr: "أتابع الموضوع الآن، وأكتب لك هنا فور الانتهاء.", sort: 1 },
    { title: "Bag tag photo", bodyEn: "Could you send a photo of the bag tag? It's the sticker the airline gave you at check-in.", bodyAr: "ممكن ترسل صورة ملصق الشنطة؟ هو الملصق اللي أعطوك إياه عند تسجيل الوصول.", sort: 2 },
    { title: "Passport photo", bodyEn: "Please send a clear photo of the passport's photo page, without glare.", bodyAr: "أرسل لو سمحت صورة واضحة لصفحة الصورة في الجواز، بدون انعكاس ضوء.", sort: 3 },
    { title: "Refund timing", bodyEn: "Card refunds usually take 5 to 10 days to show. Mada credit is instant.", bodyAr: "استرداد البطاقة يظهر عادة خلال 5 إلى 10 أيام. رصيد مدى فوري.", sort: 4 },
    { title: "Seats together", bodyEn: "I've asked the airline to seat you together. I'll confirm the seat numbers here.", bodyAr: "طلبت من شركة الطيران أن تكونوا بجانب بعض، وأأكد لك أرقام المقاعد هنا.", sort: 5 },
  ]);

  /* ── travellers ── */
  type Pass = { given: string; surname: string; relation: string; dob: string; sex: string; number: string; expiry: string; nat?: string };
  const people = async (ownerId: string, list: Pass[]) => {
    const out: string[] = [];
    for (const [i, p] of list.entries()) {
      const [row] = await db.insert(app.appPeople).values({ ownerId, isSelf: i === 0, givenNames: p.given, surname: p.surname, relation: p.relation, dateOfBirth: p.dob, sex: p.sex, nationality: p.nat ?? "SAU" }).returning();
      const masked = `${p.number.slice(0, 3)}•••${p.number.slice(-2)}`;
      await db.update(app.appPeople).set({ passportNumberEnc: encryptField(p.number, passportAad(row!.id)), passportNumberMasked: masked, passportIssuingCountry: p.nat ?? "SAU", passportNationality: p.nat ?? "SAU", passportExpiry: p.expiry, passportSource: "scan", passportUpdatedAt: new Date() }).where(eq(app.appPeople.id, row!.id));
      out.push(row!.id);
    }
    return out;
  };
  const mk = async (name: string, phone: string, agentId: string | null, household: Pass[]) => {
    const [u] = await db.insert(app.appUsers).values({ name, phone, onboardedAt: ago(60 * 24 * 30), createdAt: ago(60 * 24 * 40) }).returning();
    if (agentId) await db.insert(desk.appAgentAssignments).values({ userId: u!.id, agentId, assignedBy: lead.id });
    return { u: u!, people: await people(u!.id, household) };
  };
  const sara = await mk("Sara Alqahtani", "+966500004127", faisal!.id, [
    { given: "Sara", surname: "Alqahtani", relation: "self", dob: "1990-03-12", sex: "F", number: "A11493107", expiry: "2030-05-01" },
    { given: "Ahmed", surname: "Alqahtani", relation: "spouse", dob: "1987-11-02", sex: "M", number: "A09981244", expiry: "2027-01-20" },
    { given: "Layan", surname: "Alqahtani", relation: "child", dob: "2015-06-30", sex: "F", number: "A22018377", expiry: "2029-09-14" },
    { given: "Fahad", surname: "Alqahtani", relation: "child", dob: "2018-01-17", sex: "M", number: "A22018378", expiry: "2029-09-14" },
  ]);
  const hessa = await mk("Hessa Alharbi", "+966500004128", faisal!.id, [
    { given: "Hessa", surname: "Alharbi", relation: "self", dob: "1988-07-24", sex: "F", number: "A31493107", expiry: "2029-01-15" },
    { given: "Maria", surname: "Santos", relation: "helper", dob: "1985-02-11", sex: "F", number: "P8812345A", expiry: "2026-12-30", nat: "PHL" },
  ]);
  const omarU = await mk("Omar Alharbi", "+966500004129", omar!.id, [{ given: "Omar", surname: "Alharbi", relation: "self", dob: "1992-09-09", sex: "M", number: "A55120931", expiry: "2031-03-03" }]);
  const nora = await mk("Nora Alshehri", "+966500004130", faisal!.id, [
    { given: "Nora", surname: "Alshehri", relation: "self", dob: "1995-04-21", sex: "F", number: "A70012345", expiry: "2032-02-02" },
    { given: "Reem", surname: "Alshehri", relation: "sibling", dob: "1998-12-01", sex: "F", number: "A70012346", expiry: "2032-02-02" },
  ]);
  const sultan = await mk("Sultan Aldosari", "+966500004131", null, [{ given: "Sultan", surname: "Aldosari", relation: "self", dob: "1984-05-05", sex: "M", number: "A43100221", expiry: "2028-08-08" }]);
  const khalid = await mk("Khalid Alharbi", "+966500004132", omar!.id, [{ given: "Khalid", surname: "Alharbi", relation: "self", dob: "1979-10-10", sex: "M", number: "A20011223", expiry: "2030-10-10" }]);
  const lama = await mk("Lama Alotaibi", "+966500004133", baderA!.id, [
    { given: "Lama", surname: "Alotaibi", relation: "self", dob: "1993-08-18", sex: "F", number: "A61177301", expiry: "2031-06-06" },
    { given: "Yousef", surname: "Alotaibi", relation: "spouse", dob: "1990-01-01", sex: "M", number: "A61177302", expiry: "2031-06-06" },
  ]);
  const spam = await mk("Visa Deals", "+966500004134", null, [{ given: "Visa", surname: "Deals", relation: "self", dob: "1990-01-01", sex: "M", number: "A99999999", expiry: "2030-01-01" }]);

  /* ── orders ── */
  let seq = 0;
  type Seg = { carrier: string; carrierName: string; flight: string; from: string; to: string; depart: string; arrive: string; departTz?: string; arriveTz?: string; dur: number; direction?: string; status?: string; gate?: string; terminal?: string };
  const order = async (o: { who: { u: typeof sara.u; people: string[] }; travellers?: string[]; kind?: string; summary: string; city: string; country: string; start: string; end?: string; segs: Seg[];
    lines: { label: string; amount: number; kind: string }[]; status: string; createdMin: number; method?: string; label?: string; instalments?: number; payStatus?: string; refSuffix?: string; deskState?: Record<string, unknown>; agent?: { ops: string; name: string }; tripStatus?: string }) => {
    seq += 1;
    const travellerIds = o.travellers ?? o.who.people;
    const [trip] = await db.insert(app.appTrips).values({ ownerId: o.who.u.id, city: o.city, country: o.country, startDate: o.start, endDate: o.end ?? null, travellerIds, status: o.tripStatus ?? "planning",
      ...(o.agent && o.deskState?.pnr ? { bookingRef: String(o.deskState.pnr), confirmedByName: o.agent.name, confirmedByOpsUserId: o.agent.ops } : {}) }).returning();
    for (const [i, s] of o.segs.entries()) {
      await db.insert(app.appSegments).values({ tripId: trip!.id, direction: s.direction ?? (i === 0 ? "out" : "back"), sort: i, carrier: s.carrier, carrierName: s.carrierName, flightNumber: s.flight, fromAirport: s.from, toAirport: s.to,
        departLocal: s.depart, departTz: s.departTz ?? "Asia/Riyadh", arriveLocal: s.arrive, arriveTz: s.arriveTz ?? "Asia/Riyadh", durationMin: s.dur, baggage: "1 × 23 kg each", status: s.status ?? "scheduled", gate: s.gate ?? null, terminal: s.terminal ?? null,
        statusSource: s.status && s.status !== "scheduled" ? "Saudia ops email" : null, updatedAt: s.status && s.status !== "scheduled" ? ago(6) : new Date(), pnr: (o.deskState?.pnr as string) ?? null });
    }
    const total = o.lines.reduce((s, l) => s + l.amount, 0);
    const [r] = await db.insert(app.appRequests).values({ ownerId: o.who.u.id, kind: o.kind ?? "flight", status: o.status, summary: o.summary, travellerIds, tripId: trip!.id, createdAt: ago(o.createdMin), updatedAt: ago(Math.max(0, o.createdMin - 1)),
      details: { offer: { route: `${o.segs[0]!.from} → ${o.segs[0]!.to}`, fare: "Economy Saver", bags: "1 × 23 kg" }, ...(o.deskState ? { desk: o.deskState } : {}) }, agentOpsUserId: o.agent?.ops ?? null, agentName: o.agent?.name ?? null }).returning();
    const [q] = await db.insert(app.appQuotes).values({ requestId: r!.id, lines: o.lines, total, cancellation: "Free to cancel for 24 hours. After that, SAR 400 per person.", status: "accepted", createdAt: ago(o.createdMin + 2) }).returning();
    const [p] = await db.insert(app.appPayments).values({ ownerId: o.who.u.id, requestId: r!.id, quoteId: q!.id, method: o.method ?? "card", status: o.payStatus ?? "authorized", amount: total, label: o.label ?? "Visa ending 41", instalments: o.instalments ?? 1,
      provider: o.method === "tabby" ? "tabby" : o.method === "tamara" ? "tamara" : "mock", providerRef: `mf_seed_${o.refSuffix ?? ""}${seq}_${NOW.toString(36)}`, idempotencyKey: `seed:${seq}:${NOW}`, createdAt: ago(o.createdMin) }).returning();
    await db.insert(app.appMessages).values({ threadKind: "request", threadId: r!.id, authorKind: "mada", body: "Sent to Mada. We check every name against the passports, then book.", createdAt: ago(o.createdMin) });
    return { r: r!, p: p!, trip: trip! };
  };
  const ist = (dIn: number, dBack: number): Seg[] => [
    { carrier: "SV", carrierName: "Saudia", flight: "SV263", from: "RUH", to: "IST", depart: `${day(dIn)} 09:40:00`, arrive: `${day(dIn)} 13:55:00`, arriveTz: "Europe/Istanbul", dur: 255, terminal: "Terminal 3" },
    { carrier: "SV", carrierName: "Saudia", flight: "SV264", from: "IST", to: "RUH", depart: `${day(dBack)} 15:30:00`, departTz: "Europe/Istanbul", arrive: `${day(dBack)} 19:35:00`, dur: 245 },
  ];
  await order({ who: sara, summary: "Riyadh to Istanbul, 4 travellers", city: "Istanbul", country: "Türkiye", start: day(34), end: day(40), segs: ist(34, 40), status: "with_agent", createdMin: 2,
    lines: [{ label: "Flights · 2 adults, 2 children", amount: H(6980), kind: "flight" }, { label: "Rooms near Galata Tower · 6 nights", amount: H(5880), kind: "stay" }, { label: "Airport pickup", amount: H(240), kind: "pickup" }] });
  await order({ who: hessa, summary: "Jeddah to Dubai with Maria", city: "Dubai", country: "UAE", start: day(12), end: day(16),
    segs: [{ carrier: "EK", carrierName: "Emirates", flight: "EK804", from: "JED", to: "DXB", depart: `${day(12)} 16:25:00`, arrive: `${day(12)} 20:25:00`, arriveTz: "Asia/Dubai", dur: 180 }],
    status: "with_agent", createdMin: 7, method: "tabby", label: "Tabby · 4 payments", instalments: 4, lines: [{ label: "Flights · 2 adults", amount: H(3420), kind: "flight" }] });
  await order({ who: nora, summary: "Riyadh to London, 2 travellers", city: "London", country: "UK", start: day(21), end: day(28),
    segs: [{ carrier: "SV", carrierName: "Saudia", flight: "SV119", from: "RUH", to: "LHR", depart: `${day(21)} 08:50:00`, arrive: `${day(21)} 13:00:00`, arriveTz: "Europe/London", dur: 430 }],
    status: "with_agent", createdMin: 11, lines: [{ label: "Flights · 2 adults", amount: H(7340), kind: "flight" }],
    deskState: { heldAt: ago(5).toISOString(), heldBy: counter.id, heldPnr: "LDN7QZ" }, agent: { ops: counter.id, name: "Faisal" } });
  await order({ who: khalid, summary: "Dammam to Cairo", city: "Cairo", country: "Egypt", start: day(9),
    segs: [{ carrier: "MS", carrierName: "EgyptAir", flight: "MS662", from: "DMM", to: "CAI", depart: `${day(9)} 02:10:00`, arrive: `${day(9)} 04:20:00`, arriveTz: "Africa/Cairo", dur: 190 }],
    status: "with_agent", createdMin: 22, payStatus: "failed", refSuffix: "fail_", lines: [{ label: "Flight · 1 adult", amount: H(1890), kind: "flight" }],
    deskState: { heldAt: ago(16).toISOString(), heldBy: desk1.id, heldPnr: "CAI2MX" }, agent: { ops: desk1.id, name: "Noura" } });
  await order({ who: omarU, summary: "Riyadh to Baku", city: "Baku", country: "Azerbaijan", start: day(18),
    segs: [{ carrier: "J2", carrierName: "AZAL", flight: "J2184", from: "RUH", to: "GYD", depart: `${day(18)} 11:20:00`, arrive: `${day(18)} 15:05:00`, arriveTz: "Asia/Baku", dur: 165 }],
    status: "needs_answer", createdMin: 40, lines: [{ label: "Flight · 1 adult", amount: H(2140), kind: "flight" }], agent: { ops: desk1.id, name: "Noura" },
    deskState: { question: { text: "Your passport says OMAR S. ALHARBI. Shall I book the ticket in that exact name?", choices: ["Yes", "Use OMAR ALHARBI"], askedAt: ago(30).toISOString(), askedBy: desk1.id, answer: null, answeredAt: null } } });
  await order({ who: lama, summary: "Riyadh to Kuala Lumpur, 2 travellers", city: "Kuala Lumpur", country: "Malaysia", start: day(45),
    segs: [{ carrier: "SV", carrierName: "Saudia", flight: "SV856", from: "RUH", to: "KUL", depart: `${day(45)} 01:15:00`, arrive: `${day(45)} 14:35:00`, arriveTz: "Asia/Kuala_Lumpur", dur: 560 }],
    status: "quoted", createdMin: 55, payStatus: "voided", lines: [{ label: "Flights · 2 adults", amount: H(8360), kind: "flight" }, { label: "The airline changed the price at booking.", amount: H(420), kind: "other" }],
    agent: { ops: bader.id, name: "Bader" }, deskState: { priceChange: { from: H(8360), to: H(8780), at: ago(20).toISOString(), reason: "Saver fare sold out" } } });
  const issued = await order({ who: sultan, summary: "Riyadh to Jeddah, return", city: "Jeddah", country: "Saudi Arabia", start: day(3), end: day(5), tripStatus: "booked",
    segs: [{ carrier: "F3", carrierName: "flyadeal", flight: "F3117", from: "RUH", to: "JED", depart: `${day(3)} 07:05:00`, arrive: `${day(3)} 08:55:00`, dur: 110 }, { carrier: "F3", carrierName: "flyadeal", flight: "F3118", from: "JED", to: "RUH", depart: `${day(5)} 21:00:00`, arrive: `${day(5)} 22:45:00`, dur: 105 }],
    status: "confirmed", createdMin: 60 * 26, payStatus: "captured", lines: [{ label: "Flights · 1 adult", amount: H(890), kind: "flight" }], agent: { ops: counter.id, name: "Faisal" },
    deskState: { heldAt: ago(60 * 26 - 3).toISOString(), issuedAt: ago(60 * 26 - 4).toISOString(), issuedBy: counter.id, pnr: "JED4KT", tickets: ["0651234567801"] } });
  await order({ who: hessa, summary: "Riyadh to Doha", city: "Doha", country: "Qatar", start: day(6), travellers: [hessa.people[0]!],
    segs: [{ carrier: "QR", carrierName: "Qatar Airways", flight: "QR1171", from: "RUH", to: "DOH", depart: `${day(6)} 10:30:00`, arrive: `${day(6)} 12:00:00`, dur: 90 }],
    status: "cancelled", createdMin: 60 * 30, payStatus: "voided", lines: [{ label: "Flight · 1 adult", amount: H(980), kind: "flight" }], agent: { ops: desk1.id, name: "Noura" },
    deskState: { failedAt: ago(60 * 29).toISOString(), failReason: "Fare class closed at issue; no seats left on QR1171" } });

  /* ── requests ── */
  const req = async (who: { u: typeof sara.u; people: string[] }, kind: string, status: string, summary: string, createdMin: number, extra: Partial<typeof app.appRequests.$inferInsert> = {}) => {
    const [r] = await db.insert(app.appRequests).values({ ownerId: who.u.id, kind, status, summary, travellerIds: who.people, createdAt: ago(createdMin), updatedAt: ago(Math.max(0, createdMin - 1)), ...extra }).returning();
    return r!;
  };
  const visa = await req(sara, "visa", "sent", "Schengen visas for Sara's family", 30, { promisedBy: new Date(NOW + 90 * 60_000), details: { country: "France", travel: `${day(34)} to ${day(40)}`, appointment: "VFS Riyadh", purpose: "Tourism" } });
  await db.insert(app.appMessages).values({ threadKind: "request", threadId: visa.id, authorKind: "user", authorUserId: sara.u.id, authorName: "Sara", body: "We need visas for France in the spring break. Ahmed's passport is new.", createdAt: ago(30) });
  await req(hessa, "umrah", "reviewing", "Umrah in Ramadan for 2", 60 * 3, { travellerIds: hessa.people, details: { dates: "Last 10 nights", hotel: "Walking distance to the Haram", from: "Jeddah" } });
  const car = await req(nora, "car", "quoted", "A car with driver in London, 3 days", 60 * 5, { agentOpsUserId: counter.id, agentName: "Faisal", details: { city: "London", days: 3 } });
  await db.insert(app.appQuotes).values({ requestId: car.id, lines: [{ label: "Mercedes V-Class with driver · 3 days", amount: H(4200), kind: "service" }], total: H(4200), status: "open", createdByOpsUserId: counter.id, expiresAt: new Date(NOW + 20 * 3600_000) });
  await req(lama, "restaurant", "with_agent", "Dinner for 2 at Nobu Kuala Lumpur", 60 * 8, { agentOpsUserId: bader.id, agentName: "Bader", details: { date: day(46), time: "20:30", guests: 2 } });
  await req(nora, "destination", "sent", "Plan a trip to Tbilisi", 9, { promisedBy: new Date(NOW + 110 * 60_000),
    details: { place: { id: "plc_tbilisi", name: "Tbilisi", country: "Georgia", airports: ["TBS", "KUT"] }, dates: "May, 5 nights", travellers: 2, message: "Hi, we'd like Tbilisi in May for 5 nights. Old town, and a day trip to Kazbegi." } });
  await req(sultan, "general", "done", "Extra bag on the Jeddah trip", 60 * 30, { agentOpsUserId: counter.id, agentName: "Faisal" });

  /* ── chats ── */
  const chat = async (who: { u: typeof sara.u }, first: string, msgs: { a: "user" | "agent" | "mada"; body: string; min: number; ops?: string; name?: string }[]) => {
    const threadId = crypto.randomUUID();
    for (const m of msgs) await db.insert(app.appMessages).values({ threadKind: "support", threadId, authorKind: m.a, authorUserId: m.a === "user" ? who.u.id : null, authorOpsUserId: m.ops ?? null, authorName: m.a === "user" ? first : m.name ?? null, body: m.body, createdAt: ago(m.min) });
    return threadId;
  };
  await chat(omarU, "Omar", [{ a: "user", body: "My bag didn't arrive in Istanbul. The tag says TK 7731.", min: 4 }, { a: "mada", body: "We're on it. A person replies here within 10 minutes.", min: 4 }]);
  await chat(sultan, "Sultan", [{ a: "user", body: "Hi, I was charged twice for the Jeddah flight.", min: 14 }, { a: "user", body: "Both on my mada card ending 77.", min: 13 }]);
  await chat(hessa, "Hessa", [{ a: "user", body: "Can Maria sit next to me on the Dubai flight?", min: 50 }, { a: "agent", body: "Yes. I've asked Emirates to seat you together and will confirm the seat numbers here.", min: 47, ops: counter.id, name: "Faisal" }, { a: "user", body: "Thank you", min: 46 }]);
  await chat(nora, "Nora", [{ a: "user", body: "Is there a prayer room at Heathrow Terminal 3?", min: 2 }]);
  await db.insert(app.appMessages).values({ threadKind: "request", threadId: issued.r.id, authorKind: "agent", authorOpsUserId: counter.id, authorName: "Faisal", body: "You're booked. Booking JED4KT. Your tickets are in the Wallet.", createdAt: ago(60 * 26 - 4) });

  /* ── refunds ── */
  const refundFor = async (who: { u: typeof sara.u }, summary: string, amount: number, method: string, label: string, stage: string, createdMin: number, extra: Partial<typeof app.appRefunds.$inferInsert> = {}) => {
    seq += 1;
    const [r] = await db.insert(app.appRequests).values({ ownerId: who.u.id, kind: "cancel", status: stage === "requested" ? "sent" : "done", summary, createdAt: ago(createdMin) }).returning();
    const [p] = await db.insert(app.appPayments).values({ ownerId: who.u.id, requestId: r!.id, method, status: "captured", amount: amount * 2, label, instalments: method === "tabby" ? 4 : method === "tamara" ? 3 : 1, provider: method === "tabby" ? "tabby" : method === "tamara" ? "tamara" : "mock", providerRef: `mf_seed_rf${seq}_${NOW.toString(36)}`, idempotencyKey: `seed-rf:${seq}:${NOW}` }).returning();
    await db.insert(app.appRefunds).values({ paymentId: p!.id, amount, stage, createdAt: ago(createdMin), ...extra });
  };
  await refundFor(nora, "Cancel the London hotel, 2 nights", H(1960), "card", "Visa ending 41", "requested", 90, { reason: "Plans changed" });
  await refundFor(hessa, "Cancel the Dubai stay", H(2400), "tabby", "Tabby · 4 payments", "requested", 60 * 20, { reason: "Family emergency" });
  await refundFor(sultan, "Charged twice for F3117", H(890), "mada", "mada ending 77", "requested", 60 * 26, { reason: "Duplicate charge" });
  await refundFor(khalid, "Cancel Cairo pickup", H(180), "card", "Mastercard ending 09", "sent", 60 * 50, { destination: "credit", expectedBy: ago(60 * 49) });
  await refundFor(lama, "Change fee on the KL flight", H(400), "applepay", "Apple Pay", "rejected", 60 * 70, { reason: "The change fee is the airline's and isn't refundable after the change is made." });

  /* ── today's flights ── */
  const flying = async (who: { u: typeof sara.u; people: string[] }, s: Seg, city: string) => {
    const [trip] = await db.insert(app.appTrips).values({ ownerId: who.u.id, city, startDate: s.depart.slice(0, 10), travellerIds: who.people, status: "booked", bookingRef: "TDY" + (seq += 1) }).returning();
    await db.insert(app.appSegments).values({ tripId: trip!.id, direction: "out", carrier: s.carrier, carrierName: s.carrierName, flightNumber: s.flight, fromAirport: s.from, toAirport: s.to, departLocal: s.depart, departTz: s.departTz ?? "Asia/Riyadh",
      arriveLocal: s.arrive, arriveTz: s.arriveTz ?? "Asia/Riyadh", durationMin: s.dur, status: s.status ?? "scheduled", gate: s.gate ?? null, terminal: s.terminal ?? null, statusSource: s.status ? "Airline feed" : null, updatedAt: s.status ? ago(5) : new Date() });
  };
  // In the air now (the mock ADS-B feed has SVA263 over the Gulf of Aqaba).
  await flying(khalid, { carrier: "SV", carrierName: "Saudia", flight: "SV263", from: "RUH", to: "IST", depart: localAt(-90), arrive: localAt(165, "Europe/Istanbul"), arriveTz: "Europe/Istanbul", dur: 255, terminal: "Terminal 3", gate: "C4" }, "Istanbul");
  await flying(sara, { carrier: "XY", carrierName: "flynas", flight: "XY201", from: "RUH", to: "DXB", depart: localAt(150), arrive: localAt(275, "Asia/Dubai"), arriveTz: "Asia/Dubai", dur: 125, status: "cancelled", terminal: "Terminal 5" }, "Dubai");
  await flying(lama, { carrier: "XY", carrierName: "flynas", flight: "XY201", from: "RUH", to: "DXB", depart: localAt(150), arrive: localAt(275, "Asia/Dubai"), arriveTz: "Asia/Dubai", dur: 125, status: "cancelled", terminal: "Terminal 5" }, "Dubai");
  await flying(hessa, { carrier: "SV", carrierName: "Saudia", flight: "SV1021", from: "JED", to: "CAI", depart: localAt(200), arrive: localAt(330, "Africa/Cairo"), arriveTz: "Africa/Cairo", dur: 130, status: "delayed", gate: "B12", terminal: "North" }, "Cairo");
  await flying(nora, { carrier: "F3", carrierName: "flyadeal", flight: "F3123", from: "RUH", to: "JED", depart: localAt(260), arrive: localAt(370), dur: 110, gate: "A7" }, "Jeddah");

  /* ── moderation ── */
  const post = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
  await db.insert(desk.appDeskModeration).values([
    { kind: "tip", targetKind: "post", targetId: post(1), authorUserId: sara.u.id, snapshot: { city: "Istanbul", place: "Karaköy Güllüoğlu", text: "Go before 10 for the baklava still warm. Family room upstairs, and they have a prayer corner." }, createdAt: ago(35) },
    { kind: "tip", targetKind: "post", targetId: post(2), authorUserId: spam.u.id, snapshot: { city: "Dubai", place: "Visa in 1 hour", text: "Message me on WhatsApp for any visa in 1 hour, cheapest price guaranteed." }, createdAt: ago(80) },
    { kind: "report", targetKind: "user", targetId: spam.u.id, authorUserId: spam.u.id, reporterUserId: hessa.u.id, reason: "unsafe", note: "Asked for my passport photo in a private message", snapshot: { name: "Visa Deals", text: "Send me your passport photo and I'll check your visa for free." }, createdAt: ago(12) },
    { kind: "report", targetKind: "post", targetId: post(3), authorUserId: lama.u.id, reporterUserId: nora.u.id, reason: "other", note: "Wrong opening hours", snapshot: { city: "Kuala Lumpur", place: "Petronas Towers", text: "Skybridge is open every day until midnight." }, createdAt: ago(60 * 7) },
  ]);
  await db.insert(desk.appDeskBlocks).values({ userId: spam.u.id, reason: "Selling visas in tips and asking for passport photos", blockedBy: lead.id, createdAt: ago(60 * 3) }).onConflictDoNothing();
  // An escalation the night lead flagged.
  console.log("Desk demo data loaded: 4 agents, 8 travellers, 8 orders, 5 requests, 4 chats, 5 refunds, 5 flights today, 4 moderation items.");
}

main().then(() => client.end()).catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
