import "server-only";
import { eq } from "drizzle-orm";
import { isLocale, type Lang } from "@mada/shared";
import { db } from "@/db";
import { appRequests, appUsers } from "@/db/app-schema";
import { currentLocale, inLocale } from "./resilience/request";

/*
 * Words written for a particular traveller (a push, an inbox line, a message from the desk) are in that traveller's
 * saved language, whoever's request is running: the desk works in Ops, a circle member's action notifies the others.
 */

/** A traveller's saved language ("en" when unknown). */
export async function localeOfUser(userId: string | null | undefined, exec: Pick<typeof db, "select"> = db): Promise<Lang> {
  if (!userId) return currentLocale();
  const [u] = await exec.select({ locale: appUsers.locale }).from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  return u && isLocale(u.locale) ? u.locale : "en";
}

/** Run fn in a traveller's language. */
export async function inUserLocale<T>(userId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!userId) return fn();
  const locale = await localeOfUser(userId);
  return inLocale(locale, fn);
}

/** Run fn in the language of the traveller who owns a request (desk actions on that request). */
export async function inRequestOwnerLocale<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  const [r] = await db.select({ userId: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, requestId)).limit(1).catch(() => []);
  return inUserLocale(r?.userId ?? null, fn);
}
