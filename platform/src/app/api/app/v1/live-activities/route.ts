import { RegisterLiveActivityRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { registerActivity } from "@/lib/app/live";

// POST /api/app/v1/live-activities { tripId, segmentId, activityId, pushToken, platform, locale? } → { push }: the phone
// started (or got a new push token for) the lock-screen flight. `push` says whether the server will keep it current
// over APNs (false until the APNs key is set: docs/app/NATIVE.md). Repeats update the same row.
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId }) => json(await registerActivity(userId, await body(req, RegisterLiveActivityRequest))));
