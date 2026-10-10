import { PersonDetailResponse, SavePassportRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { savePassport, selfPersonId } from "@/lib/app/account/people";
import { authed } from "@/lib/app/account/route";

// PUT /passport { givenNames, surname, dateOfBirth, sex?, passport } → { person, details }: the account holder's own
// passport ("Add your passport"). Same rules as /people/{id}/passport.
export const dynamic = "force-dynamic";

export const PUT = authed(async (req, { userId, ipHash }) => {
  const input = await body(req, SavePassportRequest);
  return json(PersonDetailResponse.parse(await savePassport(userId, await selfPersonId(userId), input, ipHash)));
});
