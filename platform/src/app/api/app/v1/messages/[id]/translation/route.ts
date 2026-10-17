import { MessageTranslationResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { messageTranslation } from "@/lib/app/translate";

// GET /messages/{id}/translation?to=ar → { lang, text, machine }: a message the desk or Mada wrote in the other language,
// in the reader's, for whoever's conversation it is (lib/app/translate.ts). 501 NOT_CONFIGURED without the translator.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const to = new URL(req.url).searchParams.get("to") === "en" ? "en" : "ar";
  return json(MessageTranslationResponse.parse(await messageTranslation(userId, id, to)));
});
