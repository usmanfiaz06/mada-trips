import type { Tone } from "@/components/ui";

// Canonical English labels (translated at render with t()) and the tone each state uses everywhere.
export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  awaiting_credit: { label: "Awaiting credit approval", tone: "warn" },
  pending_issue: { label: "Waiting to issue", tone: "gold" },
  returned: { label: "Sent back", tone: "bad" },
  issued: { label: "Issued", tone: "ok" },
  void: { label: "Void", tone: "neutral" },
  refunded: { label: "Refunded", tone: "info" },
};
export const SERVICE: Record<string, string> = { flight: "Flight", hotel: "Hotel", visa: "Visa", package: "Package", transport: "Transport", event: "Event", other: "Other" };
export const METHOD: Record<string, string> = { cash: "Cash", mada: "mada", card: "Credit card", transfer: "Bank transfer" };
// The company's two bank accounts. Either can be used for any sale. The keys are internal; the labels are the banks.
export const ACCOUNT: Record<string, string> = { retail: "SNB", corporate: "Alinma (B2B Account)" };
export const ACCOUNTS = [
  { value: "retail", label: "SNB" },
  { value: "corporate", label: "Alinma (B2B Account)" },
] as const;
export const CLIENT_TYPE: Record<string, { label: string; tone: Tone }> = {
  retail: { label: "Retail", tone: "neutral" },
  contracted: { label: "Contracted corporate", tone: "ok" },
  noncontracted: { label: "Non-contracted corporate", tone: "warn" },
};
export const TEAM: Record<string, string> = { management: "Management", riyadh: "Riyadh office", pakistan: "Pakistan desk" };
export const EXPENSE_CATEGORY: Record<string, string> = {
  salaries: "Salaries", rent: "Rent", utilities: "Utilities", communications: "Communications", systems: "System licences",
  licences: "Government & licences", furnishing: "Furnishing", marketing: "Marketing", office: "Office supplies", travel: "Business travel", bank: "Bank charges", commission: "Team commission", other: "Other",
};
export const EXPENSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for verification", tone: "gold" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  void: { label: "Void", tone: "neutral" },
};
export const PAID_BY: Record<string, string> = { retail: "Company · SNB", corporate: "Company · Alinma (B2B Account)", partner: "Partner, personally" };
export const APPROVAL_KIND: Record<string, string> = { credit: "Credit", expense: "Expense", refund: "Refund", credit_limit: "Credit limit", settlement: "Day-25 settlement", governance: "Governance change", supplier: "Supplier payment", bsp: "IATA BSP", cash: "Bank movement", void: "Void sale", goodwill: "Goodwill credit", app_refund: "App refund" };
export const APPROVAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "gold" }, approved: { label: "Approved", tone: "ok" }, rejected: { label: "Rejected", tone: "bad" }, cancelled: { label: "Withdrawn", tone: "neutral" },
};
export const CLOSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Waiting for verification", tone: "gold" }, verified: { label: "Verified", tone: "ok" }, flagged: { label: "Flagged", tone: "bad" },
};
export const LEDGER_TYPE: Record<string, string> = { advance: "Capital advance", expense: "Expense paid personally", repayment: "Repayment", dividend: "Dividend" };

/* ───────── App desk ───────── */

// Where an app order is on the desk: the booking engine's states plus the desk's own (lib/app/desk/adapters.ts orderStage).
export const ORDER_STAGE: Record<string, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Waiting for a friend to pay", tone: "info" },
  awaiting: { label: "Waiting to confirm", tone: "gold" },
  held: { label: "Held · issue tickets", tone: "info" },
  needs_answer: { label: "Waiting on traveller", tone: "neutral" },
  price_changed: { label: "New price sent", tone: "warn" },
  issued: { label: "Issued", tone: "ok" },
  failed: { label: "Ticketing failed", tone: "bad" },
  not_issued: { label: "Not issued", tone: "bad" },
  other: { label: "In progress", tone: "neutral" },
};
export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "New", tone: "gold" },
  reviewing: { label: "Reviewing", tone: "gold" },
  needs_answer: { label: "Waiting on traveller", tone: "neutral" },
  quoted: { label: "Quote sent", tone: "info" },
  awaiting_payment: { label: "Waiting for payment", tone: "info" },
  with_agent: { label: "Paid · with us", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "ok" },
  done: { label: "Done", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};
