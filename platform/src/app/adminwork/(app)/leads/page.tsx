import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Inbox, MessageCircle, Phone, Search } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { likeContains } from "@/lib/security";
import { LEAD_SOURCE, LEAD_SOURCES, LEAD_STATUS, LEAD_STATUSES, telLink, waLink } from "@/lib/leads";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, Tabs, btn } from "@/components/ui";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; source?: string; q?: string }> }) {
  await requirePerm("leads.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const status = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all";
  const source = (LEAD_SOURCES as readonly string[]).includes(sp.source ?? "") ? sp.source! : "";
  const q = sp.q?.trim() ?? "";

  const w: (SQL | undefined)[] = [];
  if (status !== "all") w.push(eq(schema.leads.status, status));
  if (source) w.push(eq(schema.leads.source, source));
  if (q) {
    const like = likeContains(q);
    w.push(or(ilike(schema.leads.name, like), ilike(schema.leads.phone, like), ilike(schema.leads.email, like), ilike(schema.leads.ref, like)));
  }
  const [rows, counts] = await Promise.all([
    db.select({ l: schema.leads, assignee: schema.users.name }).from(schema.leads)
      .leftJoin(schema.users, eq(schema.users.id, schema.leads.assignedTo))
      .where(and(...w)).orderBy(desc(schema.leads.createdAt)).limit(300),
    db.select({ status: schema.leads.status, n: sql<number>`count(*)::int` }).from(schema.leads)
      .where(source ? eq(schema.leads.source, source) : undefined).groupBy(schema.leads.status),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const href = (s: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("status", s);
    if (source) p.set("source", source);
    if (q) p.set("q", q);
    const qs = p.toString();
    return `/adminwork/leads${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader eyebrow={t("Relationships")} title={t("Leads")}
        subtitle={t("Enquiries from the website's chat and forms. Call or message new ones quickly, then move them along.")} />
      <Tabs active={status} items={[
        { key: "all", label: t("All"), count: counts.reduce((s, c) => s + c.n, 0), href: href("all") },
        ...LEAD_STATUSES.map((s) => ({ key: s, label: t(LEAD_STATUS[s].label), count: count(s), href: href(s) })),
      ]} />
      <Card pad={false}>
        <form className="flex flex-wrap gap-2 p-4" action="/adminwork/leads">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input name="q" defaultValue={q} placeholder={t("Search name, phone or email…")} className="field ps-10" /></div>
          <select name="source" defaultValue={source} className="field w-auto">
            <option value="">{t("All sources")}</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(LEAD_SOURCE[s])}</option>)}
          </select>
          <button className={btn("outline")}>{t("Filter")}</button>
        </form>
        {rows.length === 0 ? <Empty icon={<Inbox className="size-5" />} title={t("No leads found")} hint={t("New enquiries from the website show up here.")} /> : (
          <Table>
            <thead><tr><Th>{t("Lead")}</Th><Th>{t("Received")}</Th><Th>{t("Phone")}</Th><Th>{t("Email")}</Th><Th>{t("Services")}</Th><Th>{t("Source")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody>
              {rows.map(({ l, assignee }) => {
                const wa = waLink(l.phone);
                return (
                  <tr key={l.id} className="group hover:bg-surface-2">
                    <Td><Link href={`/adminwork/leads/${l.id}`} className="block">
                      <span className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{l.name || t("No name given")}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{l.ref}</span>{assignee ? ` · ${assignee}` : ""}</span></Link></Td>
                    <Td className="whitespace-nowrap">{fmtDate(l.createdAt, L, true)}</Td>
                    <Td className="whitespace-nowrap">{l.phone ? (
                      <span className="inline-flex items-center gap-2">
                        <a href={telLink(l.phone)} className="num inline-flex items-center gap-1 text-ink hover:underline" dir="ltr"><Phone className="size-3.5 text-ink-3" />{l.phone}</a>
                        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="grid size-7 place-items-center rounded-full bg-ok-soft text-ok hover:brightness-95" title="WhatsApp" aria-label="WhatsApp"><MessageCircle className="size-3.5" /></a>}
                      </span>) : <span className="text-ink-4">—</span>}</Td>
                    <Td>{l.email ? <a href={`mailto:${l.email}`} className="hover:underline" dir="ltr">{l.email}</a> : <span className="text-ink-4">—</span>}</Td>
                    <Td className="max-w-[220px] truncate">{l.services.length ? l.services.join(", ") : <span className="text-ink-4">—</span>}</Td>
                    <Td className="whitespace-nowrap">{t(LEAD_SOURCE[l.source] ?? l.source)}</Td>
                    <Td><Badge tone={LEAD_STATUS[l.status]?.tone ?? "neutral"} dot>{t(LEAD_STATUS[l.status]?.label ?? l.status)}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
