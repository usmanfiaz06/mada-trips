import { CreatePersonRequest, type PeopleResponse, type PersonResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { createPerson, listPeople } from "@/lib/app/people";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/people → { people }: the household, account holder first. Passport numbers come back masked only.
// POST /api/app/v1/people { givenNames, surname, relation, passport? } → 201 { person }. Passport numbers are encrypted.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ people: await listPeople(userId) } satisfies PeopleResponse);
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreatePersonRequest);
  return json({ person: await createPerson(userId, input, requestContext(req).ipHash) } satisfies PersonResponse, 201);
});
