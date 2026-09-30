import type { Tone } from "@/components/ui";
import type { schema } from "@/db";

export type Lead = typeof schema.leads.$inferSelect;

export const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_SOURCES = ["chat", "form"] as const;

// Canonical English labels (translated at render with t()) and the tone each state uses everywhere.
export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "gold" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "warn" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "neutral" },
};
export const LEAD_SOURCE: Record<string, string> = { chat: "Website chat", form: "Enquiry form" };

/** Arabic-Indic and Persian digits → ASCII, so phones typed on an Arabic keyboard still work. */
export const asciiDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** A WhatsApp link for a phone as typed. Saudi local numbers (05xxxxxxxx) get the 966 country code. */
export function waLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = asciiDigits(phone).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `966${d}`;
  return d.length >= 8 ? `https://wa.me/${d}` : null;
}

/** tel: link; keeps a leading + and digits only. */
export const telLink = (phone: string) => `tel:${asciiDigits(phone).replace(/[^\d+]/g, "")}`;
