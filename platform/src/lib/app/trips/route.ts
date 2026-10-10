import "server-only";
import type { TripDetail } from "@mada/shared";
import { resilient } from "../http";
import { authenticate, type AppAuth } from "../tokens";
import { demoPhase, tripDetail } from "./core";
import { openRequestCount } from "./overview";

/** A route handler with path params and auth, run through resilient(): request ids, gates, idempotency, the error envelope. */
export function withParams<P extends Record<string, string>>(fn: (req: Request, params: P, auth: AppAuth) => Promise<Response>) {
  return (req: Request, ctx: { params: Promise<P> }) => resilient(req, async () => {
    const auth = await authenticate(req);
    return fn(req, await ctx.params, auth);
  });
}

/** The trip as the caller may see it: their own, with the clock (and demo override) applied and open requests counted. */
export async function loadTrip(req: Request, ownerId: string, id: string): Promise<TripDetail> {
  const trip = await tripDetail(ownerId, id, req);
  return { ...trip, openRequests: await openRequestCount(ownerId, id) };
}

export { demoPhase };
