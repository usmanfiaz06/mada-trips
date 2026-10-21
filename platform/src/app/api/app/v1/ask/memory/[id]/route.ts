import { MemoryResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { authed, uuidParam } from "@/lib/app/account/route";
import { forgetFact, listMemory } from "@/lib/app/ask-chat/memory";

// DELETE /ask/memory/{id} → { facts }: remove one thing Ask Mada remembers; the rest come back.
export const dynamic = "force-dynamic";

export const DELETE = authed<{ id: string }>(async (_req, { userId }, p) => {
  if (!(await forgetFact(userId, uuidParam(p.id)))) throw new AppError("NOT_FOUND");
  return json(MemoryResponse.parse({ facts: await listMemory(userId) }));
});
