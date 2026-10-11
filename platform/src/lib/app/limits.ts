import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { appDeskBlocks } from "@/db/app-schema-desk";
import { AppError } from "./http";

/*
 * Limits the desk sets (Mada Ops › Desk › Moderation, "Block"): a blocked account can't post tips, write in circles
 * or direct messages, start circles, ask people to be friends or invite anyone, and can't turn on Who's around. It
 * can still read, book, and talk to Mada (support and request threads never close). Lifting the block on the desk
 * lifts all of it at once. The app shows ACCOUNT_LIMITED's words, and GET /circles says `limited` so Circles can
 * say it up front instead of after a tap.
 */

export async function isLimited(userId: string, tx: Tx | typeof db = db): Promise<boolean> {
  const [b] = await tx.select({ id: appDeskBlocks.id }).from(appDeskBlocks).where(and(eq(appDeskBlocks.userId, userId), isNull(appDeskBlocks.liftedAt))).limit(1);
  return !!b;
}

/** Throws ACCOUNT_LIMITED for an account the desk has blocked from Circles and messaging. */
export async function assertNotLimited(userId: string, tx: Tx | typeof db = db): Promise<void> {
  if (await isLimited(userId, tx)) throw new AppError("ACCOUNT_LIMITED");
}
