import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { EyeOff, MessagesSquare } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { hiddenNameRegex } from "@/lib/portal";
import { isUuid } from "@/lib/security";
import { Badge, Card, Empty, PageHeader, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ClientMark } from "../client-mark";
import { markHandled, replyToClient } from "../actions";

export const metadata = { title: "Client messages" };

const KIND: Record<string, { label: string; tone: "neutral" | "info" | "gold" | "bad" | "ok" }> = {
  message: { label: "Message", tone: "neutral" }, price: { label: "Price request", tone: "info" }, call: { label: "Call request", tone: "gold" },
  issue: { label: "Issue", tone: "bad" }, quote: { label: "Plan", tone: "ok" }, status: { label: "Update", tone: "neutral" },
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requirePerm("clients.manage");
  const t = await getT();
  const { c: picked } = await searchParams;
  const convs = await db.select({
    id: schema.clients.id, name: schema.clients.name, logo: schema.clients.portalLogoId, color: schema.clients.portalColor,
    last: sql<Date>`max(${schema.portalMessages.createdAt})`,
    open: sql<number>`count(*) filter (where ${schema.portalMessages.side} = 'client' and ${schema.portalMessages.handledAt} is null)::int`,
  }).from(schema.portalMessages).innerJoin(schema.clients, eq(schema.clients.id, schema.portalMessages.clientId))
    .groupBy(schema.clients.id).orderBy(desc(sql`count(*) filter (where ${schema.portalMessages.side} = 'client' and ${schema.portalMessages.handledAt} is null) > 0`), desc(sql`max(${schema.portalMessages.createdAt})`));
  const currentId = isUuid(picked) ? picked : convs[0]?.id;
  const [client] = currentId ? await db.select().from(schema.clients).where(eq(schema.clients.id, currentId)) : [];
  const msgs = client ? await db.select({ m: schema.portalMessages, author: schema.users.name, ref: schema.portalRequests.ref, requestId: schema.portalRequests.id })
    .from(schema.portalMessages).leftJoin(schema.users, eq(schema.users.id, schema.portalMessages.authorId))
    .leftJoin(schema.portalRequests, eq(schema.portalRequests.id, schema.portalMessages.requestId))
    .where(eq(schema.portalMessages.clientId, client.id)).orderBy(asc(schema.portalMessages.createdAt)) : [];
  const re = client ? hiddenNameRegex(client.hiddenNames) : null;
  const hits = (s: string) => { if (!re) return false; re.lastIndex = 0; return re.test(s); };

  return (
    <>
      <PageHeader eyebrow={t("Corporate clients")} title={t("Client messages")} subtitle={t("One conversation per company. Your replies show in their workspace as “Mada team”, never with your name.")} />
      {convs.length === 0 ? <Card><Empty icon={<MessagesSquare className="size-5" />} title={t("No messages yet")} hint={t("When people at a client write from their workspace, it lands here.")} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav className="space-y-2">
            {convs.map((cv) => (
              <Link key={cv.id} href={`/adminwork/corporate/inbox?c=${cv.id}`}
                className={cx("flex items-center gap-3 rounded-[18px] p-3 transition", cv.id === currentId ? "bg-tile text-tile-ink" : "bg-surface shadow-card hover:bg-surface-2")}>
                <ClientMark clientId={cv.id} name={cv.name} hasLogo={!!cv.logo} color={cv.color} size={30} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{cv.name}</span><span className="block text-[12px] opacity-60">{timeAgo(cv.last, t.locale)}</span></span>
                {cv.open > 0 && <span className="num grid h-[22px] min-w-[22px] place-items-center rounded-full bg-gold px-1.5 text-[11.5px] font-medium text-[#1a140a]">{cv.open}</span>}
              </Link>
            ))}
          </nav>
          {client && (
            <Card className="flex min-h-[560px] flex-col gap-4">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <ClientMark clientId={client.id} name={client.name} hasLogo={!!client.portalLogoId} color={client.portalColor} size={38} />
                  <div><div className="text-[16px] font-medium">{client.name}</div><Link href={`/adminwork/corporate/clients/${client.id}`} className="text-[12.5px] text-ink-3 hover:text-ink">{t("Workspace settings")}</Link></div>
                </div>
                <form action={markHandled}><input type="hidden" name="clientId" value={client.id} /><button className="h-9 rounded-full bg-sunken px-4 text-[13px] hover:bg-line">{t("Mark all handled")}</button></form>
              </header>
              <div className="flex flex-1 flex-col gap-3">
                {msgs.map(({ m, author, ref, requestId }) => {
                  const mine = m.side !== "client";
                  return (
                    <div key={m.id} className={cx("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                      <div className={cx("max-w-[78%] rounded-[16px] px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.side === "system" ? "bg-sunken text-ink-2" : mine ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink ring-1 ring-line")}>
                        {m.kind !== "message" && m.kind !== "status" && <Badge tone={KIND[m.kind]?.tone} className="mb-1.5">{t(KIND[m.kind]?.label ?? m.kind)}</Badge>}
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        {ref && requestId && <Link href={`/adminwork/corporate/requests/${requestId}`} className="mt-1.5 inline-block font-mono text-[11.5px] underline opacity-80">{ref}</Link>}
                      </div>
                      <span className="text-[11.5px] text-ink-3">
                        {m.side === "system" ? t("Mada Ops") : author ?? "—"} · {fmtDate(m.createdAt, t.locale, true)}
                        {mine && hits(`${m.body} ${author ?? ""}`) && <> · <span className="text-warn">{t("client sees “Mada team”")}</span></>}
                        {!mine && !m.handledAt && <> · <span className="text-gold-2">{t("waiting on Mada")}</span></>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {client.hiddenNames.length > 0 && (
                <div className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-2.5 text-[12.5px] text-warn">
                  <EyeOff className="size-4 shrink-0" />{t("Never shown to {name}: {names}. They appear as “Mada team”.", { name: client.name, names: client.hiddenNames.join(", ") })}
                </div>
              )}
              <ActionForm action={replyToClient} resetOnOk className="flex items-end gap-2">
                <input type="hidden" name="clientId" value={client.id} />
                <Textarea name="body" rows={2} placeholder={t("Reply. They see it in their workspace.")} className="flex-1" />
                <SubmitButton>{t("Send")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
