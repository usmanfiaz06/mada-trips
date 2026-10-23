import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { DESTINATIONS, MemoryKind, SENSITIVE_MEMORY_KINDS, type AskKind, type MemoryFact } from "@mada/shared";
import { db } from "@/db";
import { appAskMemory } from "@/db/app-schema-ask";
import { appOffers } from "@/db/app-schema-booking";
import { appSaved } from "@/db/app-schema-circles";
import { redact, screen } from "./guard";

/*
 * What Mada remembers across conversations (docs/app/ASK-CHAT.md §7).
 *   - Facts: small lasting things the traveller said, saved by the `remember` tool (tools.ts). Health, mobility and
 *     religion are saved only after the traveller said yes to "Shall we remember that for next time?" in the turn
 *     before (consentOf reads the thread, so a model can't skip the question). Never a number that redaction would
 *     remove, a phone, an email or a document.
 *   - Signals, derived and never stored here: the last 3 searches (app_offers), saved places (app_saved) and trips
 *     taken (the overview chat.ts already reads).
 * Both go to the model as one compact block in the turn's context (memoryBlock, at most MEMORY_CHARS), most relevant
 * first, once per thread (and again after older turns are folded), so free tiers spend few tokens on it.
 */

export const MEMORY_CHARS = 600;
export const MAX_FACTS = 30;
export const FACT_CHARS = 120;
/** The block's first line: also how chat.ts sees that a thread already has it. */
export const MEMORY_HEAD = "What Mada knows about this traveller";

/** Kinds that hold one value: a new one replaces the old ("from Jeddah now", "business this time on"). */
const SINGLE: readonly MemoryKind[] = ["home_airport", "cabin", "seat", "budget", "contact"];

/** Health, mobility and religion beyond halal, in English and Arabic: saved only after a yes. */
const SENSITIVE_WORDS = /wheelchair|walk(?:er|ing)? (?:far|stick)|can'?t walk|mobility|disab|blind|deaf|pregnan|diabet|insulin|allerg|asthma|heart|dialysis|oxygen|medic|epilep|autis|cancer|surgery|kidney|\bshi'?a\b|\bsunni\b|christian|jewish|hindu|sikh|atheis|كرسي متحرك|كرسي مدولب|ويلشير|إعاق|اعاق|معاق|حامل|سكري|حساسية|ربو|القلب|غسيل كلى|أكسجين|اكسجين|دواء|أدوية|علاج|مريض|ما يقدر يمشي|ما تقدر تمشي|شيعي|سني|مسيحي/i;

export function isSensitive(kind: MemoryKind, text: string): boolean {
  return SENSITIVE_MEMORY_KINDS.includes(kind) || SENSITIVE_WORDS.test(text);
}

/** Why a fact can't be kept at all: a document, a card, a phone, an email, a link, or abuse. Null when it can. */
export function unkeepable(text: string): string | null {
  if (redact(text).redacted > 0) return "it holds a passport, card or bank number";
  if (/\d[\d\s-]{5,}\d/.test(text)) return "it holds a long number (a phone, a document or a booking code)";
  if (/@|https?:\/\/|www\./i.test(text)) return "it holds an email or a link";
  if (!screen(text).ok) return "it isn't a travel preference";
  return null;
}

const YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please|of course|go ahead|do it|save it|remember it|why not|definitely|absolutely|ايه|إيه|اي\b|أي\b|ايوه|إيوه|نعم|أكيد|اكيد|تمام|طيب|أوكي|اوكي|يب|احفظ|تذكر|اكيد|ياليت|يا ليت|لو سمحت)/i;
const NO = /^\s*(?:no\b|nope|don'?t|not now|لا\b|لأ|لا تحفظ|بلاش|مو لازم)/i;
const ASKED = /remember|نتذكر|تتذكر|نحفظ|نسجّل|نسجل|نخلي.*بالنا/i;

/**
 * Consent for a sensitive fact, read from the thread: Mada's last reply asked to remember something (a question about
 * remembering), and the traveller's message now says yes.
 */
export function consentOf(history: Anthropic.Beta.BetaMessageParam[], typed: string): { asked: boolean; yes: boolean } {
  let lastSaid = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    if (text.trim()) { lastSaid = text; break; }
  }
  const asked = ASKED.test(lastSaid) && /[?؟]/.test(lastSaid);
  return { asked, yes: asked && YES.test(typed) && !NO.test(typed) };
}

