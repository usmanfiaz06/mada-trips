import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { nextRef } from "@/lib/refs";
import { asciiDigits } from "@/lib/leads";

// Public intake for the website's chat bot and enquiry forms. No login: the middleware lets /adminwork/api/* through,
// and nothing here reads or returns platform data. Same-origin only (the website and Mada Ops share a domain).
export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;
const PER_IP_PER_HOUR = 20;

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const Lead = z.object({
  source: z.enum(["chat", "form"]),
  sessionKey: text(64),
  name: text(80),
  email: text(120).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email"),
  phone: text(32).transform((v) => (v ? asciiDigits(v) : v)).refine((v) => !v || (/^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 6), "Enter a valid phone"),
  services: z.array(z.string().trim().max(80)).max(10).optional().transform((a) => (a ?? []).filter(Boolean)),
  details: z.record(z.string().trim().min(1).max(80), z.string().trim().max(300)).optional()
    .refine((d) => !d || Object.keys(d).length <= 20, "Too many details")
    .transform((d) => Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v))),
  message: text(3000),
  questions: z.array(z.string().trim().max(300)).max(10).optional().transform((a) => (a ?? []).filter(Boolean)),
  lang: z.enum(["en", "ar"]).optional(),
  page: text(200),
});

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function clientIp(req: Request) {
  return (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0])?.trim().slice(0, 64) || "unknown";
}
const hashIp = (ip: string) => createHash("sha256").update(`mada-leads:${process.env.IP_HASH_SALT ?? ""}:${ip}`).digest("hex");

export async function POST(req: Request) {
  // Only the website itself: browsers mark requests from other sites, and those are refused.
  if (req.headers.get("sec-fetch-site") === "cross-site") return json({ ok: false }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ ok: false }, 413);

  // JSON, or text/plain holding JSON (navigator.sendBeacon sends text/plain).
  let raw: unknown;
  try {
    const body = await req.text();
    if (Buffer.byteLength(body) > MAX_BODY) return json({ ok: false }, 413);
    raw = JSON.parse(body);
  } catch { return json({ ok: false }, 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ ok: false }, 400);

  // Honeypot: people never see this field, bots fill it. Look successful, save nothing.
  const trap = (raw as { website?: unknown }).website;
  if (trap !== undefined && trap !== null && String(trap).trim() !== "") return json({ ok: true });

  const p = Lead.safeParse(raw);
  if (!p.success) return json({ ok: false }, 400);
  const v = p.data;
  const ipHash = hashIp(clientIp(req));
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) || null;

  try {
    const result = await db.transaction(async (tx) => {
      // The chat sends a partial lead as soon as it has a phone, then more later: same conversation, same row.
      if (v.source === "chat" && v.sessionKey) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead:${v.sessionKey}`}))`);
        const [prev] = await tx.select().from(schema.leads)
          .where(and(eq(schema.leads.source, "chat"), eq(schema.leads.sessionKey, v.sessionKey), gt(schema.leads.createdAt, sql`now() - interval '24 hours'`)))
          .orderBy(desc(schema.leads.createdAt)).limit(1).for("update");
        if (prev) {
          const details = { ...(prev.details as Record<string, string>), ...v.details };
          const questions = [...new Set([...((prev.questions as string[]) ?? []), ...v.questions])].slice(-10);
          await tx.update(schema.leads).set({
            name: v.name ?? prev.name, email: v.email ?? prev.email, phone: v.phone ?? prev.phone,
            services: v.services.length ? v.services : prev.services,
            details: Object.fromEntries(Object.entries(details).slice(-40)), questions,
            message: v.message ?? prev.message, lang: v.lang ?? prev.lang, page: v.page ?? prev.page,
            userAgent: userAgent ?? prev.userAgent, updatedAt: new Date(),
          }).where(eq(schema.leads.id, prev.id));
          return { ref: prev.ref };
        }
      }
      if (!v.phone && !v.email) return { error: 400 as const };
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.leads)
        .where(and(eq(schema.leads.ipHash, ipHash), gt(schema.leads.createdAt, sql`now() - interval '1 hour'`)));
      if (n >= PER_IP_PER_HOUR) return { error: 429 as const };

      const ref = await nextRef(tx, "LD");
      const [lead] = await tx.insert(schema.leads).values({
        ref, source: v.source, sessionKey: v.sessionKey ?? null, name: v.name ?? null, email: v.email ?? null, phone: v.phone ?? null,
        services: v.services, details: v.details, message: v.message ?? null, questions: v.questions,
        lang: v.lang ?? null, page: v.page ?? null, userAgent, ipHash,
      }).returning({ id: schema.leads.id });
      // Logged as a system event, without the sender's IP.
      await tx.insert(schema.auditEvents).values({
        actorId: null, action: "lead.received", entityType: "lead", entityId: lead.id, entityRef: ref,
        summary: `New website lead ${ref} from the ${v.source === "chat" ? "chat" : "enquiry form"}${v.name ? `: ${v.name}` : ""}`,
      });
      return { ref };
    });
    if ("error" in result) return json({ ok: false }, result.error);
    return json({ ok: true, ref: result.ref });
  } catch (e) {
    console.error(e);
    return json({ ok: false }, 500);
  }
}
