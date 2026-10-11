import { ChooseTransferBody, type ChooseTransferResponse, type TransferOptionsResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { loadTrip, withParams } from "@/lib/app/trips/route";
import { chooseTransfer, transferOptions } from "@/lib/app/transfers/service";

// GET /api/app/v1/trips/{id}/transfers → { outcome, airport, hotel, arrival, people, options, request }: airport pickups
// from Hotelbeds for the trip's landing, each held 20 minutes. POST { optionId, clientKey } → 201 { request }: the pick
// goes to the desk with the supplier's rate on it (beta: the desk books, quotes, the traveller pays in the app).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  return json((await transferOptions(userId, trip)) satisfies TransferOptionsResponse);
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, ChooseTransferBody);
  const trip = await loadTrip(req, userId, id);
  const request = await chooseTransfer(userId, trip, input, requestContext(req).ipHash);
  return json({ request } satisfies ChooseTransferResponse, 201);
});