const toFact = (r: typeof appAskMemory.$inferSelect): MemoryFact => ({
  id: r.id, kind: MemoryKind.safeParse(r.kind).data ?? "other", text: r.text, source: r.source === "booking" ? "booking" : "chat",
  createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
});

export async function listMemory(ownerId: string): Promise<MemoryFact[]> {
  const rows = await db.select().from(appAskMemory).where(eq(appAskMemory.ownerId, ownerId)).orderBy(desc(appAskMemory.createdAt)).limit(MAX_FACTS);
  return rows.map(toFact);
}

/** Keep one fact. A kind with one value replaces the old one; the same words again only refresh it. Oldest go past MAX_FACTS. */
export async function saveFact(ownerId: string, kind: MemoryKind, raw: string, source: "chat" | "booking" = "chat"): Promise<MemoryFact> {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, FACT_CHARS);
  return db.transaction(async (tx) => {
    if (SINGLE.includes(kind)) await tx.delete(appAskMemory).where(and(eq(appAskMemory.ownerId, ownerId), eq(appAskMemory.kind, kind)));
    else {
      const [same] = await tx.select().from(appAskMemory).where(and(eq(appAskMemory.ownerId, ownerId), sql`lower(${appAskMemory.text}) = lower(${text})`)).limit(1);
      if (same) {
        const [r] = await tx.update(appAskMemory).set({ lastUsedAt: new Date() }).where(eq(appAskMemory.id, same.id)).returning();
        return toFact(r!);
      }
    }
    const [row] = await tx.insert(appAskMemory).values({ ownerId, kind, text, source }).returning();
    const keep = await tx.select({ id: appAskMemory.id }).from(appAskMemory).where(eq(appAskMemory.ownerId, ownerId)).orderBy(desc(appAskMemory.createdAt)).limit(MAX_FACTS);
    await tx.delete(appAskMemory).where(and(eq(appAskMemory.ownerId, ownerId), notInArray(appAskMemory.id, keep.map((k) => k.id))));
    return toFact(row!);
  });
}

/** Remove one fact; false when it isn't this traveller's. */
export async function forgetFact(ownerId: string, id: string): Promise<boolean> {
  const gone = await db.delete(appAskMemory).where(and(eq(appAskMemory.id, id), eq(appAskMemory.ownerId, ownerId))).returning({ id: appAskMemory.id });
  return gone.length > 0;
}

export async function forgetAll(ownerId: string): Promise<number> {
  const gone = await db.delete(appAskMemory).where(eq(appAskMemory.ownerId, ownerId)).returning({ id: appAskMemory.id });
  return gone.length;
}

/* ───────────── the block in the turn's context ───────────── */

const WEIGHT: Record<MemoryKind, number> = { mobility: 9, health: 9, family: 7, food: 6, home_airport: 6, seat: 5, cabin: 5, airline: 4, budget: 4, contact: 3, other: 2 };
const FITS: Partial<Record<AskKind, MemoryKind[]>> = {
  flight: ["home_airport", "seat", "cabin", "airline", "budget"],
  stay: ["food", "budget", "family", "mobility"],
  umrah: ["mobility", "health", "family", "home_airport"],
  car: ["mobility", "family"],
  food: ["food"],
  visa: ["family"],
  esim: ["contact"],
};
const DAY = 86_400_000;

/** Facts in the order they matter for this message: needs first, then what fits the kind of ask, then the fresh ones. */
export function rankFacts(facts: MemoryFact[], kind: AskKind | null, now = Date.now()): MemoryFact[] {
  const score = (f: MemoryFact) => WEIGHT[f.kind] + (kind && FITS[kind]?.includes(f.kind) ? 4 : 0) + (now - Date.parse(f.lastUsedAt ?? f.createdAt) < 30 * DAY ? 1 : 0);
  return [...facts].sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt));
}

type Search = { kind?: string; destination?: string; destinationName?: string; depart?: string; return?: string | null; checkIn?: string; nights?: number; travellerIds?: string[]; cabin?: string | null };
const placeOf = (k: string | undefined) => (k ? DESTINATIONS[k]?.name ?? k : "?");
const shortDay = (d: string | undefined | null) => (d ? d.slice(5) : "");

