import { pgTable, uuid, text, integer, bigint, timestamp, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users as opsUsers } from "./schema";
import { appPayments, appRefunds, appRequests } from "./app-schema";
import { appOrders } from "./app-schema-booking";

/*
 * App finance on the desk (DESK-PLAN.md U6): what each sold line cost us and at what rate, and the payment provider's
 * settlement files matched against our captures and refunds. Migration: drizzle/0040_app_finance.sql.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const money = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * One sold line of a captured app payment (lib/app/finance/costs.ts): what the traveller paid for it (sell, VAT
 * inside), and what the supplier charges us, in their currency, with the rate to SAR written down at capture so a later
 * rate never rewrites the margin. basis: supplier (from the supplier's own answer) | estimated (from our markup) |
 * manual (finance typed it). Margin per product is the sum of these lines; nothing else is counted.
 */
export const appOrderCosts = pgTable("app_order_costs", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => appPayments.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => appOrders.id, { onDelete: "set null" }),
  requestId: uuid("request_id").references(() => appRequests.id, { onDelete: "set null" }),
  lineKey: text("line_key").notNull(),
  product: text("product").notNull(), // flight | stay | esim | transfer | activity | request | other
  label: text("label").notNull(),
  supplier: text("supplier"),
  supplierRef: text("supplier_ref"),
  sell: money("sell").notNull(), // halalas, VAT inside
  vat: money("vat").notNull().default(0),
  netAmount: text("net_amount").notNull().default("0"), // the supplier's own figure, as a decimal string
  currency: text("currency").notNull().default("SAR"),
  fxRate: text("fx_rate").notNull().default("1"), // SAR for one unit of currency, at capture
  netSar: money("net_sar").notNull().default(0), // halalas
  basis: text("basis").notNull().default("estimated"),
  businessDate: date("business_date").notNull(), // the Riyadh day the money was captured
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  updatedBy: uuid("updated_by").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("app_order_costs_line_key").on(t.paymentId, t.lineKey),
  index("app_order_costs_day_idx").on(t.businessDate, t.product),
]);

/** One settlement file (or API pull) from a payment provider, and how it matched. */
export const appReconImports = pgTable("app_recon_imports", {
  id: id(),
  provider: text("provider").notNull(), // myfatoorah (tabby, tamara later)
  source: text("source").notNull(), // file | api
  fileName: text("file_name"),
  periodFrom: date("period_from"),
  periodTo: date("period_to"),
  rows: integer("rows").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  mismatched: integer("mismatched").notNull().default(0),
  fees: money("fees").notNull().default(0),
  importedBy: uuid("imported_by").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("app_recon_imports_created_idx").on(t.createdAt)]);

/**
 * A line of a settlement against our side. status: matched | amount_mismatch | missing_ours (the provider has it, we
 * don't) | missing_provider (we captured or refunded it, the file in that period doesn't have it).
 */
export const appReconRows = pgTable("app_recon_rows", {
  id: id(),
  importId: uuid("import_id").notNull().references(() => appReconImports.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // capture | refund
  providerRef: text("provider_ref"),
  refundRef: text("refund_ref"),
  amount: money("amount").notNull().default(0), // what the provider says (or ours, for missing_provider)
  ours: money("ours"), // what we have
  fee: money("fee").notNull().default(0),
  settledOn: date("settled_on"),
  status: text("status").notNull(),
  paymentId: uuid("payment_id").references(() => appPayments.id, { onDelete: "set null" }),
  refundId: uuid("refund_id").references(() => appRefunds.id, { onDelete: "set null" }),
  raw: jsonb("raw").$type<Record<string, string>>(),
  createdAt: createdAt(),
}, (t) => [index("app_recon_rows_import_idx").on(t.importId, t.status), index("app_recon_rows_payment_idx").on(t.paymentId)]);
