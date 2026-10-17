"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { deskAudit } from "@/lib/app/desk/core";
import { deskImport, MAX_PASS_FILE } from "@/lib/app/boarding";
import { AppError } from "@/lib/app/http";
import { db } from "@/db";
import { getT } from "@/lib/i18n";

/*
 * The desk uploads the airline's boarding pass on an order (components/desk/boarding.tsx). lib/app/boarding reads the
 * barcode, matches it to the traveller and flight, keeps it as theirs and tells them; the desk audit records who.
 */

export async function boardingPassUploadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const t = await getT();
  try {
    const u = await requirePerm("desk.act");
    const tripId = str(fd, "tripId");
    const orderId = str(fd, "requestId");
    if (!isUuid(tripId) || !isUuid(orderId)) throw new Error("Not found");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error(t("Choose a file first"));
    if (file.size > MAX_PASS_FILE) throw new Error(t("Files must be under 10 MB"));
    const me = await agentForOps(u.id);
    const name = me?.displayName ?? u.name.split(" ")[0]!;
    let out;
    try {
      out = await deskImport(tripId, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 120) || "boarding-pass" }, name);
    } catch (e) {
      if (e instanceof AppError && e.code === "VALIDATION") {
        const flight = /for (\S+), not/.exec(e.message)?.[1];
        throw new Error(flight ? t("That pass is for {flight}, not this trip.", { flight }) : t("No boarding pass barcode in that file. Ask for a screenshot of the barcode."));
      }
      throw e instanceof AppError ? new Error("Not found") : e;
    }
    await deskAudit(db, u, { action: "boarding_pass.uploaded", entityType: "app_request", entityId: orderId, summary: `Uploaded ${out.added.length} boarding pass(es)` }).catch(() => {});
    revalidatePath("/adminwork/desk", "layout");
    const added = t("{n} boarding pass(es) added", { n: out.added.length });
    return { ok: out.unmatched.length ? `${added} · ${t("{n} pass(es) were for another flight: {list}", { n: out.unmatched.length, list: out.unmatched.map((x) => x.flight).join(", ") })}` : added };
  } catch (e) { return toState(e); }
}
