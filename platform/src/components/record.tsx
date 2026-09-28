import { and, desc, eq } from "drizzle-orm";
import { FileText, Image as ImageIcon, Paperclip, MessageSquare } from "lucide-react";
import { db, schema } from "@/db";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { Avatar, Card, cx } from "./ui";
import { ActionForm, SubmitButton } from "./client";
import { addRemark, uploadAttachment } from "@/app/adminwork/(app)/record-actions";

/** Everything that happened to a record, oldest last: logged changes and people's remarks, in one stream. */
export async function Timeline({ entityType, entityId, path, refLabel }: { entityType: string; entityId: string; path: string; refLabel: string }) {
  const t = await getT();
  const [events, notes] = await Promise.all([
    db.select({ e: schema.auditEvents, name: schema.users.name }).from(schema.auditEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
      .where(and(eq(schema.auditEvents.entityType, entityType), eq(schema.auditEvents.entityId, entityId)))
      .orderBy(desc(schema.auditEvents.at)).limit(60),
    db.select({ r: schema.remarks, name: schema.users.name }).from(schema.remarks)
      .innerJoin(schema.users, eq(schema.users.id, schema.remarks.userId))
      .where(and(eq(schema.remarks.entityType, entityType), eq(schema.remarks.entityId, entityId)))
      .orderBy(desc(schema.remarks.createdAt)),
  ]);
  const items = [
    ...events.filter((x) => x.e.action !== "remark.added").map((x) => ({ kind: "event" as const, at: x.e.at, name: x.name ?? t("System"), text: x.e.summary, changes: x.e.changes as Record<string, { from: unknown; to: unknown }> | null })),
    ...notes.map((x) => ({ kind: "remark" as const, at: x.r.createdAt, name: x.name, text: x.r.body, changes: null })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{t("Timeline & remarks")}</h2>
        <span className="text-[12px] text-ink-3">{t("{n} entries", { n: items.length })}</span>
      </div>
      <ActionForm action={addRemark} resetOnOk className="mb-5">
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="path" value={path} />
        <input type="hidden" name="ref" value={refLabel} />
        <div className="rounded-[18px] bg-surface-2 p-2 ring-1 ring-line focus-within:ring-gold">
          <textarea name="body" rows={2} placeholder={t("Add a remark for the team…")} className="w-full resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none placeholder:text-ink-4" />
          <div className="flex justify-end"><SubmitButton size="sm">{t("Add remark")}</SubmitButton></div>
        </div>
      </ActionForm>
      <ol className="relative space-y-5 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-line">
        {items.map((it, i) => (
          <li key={i} className="relative flex gap-3">
            {it.kind === "remark" ? <Avatar name={it.name} size={28} /> : <span className="relative z-[1] mt-1 grid size-7 shrink-0 place-items-center"><span className="size-2.5 rounded-full border-2 border-surface bg-ink-4 ring-4 ring-surface" /></span>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
                <span className="font-medium text-ink">{it.name}</span>
                <span title={fmtDate(it.at, t.locale, true)}>{timeAgo(it.at, t.locale)}</span>
              </div>
              {it.kind === "remark" ? (
                <div className="mt-1.5 inline-block max-w-full whitespace-pre-wrap rounded-2xl rounded-ss-md bg-gold-soft px-3.5 py-2 text-[14px] text-ink">{it.text}</div>
              ) : (
                <div className="mt-0.5 text-[13.5px] text-ink-2">{it.text}</div>
              )}
              {it.changes && !Array.isArray(it.changes) && Object.values(it.changes).some((v) => v && typeof v === "object" && "from" in v) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(it.changes).filter(([, v]) => v && typeof v === "object" && "from" in v).map(([k, v]) => (
                    <span key={k} className="rounded-lg bg-sunken px-2 py-0.5 text-[12px] text-ink-2">
                      {k}: <s className="text-ink-4">{String(v.from ?? "—")}</s> → {String(v.to ?? "—")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="flex items-center gap-2 text-[13px] text-ink-3"><MessageSquare className="size-4" />{t("Nothing yet")}</li>}
      </ol>
    </Card>
  );
}

export async function Attachments({ entityType, entityId, path, refLabel, canAdd = true, title }: { entityType: string; entityId: string; path: string; refLabel: string; canAdd?: boolean; title?: string }) {
  const t = await getT();
  const files = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename, mime: schema.attachments.mime, size: schema.attachments.size, createdAt: schema.attachments.createdAt, name: schema.users.name })
    .from(schema.attachments).innerJoin(schema.users, eq(schema.users.id, schema.attachments.uploadedBy))
    .where(and(eq(schema.attachments.entityType, entityType), eq(schema.attachments.entityId, entityId))).orderBy(desc(schema.attachments.createdAt));
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{title ?? t("Files")}</h2>
        <Paperclip className="size-4 text-ink-3" />
      </div>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id}>
            <a href={`/adminwork/api/files/${f.id}`} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2.5 transition hover:bg-sunken">
              <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", f.mime === "application/pdf" ? "bg-bad-soft text-bad" : "bg-info-soft text-info")}>
                {f.mime === "application/pdf" ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{f.filename}</span>
                <span className="block text-[12px] text-ink-3">{(f.size / 1024).toFixed(0)} KB · {f.name} · {timeAgo(f.createdAt, t.locale)}</span>
              </span>
            </a>
          </li>
        ))}
        {files.length === 0 && <li className="text-[13px] text-ink-3">{t("No files yet")}</li>}
      </ul>
      {canAdd && (
        <ActionForm action={uploadAttachment} resetOnOk className="mt-4">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="path" value={path} />
          <input type="hidden" name="ref" value={refLabel} />
          <div className="flex gap-2">
            <input type="file" name="file" accept="application/pdf,image/*" className="field min-w-0 flex-1 text-[13px]" />
            <SubmitButton variant="outline">{t("Upload")}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
