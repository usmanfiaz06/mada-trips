import "server-only";
import { and, desc, eq, gte, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appPayments, appRefunds } from "@/db/app-schema";
import { appOrderCosts, appReconImports, appReconRows } from "@/db/app-schema-finance";
import { riyadhDate } from "@/lib/dates";
import { CAPTURED } from "./costs";

/*
 * MyFatoorah reconciliation (DESK-PLAN U6, screen 9). Finance downloads the settlement (deposit) report from the
 * MyFatoorah portal as CSV and imports it here; every line is matched against our captures and refunds:
 *
 *   matched           same invoice (or refund reference) and amount: the capture's Ops payment is marked cleared on the
 *                     settlement day, a refund moves to Settled
 *   amount_mismatch   we both have it, the amounts differ
 *   missing_ours      in the file, not in Mada (a payment we never recorded, or someone else's)
 *   missing_provider  we captured or refunded it in the file's period, the file doesn't have it
 *
 * The file's columns are read by name, in English as the portal exports them, with the common variants ("Invoice Id",
 * "InvoiceId", "Invoice Value", "Amount", "Service Charge", "Fees", "Deposit Date", …). Amounts are riyals with
 * decimals. There is no settlement API wired yet: the import is the source (MyFatoorah's API has no deposit report we
 * can rely on, and no merchant account is set up).
 */

export const RECON_PROVIDERS = ["myfatoorah", "mock-myfatoorah", "mock"] as const;
const CARD_METHODS = ["card", "mada", "applepay"];

export type SettlementLine = { kind: "capture" | "refund"; providerRef: string | null; refundRef: string | null; amount: number; fee: number; settledOn: string | null; raw: Record<string, string> };

