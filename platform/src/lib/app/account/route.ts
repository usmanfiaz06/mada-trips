import "server-only";
import { z } from "zod";
import { authenticate, type AppAuth } from "../tokens";
import { AppError, errorResponse } from "../http";
import { requestContext } from "../context";

/*
 * Route helpers for the Wallet and account endpoints: authentication first, path ids checked as UUIDs (anything else
 * is simply "not found"), the same error envelope as every Core API route.
 */

type Ctx<P> = { params: Promise<P> };
export type Authed = AppAuth & { ipHash: string | null };

export function authed<P extends Record<string, string> = Record<string, never>>(fn: (req: Request, auth: Authed, params: P) => Promise<Response>) {
  return async (req: Request, ctx?: Ctx<P>): Promise<Response> => {
    try {
      const auth = await authenticate(req);
      const params = ((await ctx?.params) ?? {}) as P;
      return await fn(req, { ...auth, ipHash: requestContext(req).ipHash }, params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const Uuid = z.uuid();
/** A path id that must be a UUID: anything else is NOT_FOUND, never a database error. */
export function uuidParam(v: string | undefined): string {
  if (!v || !Uuid.safeParse(v).success) throw new AppError("NOT_FOUND");
  return v;
}
