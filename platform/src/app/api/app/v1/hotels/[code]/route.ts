import type { HotelDetails } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { hotelContent } from "@/lib/app/suppliers/hotelbeds/content";

// GET /api/app/v1/hotels/{code} → { hotel }: a Hotelbeds hotel's content from our store (category, every image,
// facilities, description, address). Never a live call to the Content API (their rule).
export const dynamic = "force-dynamic";

const CATEGORY: Record<string, string> = { EST: "stars", LL: "keys", AT: "keys", SUP: "stars superior", H: "stars", HS: "stars", APTH: "apartments" };
function categoryOf(code: string | null): string | null {
  if (!code) return null;
  const m = /^(\d)(\D+)$/.exec(code);
  if (!m) return code;
  return `${m[1]} ${CATEGORY[m[2]!] ?? m[2]!.toLowerCase()}`;
}

export const GET = withParams<{ code: string }>(async (_req, { code }) => {
  const n = Number(code);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("NOT_FOUND");
  const h = await hotelContent(n);
  if (!h) throw new AppError("NOT_FOUND");
  const hotel: HotelDetails = {
    code: h.code, name: h.name, category: categoryOf(h.category), address: [h.address, h.postalCode, h.city ? h.city.charAt(0) + h.city.slice(1).toLowerCase() : null].filter(Boolean).join(", ") || null,
    phone: h.phone, description: h.description, images: h.images.map((i) => `https://photos.hotelbeds.com/giata/xl/${i.path.replace(/^\//, "")}`),
    facilities: h.facilities.filter((f) => f.name).map((f) => ({ name: f.name!, paid: !!f.paid })),
    latitude: h.latitude, longitude: h.longitude, source: "HBX Group",
  };
  return json({ hotel });
});
