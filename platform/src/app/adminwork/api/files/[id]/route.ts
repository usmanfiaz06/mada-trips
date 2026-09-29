import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { canViewRecord } from "@/lib/access";
import { isUuid, SAFE_INLINE_TYPES } from "@/lib/security";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.mustChangePassword) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [f] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, id));
  // A file is visible exactly when the record it belongs to is. Same answer whether it doesn't exist or isn't yours.
  if (!f || !(await canViewRecord(u, f.entityType, f.entityId))) return notFound();
  // Only known-safe types open in the browser; anything else (including older uploads) downloads.
  const inline = SAFE_INLINE_TYPES.has(f.mime);
  const name = encodeURIComponent(f.filename);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Length": String(f.data.length),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      // Images get a fully sandboxed document. Chrome's PDF viewer refuses to run under "sandbox", so PDFs get the rest.
      "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'${f.mime === "application/pdf" ? "" : "; sandbox"}`,
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
