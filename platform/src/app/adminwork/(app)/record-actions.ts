"use server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str, type ActionState } from "@/lib/actions";
import { canAnnotateRecord, recordLabel, recordPath, RECORD_TYPES } from "@/lib/access";
import { detectFileType, isUuid } from "@/lib/security";

const ENTITY = new Set<string>(RECORD_TYPES);
const MAX_FILE = 6 * 1024 * 1024;

// The record, its label and where it lives are all resolved on the server. The browser only says which record.
export async function addRemark(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const entityType = str(fd, "entityType"), entityId = str(fd, "entityId"), body = str(fd, "body");
  if (!ENTITY.has(entityType) || !isUuid(entityId)) return { error: "Unknown record" };
  if (!body) return { error: "Write a remark first" };
  if (body.length > 2000) return { error: "Keep remarks under 2,000 characters" };
  if (!(await canAnnotateRecord(u, entityType, entityId, "remark"))) return { error: "You can't add remarks to this record" };
  const ref = await recordLabel(entityType, entityId);
  await db.transaction(async (tx) => {
    await tx.insert(schema.remarks).values({ entityType, entityId, userId: u.id, body });
    await audit(tx, { actorId: u.id, action: "remark.added", entityType, entityId, entityRef: ref, summary: `Remarked on ${ref || entityType}: "${body.slice(0, 120)}"` });
  });
  revalidatePath(recordPath(entityType, entityId));
  return { ok: "Remark added" };
}

export async function uploadAttachment(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const entityType = str(fd, "entityType"), entityId = str(fd, "entityId");
  const file = fd.get("file");
  if (!ENTITY.has(entityType) || !isUuid(entityId)) return { error: "Unknown record" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
  if (file.size > MAX_FILE) return { error: "Files must be under 6 MB" };
  if (!(await canAnnotateRecord(u, entityType, entityId, "file"))) return { error: "You can't add files to this record" };
  const data = Buffer.from(await file.arrayBuffer());
  const mime = detectFileType(data); // from the file's own bytes, never the browser's claim
  if (!mime) return { error: "Upload a PDF or an image" };
  const ref = await recordLabel(entityType, entityId);
  const filename = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200) || "file";
  await db.transaction(async (tx) => {
    await tx.insert(schema.attachments).values({ entityType, entityId, filename, mime, size: data.length, data, uploadedBy: u.id });
    await audit(tx, { actorId: u.id, action: "attachment.added", entityType, entityId, entityRef: ref, summary: `Attached ${filename} to ${ref || entityType}` });
  });
  revalidatePath(recordPath(entityType, entityId));
  return { ok: "File attached" };
}