export const REQUEST_KIND: Record<string, string> = {
  destination: "Destination", visa: "Visa", umrah: "Umrah", car: "Car", restaurant: "Restaurant", activity: "Things to do", change: "Change", cancel: "Cancel", refund: "Refund", general: "General", flight: "Flights",
};
export const PAY_STATUS: Record<string, { label: string; tone: Tone }> = {
  initiated: { label: "Started", tone: "neutral" },
  requires_action: { label: "Bank check pending", tone: "warn" },
  authorized: { label: "Authorised · not captured", tone: "info" },
  captured: { label: "Captured", tone: "ok" },
  voided: { label: "Hold released", tone: "neutral" },
  declined: { label: "Declined", tone: "bad" },
  failed: { label: "Capture didn't go through", tone: "bad" },
  refunded: { label: "Refunded", tone: "neutral" },
  partially_refunded: { label: "Partly refunded", tone: "neutral" },
};
export const REFUND_STAGE: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "To decide", tone: "gold" }, awaiting_lead: { label: "With a lead", tone: "warn" }, lead_approved: { label: "Lead approved · sending", tone: "info" },
  approved: { label: "Approved · on its way", tone: "info" }, sent: { label: "Sent", tone: "ok" }, settled: { label: "Settled", tone: "ok" }, rejected: { label: "Declined", tone: "bad" },
  withdrawn: { label: "Withdrawn by the traveller", tone: "neutral" },
};
/** App finance (DESK-PLAN U6): products on the revenue page, cost basis, reconciliation match. */
export const APP_PRODUCT: Record<string, string> = { flight: "Flights", stay: "Stays", esim: "eSIMs", transfer: "Transfers", activity: "Things to do", request: "Requests", other: "Other" };
export const COST_BASIS: Record<string, { label: string; tone: Tone }> = {
  supplier: { label: "From the supplier", tone: "ok" }, estimated: { label: "Estimated", tone: "warn" }, manual: { label: "Typed by finance", tone: "info" }, missing: { label: "No cost yet", tone: "bad" },
};
export const RECON_STATUS: Record<string, { label: string; tone: Tone }> = {
  matched: { label: "Matched", tone: "ok" }, amount_mismatch: { label: "Amount differs", tone: "bad" }, missing_ours: { label: "Not in Mada", tone: "bad" }, missing_provider: { label: "Not in the file", tone: "warn" },
};
export const ESIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  ordering: { label: "Ordering", tone: "info" }, ready: { label: "Ready to install", tone: "info" }, installed: { label: "Installed", tone: "ok" }, active: { label: "On", tone: "ok" },
  used_up: { label: "All used", tone: "neutral" }, expired: { label: "Ended", tone: "neutral" }, refunded: { label: "Refunded", tone: "warn" }, stuck: { label: "With Mada", tone: "bad" },
};
export const AGENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "ok" }, away: { label: "Away", tone: "warn" }, offline: { label: "Signed off", tone: "neutral" },
};
// Desk tickets (lib/app/desk/tickets.ts, DESK-PLAN.md §4.4).
export const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "gold" }, open: { label: "Open", tone: "info" }, waiting_customer: { label: "Waiting on customer", tone: "neutral" },
  waiting_supplier: { label: "Waiting on supplier", tone: "neutral" }, resolved: { label: "Resolved", tone: "ok" }, closed: { label: "Closed", tone: "neutral" },
};
export const TICKET_PRIORITY: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: "Urgent", tone: "bad" }, high: { label: "High", tone: "warn" }, normal: { label: "Normal", tone: "neutral" }, low: { label: "Low", tone: "neutral" },
};
// The live board's lifecycle tabs and products (lib/app/desk/board.ts), and where a drop-off stopped (dropoffs.ts).
export const BOARD_STAGE: Record<string, { label: string; tone: Tone }> = {
  searching: { label: "Searching", tone: "neutral" }, held: { label: "Held · not paid", tone: "gold" }, paid: { label: "Paid · with the desk", tone: "info" },
  confirmed: { label: "Confirmed · ticketed", tone: "ok" }, travelling: { label: "Travelling", tone: "brand" }, done: { label: "Done", tone: "neutral" }, problem: { label: "Problem", tone: "bad" },
};
export const BOARD_PRODUCT: Record<string, string> = {
  flight: "Flights", stay: "Stays", package: "Flight + stay", esim: "eSIMs", transfer: "Transfers", activity: "Things to do", umrah: "Umrah", visa: "Visa", share: "Circle share", request: "Other requests",
};
export const BOARD_SUPPLIER: Record<string, string> = { mada: "Mada desk", tbo: "TBO", hotelbeds: "Hotelbeds", esimaccess: "eSIM Access", airalo: "Airalo", mock: "Test supplier" };
export const DROPOFF_KIND: Record<string, { label: string; tone: Tone }> = {
  search: { label: "Searched, didn't book", tone: "neutral" }, sheet: { label: "Pay sheet, not paid", tone: "gold" },
  payment: { label: "Payment didn't go through", tone: "bad" }, held: { label: "Held, not paid", tone: "warn" },
};
export const DROPOFF_STEP: Record<string, string> = {
  searched: "Saw the results", pay_sheet: "Opened the pay sheet", declined: "Card declined", bank_check: "Stopped at the bank check", friend_to_pay: "Waiting for a friend to pay", quote_sent: "Quote sent, not paid",
};
export const DROPOFF_MARK: Record<string, { label: string; tone: Tone }> = { recovered: { label: "Recovered", tone: "ok" }, ignored: { label: "Ignored", tone: "neutral" } };
