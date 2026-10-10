import { CreateInviteRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { inviteByPhone, linkFor, listInvites } from "@/lib/app/circles/invites";

// GET /invites → { sent, incoming, link }: people you invited to Mada, circle invites waiting for you, your link.
// POST /invites { phone, channel? } | { link: true } → { invite, link, onMada }. A number already on Mada comes
// back as onMada (add them as a friend instead).
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await listInvites(userId));
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreateInviteRequest);
  if ("link" in input) return json({ invite: null, link: await linkFor(userId, null), onMada: null });
  const r = await inviteByPhone(userId, input, requestContext(req).ipHash);
  return json({ ...r, link: null }, r.invite ? 201 : 200);
});
