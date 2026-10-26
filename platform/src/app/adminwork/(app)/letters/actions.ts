"use server";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { str, toState, type ActionState } from "@/lib/actions";

const MAX_BODY = 80_000;      // generous for a one-page letter
const MAX_DESIGN = 3_000_000; // a typed signature is tiny; an uploaded signature image (data URL) a few hundred KB

// The body comes from a rich-text editor, rendered back only to staff who can issue letters. Strip anything
// executable so a stray paste can't store a script.
function sanitize(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, MAX_BODY);
}

export async function createLetter(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("letters.manage");
  const subject = str(fd, "subject");
  if (!subject) return { error: "Add a subject so the letter is easy to find later" };
  if (subject.length > 200) return { error: "Keep the subject under 200 characters" };
  const recipient = str(fd, "recipient").slice(0, 200) || null;
  const date = str(fd, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a valid date" };
  const bodyHtml = sanitize(str(fd, "bodyHtml"));
  let design: object = {};
  const rawDesign = str(fd, "design");
  if (rawDesign) {
    if (rawDesign.length > MAX_DESIGN) return { error: "The signature image is too large — use a smaller file" };
    try { design = JSON.parse(rawDesign) as object; } catch { return { error: "Couldn't read the stamp/signature layout" }; }
  }
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const ref = await nextRef(tx, "LH");
      const [m] = await tx.insert(schema.letters).values({ ref, subject, recipient, letterDate: date, bodyHtml, design, createdBy: u.id }).returning();
      await audit(tx, { actorId: u.id, action: "letter.issued", entityType: "letter", entityId: m.id, entityRef: ref, summary: `Issued letter ${ref}: ${subject}${recipient ? ` · to ${recipient}` : ""}` });
      return m.id;
    });
  } catch (e) { return toState(e); }
  redirect(`/adminwork/letters/${id}`);
}
