import { MemoryResponse } from "@mada/shared";
import { db } from "@/db";
import { json } from "@/lib/app/http";
import { appAuditLog } from "@/lib/app/audit";
import { authed } from "@/lib/app/account/route";
import { forgetAll, listMemory } from "@/lib/app/ask-chat/memory";

// GET /ask/memory → { facts }: what Ask Mada remembers about the signed-in traveller (Account → What Mada remembers).
// DELETE /ask/memory → { facts: [] }: forget everything. docs/app/ASK-CHAT.md §7.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(MemoryResponse.parse({ facts: await listMemory(userId) })));

export const DELETE = authed(async (_req, { userId, ipHash }) => {
  const n = await forgetAll(userId);
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "ask.memory_forgotten", entityType: "app_user", entityId: userId, summary: `Asked Mada to forget everything (${n})`, ipHash });
  return json(MemoryResponse.parse({ facts: [] }));
});
