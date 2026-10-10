import { CardsResponse, SetDefaultCardRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { setDefault } from "@/lib/app/account/cards";
import { authed } from "@/lib/app/account/route";

// PUT /cards/default { id: cardId | "applepay" } → { cards, defaultId }.
export const dynamic = "force-dynamic";

export const PUT = authed(async (req, { userId, ipHash }) => {
  const { id } = await body(req, SetDefaultCardRequest);
  return json(CardsResponse.parse(await setDefault(userId, id, ipHash)));
});
