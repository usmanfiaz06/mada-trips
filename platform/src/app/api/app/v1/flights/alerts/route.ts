import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { FlightNumber, FlightStatus, IsoDay } from "@mada/shared";
import { AppError, body, json, route } from "@/lib/app/http";
import { applyAlert } from "@/lib/app/trips/status";

// POST /api/app/v1/flights/alerts: FlightAware alert webhook (normalised by our alert relay). Authenticated by a shared
// secret in `x-mada-alerts-secret` (FLIGHT_ALERTS_SECRET); without it configured the endpoint answers 501.
// Each change reaches each traveller once: the inbox, then a push.
export const dynamic = "force-dynamic";

const Alert = z.object({
  flightNumber: FlightNumber, date: IsoDay, status: FlightStatus.optional(), gate: z.string().max(8).nullable().optional(),
  terminal: z.string().max(30).nullable().optional(), delayMin: z.number().int().min(0).max(2880).nullable().optional(),
});

export const POST = route(async (req) => {
  const secret = process.env.FLIGHT_ALERTS_SECRET;
  if (!secret || secret.length < 16) throw new AppError("NOT_CONFIGURED");
  const given = Buffer.from(req.headers.get("x-mada-alerts-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new AppError("UNAUTHORIZED");
  const a = await body(req, Alert);
  return json({ ok: true, ...(await applyAlert(a)) });
});
