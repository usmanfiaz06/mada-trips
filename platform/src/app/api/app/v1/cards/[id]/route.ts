import { CardsResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { removeCard } from "@/lib/app/account/cards";
import { authed, uuidParam } from "@/lib/app/account/route";

// DELETE /cards/{id}[?newDefault={id|applepay}] → { cards, defaultId }. Removing the default needs the new one first
// (FLOWS.md §9), unless it's the only card: then Apple Pay becomes the default.
export const dynamic = "force-dynamic";

export const DELETE = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const nd = new URL(req.url).searchParams.get("newDefault");
  if (nd && nd !== "applepay") uuidParam(nd);
  if (nd === p.id) throw new AppError("VALIDATION", { fields: { newDefault: "Same card" } });
  return json(CardsResponse.parse(await removeCard(userId, uuidParam(p.id), nd, ipHash)));
});
