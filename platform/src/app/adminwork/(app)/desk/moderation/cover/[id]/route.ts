import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/security";
import { deskCoverBytes } from "@/lib/app/circles/covers";

// A circle's uploaded cover photo, for the desk to check (Moderation). Desk only; never cached.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.mustChangePassword || !u.permissions.has("desk.view")) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    const { file, bytes } = await deskCoverBytes(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mime, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch { return notFound(); }
}
