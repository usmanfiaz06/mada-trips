"use server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str, type ActionState } from "@/lib/actions";

const ENTITY = new Set(["booking", "expense", "client", "approval", "close", "settlement", "user"]);
const MAX_FILE = 6 * 1024 * 1024;
const OK_MIME = /^(image\/(png|jpe?g|webp|heic)|application\/pdf)$/;

export async function addRemark(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const entityType = str(fd, "entityType"), entityId = str(fd, "entityId"), body = str(fd, "body"), path = str(fd, "path"), ref = str(fd, "ref");
  if (!ENTITY.has(entityType)) return { error: "Unknown record" };
  if (!body) return { error: "Write a remark first" };
  if (body.length > 2000) return { error: "Keep remarks under 2,000 characters" };
  await db.transaction(async (tx) => {
    await tx.insert(schema.remarks).values({ entityType, entityId, userId: u.id, body });
    await audit(tx, { actorId: u.id, action: "remark.added", entityType, entityId, entityRef: ref || null, summary: `Remarked on ${ref || entityType}: "${body.slice(0, 120)}"` });
  });
  revalidatePath(path);
  return { ok: "Remark added" };
}

export async function uploadAttachment(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const entityType = str(fd, "entityType"), entityId = str(fd, "entityId"), path = str(fd, "path"), ref = str(fd, "ref");
  const file = fd.get("file");
  if (!ENTITY.has(entityType)) return { error: "Unknown record" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file" };
  if (file.size > MAX_FILE) return { error: "Files must be under 6 MB" };
  if (!OK_MIME.test(file.type)) return { error: "Upload a PDF or an image" };
  const data = Buffer.from(await file.arrayBuffer());
  await db.transaction(async (tx) => {
    await tx.insert(schema.attachments).values({ entityType, entityId, filename: file.name.slice(0, 200), mime: file.type, size: file.size, data, uploadedBy: u.id });
    await audit(tx, { actorId: u.id, action: "attachment.added", entityType, entityId, entityRef: ref || null, summary: `Attached ${file.name} to ${ref || entityType}` });
  });
  revalidatePath(path);
  return { ok: "File attached" };
}
