import "server-only";
import { requestContext } from "../context";
import { resilient, type RouteOptions } from "../http";
import { authenticate, type AppAuth } from "../tokens";

/* Places endpoints: signed in, request id and gates from resilient(), params read the way Next passes them. */
type Ctx<P> = { params: Promise<P> };

export function placesRoute<P extends Record<string, string> = Record<string, never>>(fn: (req: Request, auth: AppAuth & { ipHash: string | null }, params: P) => Promise<Response>, opts: RouteOptions = {}) {
  return (req: Request, ctx: Ctx<P>): Promise<Response> => resilient(req, async () => {
    const auth = await authenticate(req);
    const params = ((await ctx?.params) ?? {}) as P;
    return fn(req, { ...auth, ipHash: requestContext(req).ipHash }, params);
  }, opts);
}

/** Query string → object, for zod. */
export const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());
