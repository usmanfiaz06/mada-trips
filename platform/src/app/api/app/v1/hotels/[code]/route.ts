import type { HotelDetails } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { openRoute } from "@/lib/app/guest";
import { hotelContent } from "@/lib/app/suppliers/hotelbeds/content";
import { bestImage, photoUrl } from "@/lib/app/suppliers/hotelbeds/hotels";
import { hotelCodeOf } from "@/lib/app/shield";

// GET /api/app/v1/hotels/{id} → { hotel }: a partner hotel's content from our store (category, every image,
// facilities, description, address). Never a live call to the Content API (their rule). {id} is the sealed id the stay
// card carries (lib/app/shield.ts); the photos go out through our image route.
export const dynamic = "force-dynamic";

const CATEGORY: Record<string, string> = { EST: "stars", LL: "keys", AT: "keys", SUP: "stars superior", H: "stars", HS: "stars", APTH: "apartments" };
function categoryOf(code: string | null): string | null {
  if (!code) return null;
  const m = /^(\d)(\D+)$/.exec(code);
  if (!m) return code;
  return `${m[1]} ${CATEGORY[m[2]!] ?? m[2]!.toLowerCase()}`;
}

/** Every photo at xl (the page is wide), the one the cards lead with first (bestImage: the hotel, a room, the lobby). */
function imagesOf(images: { path: string; type: string | null }[]): string[] {
  const lead = bestImage(images);
  return [...new Set([lead, ...images].filter((i): i is { path: string; type: string | null } => !!i?.path).map((i) => photoUrl(i.path, "xl")))];
}

// Open to guests: a hotel page (shared or found) opens for anyone.
export const GET = openRoute<{ code: string }>("read", async (_req, _auth, { code }) => {
  const n = hotelCodeOf(code);
  if (!n) throw new AppError("NOT_FOUND");
  const h = await hotelContent(n);
  if (!h) throw new AppError("NOT_FOUND");
  const hotel: HotelDetails = {
    code: String(h.code), name: h.name, category: categoryOf(h.category), address: [h.address, h.postalCode, h.city ? h.city.charAt(0) + h.city.slice(1).toLowerCase() : null].filter(Boolean).join(", ") || null,
    phone: h.phone, description: h.description, images: imagesOf(h.images),
    facilities: h.facilities.filter((f) => f.name).map((f) => ({ name: f.name!, paid: !!f.paid })),
    latitude: h.latitude, longitude: h.longitude,
  };
  return json({ hotel });
});
