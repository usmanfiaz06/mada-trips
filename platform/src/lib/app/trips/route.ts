import "server-only";
import type { TripDetail } from "@mada/shared";
import { errorResponse } from "../http";
import { authenticate, type AppAuth } from "../tokens";
import { demoPhase, tripDetail } from "./core";
import { openRequestCount } from "./overview";

/** A route handler with path params, auth and the error envelope. */
export function withParams<P extends Record<string, string>>(fn: (req: Request, params: P, auth: AppAuth) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const auth = await authenticate(req);
      return await fn(req, await ctx.params, auth);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** The trip as the caller may see it: their own, with the clock (and demo override) applied and open requests counted. */
export async function loadTrip(req: Request, ownerId: string, id: string): Promise<TripDetail> {
  const trip = await tripDetail(ownerId, id, req);
  return { ...trip, openRequests: await openRequestCount(ownerId, id) };
}

export { demoPhase };
