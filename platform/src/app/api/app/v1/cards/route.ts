import { AddCardRequest, CardsResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { addCard, listCards } from "@/lib/app/account/cards";
import { authed } from "@/lib/app/account/route";

// GET /cards → { cards, defaultId }. POST { token, brand, last4, exp, makeDefault? } → 201 { cards, defaultId }.
// The token comes from the payment provider's SDK; card numbers never reach Mada.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(CardsResponse.parse(await listCards(userId))));

export const POST = authed(async (req, { userId, ipHash }) => {
  const input = await body(req, AddCardRequest);
  return json(CardsResponse.parse(await addCard(userId, input, ipHash)), 201);
});
