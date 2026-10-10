import { PersonDetailResponse, UpdatePersonRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { getPersonDetail, removePerson, updatePerson } from "@/lib/app/account/people";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /people/{id} → { person, details }. PATCH { relationLabel?, meal?, iqama?, exitVisa? } → { person, details }.
// DELETE → { ok }: removed from the household with their passport, details and documents. Never the account holder.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => json(PersonDetailResponse.parse(await getPersonDetail(userId, uuidParam(p.id)))));

export const PATCH = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const patch = await body(req, UpdatePersonRequest);
  return json(PersonDetailResponse.parse(await updatePerson(userId, id, patch, ipHash)));
});

export const DELETE = authed<{ id: string }>(async (_req, { userId, ipHash }, p) => {
  await removePerson(userId, uuidParam(p.id), ipHash);
  return json({ ok: true });
});
