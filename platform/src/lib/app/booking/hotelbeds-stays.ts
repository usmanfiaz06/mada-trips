import "server-only";
import type { StoredStay } from "./search";
import { eq } from "drizzle-orm";
import { t, type StayOption } from "@mada/shared";
import { db } from "@/db";
import { appOffers } from "@/db/app-schema-booking";
import { decodeOfferId } from "../suppliers/hotelbeds/hotels";
import { hotelbedsHotels, toAppError } from "../suppliers/hotelbeds/app";
import { repriceOffer, type OfferRow } from "./search";

/*
 * Hotelbeds certification (docs/app/HOTELBEDS.md): before a traveller pays for a room,
 *   - a RECHECK rate goes through checkrates (the price may move; the order sheet shows the new one), and
 *   - the rate's comments (essential information: taxes, check-in rules, deposits) are shown in full (cert. 3.9).
 * A BOOKABLE rate gets its comments from the Content API's rateCommentDetails, by its rateCommentsId and check-in day.
 * The answer is kept on the offer, so the sheet doesn't ask again while it is open.
 */

const comments = new Map<string, { at: number; text: string | null }>();
const DAY = 24 * 3_600_000;

export async function withHotelbedsEssentials(ownerId: string, row: OfferRow): Promise<OfferRow> {
  const s = row.payload as unknown as StoredStay;
  if (!s.hotel || s.hotel.rateComments !== null) return row;
  const d = decodeOfferId(row.supplierOfferId);
  if (!d) return row;
  if (d.recheck) {
    // checkrates answers with the price and the full rateComments; repriceOffer keeps both on the offer.
    const { row: updated } = await repriceOffer(ownerId, row.id);
    const after = updated.payload as unknown as StoredStay;
    if (after.hotel && after.hotel.rateComments === null) await setComments(updated, "");
    return (await reload(row.id)) ?? updated;
  }
  let text = "";
  if (s.hotel.rateCommentsId) {
    const key = `${s.hotel.rateCommentsId}|${s.checkIn}`;
    const hit = comments.get(key);
    if (hit && Date.now() - hit.at < DAY) text = hit.text ?? "";
    else {
      try {
        const got = await hotelbedsHotels().rateCommentDetails(s.hotel.rateCommentsId, s.checkIn);
        comments.set(key, { at: Date.now(), text: got });
        text = got ?? "";
      } catch (e) {
        // Without the comments the room can't be sold (cert. 3.9): the traveller is told to try again.
        throw toAppError(e);
      }
    }
  }
  await setComments(row, text);
  return (await reload(row.id)) ?? row;
}

async function setComments(row: OfferRow, text: string) {
  const s = row.payload as unknown as StoredStay;
  await db.update(appOffers).set({ payload: { ...s, hotel: { ...s.hotel!, rateComments: text } } as unknown as Record<string, unknown> }).where(eq(appOffers.id, row.id));
}

async function reload(id: string) {
  const [r] = await db.select().from(appOffers).where(eq(appOffers.id, id));
  return r;
}

/** The order sheet's rule for a Hotelbeds room: the hotel's cancellation policy, then its essential information. */
export function hotelbedsRule(s: StayOption): string {
  const c = s.hotel?.rateComments?.trim();
  return c ? `${s.cancellation} ${t("hb.essential", { text: c })}` : s.cancellation;
}
