import type { EntryQuery, EntryRequirement, EntryRulesSupplier } from "./types";

const TTL_MS = 6 * 60 * 60_000;
const g = globalThis as unknown as { __madaEntryRules?: Map<string, { at: number; r: EntryRequirement | null }> };
const memo = (g.__madaEntryRules ??= new Map());
export const clearEntryRulesCache = () => memo.clear();

/** One nationality to one country, kept 6 hours per instance (by month: rules change by date). Null on any failure. */
export async function entryRequirement(s: EntryRulesSupplier, q: EntryQuery): Promise<EntryRequirement | null> {
  const key = `${s.name}|${q.nationality}|${q.destination}|${q.depart.slice(0, 7)}|${q.language ?? "en"}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.r;
  try {
    const r = await s.requirement(q);
    memo.set(key, { at: Date.now(), r });
    return r;
  } catch (e) {
    console.warn("[entry] rules supplier failed; the built-in rules answer", e instanceof Error ? e.message.slice(0, 120) : "");
    return null;
  }
}
