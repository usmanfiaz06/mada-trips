import "server-only";
import type { DemoFlag, GuestTraveller, Person } from "@mada/shared";
import { requestContext } from "./context";
import { resilient, type RouteOptions } from "./http";
import { authenticateOptional, type AppAuth } from "./tokens";
import { demoFlags } from "./booking/common";
import { hit } from "./circles/limits";

/*
 * Looking around without an account (Apple 5.1.1(v): sign-in only where an account is the point). Search, prices,
 * hotel pages, Discover, places and the curated plans answer a guest; booking, saving, chat with Mada, Circles and the
 * Wallet stay behind sign-in. A guest call carries no token: it is counted per network (the IP's hash) and answers
 * nothing personal. A signed-in call through the same route works exactly as before.
 */

/** Calls per network per minute without an account: searches cost a supplier call, reads are cheap. */
export const GUEST_LIMITS = { searchesPerMinute: 20, readsPerMinute: 120 } as const;

type Ctx<P> = { params: Promise<P> };
export type OpenAuth = { userId: string | null; sessionId: string | null; ipHash: string | null; demo: Set<DemoFlag> };

/**
 * A route a guest may call. `kind` picks the guest limit. A bad or expired token is still an error (the app
 * refreshes it); only a request with no Authorization header at all is a guest.
 */
export function openRoute<P extends Record<string, string> = Record<string, never>>(
  kind: "search" | "read",
  fn: (req: Request, auth: OpenAuth, params: P) => Promise<Response>,
  opts: RouteOptions = {},
) {
  return (req: Request, ctx: Ctx<P>): Promise<Response> => resilient(req, async () => {
    const auth: AppAuth | null = await authenticateOptional(req);
    const { ipHash } = requestContext(req);
    if (!auth) {
      const limit = kind === "search" ? GUEST_LIMITS.searchesPerMinute : GUEST_LIMITS.readsPerMinute;
      await hit(`guest:${kind}:${ipHash ?? "unknown"}`, limit, 60);
    }
    const params = ((await ctx?.params) ?? {}) as P;
    return fn(req, { userId: auth?.userId ?? null, sessionId: auth?.sessionId ?? null, ipHash, demo: demoFlags(req) }, params);
  }, opts);
}

/**
 * The people a guest said are going, as the pricing rules need them: an id (the phone's), an age if known, nothing
 * else. Never stored on a person; the offers keep only the ids.
 */
export function guestPeople(ids: string[], guests: GuestTraveller[] | undefined): Person[] {
  const said = new Map((guests ?? []).map((g) => [g.id, g]));
  return [...new Set(ids)].map((id, i) => {
    const g = said.get(id);
    return {
      id, isSelf: g?.isSelf ?? i === 0, givenNames: "", surname: "", firstName: "", relation: g?.isSelf || (!g && i === 0) ? "self" : "family",
      dateOfBirth: g?.dateOfBirth ?? null, sex: null, nationality: null, passport: null, createdAt: new Date(0).toISOString(),
    } satisfies Person;
  });
}
