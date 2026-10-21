import { HotelTranslationResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { openRoute } from "@/lib/app/guest";
import { hotelCodeOf } from "@/lib/app/shield";
import { hotelTranslation } from "@/lib/app/translate";

// GET /hotels/{code}/translation?to=ar → the hotel's description and facility names in that language, translated once
// and kept (lib/app/translate.ts). 501 NOT_CONFIGURED without the translator: the page keeps the original.
export const dynamic = "force-dynamic";

export const GET = openRoute<{ code: string }>("search", async (req, _auth, { code }) => {
  const n = hotelCodeOf(code);
  if (!n) throw new AppError("NOT_FOUND");
  const to = new URL(req.url).searchParams.get("to") === "en" ? "en" : "ar";
  return json(HotelTranslationResponse.parse(await hotelTranslation(n, to)));
});
