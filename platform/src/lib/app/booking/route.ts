import "server-only";
import type { DemoFlag } from "@mada/shared";
import { requestContext } from "../context";
import { errorResponse } from "../http";
import { authenticate, type AppAuth } from "../tokens";
import { demoFlags } from "./common";

/* Route helper for booking endpoints: authentication first, the demo switches (mock mode only), one error envelope. */

type Ctx<P> = { params: Promise<P> };
export type BookingAuth = AppAuth & { ipHash: string | null; demo: Set<DemoFlag> };

export function bookingRoute<P extends Record<string, string> = Record<string, never>>(fn: (req: Request, auth: BookingAuth, params: P) => Promise<Response>) {
  return async (req: Request, ctx?: Ctx<P>): Promise<Response> => {
    try {
      const auth = await authenticate(req);
      const params = ((await ctx?.params) ?? {}) as P;
      return await fn(req, { ...auth, ipHash: requestContext(req).ipHash, demo: demoFlags(req) }, params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
