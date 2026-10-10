import { PresenceQuery, type PresenceResponse } from "@mada/shared";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appMessages, appRequests } from "@/db/app-schema";
import { AppError, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { presenceFor } from "@/lib/app/desk/agents";

// GET /api/app/v1/support/presence[?threadKind=request|support&threadId=…] → who is on duty for this traveller now:
// { title: "Mada", agent, usual (when someone is covering), covering, online, typing, replyMinutes, line }.
// Typing is only reported for a thread the caller owns.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  const url = new URL(req.url);
  const q = PresenceQuery.safeParse({ threadKind: url.searchParams.get("threadKind") ?? undefined, threadId: url.searchParams.get("threadId") ?? undefined });
  if (!q.success || (!!q.data.threadKind !== !!q.data.threadId)) throw new AppError("VALIDATION", { fields: { threadId: "Pass threadKind and threadId together" } });
  let thread: { kind: "request" | "support"; id: string } | null = null;
  if (q.data.threadKind && q.data.threadId) {
    const owns = q.data.threadKind === "request"
      ? (await db.select({ id: appRequests.id }).from(appRequests).where(and(eq(appRequests.id, q.data.threadId), eq(appRequests.ownerId, userId))).limit(1)).length > 0
      : (await db.select({ id: appMessages.id }).from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, q.data.threadId), eq(appMessages.authorUserId, userId))).limit(1)).length > 0;
    if (owns) thread = { kind: q.data.threadKind, id: q.data.threadId };
  }
  return json((await presenceFor(userId, thread)) satisfies PresenceResponse);
});
