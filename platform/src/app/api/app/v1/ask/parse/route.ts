import { AskParseRequest, AskParseResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { parseAsk } from "@/lib/app/booking/ask";
import { openRoute } from "@/lib/app/guest";

// POST /ask/parse { text } → { intent }: what Mada understood (structure only, never a price). Claude with a strict tool
// schema in live mode, the deterministic rules in mock mode and whenever the model doesn't answer.
export const dynamic = "force-dynamic";

// Open to guests: what they typed is read the same way, without a household to match names against.
export const POST = openRoute("search", async (req, { userId }) => {
  const { text } = await body(req, AskParseRequest);
  return json(AskParseResponse.parse({ intent: await parseAsk(userId, text) }));
});
