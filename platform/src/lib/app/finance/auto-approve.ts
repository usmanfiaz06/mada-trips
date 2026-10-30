import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { autoApproveRefund, refundAutoMax, type AutoApproveDecision, type RefundClear, type RefundQuoteItem } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appDeskBlocks } from "@/db/app-schema-desk";
import { getSettings } from "@/lib/settings";

/*
 * Instant approval when the rules are clear (APP-FINANCE.md "Auto-approval"). A refund skips the desk only when all of
 * these hold:
 *   - the amount is what the rules give back with no fee (free-cancellation window, or the supplier's simulation
 *     shows none), or the supplier already confirmed the cancellation and the refund (the airline cancelled);
 *   - it goes to the Mada Wallet or back to the card (instalments always go to a person);
 *   - it is within APP_REFUND_AUTO_MAX (SAR; default the agent's single-refund limit, Rules & limits deskRefundLimit);
 *   - the account has no open fraud or abuse flag. The only such signal today is an unlifted desk block
 *     (app_desk_blocks); there is no fraud score or chargeback flag yet.
 * The decision itself is the pure autoApproveRefund in @mada/shared, so the app's mock follows the same rule.
 */

type Exec = Tx | typeof db;

/** The most a refund may be and still be approved by the rules, in halalas. */
export async function autoApproveMax(q: Exec = db): Promise<number> {
  return refundAutoMax(process.env.APP_REFUND_AUTO_MAX, (await getSettings(q)).deskRefundLimit);
}

/** An open fraud or abuse flag on the traveller: an unlifted desk block. */
export async function openRiskFlag(q: Exec, userId: string): Promise<boolean> {
  const [b] = await q.select({ id: appDeskBlocks.id }).from(appDeskBlocks).where(and(eq(appDeskBlocks.userId, userId), isNull(appDeskBlocks.liftedAt))).limit(1);
  return !!b;
}

/** How the rules settled these items: all back with no fee, the supplier confirmed (airline cancelled), or not clear. */
export function clearOf(quotes: readonly Pick<RefundQuoteItem, "paid" | "back" | "law" | "askAnyway">[], airlineCancelled = false): RefundClear {
  if (!quotes.length || quotes.some((q) => q.askAnyway || q.back.amount !== q.paid.amount)) return null;
  return airlineCancelled || quotes.some((q) => q.law) ? "supplier_confirmed" : "free";
}

export async function decideAuto(q: Exec, v: { userId: string; clear: RefundClear; destination: "original" | "credit" | "instalments"; amount: number }): Promise<AutoApproveDecision> {
  const [max, flagged] = await Promise.all([autoApproveMax(q), openRiskFlag(q, v.userId)]);
  return autoApproveRefund({ clear: v.clear, destination: v.destination, amount: v.amount, max, flagged });
}
