/*
 * Entry requirements (visa, eTA, passport validity) for one nationality going to one country, in our words. Sherpa
 * live; fixtures and the built-in rules (shared ENTRY_RULES) in mock. The entry check (booking/search.ts checkEntry)
 * asks this first and keeps the built-in rules as the fallback (apply.ts).
 */

export type EntryKind =
  /** Nothing to arrange before flying. */
  | "visa_free"
  | "visa_on_arrival"
  /** An online visa or authorisation that Mada can get (e-Visa, ETA, ESTA). */
  | "evisa"
  | "eta"
  /** A visa from an embassy or visa centre. */
  | "visa_required"
  | "not_allowed"
  | "unknown";

export type EntryRequirement = {
  /** ISO alpha-3 (our people's passports). */
  nationality: string;
  /** ISO alpha-2 (our destinations). */
  destination: string;
  kind: EntryKind;
  /** "Türkiye e-Visa", what Mada can get; null when nothing is needed. */
  name: string | null;
  /** One or two sentences for the traveller, "{name}" where their name goes. */
  text: string;
  maxStayDays: number | null;
  /** The passport must be valid this many days after arrival (or after leaving, as the rule says). */
  passportDays: number | null;
  applyUrl: string | null;
  source: "sherpa" | "mock";
  /** When the supplier last checked the rule (ISO), for "Checked on …". */
  checkedAt: string | null;
};

export type EntryQuery = { nationality: string; destination: string; depart: string; return: string | null; language?: "en" | "ar" };

export interface EntryRulesSupplier {
  readonly name: "sherpa" | "mock";
  /** Null when the supplier has nothing for this pair: the built-in rules answer. */
  requirement(q: EntryQuery): Promise<EntryRequirement | null>;
}
