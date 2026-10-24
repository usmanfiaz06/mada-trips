import { afterEach, describe, expect, it, vi } from "vitest";
import { hotelReviews, metresBetween, reviewsOf } from "@/lib/app/hotels/google-reviews";

const hotel = { name: "Millennium Plaza Downtown Hotel Dubai", address: "Sheikh Zayed Road, Dubai", latitude: 25.2206, longitude: 55.2804 };
const place = (over: Record<string, unknown> = {}) => ({
  id: "p1", types: ["lodging", "hotel"], location: { latitude: 25.2209, longitude: 55.2801 }, rating: 4.36, userRatingCount: 2140,
  googleMapsUri: "https://maps.google.com/?cid=1",
  reviews: [
    { rating: 5, relativePublishTimeDescription: "2 weeks ago", text: { text: "Great view of the Burj.", languageCode: "en" }, originalText: { text: "Great view of the Burj.", languageCode: "en" }, authorAttribution: { displayName: "Sara A.", uri: "https://maps.google.com/u/1", photoUri: "https://lh3/x" } },
    { rating: 3, relativePublishTimeDescription: "a month ago", text: { text: "Good, breakfast was slow.", languageCode: "en" }, originalText: { text: "جيد", languageCode: "ar" }, authorAttribution: { displayName: "Omar" } },
    { rating: 4, text: { text: "" } },
  ],
  ...over,
});

describe("google reviews", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("measures metres", () => {
    expect(Math.round(metresBetween({ lat: 25.2206, lng: 55.2804 }, { lat: 25.2209, lng: 55.2801 }))).toBeLessThan(60);
  });

  it("takes the lodging at the hotel's spot, its rating and reviews with authors", () => {
    const r = reviewsOf(hotel, [place()]);
    expect(r.place?.rating).toBe(4.4);
    expect(r.place?.count).toBe(2140);
    expect(r.place?.reviews).toHaveLength(2);
    expect(r.place?.reviews[0]).toMatchObject({ author: "Sara A.", rating: 5, when: "2 weeks ago", translated: false });
    expect(r.place?.reviews[1]?.translated).toBe(true);
  });

  it("shows nothing rather than another hotel's reviews", () => {
    expect(reviewsOf(hotel, [place({ location: { latitude: 25.25, longitude: 55.3 } })]).place).toBeNull();
    expect(reviewsOf(hotel, [place({ types: ["restaurant"] })]).place).toBeNull();
    expect(reviewsOf(hotel, []).place).toBeNull();
  });

  it("needs a key, and sends the name, the address and the spot to Google", async () => {
    await expect(hotelReviews(hotel, "en")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ places: [place()] }), { status: 200 }));
    const r = await hotelReviews(hotel, "ar", fetcher as unknown as typeof fetch);
    expect(r.place?.count).toBe(2140);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ textQuery: "Millennium Plaza Downtown Hotel Dubai, Sheikh Zayed Road, Dubai", languageCode: "ar", includedType: "lodging" });
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
  });
});
