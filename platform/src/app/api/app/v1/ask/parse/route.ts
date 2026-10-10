import { AskParseRequest, AskParseResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { parseAsk } from "@/lib/app/booking/ask";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /ask/parse { text } → { intent }: what Mada understood (structure only, never a price). Claude with a strict tool
// schema in live mode, the deterministic rules in mock mode and whenever the model doesn't answer.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId }) => {
  const { text } = await body(req, AskParseRequest);
  return json(AskParseResponse.parse({ intent: await parseAsk(userId, text) }));
});
