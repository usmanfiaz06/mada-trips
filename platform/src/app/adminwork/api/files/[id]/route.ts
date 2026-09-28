import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [f] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, id));
  if (!f) return new Response("Not found", { status: 404 });
  // Expense proofs: the submitter and people who can see all expenses. Sales documents: anyone in the team who can see sales.
  if (f.entityType === "expense" && !u.permissions.has("expenses.view_all")) {
    const [e] = await db.select({ by: schema.expenses.submittedBy }).from(schema.expenses).where(eq(schema.expenses.id, f.entityId));
    if (e?.by !== u.id) return new Response("Not found", { status: 404 });
  }
  if (["settlement", "user"].includes(f.entityType) && !u.permissions.has("finance.view") && !u.permissions.has("team.manage")) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mime, "Content-Length": String(f.size), "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
