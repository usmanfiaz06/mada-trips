import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { isUuid, SAFE_INLINE_TYPES } from "@/lib/security";

// Files the desk sent in a traveller's thread (stored with the Ops attachments, entity "app_thread"). Desk only.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.mustChangePassword || !u.permissions.has("desk.view")) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [f] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.entityType, "app_thread")));
  if (!f) return notFound();
  const inline = SAFE_INLINE_TYPES.has(f.mime);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.mime : "application/octet-stream", "Content-Length": String(f.data.length), "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'${f.mime === "application/pdf" ? "" : "; sandbox"}`,
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
