import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, bigint, boolean, timestamp, date, jsonb, index, uniqueIndex, customType, serial,
} from "drizzle-orm/pg-core";

// Money is stored in halalas (1 SAR = 100 halalas) as bigint so arithmetic is exact.
const money = (name: string) => bigint(name, { mode: "number" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────── People, roles, access ───────────── */

export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const partners = pgTable("partners", {
  id: id(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  title: text("title").notNull(),
  titleAr: text("title_ar").notNull(),
  // Equity in basis points: 3333 = 33.33%. All partners must sum to 10000.
  equityBps: integer("equity_bps").notNull(),
  isDirector: boolean("is_director").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  partnerId: uuid("partner_id").references(() => partners.id),
  team: text("team").notNull().default("management"), // management | riyadh | pakistan
  locale: text("locale").notNull().default("en"),
  active: boolean("active").notNull().default(true),
  // Commission as a share of margin, in basis points (1000 = 10%). Only managers and the person see it.
  commissionBps: integer("commission_bps").notNull().default(0),
  // Set when someone else chose the password (new member, reset): they must pick their own before doing anything.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  // One login per partner: a partner is one director vote, never two.
  uniqueIndex("users_one_per_partner").on(t.partnerId).where(sql`${t.partnerId} IS NOT NULL`),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

// Issuance authority Bader grants to named staff (the "TTP" control).
export const delegations = pgTable("delegations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  grantedBy: uuid("granted_by").notNull().references(() => users.id),
  scope: text("scope").notNull().default("retail"), // retail | all
  maxTicket: money("max_ticket").notNull(),
  dailyCap: money("daily_cap").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
});

/* ───────────── Clients & sales ───────────── */

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  type: text("type").notNull(), // retail | contracted | noncontracted
  phone: text("phone"),
  email: text("email"),
  contactPerson: text("contact_person"),
  creditLimit: money("credit_limit").notNull().default(0),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  contractRef: text("contract_ref"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("clients_name_idx").on(t.name)]);

export const bookings = pgTable("bookings", {
  id: id(),
  ref: text("ref").notNull().unique(),
  channel: text("channel").notNull(), // retail | corporate
  account: text("account").notNull(), // retail | corporate  (bank account it settles into)
  serviceType: text("service_type").notNull(), // flight | hotel | visa | package | transport | event | other
  clientId: uuid("client_id").notNull().references(() => clients.id),
  passengers: text("passengers").notNull(),
  paxCount: integer("pax_count").notNull().default(1),
  description: text("description"),
  // Structured answers for the service (visa type, hotel dates, meal plan, ...). description is built from them.
  details: jsonb("details"),
  // Everyone on the sale: [{ name, passport?, nationality?, expiry?, dob? }]. passengers/paxCount are derived from it.
  travellers: jsonb("travellers"),
  supplier: text("supplier"),
  pnr: text("pnr"),
  ticketNumbers: text("ticket_numbers"),
  travelDate: date("travel_date"),
  netCost: money("net_cost").notNull(),
  // Whether the supplier's cost has been settled. Until then the booking sits in "money we owe".
  supplierPaid: boolean("supplier_paid").notNull().default(false),
  // Flights are billed by IATA through BSP: their cost rolls into the 15-day BSP closing instead of a direct payable.
  viaBsp: boolean("via_bsp").notNull().default(false),
  bspClosingId: uuid("bsp_closing_id"),
  sellPrice: money("sell_price").notNull(),
  vatAmount: money("vat_amount").notNull().default(0),
  // The preparer's commission rate when the sale was made, frozen so later rate changes don't rewrite history.
  commissionBps: integer("commission_bps").notNull().default(0),
  status: text("status").notNull().default("pending_issue"), // draft | pending_issue | issued | returned | void | refunded
  onCredit: boolean("on_credit").notNull().default(false),
  creditApprovalId: uuid("credit_approval_id"),
  dueDate: date("due_date"),
  businessDate: date("business_date").notNull(), // Riyadh calendar day it belongs to
  preparedBy: uuid("prepared_by").notNull().references(() => users.id),
  issuedBy: uuid("issued_by").references(() => users.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  issuedUnderDelegation: uuid("issued_under_delegation"),
  returnNote: text("return_note"),
  recognizedCycleId: uuid("recognized_cycle_id"),
  invoiceId: uuid("invoice_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bookings_status_idx").on(t.status),
  index("bookings_bdate_idx").on(t.businessDate),
  index("bookings_client_idx").on(t.clientId),
]);

export const payments = pgTable("payments", {
  id: id(),
  bookingId: uuid("booking_id").references(() => bookings.id),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  account: text("account").notNull(), // retail | corporate
  method: text("method").notNull(), // cash | mada | card | transfer
  amount: money("amount").notNull(),
  reference: text("reference"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  businessDate: date("business_date").notNull(),
  clearedOn: date("cleared_on"), // date funds cleared in the bank; drives the Day-25 cut-off
  clearedBy: uuid("cleared_by").references(() => users.id),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("payments_booking_idx").on(t.bookingId), index("payments_cleared_idx").on(t.clearedOn)]);

// Money paid OUT to a supplier for a booking's cost. Source is a company bank, or a partner's own cash
// (which then becomes owed back to that partner, after the other directors approve).
export const supplierPayments = pgTable("supplier_payments", {
  id: id(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  supplier: text("supplier").notNull(),
  amount: money("amount").notNull(),
  source: text("source").notNull(), // bank | partner
  account: text("account"),         // retail | corporate, when source = bank
  partnerId: uuid("partner_id").references(() => partners.id), // when source = partner
  method: text("method").notNull().default("transfer"), // cash | transfer
  status: text("status").notNull().default("settled"),  // settled | pending_approval
  approvalId: uuid("approval_id"),
  reference: text("reference"),
  paidOn: date("paid_on").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("supplier_payments_booking_idx").on(t.bookingId), index("supplier_payments_account_idx").on(t.account)]);

/* ───────────── Approvals ───────────── */

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  ref: text("ref").notNull().unique(),
  kind: text("kind").notNull(), // credit | expense | refund | credit_limit | settlement
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  title: text("title").notNull(),
  amount: money("amount").notNull().default(0),
  reason: text("reason"),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  requiredApprovals: integer("required_approvals").notNull(),
  requiresAll: boolean("requires_all").notNull().default(false),
  approverPool: text("approver_pool").notNull(), // directors | permission:<perm>
  rule: text("rule").notNull(), // human readable rule that applied, frozen at request time
  // For governance changes (equity, thresholds, advances): exactly what will be applied once everyone agrees.
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | cancelled
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("approvals_status_idx").on(t.status)]);

export const approvalDecisions = pgTable("approval_decisions", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  decision: text("decision").notNull(), // approve | reject
  remark: text("remark"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("approval_decision_once").on(t.requestId, t.userId)]);

/* ───────────── Expenses, partner ledger ───────────── */

export const expenses = pgTable("expenses", {
  id: id(),
  ref: text("ref").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  justification: text("justification").notNull(),
  vendor: text("vendor"),
  amount: money("amount").notNull(),
  vatAmount: money("vat_amount").notNull().default(0),
  expenseDate: date("expense_date").notNull(),
  paidBy: text("paid_by").notNull(), // retail | corporate | partner
  partnerId: uuid("partner_id").references(() => partners.id),
  isStartup: boolean("is_startup").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  approvalId: uuid("approval_id"),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  // The Day-25 cycle whose P&L counted this expense, so late approvals land in the next cycle and nothing counts twice.
  recognizedCycleId: uuid("recognized_cycle_id"),
  createdAt: createdAt(),
}, (t) => [index("expenses_status_idx").on(t.status), index("expenses_date_idx").on(t.expenseDate)]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  // advance, expense   → company owes partner more (+)
  // repayment          → company paid back (−)
  // dividend           → profit paid out (does not change balance owed)
  type: text("type").notNull(),
  amount: money("amount").notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  cycleId: uuid("cycle_id"),
  entryDate: date("entry_date").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("ledger_partner_idx").on(t.partnerId)]);

/* ───────────── Controls: daily close, BSP, settlement ───────────── */

export const dailyCloses = pgTable("daily_closes", {
  id: id(),
  businessDate: date("business_date").notNull(),
  team: text("team").notNull(), // riyadh | pakistan
  status: text("status").notNull().default("submitted"), // submitted | verified | flagged
  cashExpected: money("cash_expected").notNull().default(0),
  cashCounted: money("cash_counted").notNull().default(0),
  snapshot: jsonb("snapshot").notNull(),
  note: text("note"),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  lateSubmission: boolean("late_submission").notNull().default(false),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifyNote: text("verify_note"),
}, (t) => [uniqueIndex("daily_close_once").on(t.businessDate, t.team)]);

export const bspObligations = pgTable("bsp_obligations", {
  id: id(),
  period: text("period").notNull(),
  dueDate: date("due_date").notNull(),
  amount: money("amount").notNull(),
  account: text("account").notNull().default("corporate"),
  status: text("status").notNull().default("upcoming"), // upcoming | paid
  paidOn: date("paid_on"),
  note: text("note"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const bankAccounts = pgTable("bank_accounts", {
  key: text("key").primaryKey(), // retail | corporate
  name: text("name").notNull(),
  bank: text("bank"),
  iban: text("iban"),
  openingBalance: money("opening_balance").notNull().default(0),
  openingDate: date("opening_date").notNull(),
});

// A 15-day IATA/BSP closing: the total owed to IATA for flights issued in the window, and how it was settled.
export const bspClosings = pgTable("bsp_closings", {
  id: id(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  dueDate: date("due_date").notNull(),        // period end + standard payment days
  amount: money("amount").notNull(),          // frozen at settlement time
  status: text("status").notNull().default("pending_approval"), // pending_approval | paid
  source: text("source").notNull(),           // bank | partner
  account: text("account"),                   // retail | corporate, when source = bank
  partnerId: uuid("partner_id").references(() => partners.id),
  approvalId: uuid("approval_id"),
  reference: text("reference"),
  paidOn: date("paid_on"),
  settledBy: uuid("settled_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("bsp_closings_period_idx").on(t.periodEnd)]);

export const settlementCycles = pgTable("settlement_cycles", {
  id: id(),
  label: text("label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(), // the 25th
  status: text("status").notNull().default("draft"), // draft | pending_approval | approved | paid
  inputs: jsonb("inputs").notNull(),
  figures: jsonb("figures").notNull(),
  approvalId: uuid("approval_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [uniqueIndex("cycle_end_once").on(t.endDate)]);

/* ───────────── Tasks ───────────── */

// Work assigned to a person: who, what, by when, and where it stands. Optionally tied to a sale, client or expense.
export const tasks = pgTable("tasks", {
  id: id(),
  ref: text("ref").notNull().unique(),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"), // open | in_progress | waiting | done | cancelled
  priority: text("priority").notNull().default("normal"), // normal | high | urgent
  assigneeId: uuid("assignee_id").notNull().references(() => users.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  dueDate: date("due_date"),
  waitingOn: text("waiting_on"), // what it's stuck on, while status is "waiting"
  checklist: jsonb("checklist").notNull().default([]), // [{ id, text, done }]
  linkType: text("link_type"), // booking | client | expense
  linkId: uuid("link_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
  index("tasks_due_idx").on(t.dueDate),
  index("tasks_link_idx").on(t.linkType, t.linkId),
]);

/* ───────────── Cross-cutting: remarks, files, audit, settings ───────────── */

export const remarks = pgTable("remarks", {
  id: id(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("remarks_entity_idx").on(t.entityType, t.entityId)]);

export const attachments = pgTable("attachments", {
  id: id(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)]);

// Append-only: the app never updates or deletes rows here (enforced by trigger in migration 0001).
export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  entityRef: text("entity_ref"),
  summary: text("summary").notNull(),
  changes: jsonb("changes"),
  ip: text("ip"),
}, (t) => [
  index("audit_at_idx").on(t.at),
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_actor_idx").on(t.actorId),
]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});
