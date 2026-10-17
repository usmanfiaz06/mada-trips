import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HotelTranslationResponse, Lang } from "@mada/shared";
import { db } from "@/db";
import { appTranslations } from "@/db/app-schema-booking";
import { AppError } from "./http";
import { suppliers } from "./suppliers";
import { hotelContent } from "./suppliers/hotelbeds/content";

/*
 * The hotel's own words in the reader's language. Hotelbeds content is stored in English; on an Arabic page the
 * original shows with a "Translate" toggle, and the first tap here translates it once (Claude) and keeps it in
 * app_translations, so every later reader gets it from the store. A changed original is translated again.
 */

const hashOf = (parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);

export async function hotelTranslation(code: number, to: Lang): Promise<HotelTranslationResponse> {
  const h = await hotelContent(code);
  if (!h) throw new AppError("NOT_FOUND");
  const facilities = h.facilities.filter((f) => f.name).map((f) => f.name!);
  const source = [h.description ?? "", ...facilities];
  // Stored in English: an English reader already has it.
  if (to === "en") return { lang: "en", description: h.description, facilities, machine: false };
  const key = `hotel:${code}`;
  const sourceHash = hashOf(source);
  const [kept] = await db.select().from(appTranslations).where(and(eq(appTranslations.key, key), eq(appTranslations.lang, to))).limit(1);
  if (kept && kept.sourceHash === sourceHash) return kept.body as HotelTranslationResponse;
  const out = await suppliers.ai().translate(source, to).catch(() => null);
  if (!out) throw new AppError("NOT_CONFIGURED");
  const body: HotelTranslationResponse = { lang: to, description: h.description ? out[0] || null : null, facilities: out.slice(1), machine: true };
  await db.insert(appTranslations).values({ key, lang: to, sourceHash, body }).onConflictDoUpdate({ target: [appTranslations.key, appTranslations.lang], set: { sourceHash, body, createdAt: new Date() } });
  return body;
}
