// POST …/v1/log { logs: [string] }: Wallet's own error messages about our passes. Logged (trimmed), never stored.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { logs?: unknown } | null;
  const logs = Array.isArray(body?.logs) ? body.logs.filter((l): l is string => typeof l === "string").slice(0, 10) : [];
  for (const l of logs) console.warn(`[wallet] ${l.slice(0, 300)}`);
  return new Response(null, { status: 200 });
}
