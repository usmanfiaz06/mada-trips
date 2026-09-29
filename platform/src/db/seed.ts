/**
 * npm run db:seed              → bootstrap + realistic demo data (for trying the platform)
 * npm run db:seed -- --bootstrap → only roles, partners, bank accounts and the three partner logins
 * Add --reset to wipe everything first.
 */
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { SYSTEM_ROLES } from "../lib/permissions";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
const client = postgres(url, { max: 1, prepare: false, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require" });
const db = drizzle(client, { schema });
const args = new Set(process.argv.slice(2));
const IS_PROD = !!process.env.VERCEL || process.env.NODE_ENV === "production";
const PASSWORD = process.env.SEED_PASSWORD ?? (IS_PROD ? "" : "Mada@2026");

const TZ_OFFSET = 3; // Riyadh is UTC+3 all year
const riyadhDay = (d: Date) => new Date(d.getTime() + TZ_OFFSET * 3600_000).toISOString().slice(0, 10);
const at = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(); d.setUTCHours(hour - TZ_OFFSET, minute, 0, 0); d.setUTCDate(d.getUTCDate() - daysAgo); return d;
};
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const sar = (n: number) => Math.round(n * 100);

async function main() {
  if (args.has("--reset")) {
    await db.execute(sql`DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events`);
    await db.execute(sql`TRUNCATE audit_events, attachments, remarks, settlement_cycles, bank_accounts, bsp_obligations, daily_closes, ledger_entries, expenses, approval_decisions, approval_requests, payments, bookings, clients, delegations, sessions, users, partners, roles, settings, counters RESTART IDENTITY CASCADE`);
    await db.execute(sql`CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_immutable()`);
    console.log("Wiped.");
  }
  if (IS_PROD && args.has("--reset")) throw new Error("Refusing to wipe a production database");
  if (IS_PROD && !args.has("--bootstrap")) throw new Error("Demo data is never loaded in production; use --bootstrap");
  const existing = await db.select().from(schema.users).limit(1);
  if (existing.length) { console.log("Already set up. Nothing to do."); return; }
  if (!PASSWORD) { console.log("Skipping first-time setup: set SEED_PASSWORD (the partners' first password) and redeploy."); return; }

  const roleRows = await db.insert(schema.roles).values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true }))).returning();
  const role = (k: string) => roleRows.find((r) => r.key === k)!.id;

  const [abdulaziz, bader, haneef] = await db.insert(schema.partners).values([
    { name: "Abdulaziz", nameAr: "عبدالعزيز", title: "Chairman · Managing Partner", titleAr: "رئيس مجلس الإدارة · شريك مدير", equityBps: 3333, sort: 1 },
    { name: "Bader", nameAr: "بدر", title: "CEO · Managing Partner", titleAr: "الرئيس التنفيذي · شريك مدير", equityBps: 3333, sort: 2 },
    { name: "Haneef", nameAr: "حنيف", title: "Board Member · Managing Partner", titleAr: "عضو مجلس الإدارة · شريك مدير", equityBps: 3334, sort: 3 },
  ]).returning();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = await db.insert(schema.users).values([
    { name: "Abdulaziz", email: "abdulaziz@madatrips.com", passwordHash: hash, roleId: role("chairman"), partnerId: abdulaziz.id, team: "management" },
    { name: "Bader Al Sulaiman", email: "bader@madatrips.com", passwordHash: hash, roleId: role("ceo"), partnerId: bader.id, team: "management" },
    { name: "Haneef", email: "haneef@madatrips.com", passwordHash: hash, roleId: role("director"), partnerId: haneef.id, team: "management" },
  ]).returning();
  const [uA, uB, uH] = users;

  const openingDate = riyadhDay(at(60, 12));
  await db.insert(schema.bankAccounts).values([
    { key: "retail", name: "Retail / B2C", bank: "Al Rajhi Bank", iban: "SA00 8000 0000 6080 1016 7519", openingBalance: 0, openingDate },
    { key: "corporate", name: "Corporate / B2B", bank: "Saudi National Bank", iban: "SA00 1000 0000 1234 5678 9012", openingBalance: 0, openingDate },
  ]);

  if (args.has("--bootstrap")) { console.log(`Bootstrap done. Partners sign in with password ${PASSWORD}; change it on first login.`); return; }

  /* ─────────── Demo data ─────────── */
  const staff = await db.insert(schema.users).values([
    { name: "Sara Al Qahtani", email: "sara@madatrips.com", passwordHash: hash, roleId: role("retail_agent"), team: "riyadh", phone: "+966 55 000 1122" },
    { name: "Ali Raza", email: "ali@madatrips.com", passwordHash: hash, roleId: role("corporate_agent"), team: "pakistan" },
    { name: "Fatima Noor", email: "fatima@madatrips.com", passwordHash: hash, roleId: role("corporate_agent"), team: "pakistan" },
  ]).returning();
  const [sara, ali, fatima] = staff;

  await db.insert(schema.delegations).values({ userId: sara.id, grantedBy: uB.id, scope: "retail", maxTicket: sar(8000), dailyCap: sar(40000), expiresAt: at(-60, 23), note: "Retail walk-ins during office hours" });

  // Initial IATA working-capital injection by Bader and startup costs.
  const openingInjection = sar(150000);
  await db.update(schema.bankAccounts).set({ openingBalance: openingInjection }).where(sql`key = 'corporate'`);
  await db.insert(schema.ledgerEntries).values([
    { partnerId: bader.id, type: "advance", amount: openingInjection, description: "Initial IATA working capital injection", entryDate: openingDate, createdBy: uA.id },
  ]);

  const clientRows = await db.insert(schema.clients).values([
    { name: "Al Noor Engineering", type: "contracted", contactPerson: "Khalid Al Harbi", email: "travel@alnoor.sa", phone: "+966 11 400 2200", creditLimit: sar(250000), paymentTermsDays: 30, contractRef: "CT-2026-004", createdBy: uA.id },
    { name: "Riyadh Medical Group", type: "contracted", contactPerson: "Dr. Mona Saleh", email: "admin@rmg.sa", creditLimit: sar(180000), paymentTermsDays: 30, contractRef: "CT-2026-007", createdBy: uA.id },
    { name: "Vision Events Co.", type: "contracted", contactPerson: "Faisal Otaibi", email: "ops@visionevents.sa", creditLimit: sar(120000), paymentTermsDays: 15, contractRef: "CT-2026-011", createdBy: uA.id },
    { name: "Gulf Horizon Trading", type: "noncontracted", contactPerson: "Omar Nasser", phone: "+966 50 777 1212", createdBy: uB.id },
    { name: "Sultan Al Dosari", type: "retail", phone: "+966 55 123 9876", createdBy: sara.id },
    { name: "Nora Al Shehri", type: "retail", phone: "+966 54 222 3344", createdBy: sara.id },
    { name: "Ahmed Hassan", type: "retail", phone: "+966 56 111 0099", createdBy: sara.id },
    { name: "Layla Mansour", type: "retail", phone: "+966 53 909 4411", createdBy: sara.id },
    { name: "Walk-in customer", type: "retail", createdBy: sara.id },
  ]).returning();
  const corp = clientRows.filter((c) => c.type === "contracted");
  const retail = clientRows.filter((c) => c.type === "retail");

  const routes = ["RUH → DXB", "RUH → CAI", "JED → IST", "RUH → LHR", "DMM → BAH", "RUH → KHI", "JED → KUL", "RUH → AMM", "RUH → CDG", "MED → IST"];
  const names = ["Mohammed Al Harbi", "Abdullah Saleh", "Reem Khalid", "Yousef Omar", "Hessa Nasser", "Tariq Aziz", "Maha Fahad", "Imran Qureshi", "Ahmad Zaki", "Dana Al Mutairi", "Salman Faris", "Lina Haddad"];
  let n = 10000, pn = 0;
  const ev: (typeof schema.auditEvents.$inferInsert)[] = [];

  for (let daysAgo = 44; daysAgo >= 0; daysAgo--) {
    const perDay = daysAgo === 0 ? 4 : 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < perDay; k++) {
      const isCorp = rnd() < 0.45;
      const service = rnd() < 0.72 ? "flight" : pick(["hotel", "visa", "package", "transport"]);
      const net = service === "flight" ? 900 + rnd() * 5200 : service === "hotel" ? 600 + rnd() * 3000 : service === "visa" ? 300 + rnd() * 400 : 2000 + rnd() * 9000;
      const marginPct = isCorp ? 0.04 + rnd() * 0.07 : 0.06 + rnd() * 0.12 - (rnd() < 0.05 ? 0.14 : 0);
      const sell = Math.round(net * (1 + marginPct));
      const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      const lastHour = daysAgo === 0 ? Math.max(9, Math.min(21, nowHour - 1)) : 21;
      const hour = Math.min(lastHour, 9 + Math.floor(rnd() * (lastHour - 8)));
      let created = at(daysAgo, hour, Math.floor(rnd() * 60));
      if (created > new Date()) created = new Date(Date.now() - (k + 1) * 17 * 60_000);
      const bdate = riyadhDay(created);
      const preparer = isCorp ? pick([ali, fatima]) : sara;
      const client = isCorp ? pick(corp) : pick(retail);
      const recent = daysAgo === 0 && k >= 2;
      const status = recent ? "pending_issue" : "issued";
      const issuer = !recent ? (isCorp || service === "flight" && sell > 8000 ? uB : service === "flight" ? sara : preparer) : null;
      const pax = pick(names);
      const ref = `S-${++n}`;
      const due = isCorp ? riyadhDay(at(daysAgo - client.paymentTermsDays, 12)) : null;
      const [b] = await db.insert(schema.bookings).values({
        ref, channel: isCorp ? "corporate" : "retail", account: isCorp ? "corporate" : "retail", serviceType: service, clientId: client.id,
        passengers: pax, paxCount: 1 + (rnd() < 0.2 ? 1 : 0), description: service === "flight" ? pick(routes) : service === "hotel" ? "Hotel · 3 nights" : service === "visa" ? "Schengen visa" : "Holiday package",
        supplier: service === "flight" ? pick(["Saudia", "flynas", "Emirates", "Qatar Airways", "Turkish Airlines"]) : pick(["Hotelbeds", "Expedia TAAP", "VFS"]),
        pnr: service === "flight" ? Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rnd() * 32)]).join("") : null,
        ticketNumbers: status === "issued" && service === "flight" ? `065-${Math.floor(1e9 + rnd() * 8e9)}` : null,
        travelDate: riyadhDay(at(daysAgo - 5 - Math.floor(rnd() * 30), 12)),
        netCost: sar(net), sellPrice: sar(sell), status, onCredit: isCorp, dueDate: due, businessDate: bdate,
        preparedBy: preparer.id, issuedBy: issuer?.id ?? null, issuedAt: issuer ? new Date(created.getTime() + 25 * 60_000) : null,
        issuedUnderDelegation: null, createdAt: created, updatedAt: created,
      }).returning();
      ev.push({ at: created, actorId: preparer.id, action: "booking.created", entityType: "booking", entityId: b.id, entityRef: ref, summary: `Created ${ref} · ${pax} · ${b.description}` });
      if (issuer) ev.push({ at: b.issuedAt!, actorId: issuer.id, action: "booking.issued", entityType: "booking", entityId: b.id, entityRef: ref, summary: `Issued ${ref}${b.ticketNumbers ? ` · ticket ${b.ticketNumbers}` : ""}` });

      // Retail pays on the spot; corporate pays on terms (older ones already paid by wire).
      const paid = !isCorp ? (rnd() < 0.94 ? sell : Math.round(sell * 0.5)) : daysAgo > 18 && rnd() < 0.75 ? sell : 0;
      if (paid > 0) {
        const payAt = isCorp ? at(Math.max(0, daysAgo - 12), 11) : created;
        const clearLag = isCorp ? 0 : 1 + Math.floor(rnd() * 2);
        const clearedOn = daysAgo - clearLag >= 1 ? riyadhDay(at(daysAgo - clearLag - (isCorp ? 12 : 0), 12)) : null;
        await db.insert(schema.payments).values({
          bookingId: b.id, clientId: client.id, account: b.account, method: isCorp ? "transfer" : pick(["mada", "mada", "card", "cash", "transfer"]),
          amount: sar(paid), collectedAt: payAt, businessDate: riyadhDay(payAt), clearedOn: clearedOn && clearedOn <= riyadhDay(new Date()) ? clearedOn : null,
          clearedBy: clearedOn ? uA.id : null, recordedBy: preparer.id, reference: isCorp ? `WT${Math.floor(rnd() * 1e8)}` : null, createdAt: payAt,
        });
        pn++;
      }
    }
  }

  // Expenses: startup costs paid personally (partner loans) and monthly overheads.
  const expRows: (typeof schema.expenses.$inferInsert)[] = [
    { ref: "EX-1001", category: "licences", description: "Commercial registration & MISA licence", justification: "Required to operate", amount: sar(18500), expenseDate: riyadhDay(at(58, 12)), paidBy: "partner", partnerId: abdulaziz.id, isStartup: true, status: "approved", submittedBy: uA.id },
    { ref: "EX-1002", category: "rent", description: "Office lease · first year advance", justification: "Riyadh branch lease", amount: sar(64000), expenseDate: riyadhDay(at(57, 12)), paidBy: "partner", partnerId: haneef.id, isStartup: true, status: "approved", submittedBy: uH.id },
    { ref: "EX-1003", category: "furnishing", description: "Office furniture & fit-out", justification: "Retail counter and desks", amount: sar(27300), expenseDate: riyadhDay(at(55, 12)), paidBy: "partner", partnerId: bader.id, isStartup: true, status: "approved", submittedBy: uB.id },
    { ref: "EX-1004", category: "salaries", description: "Salaries · Riyadh & Pakistan team", justification: "Monthly payroll", amount: sar(21500), expenseDate: riyadhDay(at(36, 12)), paidBy: "retail", status: "approved", submittedBy: uA.id },
    { ref: "EX-1005", category: "utilities", description: "Electricity, water & internet", justification: "Monthly utilities", amount: sar(1850), expenseDate: riyadhDay(at(30, 12)), paidBy: "retail", status: "approved", submittedBy: sara.id },
    { ref: "EX-1006", category: "systems", description: "GDS & booking system licence", justification: "Monthly licence", amount: sar(4200), expenseDate: riyadhDay(at(20, 12)), paidBy: "corporate", status: "approved", submittedBy: uB.id },
    { ref: "EX-1007", category: "communications", description: "Mobile lines & WhatsApp Business", justification: "Team communications", amount: sar(950), expenseDate: riyadhDay(at(12, 12)), paidBy: "retail", status: "approved", submittedBy: uA.id },
    { ref: "EX-1008", category: "salaries", description: "Salaries · Riyadh & Pakistan team", justification: "Monthly payroll", amount: sar(21500), expenseDate: riyadhDay(at(3, 12)), paidBy: "retail", status: "approved", submittedBy: uA.id },
    { ref: "EX-1009", category: "marketing", description: "Instagram campaign · Umrah season", justification: "Retail lead generation", amount: sar(3500), expenseDate: riyadhDay(at(1, 12)), paidBy: "partner", partnerId: bader.id, status: "pending", submittedBy: uB.id },
    { ref: "EX-1010", category: "office", description: "Printer toner & stationery", justification: "Counter supplies", amount: sar(420), expenseDate: riyadhDay(at(0, 12)), paidBy: "retail", status: "pending", submittedBy: sara.id },
  ];
  const ex = await db.insert(schema.expenses).values(expRows).returning();
  for (const e of ex) {
    if (e.paidBy === "partner" && e.status === "approved") {
      await db.insert(schema.ledgerEntries).values({ partnerId: e.partnerId!, type: e.isStartup ? "advance" : "expense", amount: e.amount, description: `${e.ref} · ${e.description}`, sourceType: "expense", sourceId: e.id, entryDate: e.expenseDate, createdBy: uA.id });
    }
    ev.push({ at: new Date(`${e.expenseDate}T09:00:00Z`), actorId: e.submittedBy, action: "expense.submitted", entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `Submitted ${e.ref} · ${e.description}` });
    if (e.status === "approved") ev.push({ at: new Date(`${e.expenseDate}T14:00:00Z`), actorId: e.submittedBy === uA.id ? uB.id : uA.id, action: "expense.approved", entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `${e.ref} approved: ${e.description}` });
  }
  await db.insert(schema.counters).values([{ key: "EX", value: 1010 }, { key: "S", value: n }]);

  // Pending approvals so the inbox is alive: expenses + a credit request for a non-contracted client.
  let ap = 1000;
  for (const e of ex.filter((x) => x.status === "pending")) {
    const [r] = await db.insert(schema.approvalRequests).values({
      ref: `AP-${++ap}`, kind: "expense", entityType: "expense", entityId: e.id, title: `${e.ref} · ${e.description}`, amount: e.amount,
      reason: e.justification, requestedBy: e.submittedBy, requiredApprovals: 1, approverPool: "permission:expenses.verify", rule: "1 verifier (never the person who submitted it)",
    }).returning();
    await db.update(schema.expenses).set({ approvalId: r.id }).where(sql`id = ${e.id}`);
  }
  const gulf = clientRows.find((c) => c.type === "noncontracted")!;
  const creditAmt = sar(14800);
  const [cb] = await db.insert(schema.bookings).values({
    ref: `S-${++n}`, channel: "corporate", account: "corporate", serviceType: "flight", clientId: gulf.id, passengers: "Omar Nasser + 3", paxCount: 4,
    description: "RUH → IST · business trip", supplier: "Turkish Airlines", pnr: "Q7K2MX", netCost: sar(13900), sellPrice: creditAmt, status: "awaiting_credit", onCredit: true,
    dueDate: riyadhDay(at(-14, 12)), businessDate: riyadhDay(new Date()), preparedBy: ali.id, createdAt: new Date(Date.now() - 150 * 60_000), updatedAt: new Date(Date.now() - 150 * 60_000),
  }).returning();
  const [cr] = await db.insert(schema.approvalRequests).values({
    ref: `AP-${++ap}`, kind: "credit", entityType: "booking", entityId: cb.id, title: `Credit for Gulf Horizon Trading · ${cb.ref}`, amount: creditAmt,
    reason: "New corporate lead, 4 pax to Istanbul. Wants 14 days to pay by wire.", requestedBy: ali.id, requiredApprovals: 2, approverPool: "directors",
    rule: "Up to SAR 20,000.00: any 2 directors approve", createdAt: new Date(Date.now() - 148 * 60_000),
  }).returning();
  await db.insert(schema.approvalDecisions).values({ requestId: cr.id, userId: uB.id, decision: "approve", remark: "Known contact, fine for 14 days.", createdAt: new Date(Date.now() - 90 * 60_000) });
  await db.update(schema.bookings).set({ creditApprovalId: cr.id }).where(sql`id = ${cb.id}`);
  await db.update(schema.counters).set({ value: n }).where(sql`key = 'S'`);
  await db.insert(schema.counters).values({ key: "AP", value: ap });
  ev.push({ at: new Date(Date.now() - 148 * 60_000), actorId: ali.id, action: "approval.requested", entityType: "approval", entityId: cr.id, entityRef: cr.ref, summary: `Requested credit approval: ${cr.title}` });
  ev.push({ at: new Date(Date.now() - 90 * 60_000), actorId: uB.id, action: "approval.approved_vote", entityType: "approval", entityId: cr.id, entityRef: cr.ref, summary: `Approved ${cr.ref}: ${cr.title} · "Known contact, fine for 14 days."` });

  // BSP remittances: paid ones in the past, upcoming ones ahead.
  await db.insert(schema.bspObligations).values([
    { period: "BSP · 1st half, last month", dueDate: riyadhDay(at(32, 12)), amount: sar(61200), status: "paid", paidOn: riyadhDay(at(32, 12)), createdBy: uB.id },
    { period: "BSP · 2nd half, last month", dueDate: riyadhDay(at(17, 12)), amount: sar(74800), status: "paid", paidOn: riyadhDay(at(17, 12)), createdBy: uB.id },
    { period: "BSP · 1st half, this month", dueDate: riyadhDay(at(-3, 12)), amount: sar(68400), status: "upcoming", createdBy: uB.id },
    { period: "BSP · 2nd half, this month", dueDate: riyadhDay(at(-18, 12)), amount: sar(52300), status: "upcoming", createdBy: uB.id },
  ]);

  await db.insert(schema.settings).values([{ key: "iataReserveHeld", value: sar(110000) }, { key: "iataBuffer", value: sar(20000) }]);

  // Daily closes for the past week.
  for (let d = 7; d >= 1; d--) {
    const bd = riyadhDay(at(d, 12));
    for (const [team, who] of [["riyadh", sara], ["pakistan", ali]] as const) {
      const late = d === 4 && team === "pakistan";
      await db.insert(schema.dailyCloses).values({
        businessDate: bd, team, status: d > 1 ? "verified" : "submitted", cashExpected: team === "riyadh" ? sar(1200 + d * 90) : 0, cashCounted: team === "riyadh" ? sar(1200 + d * 90 - (d === 3 ? 50 : 0)) : 0,
        snapshot: { note: "seed" }, submittedBy: who.id, submittedAt: at(d, late ? 22 : 21, late ? 25 : 48), lateSubmission: late,
        verifiedBy: d > 1 ? uA.id : null, verifiedAt: d > 1 ? at(d - 1, 10) : null, verifyNote: d === 3 && team === "riyadh" ? "SAR 50 short, counter float corrected next day" : null,
      });
      ev.push({ at: at(d, late ? 22 : 21, late ? 25 : 48), actorId: who.id, action: "close.submitted", entityType: "close", entityRef: `${bd} · ${team}`, summary: `Submitted ${team === "riyadh" ? "Riyadh" : "Pakistan"} daily close for ${bd}${late ? " (late)" : ""}` });
    }
  }

  ev.push({ at: at(59, 10), actorId: uA.id, action: "user.created", entityType: "user", entityId: sara.id, entityRef: sara.name, summary: `Added Sara Al Qahtani as Retail agent (Riyadh)` });
  ev.push({ at: at(45, 11), actorId: uB.id, action: "delegation.granted", entityType: "user", entityId: sara.id, entityRef: sara.name, summary: `Granted Sara Al Qahtani retail issuing up to SAR 8,000 per ticket` });
  ev.sort((a, b) => a.at!.getTime() - b.at!.getTime());
  for (let i = 0; i < ev.length; i += 200) await db.insert(schema.auditEvents).values(ev.slice(i, i + 200));

  console.log(`Demo ready: ${n - 10000} sales, ${pn} payments, ${ex.length} expenses. Password for every demo user: ${PASSWORD}`);
}

main().then(() => client.end()).catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
