import { PersonDetailResponse, SavePassportRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { savePassport } from "@/lib/app/account/people";
import { authed, uuidParam } from "@/lib/app/account/route";

// PUT /people/{id}/passport { givenNames, surname, dateOfBirth, sex?, passport } → { person, details }.
// Read on the phone (MRZ) or typed; the full number is encrypted, only the masked one comes back.
export const dynamic = "force-dynamic";

export const PUT = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const input = await body(req, SavePassportRequest);
  return json(PersonDetailResponse.parse(await savePassport(userId, id, input, ipHash)));
});
