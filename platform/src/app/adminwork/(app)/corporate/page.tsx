import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Building2, Settings2 } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { linesText, STAFF_STATUS_LABEL, type Line } from "@/lib/portal";
import { Badge, Card, CardHead, Empty, Field, Input, Money, PageHeader, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ClientMark } from "./client-mark";
import { enableWorkspace } from "./actions";

export const metadata = { title: "Workspace requests" };

const COLUMNS = [
  { key: "submitted", tone: "gold" as const },
  { key: "confirmed", tone: "info" as const },
  { key: "delivering", tone: "info" as const },
  { key: "active", tone: "ok" as const },
  { key: "awaiting_approval", tone: "neutral" as const },
];

export default async function CorporatePage() {
  await requirePerm("clients.manage");
  const t = await getT();
  const [requests, workspaces, companies, unread] = await Promise.all([
    db.select({ r: schema.portalRequests, client: schema.clients.name, clientId: schema.clients.id, logo: schema.clients.portalLogoId, color: schema.clients.portalColor })
      .from(schema.portalRequests).innerJoin(schema.clients, eq(schema.clients.id, schema.portalRequests.clientId))
      .where(inArray(schema.portalRequests.status, COLUMNS.map((c) => c.key))).orderBy(desc(schema.portalRequests.updatedAt)),
    db.select({ c: schema.clients, users: sql<number>`(select count(*)::int from users u where u.client_id = ${schema.clients.id} and u.active)` })
      .from(schema.clients).where(eq(schema.clients.portalEnabled, true)).orderBy(schema.clients.name),
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients)
      .where(sql`${schema.clients.portalEnabled} = false AND ${schema.clients.type} <> 'retail'`).orderBy(schema.clients.name),
    db.select({ clientId: schema.portalMessages.clientId, n: sql<number>`count(*)::int` }).from(schema.portalMessages)
      .where(sql`${schema.portalMessages.side} = 'client' AND ${schema.portalMessages.handledAt} IS NULL`).groupBy(schema.portalMessages.clientId),
  ]);
  const unreadBy = new Map(unread.map((x) => [x.clientId, x.n]));
  const waiting = requests.filter((x) => x.r.status === "submitted");
  const running = requests.filter((x) => x.r.status === "active").reduce((a, x) => a + x.r.monthly, 0);

  return (
    <>
      <PageHeader eyebrow={t("Corporate clients")} title={t("Workspace requests")}
        subtitle={t("Plans that client companies send from their workspace. Confirm them, deliver the cars, then bill each month as a corporate sale.")} />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card><div className="text-[13px] text-ink-3">{t("New, waiting on Mada")}</div><div className="figure mt-4 text-[40px]">{waiting.length}</div></Card>
        <Card><div className="text-[13px] text-ink-3">{t("Clients with a workspace")}</div><div className="figure mt-4 text-[40px]">{workspaces.length}</div></Card>
        <section className="night rounded-card p-6"><div className="text-[13px] text-tile-ink-3">{t("Leases on the road · monthly before VAT")}</div><div className="figure mt-4 text-[40px] text-glow-gold"><Money v={running} muted /></div></section>
      </div>

      <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = requests.filter((x) => x.r.status === col.key);
          return (
            <section key={col.key} className="flex min-h-[220px] w-[270px] shrink-0 flex-col gap-2 rounded-[22px] bg-sunken p-2.5">
              <header className="flex items-center justify-between px-2 py-1.5 text-[13px] font-medium">
                <span>{t(STAFF_STATUS_LABEL[col.key])}</span><span className="num text-ink-3">{items.length}</span>
              </header>
              {items.map(({ r, client, clientId, logo, color }) => (
                <Link key={r.id} href={`/adminwork/corporate/requests/${r.id}`} className="block rounded-[16px] bg-surface p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-float">
                  <div className="flex items-center gap-2">
                    <ClientMark clientId={clientId} name={client} hasLogo={!!logo} color={color} size={26} />
                    <div className="min-w-0"><div className="truncate text-[13px] font-medium">{client}</div><div className="font-mono text-[11px] text-ink-3">{r.ref}</div></div>
                  </div>
                  <div className="mt-2 text-[13px] text-ink-2">{linesText(r.lines as Line[])}</div>
                  <div className="mt-2 flex items-center justify-between text-[12px] text-ink-3">
                    <span>{r.term} {t("mo")} · {fmtDate(r.updatedAt, t.locale)}</span>
                    <Money v={r.monthly} className="text-[12.5px] text-ink" />
                  </div>
                  {r.status === "active" && <div className="mt-2 text-[11.5px] text-ink-3">{t("Billed {n} of {m} months", { n: r.monthsBilled, m: r.term })}</div>}
                </Link>
              ))}
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card pad={false}>
          <div className="p-6 pb-2"><CardHead title={t("Clients with a workspace")} hint={t("Their people sign in at the same page as you and only see their own company.")} /></div>
          {workspaces.length === 0 ? <Empty icon={<Building2 className="size-5" />} title={t("No workspaces yet")} hint={t("Open one for a company on the right.")} /> : (
            <ul>
              {workspaces.map(({ c, users }) => (
                <li key={c.id} className="flex items-center gap-3 border-t border-line px-6 py-3.5">
                  <ClientMark clientId={c.id} name={c.name} hasLogo={!!c.portalLogoId} color={c.portalColor} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{c.name}</div>
                    <div className="text-[12px] text-ink-3"><span className="font-mono" dir="ltr">/corporate/{c.portalSlug ?? "login"}</span> · {t("{n} people", { n: users })} · {c.hiddenNames.length ? t("{n} hidden names", { n: c.hiddenNames.length }) : t("No hidden names")}</div>
                  </div>
                  {!!unreadBy.get(c.id) && <Link href={`/adminwork/corporate/inbox?c=${c.id}`}><Badge tone="gold" dot>{t("{n} new", { n: unreadBy.get(c.id)! })}</Badge></Link>}
                  <Link href={`/adminwork/corporate/clients/${c.id}`} className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t("Workspace settings")}><Settings2 className="size-4" /></Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title={t("Open a workspace")} hint={t("For an existing company, or a new one. You choose services, cars, prices and logins next.")} />
          <ActionForm action={enableWorkspace} className="space-y-3">
            <Field label={t("Existing company")}>
              <Select name="clientId" placeholder={t("Choose…")} options={companies.map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
            <div className="text-center text-[12px] text-ink-3">{t("or")}</div>
            <Field label={t("New company")}><Input name="newName" placeholder={t("Company name")} /></Field>
            <SubmitButton>{t("Open workspace")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

