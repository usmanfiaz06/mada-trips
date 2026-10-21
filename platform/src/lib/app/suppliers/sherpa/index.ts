import "server-only";
import { keyedExplicit, keyedMode } from "../../config";
import { guarded } from "../../resilience/breaker";
import { mockEntryRules } from "./mock";
import { sherpa } from "./sherpa";
import type { EntryRulesSupplier } from "./types";

export type * from "./types";
export { withEntryRequirements } from "./apply";
export { clearEntryRulesCache, entryRequirement } from "./cache";

/*
 * The entry-rules source (CONNECT.md §27): Sherpa with SHERPA_API_KEY (behind the "sherpa" breaker), the fixtures with
 * SUPPLIER_MODE_SHERPA=mock, else none — the built-in rules (shared ENTRY_RULES) answer alone, as before.
 */
export function entryRulesSupplier(): EntryRulesSupplier | null {
  const m = keyedMode("sherpa");
  if (m === "live") return guarded("sherpa", sherpa);
  if (m === "mock" && keyedExplicit("sherpa")) return mockEntryRules;
  return null;
}
