import { DevicesResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { listDevices } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// GET /account/devices → { devices }: every signed-in device, this one first and marked current.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId, sessionId }) => json(DevicesResponse.parse({ devices: await listDevices(userId, sessionId) })));
