import type { ReactNode } from "react";
import { FileText, Image as ImageIcon, Lock } from "lucide-react";
import { withBase } from "@/lib/base";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { Avatar, Badge, Card, CardHead, cx, type Tone } from "../ui";

/* Presentational pieces shared by the desk pages (server components). */

export async function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const t = await getT();
  const m = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <Badge tone={m.tone} dot>{t(m.label)}</Badge>;
}

type Msg = { id: string; authorKind: string; authorName: string | null; body: string; card: Record<string, unknown> | null; createdAt: Date };
type Note = { n: { id: string; body: string; createdAt: Date }; name: string };

/** The traveller's thread as they see it, with the team's notes woven in (marked, and never sent). */
export async function Thread({ messages, notes, travellerName, empty }: { messages: Msg[]; notes: Note[]; travellerName: string; empty?: ReactNode }) {
  const t = await getT();
  const items = [
    ...messages.map((m) => ({ type: "msg" as const, at: m.createdAt, m })),
    ...notes.map((n) => ({ type: "note" as const, at: n.n.createdAt, n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!items.length) return <div className="py-10 text-center text-[13px] text-ink-3">{empty ?? t("Nothing in this thread yet")}</div>;
  let lastDay = "";
  return (
    <ol className="space-y-3">
      {items.map((it) => {
        const day = fmtDate(it.at, t.locale);
        const sep = day !== lastDay ? (lastDay = day) : null;
        return (
          <li key={it.type === "msg" ? it.m.id : it.n.n.id}>
            {sep && <div className="my-4 flex items-center gap-3 text-[11.5px] text-ink-4"><span className="h-px flex-1 bg-line" />{sep}<span className="h-px flex-1 bg-line" /></div>}
            {it.type === "note" ? (
              <div className="mx-auto max-w-[560px] rounded-2xl border border-dashed border-gold/60 bg-gold-soft/60 px-3.5 py-2.5 text-[13.5px] text-ink">
                <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-gold-2"><Lock className="size-3" />{t("Note for the team")} · {it.n.name} · {timeAgo(it.at, t.locale)}</div>
                <div dir="auto" className="whitespace-pre-wrap break-words text-start">{it.n.n.body}</div>
              </div>
            ) : <Bubble m={it.m} traveller={travellerName} />}
          </li>
        );
      })}
    </ol>
  );
}

async function Bubble({ m, traveller }: { m: Msg; traveller: string }) {
  const t = await getT();
  const mine = m.authorKind !== "user";
  const card = m.card ?? {};
  const att = card.attachment as { id: string; filename: string; mime: string; size: number } | undefined;
  const choices = card.choices as { label: string; key: string }[] | undefined;
  const who = m.authorKind === "user" ? traveller : m.authorKind === "agent" ? m.authorName ?? t("Agent") : "Mada";
  return (
    <div className={cx("flex items-end gap-2", mine ? "flex-row-reverse" : "")}>
      {m.authorKind === "mada" ? <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand"><img src={withBase("/symbol-sand.svg")} alt="" className="h-3 dark:hidden" /><img src={withBase("/symbol-green.svg")} alt="" className="hidden h-3 dark:block" /></span> : <Avatar name={who} size={28} />}
      <div className={cx("max-w-[78%] min-w-0", mine && "text-end")}>
        <div className="mb-1 text-[11.5px] text-ink-3"><span className="font-medium text-ink-2">{who}</span> · <span title={fmtDate(m.createdAt, t.locale, true)}>{timeAgo(m.createdAt, t.locale)}</span></div>
        <div dir="auto" className={cx("inline-block max-w-full whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-start text-[14px] leading-relaxed",
          m.authorKind === "user" ? "rounded-es-md bg-surface-2 text-ink ring-1 ring-line" : m.authorKind === "agent" ? "rounded-ee-md bg-ink text-bg" : "rounded-ee-md bg-brand text-brand-ink")}>
          {m.body}
          {att && (
            <a href={`/adminwork/desk/files/${att.id}`} target="_blank" rel="noopener" className="mt-2 flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-2 text-[12.5px] underline-offset-2 hover:underline">
              {att.mime === "application/pdf" ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}{att.filename}
            </a>
          )}
        </div>
        {choices && (
          <div className={cx("mt-1.5 flex flex-wrap gap-1.5", mine && "justify-end")}>
            {choices.map((c) => <span key={c.key} className={cx("rounded-full px-2.5 py-1 text-[12px] ring-1", card.picked === c.key ? "bg-ok-soft text-ok ring-ok/30" : "text-ink-2 ring-line-strong")}>{c.label}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the team did on this record, newest first, from the Ops activity log. */
export async function DeskTimeline({ entityId }: { entityId: string }) {
  const t = await getT();
  const rows = await db.select({ e: schema.auditEvents, name: schema.users.name }).from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(and(eq(schema.auditEvents.entityType, "desk"), eq(schema.auditEvents.entityId, entityId))).orderBy(desc(schema.auditEvents.at)).limit(40);
  return (
    <Card>
      <CardHead title={t("Desk log")} action={<span className="text-[12px] text-ink-3">{t("{n} entries", { n: rows.length })}</span>} />
      {rows.length === 0 ? <p className="text-[13px] text-ink-3">{t("Nothing yet")}</p> : (
        <ol className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-line">
          {rows.map(({ e, name }) => (
            <li key={e.id} className="relative flex gap-3">
              <span className="relative z-[1] mt-1 grid size-7 shrink-0 place-items-center"><span className="size-2.5 rounded-full border-2 border-surface bg-gold ring-4 ring-surface" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3"><span className="font-medium text-ink">{name ?? t("System")}</span><span title={fmtDate(e.at, t.locale, true)}>{timeAgo(e.at, t.locale)}</span></div>
                <div className="mt-0.5 text-[13.5px] text-ink-2">{e.summary}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
