import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SLUG_RE } from "@/lib/portal";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** A client's logo for their branded sign-in page (/corporate/<slug>). Public: only the logo, only for open workspaces. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return notFound();
  const [c] = await db.select({ id: schema.clients.id, logo: schema.clients.portalLogoId }).from(schema.clients)
    .where(and(eq(schema.clients.portalSlug, slug), eq(schema.clients.portalEnabled, true)));
  if (!c?.logo) return notFound();
  const [f] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, c.logo));
  if (!f || f.entityType !== "client_logo" || f.entityId !== c.id || !f.mime.startsWith("image/")) return notFound();
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mime, "Content-Length": String(f.data.length), "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" },
  });
}
