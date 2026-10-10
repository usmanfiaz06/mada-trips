import Link from "next/link";
import { desc } from "drizzle-orm";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { db } from "@/db";
import { appDeskCanned } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { agentForOps, presenceFor } from "@/lib/app/desk/agents";
import { getThread, listConversations } from "@/lib/app/desk/adapters";
import { shortRef } from "@/lib/app/desk/core";
import { slaFor } from "@/lib/app/desk/sla";
import { Avatar, Card, Empty, cx } from "@/components/ui";
import { AssignCard } from "@/components/desk/assign";
import { Composer } from "@/components/desk/forms";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { Thread } from "@/components/desk/parts";
import { replyAction, typingAction } from "../actions";

export const metadata = { title: "Chats · Desk" };

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ t?: string; f?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const [kindRaw, idRaw] = (sp.t ?? "").split(":");
  const sel = (kindRaw === "support" || kindRaw === "request") && isUuid(idRaw) ? { kind: kindRaw as "support" | "request", id: idRaw } : null;
  const waitingOnly = sp.f === "waiting";
  const [all, me, canned, thread] = await Promise.all([
    listConversations(200), agentForOps(u.id), db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt)),
    sel ? getThread(sel.kind, sel.id) : Promise.resolve(null),
  ]);
  const list = waitingOnly ? all.filter((c) => c.waitingSince) : all;
  const waiting = all.filter((c) => c.waitingSince).length;
  const presence = thread?.user ? await presenceFor(thread.user.id) : null;
  const travellerName = thread?.user?.name || t("Traveller");
  const href = (c: { kind: string; id: string }) => `/adminwork/desk/chats?t=${c.kind}:${c.id}${waitingOnly ? "&f=waiting" : ""}`;

  return (
    <>
      <AutoRefresh every={10} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 animate-rise">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-3"><span className="size-1.5 rounded-full bg-gold" />{t("App desk")}</div>
          <h1 className="text-[34px] font-[380] leading-[1.05] tracking-[-0.035em] text-ink">{t("Chats")}</h1>
        </div>
        <p className="max-w-md text-[13.5px] text-ink-3">{t("Travellers write to Mada. You answer as yourself, by first name. First reply within 10 minutes, any hour.")}</p>
      </div>
      <div className="grid gap-4 lg:h-[calc(100dvh-230px)] lg:min-h-[560px] lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <Card pad={false} className={cx("flex min-h-0 flex-col overflow-hidden", sel && "hidden lg:flex")}>
          <div className="flex gap-1.5 border-b border-line p-3">
            {[["", t("All"), all.length], ["waiting", t("Waiting"), waiting]].map(([f, l, n]) => (
              <Link key={String(f)} href={`/adminwork/desk/chats${f ? "?f=waiting" : ""}${sel ? `${f ? "&" : "?"}t=${sel.kind}:${sel.id}` : ""}`}
                className={cx("inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition", (f === "waiting") === waitingOnly ? "bg-ink text-bg" : "text-ink-2 hover:bg-sunken")}>
                {l}<span className={cx("num rounded-full px-1.5 text-[11px]", f === "waiting" && Number(n) ? "bg-bad-soft text-bad" : "bg-sunken text-ink-3")}>{n}</span>
              </Link>
            ))}
          </div>
          {list.length === 0 ? <Empty icon={<MessagesSquare className="size-5" />} title={t("No conversations")} hint={t("When a traveller writes to Mada, it shows up here.")} /> : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const on = sel?.kind === c.kind && sel.id === c.id;
                const sla = c.waitingSince ? slaFor("chat", c.waitingSince) : null;
                return (
                  <li key={`${c.kind}:${c.id}`}>
                    <Link href={href(c)} className={cx("relative flex gap-3 px-4 py-3 transition", on ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                      {on && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-gold" />}
                      <Avatar name={c.userName} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[14px] text-ink">{c.userName}</span><span className="shrink-0 text-[11.5px] text-ink-3">{timeAgo(c.lastAt, L)}</span></span>
                        <span className="block truncate text-[12px] text-ink-3">{c.kind === "request" ? c.summary ?? shortRef(c.id) : t("Support")}</span>
                        <span className={cx("mt-0.5 block truncate text-[13px]", c.waitingSince ? "font-medium text-ink" : "text-ink-3")}>{c.lastAuthor === "agent" ? `${t("You")}: ` : c.lastAuthor === "mada" ? "Mada: " : ""}{c.lastBody || t("Photo")}</span>
                        {sla && <span className="mt-1.5 block"><SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} compact /></span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {thread ? (
          <Card pad={false} className="flex min-h-[70dvh] flex-col overflow-hidden lg:min-h-0">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
              <Link href={`/adminwork/desk/chats${waitingOnly ? "?f=waiting" : ""}`} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-sunken lg:hidden" aria-label={t("Back")}><ArrowLeft className="size-4 rtl:rotate-180" /></Link>
              <Avatar name={travellerName} size={36} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[15px] text-ink">{travellerName}</div>
                <div className="truncate text-[12px] text-ink-3">{thread.kind === "request" ? <Link href={`/adminwork/desk/requests/${thread.id}`} className="underline decoration-gold decoration-2 underline-offset-2">{thread.summary ?? shortRef(thread.id)}</Link> : t("Support chat")}{thread.user?.phone ? <> · <span className="num" dir="ltr">{thread.user.phone}</span></> : null}</div>
              </div>
              {presence && (
                <div className="hidden max-w-[300px] rounded-2xl bg-surface-2 px-3 py-1.5 text-[11.5px] leading-snug text-ink-3 sm:block" title={t("What the traveller sees under Mada")}>
                  <span className="block text-[10.5px] uppercase tracking-[0.08em] text-ink-4">{t("Traveller sees")}</span>
                  <span className="flex items-center gap-1.5 text-ink-2"><span className={cx("size-1.5 shrink-0 rounded-full", presence.online ? "bg-ok" : "bg-ink-4")} /><span className="truncate">{presence.line}</span></span>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"><Thread messages={thread.messages} notes={thread.notes} travellerName={travellerName} /></div>
            {can(u, "desk.act") && (
              <div className="border-t border-line p-3 sm:p-4">
                <Composer action={replyAction} typing={typingAction} threadKind={thread.kind} threadId={thread.id} agentName={me?.displayName ?? u.name.split(" ")[0]!} canned={canned.map((c) => ({ id: c.id, title: c.title, en: c.bodyEn, ar: c.bodyAr }))} locale={L} />
              </div>
            )}
          </Card>
        ) : (
          <Card className="hidden place-items-center lg:grid"><Empty icon={<MessagesSquare className="size-5" />} title={t("Choose a conversation")} hint={t("Waiting travellers are at the top of the list.")} /></Card>
        )}

        {thread && (
          <div className="hidden min-h-0 space-y-4 overflow-y-auto xl:block">
            <AssignCard kind="chat" id={`${thread.kind}:${thread.id}`} userId={thread.user?.id ?? null} canAct={can(u, "desk.act")} />
          </div>
        )}
      </div>
    </>
  );
}
