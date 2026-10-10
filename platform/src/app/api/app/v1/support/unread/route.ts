import { SupportUnreadResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { unreadCount } from "@/lib/app/support/threads";
import { authed } from "@/lib/app/account/route";

// GET /support/unread → { unread }: messages from Mada not yet seen, across every conversation.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(SupportUnreadResponse.parse({ unread: await unreadCount(userId) })));
