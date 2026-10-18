import { EsimPlacesResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { esimPlaces } from "@/lib/app/esim/service";

// GET /esim/places → every country and region the eSIM supplier sells (ISO code or region code, English and Arabic
// names, flag), for the planner's "Where to?" search. From the catalogue synced each day.
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async () => json(EsimPlacesResponse.parse({ places: await esimPlaces() })));
