import "server-only";
import { headers } from "next/headers";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { audit } from "./audit";
import { nextRef } from "./refs";
import { sar } from "./money";
import { addDays, businessDate } from "./dates";
import { getSettings } from "./settings";
import { clientExposure } from "./finance";
import { createApproval } from "./approvals";

/* ───────── Sign-in links ───────── */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** This deployment's address as the browser sees it (madatrips.sa in production, localhost in development). */
export async function siteOrigin() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "madatrips.sa").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
export const workspaceLink = (origin: string, slug: string | null) => `${origin}/corporate/${slug ?? "login"}`;

/** A short, unused link name from the company name: "KEO International Consultants" → "keo". */
export async function freeSlug(q: Tx | typeof db, name: string) {
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean);
  const candidates = [words[0], words.slice(0, 2).join("-"), words.slice(0, 3).join("-")].filter((x): x is string => !!x && x.length >= 2 && x !== "login");
  if (!candidates.length) candidates.push("client");
  for (const c of [...candidates, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${candidates[0]}-${n}`)]) {
    const slug = c.slice(0, 40).replace(/-+$/, "");
    if (!SLUG_RE.test(slug)) continue;
    const [taken] = await q.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.portalSlug, slug));
    if (!taken) return slug;
  }
  return `client-${Date.now().toString(36)}`;
}

/* ───────── Catalog and prices ───────── */

export const LEASE_TERMS = [12, 24, 36, 48] as const;

export const SERVICES = [
  { key: "lease", en: "Long-term lease", ar: "تأجير طويل الأجل" },
  { key: "daily", en: "Daily rental", ar: "تأجير يومي" },
  { key: "chauffeur", en: "Chauffeur", ar: "سيارة مع سائق" },
  { key: "travel", en: "Flights and hotels", ar: "الطيران والفنادق" },
  { key: "visa", en: "Visas", ar: "التأشيرات" },
  { key: "manpower", en: "Manpower", ar: "القوى العاملة" },
] as const;
export type ServiceKey = (typeof SERVICES)[number]["key"];
export type ServiceMode = "price" | "quote";

export type Vehicle = typeof schema.vehicles.$inferSelect;
export type Client = typeof schema.clients.$inferSelect;
type TermMap = Partial<Record<string, number>>;

export const vehicleName = (v: Pick<Vehicle, "make" | "model">) => `${v.make} ${v.model}`;
export const vehicleShort = (v: Pick<Vehicle, "model" | "trim">) => [v.model, v.trim].filter(Boolean).join(" ");

/** Supplier cost per month for a term, or null when we don't have one. */
export const costFor = (v: Vehicle, term: number) => (v.cost as TermMap)[String(term)] ?? null;

/**
 * What this client pays per month, before VAT. An agreed price for this client wins; then markup on supplier cost;
 * then the catalog list price. Null means "price on request".
 */
export function priceFor(c: Pick<Client, "portalMarkupBps">, v: Vehicle, term: number, agreed?: Map<string, number>) {
  if (v.onRequest) return null;
  const own = agreed?.get(`${v.id}:${term}`);
  if (own !== undefined) return own;
  const cost = costFor(v, term);
  if (c.portalMarkupBps !== null && cost !== null) return Math.round(cost * (1 + c.portalMarkupBps / 10_000));
  return (v.price as TermMap)[String(term)] ?? null;
}

export async function agreedPrices(clientId: string, q: Tx | typeof db = db) {
  const rows = await q.select().from(schema.clientVehiclePrices).where(eq(schema.clientVehiclePrices.clientId, clientId));
  return new Map(rows.map((r) => [`${r.vehicleId}:${r.term}`, r.price]));
}

export async function catalog(q: Tx | typeof db = db) {
  return q.select().from(schema.vehicles).where(eq(schema.vehicles.active, true)).orderBy(asc(schema.vehicles.sort));
}

/** The client's own view of the catalog: only the vehicles and terms Mada chose for them, at their prices. Never costs. */
export async function clientCatalog(c: Client) {
  const [all, agreed] = await Promise.all([catalog(), agreedPrices(c.id)]);
  const terms = [...c.portalTerms].filter((t) => (LEASE_TERMS as readonly number[]).includes(t)).sort((a, b) => a - b);
  return {
    terms,
    vehicles: all.filter((v) => !c.portalHiddenVehicles.includes(v.key)).map((v) => ({
      id: v.id, key: v.key, make: v.make, model: v.model, trim: v.trim, category: v.category, year: v.year,
      engine: v.engine, drive: v.drive, fuel: v.fuel, seats: v.seats, image: v.image, onRequest: v.onRequest,
      prices: Object.fromEntries(terms.map((t) => [t, priceFor(c, v, t, agreed)])) as Record<number, number | null>,
    })),
  };
}

/* ───────── Names a client must never see ───────── */

/** Hidden from every client workspace from the moment it opens. Staff never appear by name to clients anyway ("Mada team"). */
export const ALWAYS_HIDDEN = ["Haneef", "Abdulaziz"];

const ARABIC: Record<string, string> = { haneef: "حنيف", hanif: "حنيف", abdulaziz: "عبد ?العزيز", abdelaziz: "عبد ?العزيز", bader: "بدر" };

/** Matches each hidden name loosely: case, spaces or hyphens between letters, common spellings, and Arabic. */
export function hiddenNameRegex(names: string[]) {
  const parts: string[] = [];
  for (const n of new Set([...ALWAYS_HIDDEN, ...names])) {
    const k = n.toLowerCase().replace(/[^a-z]/g, "");
    if (k.length < 2) continue;
    const variants = new Set([k]);
    if (k === "haneef") { variants.add("hanif"); variants.add("haneif"); }
    if (k.startsWith("abdul")) { variants.add(`abdel${k.slice(5)}`); variants.add(`abd${k.slice(5)}`); }
    for (const v of variants) {
      parts.push(v.split("").join("[\\s\\-_.]?"));
      if (ARABIC[v]) parts.push(ARABIC[v]);
    }
    // A name typed in Arabic in the list matches itself.
    if (/[؀-ۿ]/.test(n)) parts.push(n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  return parts.length ? new RegExp(`(${parts.join("|")})`, "gi") : null;
}

/** Replace hidden names everywhere inside a value bound for a client's screen. */
export function scrub<T>(value: T, names: string[]): T {
  const re = hiddenNameRegex(names);
  if (!re) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, "Mada team");
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/* ───────── Requests ───────── */

export type Line = { vehicleId: string; key: string; name: string; qty: number; unitPrice: number; unitCost: number | null };
export type Delivery = { place: "office" | "home" | "site" | "collect"; address: string; city: string; contact: string; window: "morning" | "evening" };

export const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "Waiting for your approver",
  submitted: "Sent to Mada",
  confirmed: "Order confirmed",
  delivering: "Out for delivery",
  active: "On the road",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};
export const STAFF_STATUS_LABEL: Record<string, string> = { ...STATUS_LABEL, awaiting_approval: "With client approver", submitted: "New" };
export const TRACK = ["awaiting_approval", "submitted", "confirmed", "delivering", "active", "completed"] as const;

export const linesText = (lines: Line[]) => lines.map((l) => `${l.name} × ${l.qty}`).join(", ");

export async function postMessage(tx: Tx | typeof db, m: { clientId: string; requestId?: string | null; authorId: string | null; side: "client" | "mada" | "system"; kind?: string; body: string }) {
  const [row] = await tx.insert(schema.portalMessages).values({
    clientId: m.clientId, requestId: m.requestId ?? null, authorId: m.authorId, side: m.side, kind: m.kind ?? "message", body: m.body.slice(0, 4000),
  }).returning();
  // Anything Mada says closes what the client was waiting on.
  if (m.side !== "client") {
    await tx.update(schema.portalMessages).set({ handledAt: new Date() })
      .where(and(eq(schema.portalMessages.clientId, m.clientId), eq(schema.portalMessages.side, "client"), sql`${schema.portalMessages.handledAt} IS NULL`));
  }
  return row;
}

/** Supplier cost per month for the plan, from the catalog now. Null when any line has no cost yet. */
export async function refreshCosts(tx: Tx, lines: Line[], term: number) {
  const ids = lines.map((l) => l.vehicleId);
  const rows = ids.length ? await tx.select().from(schema.vehicles).where(inArray(schema.vehicles.id, ids)) : [];
  const byId = new Map(rows.map((v) => [v.id, v]));
  let total = 0;
  const missing: string[] = [];
  const out = lines.map((l) => {
    const v = byId.get(l.vehicleId);
    const c = v ? costFor(v, term) : null;
    if (c === null) missing.push(l.name); else total += c * l.qty;
    return { ...l, unitCost: c };
  });
  return { lines: out, monthlyCost: missing.length ? null : total, missing };
}

/**
 * Raise the next monthly bill for a running lease as a corporate sale, through the same credit rules as any other
 * sale: inside a contracted client's limit it goes straight to issuing; otherwise directors approve the credit.
 */
export async function billNextMonth(tx: Tx, requestId: string, actorId: string) {
  const [r] = await tx.select().from(schema.portalRequests).where(eq(schema.portalRequests.id, requestId)).for("update");
  if (!r) throw new Error("Request not found");
  if (r.status !== "active") throw new Error("Bill a lease once the cars are delivered");
  if (r.monthsBilled >= r.term) throw new Error("Every month of this lease is already billed");
  const [client] = await tx.select().from(schema.clients).where(eq(schema.clients.id, r.clientId)).for("update");
  const lines = r.lines as Line[];
  if (!r.monthlyCost) throw new Error("This request has no supplier cost. Add it in the catalog and confirm again");

  const s = await getSettings(tx);
  const month = r.monthsBilled + 1;
  const vat = Math.round(r.monthly * 0.15);
  const sellPrice = r.monthly + vat;
  const netCost = r.monthlyCost + Math.round(r.monthlyCost * 0.15);
  const bdate = businessDate(new Date(), s.closeHour);
  const exposure = await clientExposure(tx, client.id);
  const needsCredit = client.type !== "contracted" || exposure + sellPrice > client.creditLimit;
  const [{ rate }] = await tx.select({ rate: schema.users.commissionBps }).from(schema.users).where(eq(schema.users.id, actorId));
  const suppliers = [...new Set((await tx.select({ s: schema.vehicles.supplier }).from(schema.vehicles).where(inArray(schema.vehicles.id, lines.map((l) => l.vehicleId)))).map((x) => x.s).filter(Boolean))];

  const ref = await nextRef(tx, "S", 10000);
  const [b] = await tx.insert(schema.bookings).values({
    ref, channel: "corporate", account: "corporate", serviceType: "transport", clientId: client.id,
    passengers: client.name, paxCount: 1, travellers: [],
    description: `Lease ${r.ref} · month ${month} of ${r.term} · ${linesText(lines)}`.slice(0, 200),
    supplier: suppliers.join(", ") || null, supplierReviewed: true, commissionBps: rate,
    netCost, sellPrice, vatAmount: vat, status: needsCredit ? "awaiting_credit" : "pending_issue",
    onCredit: true, dueDate: addDays(bdate, client.paymentTermsDays || 30), businessDate: bdate, preparedBy: actorId,
    portalRequestId: r.id, portalMonth: month,
  }).returning();
  await tx.update(schema.portalRequests).set({ monthsBilled: month, status: month >= r.term ? "completed" : r.status, updatedAt: new Date() }).where(eq(schema.portalRequests.id, r.id));
  await audit(tx, { actorId, action: "booking.created", entityType: "booking", entityId: b.id, entityRef: ref,
    summary: `Billed ${r.ref} month ${month}/${r.term} as ${ref} · sell ${sar(sellPrice)} incl. VAT, margin ${sar(sellPrice - netCost)}` });

  let approvalRef: string | null = null;
  if (needsCredit) {
    const reason = client.type === "contracted"
      ? `Over contract limit: exposure ${sar(exposure)} + ${sar(sellPrice)} > limit ${sar(client.creditLimit)}`
      : `Corporate lease billed on credit for a client without a contract`;
    const req = await createApproval(tx, { kind: "credit", entityType: "booking", entityId: b.id, title: `Credit for ${client.name} · ${ref}`, amount: sellPrice, routeAmount: exposure + sellPrice, reason, requestedBy: actorId });
    await tx.update(schema.bookings).set({ creditApprovalId: req.id }).where(eq(schema.bookings.id, b.id));
    approvalRef = req.ref;
  }
  await postMessage(tx, { clientId: client.id, requestId: r.id, authorId: actorId, side: "system", kind: "status",
    body: `Invoice for month ${month} of ${r.term} is ready: SAR ${sar(sellPrice)} including VAT, due in ${client.paymentTermsDays || 30} days.` });
  return { booking: b, approvalRef };
}

/** People at Mada a client can be assigned to (never shown to the client by name if the name is hidden). */
export async function staffList() {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
    .where(and(eq(schema.users.active, true), sql`${schema.users.clientId} IS NULL`)).orderBy(asc(schema.users.name));
}
