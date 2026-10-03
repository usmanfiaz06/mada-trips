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
export const APPROVAL_KIND: Record<string, string> = { credit: "Credit", expense: "Expense", refund: "Refund", credit_limit: "Credit limit", settlement: "Day-25 settlement", governance: "Governance change", supplier: "Supplier payment", bsp: "IATA BSP", cash: "Bank movement", void: "Void sale" };
export const APPROVAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "gold" }, approved: { label: "Approved", tone: "ok" }, rejected: { label: "Rejected", tone: "bad" }, cancelled: { label: "Withdrawn", tone: "neutral" },
};
export const CLOSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Waiting for verification", tone: "gold" }, verified: { label: "Verified", tone: "ok" }, flagged: { label: "Flagged", tone: "bad" },
};
export const LEDGER_TYPE: Record<string, string> = { advance: "Capital advance", expense: "Expense paid personally", repayment: "Repayment", dividend: "Dividend" };
