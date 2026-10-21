import { AskThreadPatch, AskThreadResponse, AskThreadRow } from "@mada/shared";
import { AppError, body, json } from "@/lib/app/http";
import { authed, uuidParam } from "@/lib/app/account/route";
import { deleteThread, getThread, patchThread } from "@/lib/app/ask-chat/threads";

// GET /ask/threads/{id} → { thread, lines, last }: one chat and its lines, so it opens on any device.
// PATCH { title?, archived?, tripId? } → { thread }: rename (empty title: automatic again), archive or unarchive, or
// attach a chat about no trip yet to the trip a booking made in it created (§2.2).
// DELETE → { deleted: true }: the chat only; its trip, plan and bookings stay. docs/app/ASK-INTEGRATED.md §2.4.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => {
  const out = await getThread(userId, uuidParam(p.id));
  if (!out) throw new AppError("NOT_FOUND");
  return json(AskThreadResponse.parse(out));
});

export const PATCH = authed<{ id: string }>(async (req, { userId }, p) => {
  const id = uuidParam(p.id);
  const patch = await body(req, AskThreadPatch);
  const thread = await patchThread(userId, id, patch);
  if (!thread) throw new AppError("NOT_FOUND");
  return json({ thread: AskThreadRow.parse(thread) });
});

export const DELETE = authed<{ id: string }>(async (_req, { userId }, p) => {
  if (!(await deleteThread(userId, uuidParam(p.id)))) throw new AppError("NOT_FOUND");
  return json({ deleted: true });
});
