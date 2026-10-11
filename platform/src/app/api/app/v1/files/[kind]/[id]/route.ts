import { AppError, errorResponse } from "@/lib/app/http";
import { linkedFile, verifyFileLink } from "@/lib/app/file-links";
import { SAFE_INLINE_TYPES } from "@/lib/security";

// GET /files/{desk|app}/{id}?exp=…&sig=… → a file from a traveller's conversation, through a short-lived signed link
// (lib/app/file-links.ts). No sign-in header: the signature is the permission, minted after the owner check.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind, id } = await params;
    const url = new URL(req.url);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyFileLink(kind, id, url.searchParams.get("exp"), url.searchParams.get("sig"))) throw new AppError("NOT_FOUND");
    const f = await linkedFile(kind, id);
    if (!f) throw new AppError("NOT_FOUND");
    const inline = SAFE_INLINE_TYPES.has(f.mime);
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": inline ? f.mime : "application/octet-stream", "Content-Length": String(f.bytes.length), "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'${f.mime === "application/pdf" ? "" : "; sandbox"}`,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