/** Split CSV text into rows (quotes, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const COLS = {
  providerRef: ["invoiceid", "invoice", "invoiceno", "invoicenumber", "key", "paymentkey"],
  refundRef: ["refundreference", "refundref", "refundid", "refundno"],
  type: ["transactiontype", "type", "operation", "transactionstatus"],
  amount: ["invoicevalue", "amount", "transactionamount", "grossamount", "value", "invoiceamount"],
  fee: ["servicecharge", "fees", "fee", "commission", "charges", "mfcharge"],
  date: ["depositdate", "settlementdate", "settledon", "transactiondate", "date", "createddate"],
} as const;

/** Riyals with decimals ("1,234.50", "SAR 99") to halalas; null when it isn't a number. */
export function sarToHalalas(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** A date in the file as an ISO day ("2026-10-18", "18/10/2026", "2026-10-18 14:02:11"). */
export function isoDay(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

/** Read a settlement file into lines. Throws on a file without an invoice and an amount column. */
export function readSettlement(text: string): SettlementLine[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file has no lines");
  const head = rows[0]!.map(norm);
  const col = (names: readonly string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const at = { providerRef: col(COLS.providerRef), refundRef: col(COLS.refundRef), type: col(COLS.type), amount: col(COLS.amount), fee: col(COLS.fee), date: col(COLS.date) };
  if (at.providerRef < 0 || at.amount < 0) throw new Error("This doesn't look like a MyFatoorah settlement file: it needs an Invoice Id and an amount column");
  return rows.slice(1).map((r) => {
    const raw = Object.fromEntries(rows[0]!.map((h, i) => [h.trim(), (r[i] ?? "").trim()]));
    const type = at.type >= 0 ? r[at.type] ?? "" : "";
    const amount = sarToHalalas(r[at.amount]) ?? 0;
    const refund = /refund/i.test(type) || amount < 0;
    return {
      kind: refund ? "refund" as const : "capture" as const,
      providerRef: (r[at.providerRef] ?? "").trim() || null,
      refundRef: at.refundRef >= 0 ? (r[at.refundRef] ?? "").trim() || null : null,
      amount: Math.abs(amount), fee: Math.abs(at.fee >= 0 ? sarToHalalas(r[at.fee]) ?? 0 : 0), settledOn: isoDay(at.date >= 0 ? r[at.date] : undefined), raw,
    };
  }).filter((l) => l.providerRef || l.refundRef);
}

export type ImportSummary = { importId: string; rows: number; matched: number; mismatched: number; missingOurs: number; missingProvider: number; amountMismatch: number; fees: number };

/** Import one settlement file: match every line, add what we have and the file doesn't, mark cleared and settled. */
export async function importSettlement(actorId: string | null, v: { fileName: string; text: string; provider?: string }): Promise<ImportSummary> {
  const lines = readSettlement(v.text);
  if (!lines.length) throw new Error("The file has no payments in it");
  const days = lines.map((l) => l.settledOn).filter((d): d is string => !!d).sort();
  const from = days[0] ?? null, to = days.at(-1) ?? null;

  const refs = [...new Set(lines.map((l) => l.providerRef).filter((x): x is string => !!x))];
  const pays = refs.length ? await db.select().from(appPayments).where(and(inArray(appPayments.providerRef, refs), inArray(appPayments.provider, [...RECON_PROVIDERS]))) : [];
  const byRef = new Map(pays.map((p) => [p.providerRef!, p]));
  const refundRefs = [...new Set(lines.map((l) => l.refundRef).filter((x): x is string => !!x))];
  const refundWhere = [pays.length ? inArray(appRefunds.paymentId, pays.map((p) => p.id)) : undefined, refundRefs.length ? inArray(appRefunds.providerRef, refundRefs) : undefined].filter((x) => !!x);
  const refunds = refundWhere.length ? await db.select().from(appRefunds).where(or(...refundWhere)) : [];

  type Row = typeof appReconRows.$inferInsert;
  const out: Omit<Row, "importId">[] = [];
  const seenPay = new Set<string>(), seenRefund = new Set<string>();
  for (const l of lines) {
    if (l.kind === "capture") {
      const p = l.providerRef ? byRef.get(l.providerRef) : undefined;
      if (!p) { out.push({ kind: "capture", providerRef: l.providerRef, amount: l.amount, fee: l.fee, settledOn: l.settledOn, status: "missing_ours", raw: l.raw }); continue; }
      seenPay.add(p.id);
      out.push({ kind: "capture", providerRef: l.providerRef, amount: l.amount, ours: p.amount, fee: l.fee, settledOn: l.settledOn, paymentId: p.id, status: p.amount === l.amount ? "matched" : "amount_mismatch", raw: l.raw });
    } else {
      const p = l.providerRef ? byRef.get(l.providerRef) : undefined;
      const f = refunds.find((x) => !seenRefund.has(x.id) && l.refundRef && x.providerRef === l.refundRef)
        ?? refunds.find((x) => !seenRefund.has(x.id) && p && x.paymentId === p.id && x.amount === l.amount && ["approved", "sent", "settled"].includes(x.stage));
      if (!f) { out.push({ kind: "refund", providerRef: l.providerRef, refundRef: l.refundRef, amount: l.amount, fee: l.fee, settledOn: l.settledOn, paymentId: p?.id ?? null, status: "missing_ours", raw: l.raw }); continue; }
      seenRefund.add(f.id);
      out.push({ kind: "refund", providerRef: l.providerRef, refundRef: l.refundRef ?? f.providerRef, amount: l.amount, ours: f.amount, fee: l.fee, settledOn: l.settledOn, paymentId: f.paymentId, refundId: f.id, status: f.amount === l.amount ? "matched" : "amount_mismatch", raw: l.raw });
    }
  }

  // Ours in the same days that the file doesn't have.
  if (from && to) {
    const ours = await db.select({ p: appPayments, day: sql<string>`min(${appOrderCosts.businessDate})::text` }).from(appPayments)
      .innerJoin(appOrderCosts, eq(appOrderCosts.paymentId, appPayments.id))
      .where(and(inArray(appPayments.status, [...CAPTURED]), inArray(appPayments.provider, [...RECON_PROVIDERS]), inArray(appPayments.method, CARD_METHODS),
        gte(appOrderCosts.businessDate, from), lte(appOrderCosts.businessDate, to), seenPay.size ? notInArray(appPayments.id, [...seenPay]) : undefined))
      .groupBy(appPayments.id);
    for (const { p, day } of ours) out.push({ kind: "capture", providerRef: p.providerRef, amount: p.amount, ours: p.amount, settledOn: day, paymentId: p.id, status: "missing_provider" });
    const sent = await db.select({ f: appRefunds, ref: appPayments.providerRef }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
      .where(and(eq(appRefunds.destination, "original"), inArray(appRefunds.stage, ["sent"]), inArray(appPayments.provider, [...RECON_PROVIDERS]),
        sql`(${appRefunds.sentAt} AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ${from}::date AND ${to}::date`, seenRefund.size ? notInArray(appRefunds.id, [...seenRefund]) : undefined));
    for (const { f, ref } of sent) out.push({ kind: "refund", providerRef: ref, refundRef: f.providerRef, amount: f.amount, ours: f.amount, paymentId: f.paymentId, refundId: f.id, status: "missing_provider" });
  }

  const matched = out.filter((r) => r.status === "matched").length;
  const fees = out.reduce((a, r) => a + (r.fee ?? 0), 0);
  return db.transaction(async (tx) => {
    const [imp] = await tx.insert(appReconImports).values({ provider: v.provider ?? "myfatoorah", source: "file", fileName: v.fileName.slice(0, 160), periodFrom: from, periodTo: to, rows: lines.length, matched, mismatched: out.length - matched, fees, importedBy: actorId }).returning();
    if (out.length) await tx.insert(appReconRows).values(out.map((r) => ({ ...r, importId: imp!.id })));
    // Matched captures: their Ops payment cleared on the settlement day. Matched refunds: settled.
    for (const r of out.filter((x) => x.status === "matched")) {
      if (r.kind === "capture" && r.paymentId) {
        const [p] = await tx.select({ ops: appPayments.opsPaymentId }).from(appPayments).where(eq(appPayments.id, r.paymentId));
        if (p?.ops) await tx.update(schema.payments).set({ clearedOn: r.settledOn ?? to ?? riyadhDate(), clearedBy: actorId }).where(and(eq(schema.payments.id, p.ops), sql`${schema.payments.clearedOn} IS NULL`));
      }
      if (r.kind === "refund" && r.refundId) {
        await tx.update(appRefunds).set({ stage: "settled", settledAt: new Date(), sentAt: sql`coalesce(${appRefunds.sentAt}, now())`, updatedAt: new Date() }).where(and(eq(appRefunds.id, r.refundId), inArray(appRefunds.stage, ["approved", "sent"])));
      }
    }
    if (actorId) await tx.insert(schema.auditEvents).values({ actorId, action: "app.recon.imported", entityType: "desk", entityId: imp!.id, entityRef: v.fileName.slice(0, 60),
      summary: `Imported a MyFatoorah settlement: ${lines.length} lines, ${matched} matched, ${out.length - matched} to look at` });
    return {
      importId: imp!.id, rows: lines.length, matched, mismatched: out.length - matched, fees,
      missingOurs: out.filter((r) => r.status === "missing_ours").length, missingProvider: out.filter((r) => r.status === "missing_provider").length, amountMismatch: out.filter((r) => r.status === "amount_mismatch").length,
    };
  });
}

export async function listImports(limit = 20) {
  return db.select().from(appReconImports).orderBy(desc(appReconImports.createdAt)).limit(limit);
}

export const RECON_TABS = ["attention", "matched", "all"] as const;

/** One import's lines for a tab (attention: everything not matched), 50 at a time, with the count per status. */
export async function reconRows(importId: string, opts: { tab?: string; limit?: number; offset?: number } = {}) {
  const tab = opts.tab ?? "attention";
  const where = and(eq(appReconRows.importId, importId), tab === "matched" ? eq(appReconRows.status, "matched") : tab === "attention" ? sql`${appReconRows.status} <> 'matched'` : undefined);
  const [counts, rows] = await Promise.all([
    db.select({ k: appReconRows.status, n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${appReconRows.amount}),0)::bigint` }).from(appReconRows).where(eq(appReconRows.importId, importId)).groupBy(appReconRows.status),
    db.select().from(appReconRows).where(where).orderBy(appReconRows.status, desc(appReconRows.amount)).limit(opts.limit ?? 50).offset(opts.offset ?? 0),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c.k, { n: c.n, v: Number(c.v) }]));
  const n = (k: string) => by[k]?.n ?? 0;
  const total = tab === "matched" ? n("matched") : tab === "attention" ? counts.filter((c) => c.k !== "matched").reduce((a, c) => a + c.n, 0) : counts.reduce((a, c) => a + c.n, 0);
  return { rows, by, total };
}
