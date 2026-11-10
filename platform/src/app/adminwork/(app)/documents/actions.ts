"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { isUuid, detectFileType } from "@/lib/security";
import { str, toState, type ActionState } from "@/lib/actions";
import {
  type DocType, type ItineraryData, type TransportData, type VoucherData, type ReceiptData, type FlightItem,
  DOC_TYPES, REF_PREFIX, TRANSPORT_LABEL, receiptTotals, money2, itineraryItems,
} from "./types";

const MAX_DATA = 200_000;

// What the ledger shows for each document: a short title and who it's for, derived from the content.
function summarize(type: DocType, data: ItineraryData | TransportData | VoucherData | ReceiptData): { title: string; forName: string | null } {
  if (type === "itinerary") {
    const d = data as ItineraryData;
    const first = itineraryItems(d).find((x) => x.kind === "flight") as FlightItem | undefined;
    const route = first && (first.fromCode || first.toCode) ? `${first.fromCode || "?"} → ${first.toCode || "?"}` : "Itinerary";
    return { title: route, forName: d.passengers.find((p) => p.name.trim())?.name ?? null };
  }
  if (type === "transport") {
    const d = data as TransportData;
    const route = (d.fromPlace.trim() || d.toPlace.trim()) ? `${d.fromPlace.trim() || "?"} → ${d.toPlace.trim() || "?"}` : TRANSPORT_LABEL[d.mode];
    return { title: `${TRANSPORT_LABEL[d.mode]} · ${route}`, forName: d.passengers.find((p) => p.name.trim())?.name ?? null };
  }
  if (type === "voucher") {
    const d = data as VoucherData;
    return { title: d.hotel.trim() || "Hotel voucher", forName: d.guest.trim() || null };
  }
  const d = data as ReceiptData;
  const { total } = receiptTotals(d);
  return { title: `${d.invoice ? "Tax invoice" : "Receipt"} · SAR ${money2(total)}`, forName: d.billTo.trim() || null };
}

export async function createDocument(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("documents.issue");
  const type = str(fd, "type") as DocType;
  if (!DOC_TYPES.includes(type)) return { error: "Pick a document type" };
  const date = str(fd, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a valid date" };
  const raw = str(fd, "data");
  if (!raw) return { error: "Nothing to save yet — fill in the document first" };
  if (raw.length > MAX_DATA) return { error: "This document is too large to save" };
  let data: ItineraryData | TransportData | VoucherData | ReceiptData;
  try { data = JSON.parse(raw); } catch { return { error: "Couldn't read the document — please try again" }; }

  const { title, forName } = summarize(type, data);
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const ref = await nextRef(tx, REF_PREFIX[type]);
      const [row] = await tx.insert(schema.documents).values({ ref, type, title, forName, docDate: date, data, createdBy: u.id }).returning();
      await audit(tx, { actorId: u.id, action: "document.issued", entityType: "document", entityId: row.id, entityRef: ref, summary: `Issued ${type} ${ref}${forName ? ` for ${forName}` : ""}` });
      return row.id;
    });
  } catch (e) { return toState(e); }
  redirect(`/adminwork/documents/${id}`);
}

/**
 * Attach the carrier's original ticket PDF (or image) to a document — e.g. a bus/train ticket that carries a
 * QR code, which can't be recreated. The file is stored on the record and viewable/downloadable; ticking
 * "has a QR code" also marks the document so the QR original is clearly flagged.
 */
export async function attachDocumentFile(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("documents.issue");
  const id = str(fd, "id");
  if (!isUuid(id)) return { error: "Document not found" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or image to upload", fields: { file: "x" } };
  if (file.size > 10 * 1024 * 1024) return { error: "The file must be under 10 MB" };
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = detectFileType(bytes); // from the file's own bytes, not the browser's claim
  if (!mime) return { error: "Upload a PDF or an image" };
  const hasQr = str(fd, "hasQr") === "on";
  try {
    await db.transaction(async (tx) => {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
      if (!doc) throw new Error("Document not found");
      await tx.insert(schema.attachments).values({
        entityType: "document", entityId: id, mime, size: bytes.length, data: bytes, uploadedBy: u.id,
        filename: (file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200) || "ticket"),
      });
      if (hasQr && !(doc.data as { hasQr?: boolean }).hasQr) {
        await tx.update(schema.documents).set({ data: { ...(doc.data as object), hasQr: true } }).where(eq(schema.documents.id, id));
      }
      await audit(tx, { actorId: u.id, action: "document.attached", entityType: "document", entityId: id, entityRef: doc.ref,
        summary: `Attached ${hasQr ? "QR original ticket" : "a file"} to ${doc.ref}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath(`/adminwork/documents/${id}`);
  return { ok: "File attached" };
}

/**
 * Edit a document in place. The same record (and ref) is kept and its printed/saved PDF updates — so fixing
 * a mistake no longer means creating a duplicate. The document type never changes on an edit.
 */
export async function updateDocument(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("documents.issue");
  const id = str(fd, "id");
  if (!isUuid(id)) return { error: "Document not found" };
  const date = str(fd, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a valid date" };
  const raw = str(fd, "data");
  if (!raw) return { error: "Nothing to save yet — fill in the document first" };
  if (raw.length > MAX_DATA) return { error: "This document is too large to save" };
  let data: ItineraryData | TransportData | VoucherData | ReceiptData;
  try { data = JSON.parse(raw); } catch { return { error: "Couldn't read the document — please try again" }; }
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
      if (!before) throw new Error("Document not found");
      const { title, forName } = summarize(before.type as DocType, data); // type is fixed; derive labels from the edited content
      await tx.update(schema.documents).set({ title, forName, docDate: date, data }).where(eq(schema.documents.id, id));
      await audit(tx, { actorId: u.id, action: "document.updated", entityType: "document", entityId: id, entityRef: before.ref,
        summary: `Edited ${before.type} ${before.ref}${forName ? ` for ${forName}` : ""}`, changes: diff({ title: before.title, date: before.docDate }, { title, date }) });
    });
  } catch (e) { return toState(e); }
  redirect(`/adminwork/documents/${id}`);
}
