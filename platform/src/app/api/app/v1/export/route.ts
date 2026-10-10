import { ExportResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { latestExport, requestExport } from "@/lib/app/account/privacy";
import { authed } from "@/lib/app/account/route";

// GET /export → { export }: the latest request. POST /export → 202 { export }: a copy of everything, emailed within
// 24 hours as a link that works for 7 days. Needs an email on the account.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(ExportResponse.parse({ export: await latestExport(userId) })));

export const POST = authed(async (_req, { userId, ipHash }) => json(ExportResponse.parse({ export: await requestExport(userId, ipHash) }), 202));
