import { MemberPatchRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { makeAdmin, removeMember } from "@/lib/app/circles/circles";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// PATCH /circles/{id}/members/{uid} { role: "admin" } → { ok }: hand over admin (the admin).
// DELETE /circles/{id}/members/{uid} → { ok }: remove someone (the admin). Their messages stay.
export const dynamic = "force-dynamic";

export const PATCH = routeP<{ id: string; uid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await body(req, MemberPatchRequest);
  await makeAdmin(uuidParam(p.id), userId, uuidParam(p.uid));
  return json({ ok: true });
});

export const DELETE = routeP<{ id: string; uid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await removeMember(uuidParam(p.id), userId, uuidParam(p.uid));
  return json({ ok: true });
});
