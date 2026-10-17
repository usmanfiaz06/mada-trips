import type { BoardingPassesResponse, ImportBoardingPassResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { importPasses, listPasses, MAX_PASS_FILE } from "@/lib/app/boarding";
import { requestContext } from "@/lib/app/context";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/boarding-passes → { passes, checkIn, appleWallet }: the airline's passes on this trip, when
// check-in opens for each flight still to come (with the airline's page), and whether Apple Wallet passes can be made.
// POST multipart { file }: a PDF, an image or a .pkpass from the airline's check-in → 201 { added, unmatched }.
// No barcode in the file, or one for another trip, is VALIDATION with the words to show (bp.unreadable, bp.otherTrip).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  return json((await listPasses(trip, Date.parse(trip.clock.now))) satisfies BoardingPassesResponse);
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PASS_FILE + 64 * 1024) throw new AppError("VALIDATION", { copy: "error.documentSize", fields: { file: "too_big" } });
  let form: FormData;
  try { form = await req.formData(); } catch { throw new AppError("VALIDATION", { fields: { file: "missing" } }); }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new AppError("VALIDATION", { fields: { file: "missing" } });
  if (file.size > MAX_PASS_FILE) throw new AppError("VALIDATION", { copy: "error.documentSize", fields: { file: "too_big" } });
  const bytes = Buffer.from(await file.arrayBuffer());
  const out = await importPasses(userId, trip, { bytes, name: (file.name || "boarding-pass").replace(/[\\/]/g, "_").slice(0, 120) }, { source: "traveller", ipHash: requestContext(req).ipHash });
  return json(out satisfies ImportBoardingPassResponse, 201);
});
