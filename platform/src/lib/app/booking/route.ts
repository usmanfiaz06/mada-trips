import "server-only";
import type { DemoFlag } from "@mada/shared";
import { requestContext } from "../context";
import { resilient } from "../http";
import { authenticate, type AppAuth } from "../tokens";
import { demoFlags } from "./common";

/*
 * Route helper for booking endpoints: the shared resilience wrapper (request id, version and maintenance gates,
 * Idempotency-Key replay on POSTs, one error envelope), then authentication and the demo switches (mock mode only).
 */

type Ctx<P> = { params: Promise<P> };
export type BookingAuth = AppAuth & { ipHash: string | null; demo: Set<DemoFlag> };

export function bookingRoute<P extends Record<string, string> = Record<string, never>>(fn: (req: Request, auth: BookingAuth, params: P) => Promise<Response>) {
  return (req: Request, ctx: Ctx<P>): Promise<Response> => resilient(req, async () => {
    const auth = await authenticate(req);
    const params = ((await ctx.params) ?? {}) as P;
    return fn(req, { ...auth, ipHash: requestContext(req).ipHash, demo: demoFlags(req) }, params);
  });
}
