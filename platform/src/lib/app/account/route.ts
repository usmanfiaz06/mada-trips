import "server-only";
import { z } from "zod";
import { authenticate, type AppAuth } from "../tokens";
import { AppError, resilient, type RouteOptions } from "../http";
import { requestContext } from "../context";

/*
 * Route helpers for the Wallet and account endpoints: authentication first, path ids checked as UUIDs (anything else
 * is simply "not found"), and the same request id, version and maintenance gates, Idempotency-Key handling and error envelope as
 * every Core API route (resilient() from http.ts).
 */

type Ctx<P> = { params: Promise<P> };
export type Authed = AppAuth & { ipHash: string | null };

export function authed<P extends Record<string, string> = {}>( // eslint-disable-line @typescript-eslint/no-empty-object-type
  fn: (req: Request, auth: Authed, params: P) => Promise<Response>,
  opts: RouteOptions = {},
) {
  return (req: Request, ctx: Ctx<P>): Promise<Response> => resilient(req, async () => {
    const auth = await authenticate(req);
    const params = ((await ctx?.params) ?? {}) as P;
    return fn(req, { ...auth, ipHash: requestContext(req).ipHash }, params);
  }, opts);
}

const Uuid = z.uuid();
/** A path id that must be a UUID: anything else is NOT_FOUND, never a database error. */
export function uuidParam(v: string | undefined): string {
  if (!v || !Uuid.safeParse(v).success) throw new AppError("NOT_FOUND");
  return v;
}
