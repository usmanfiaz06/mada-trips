import { timingSafeEqual } from "node:crypto";
import { AppError, json, route } from "@/lib/app/http";
import { refreshDue } from "@/lib/app/activities/ingest";

// GET /cron/activities → { refreshed: [...] }. The scheduled refresh of Things to do (OpenStreetMap, Wikidata,
// pageviews, Commons): a few cities due per run. Vercel Cron calls it daily with Authorization: Bearer CRON_SECRET
// (platform/vercel.json); without CRON_SECRET set it refuses. Also: npx tsx scripts/activities/refresh.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret ?? ""}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw new AppError("UNAUTHORIZED");
  const limit = Math.min(10, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 4) || 4));
  return json({ refreshed: await refreshDue({ limit, pauseMs: 1500 }) });
}, { ungated: true });
