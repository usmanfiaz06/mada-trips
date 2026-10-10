import { MoveCreditRequest, MoveCreditResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { moveCreditToCard } from "@/lib/app/credit";
import { cardLabel, ownCard } from "@/lib/app/account/cards";
import { authed } from "@/lib/app/account/route";

// POST /credit/move { cardId } → { credit, moved, to }: the whole balance goes back to a saved card (5 to 10 working days).
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  const { cardId } = await body(req, MoveCreditRequest);
  const card = await ownCard(userId, cardId);
  const label = cardLabel(card);
  const r = await moveCreditToCard(userId, { id: card.id, label }, ipHash);
  return json(MoveCreditResponse.parse({ credit: r.credit, moved: r.moved, to: label }));
});