/** One recent search as a few words: "flight Istanbul 12-20 to 12-27, 4 people". */
export function searchLine(s: Search): string {
  const n = s.travellerIds?.length ?? 1;
  const when = s.kind === "stay" ? `${shortDay(s.checkIn)}${s.nights ? `, ${s.nights} nights` : ""}` : `${shortDay(s.depart)}${s.return ? ` to ${shortDay(s.return)}` : ""}`;
  return `${s.kind ?? "flight"} ${s.destinationName ?? placeOf(s.destination)} ${when}, ${n} ${n === 1 ? "person" : "people"}${s.cabin && s.cabin !== "economy" ? `, ${s.cabin}` : ""}`;
}

/** The derived signals: the last 3 searches and up to 3 saved places, from the tables that already hold them. */
export async function signalsOf(ownerId: string): Promise<{ searches: string[]; saved: string[] }> {
  const since = new Date(Date.now() - 60 * DAY);
  const at = sql<Date>`max(${appOffers.createdAt})`;
  const [searches, saved] = await Promise.all([
    db.select({ search: appOffers.search, at }).from(appOffers).where(and(eq(appOffers.ownerId, ownerId), gt(appOffers.createdAt, since))).groupBy(appOffers.search).orderBy(desc(at)).limit(3).catch(() => []),
    db.select({ city: appSaved.city, at: sql<Date>`max(${appSaved.createdAt})` }).from(appSaved).where(eq(appSaved.userId, ownerId)).groupBy(appSaved.city).orderBy(desc(sql`max(${appSaved.createdAt})`)).limit(3).catch(() => []),
  ]);
  return { searches: searches.map((r) => searchLine(r.search as Search)), saved: saved.map((r) => r.city).filter(Boolean) };
}

/**
 * The compact block (≤ MEMORY_CHARS), or null when Mada knows nothing yet. Whole lines only, most relevant first:
 * the facts by rankFacts, then searches, saved places and trips taken. The facts that made it in are marked used.
 */
export function composeMemory(facts: MemoryFact[], signals: { searches: string[]; saved: string[]; taken: string[] }, kind: AskKind | null, max = MEMORY_CHARS): { text: string | null; used: string[] } {
  const head = `${MEMORY_HEAD} (from earlier chats and bookings; use it when it fits, say it back naturally, never list it):`;
  const lines: { text: string; id?: string }[] = [
    ...rankFacts(facts, kind).map((f) => ({ text: `- ${f.kind.replace("_", " ")}: ${f.text}`, id: f.id })),
    signals.searches.length ? { text: `- Recent searches: ${signals.searches.join("; ")}` } : null,
    signals.saved.length ? { text: `- Saved places: ${signals.saved.join(", ")}` } : null,
    signals.taken.length ? { text: `- Trips taken: ${signals.taken.join(", ")}` } : null,
  ].filter((x): x is { text: string; id?: string } => !!x);
  if (!lines.length) return { text: null, used: [] };
  const out = [head];
  const used: string[] = [];
  let len = head.length;
  for (const l of lines) {
    if (len + 1 + l.text.length > max) continue;
    out.push(l.text);
    len += 1 + l.text.length;
    if (l.id) used.push(l.id);
  }
  return out.length > 1 ? { text: out.join("\n"), used } : { text: null, used: [] };
}

/** Read everything and compose the block for this turn; marks the facts it used. Never fails the turn. */
export async function memoryBlock(ownerId: string, o: { kind: AskKind | null; taken: string[] }): Promise<string | null> {
  try {
    const [facts, signals] = await Promise.all([listMemory(ownerId), signalsOf(ownerId)]);
    const { text, used } = composeMemory(facts, { ...signals, taken: o.taken.slice(0, 3) }, o.kind);
    if (used.length) await db.update(appAskMemory).set({ lastUsedAt: new Date() }).where(and(eq(appAskMemory.ownerId, ownerId), inArray(appAskMemory.id, used)));
    return text;
  } catch (e) {
    console.warn("[ask-chat] memory: not read this turn", e instanceof Error ? e.name : "");
    return null;
  }
}
