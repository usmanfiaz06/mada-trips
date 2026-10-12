import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { readPassportCopy } from "@/lib/app/desk/passport-copy";

// A traveller's passport copy, for the agent on a booking that needs it (lib/app/desk/passport-copy.ts decides).
// Decrypted only here, shown inline (never as a download, never cached), and every look is audited.
const plain = (status: number, text: string) => new Response(text, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_: Request, { params }: { params: Promise<{ requestId: string; personId: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.mustChangePassword || !u.permissions.has("desk.act")) return plain(401, "Unauthorized");
  const { requestId, personId } = await params;
  if (!isUuid(requestId) || !isUuid(personId)) return plain(404, "Not found");
  try {
    const { file, bytes } = await readPassportCopy(u, requestId, personId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mime, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="passport-copy.${file.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin"}"`, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'${file.mime === "application/pdf" ? "" : "; sandbox"}`,
        "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof DeskError) return plain(e.kind === "NOT_FOUND" ? 404 : 403, e.message);
    throw e;
  }
}
