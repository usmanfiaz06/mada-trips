import { z } from "zod";
import { RegisterDeviceRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { registerDevice, unregisterDevice } from "@/lib/app/trips/inbox";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/devices { pushToken, platform, name? } → 201 { deviceId }: this phone's Expo push token.
// DELETE { pushToken } → { ok }: no more pushes to it (sign-out, alerts turned off).
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId, sessionId } = await authenticate(req);
  const input = await body(req, RegisterDeviceRequest);
  return json({ deviceId: await registerDevice(userId, sessionId, input, requestContext(req).ipHash) }, 201);
});

export const DELETE = route(async (req) => {
  const { userId } = await authenticate(req);
  const { pushToken } = await body(req, z.object({ pushToken: z.string().min(10).max(400) }));
  await unregisterDevice(userId, pushToken);
  return json({ ok: true });
});
