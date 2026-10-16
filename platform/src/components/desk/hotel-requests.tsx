import { HotelRequests, hotelRequestLines } from "@mada/shared";
import { Badge, Card, CardHead } from "@/components/ui";

/** What the traveller asked the hotel for on the order sheet (the stay's draft): chips and their own words, as sent to the property. */
export function HotelRequestsCard({ draft, t }: { draft: Record<string, unknown> | null | undefined; t: (s: string) => string }) {
  const parsed = HotelRequests.nullish().safeParse(draft?.requests);
  const lines = parsed.success ? hotelRequestLines(parsed.data, "en") : [];
  if (!lines.length) return null;
  return (
    <Card>
      <CardHead title={t("Requests for the hotel")} hint={t("Asked on the order sheet. Sent to the property with the booking; hotels do their best, none of it is a promise.")} />
      <ul className="mt-2 flex flex-wrap gap-2">
        {lines.map((l, i) => <li key={i}><Badge tone="info" className="h-auto whitespace-normal py-1">{l}</Badge></li>)}
      </ul>
    </Card>
  );
}
