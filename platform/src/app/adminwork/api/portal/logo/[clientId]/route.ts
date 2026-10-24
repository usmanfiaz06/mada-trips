import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/security";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** A client's logo: for Mada staff, and for that client's own people. */
export async function GET(_: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { clientId } = await params;
  if (!isUuid(clientId) || (u.clientId && u.clientId !== clientId)) return notFound();
  const [c] = await db.select({ logo: schema.clients.portalLogoId }).from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!c?.logo) return notFound();
  const [f] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, c.logo));
  if (!f || f.entityType !== "client_logo" || f.entityId !== clientId || !f.mime.startsWith("image/")) return notFound();
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mime, "Content-Length": String(f.data.length), "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
