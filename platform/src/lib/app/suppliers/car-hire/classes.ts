import type { CarClass } from "./types";

/** ACRISS code → our class (the first letter, and vans/SUVs from the second). */
export function classOf(acriss: string | null | undefined): CarClass {
  const a = (acriss ?? "").toUpperCase();
  if (/^.[VK]/.test(a)) return "van";
  if (/^.[FGJ]/.test(a)) return "suv";
  const first: Record<string, CarClass> = { M: "mini", N: "mini", E: "economy", H: "economy", C: "compact", D: "compact", I: "intermediate", J: "intermediate", S: "standard", R: "standard", F: "fullsize", G: "fullsize", P: "premium", U: "premium", L: "luxury", W: "luxury", O: "fullsize", X: "special" };
  return first[a[0] ?? ""] ?? "special";
}

/** Whole rental days (24-hour blocks, a started block counts), at least one. */
export function hireDays(fromLocal: string, toLocal: string): number {
  const ms = Date.parse(`${toLocal}Z`) - Date.parse(`${fromLocal}Z`);
  return Math.max(1, Math.ceil((ms - 59 * 60_000) / 86_400_000)); // 59 minutes' grace, as most desks give
}
