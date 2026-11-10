"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { isUuid } from "@/lib/security";
import { str, toState, type ActionState } from "@/lib/actions";
import {
  type DocType, type ItineraryData, type VoucherData, type ReceiptData, type FlightItem,
  DOC_TYPES, REF_PREFIX, receiptTotals, money2, itineraryItems,
} from "./types";

const MAX_DATA = 200_000;

// What the ledger shows for each document: a short title and who it's for, derived from the content.
function summarize(type: DocType, data: ItineraryData | VoucherData | ReceiptData): { title: string; forName: string | null } {
  if (type === "itinerary") {
    const d = data as ItineraryData;
    const first = itineraryItems(d).find((x) => x.kind === "flight") as FlightItem | undefined;
    const route = first && (first.fromCode || first.toCode) ? `${first.fromCode || "?"} → ${first.toCode || "?"}` : "Itinerary";
    return { title: route, forName: d.passengers.find((p) => p.name.trim())?.name ?? null };
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
  let data: ItineraryData | VoucherData | ReceiptData;
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
  let data: ItineraryData | VoucherData | ReceiptData;
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
