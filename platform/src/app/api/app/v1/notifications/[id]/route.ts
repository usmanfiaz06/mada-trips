import { z } from "zod";
import { body, json } from "@/lib/app/http";
import { markOne } from "@/lib/app/trips/inbox";
import { withParams } from "@/lib/app/trips/route";

// PATCH /api/app/v1/notifications/{id} { read } → { notification }.
export const dynamic = "force-dynamic";

export const PATCH = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const { read } = await body(req, z.object({ read: z.boolean() }));
  return json({ notification: await markOne(userId, id, read) });
});
