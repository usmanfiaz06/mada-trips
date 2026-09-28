import Link from "next/link";
import { sql } from "drizzle-orm";
import { Building2, Plus, Search, Users2 } from "lucide-react";
import { db } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { CLIENT_TYPE } from "@/lib/labels";
import { sar } from "@/lib/money";
import { Badge, Card, Empty, LinkButton, Meter, PageHeader, Table, Td, Th, Tabs, cx } from "@/components/ui";

export const metadata = { title: "Clients & credit" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const { type = "all", q } = await searchParams;
  const like = q ? `%${q.replace(/[%_]/g, "")}%` : null;
  const rows = await db.execute<{ id: string; name: string; type: string; phone: string | null; contact_person: string | null; credit_limit: number; terms: number; owed: number; overdue: number; sales: number; last: string | null }>(sql`
    SELECT c.id, c.name, c.type, c.phone, c.contact_person, c.credit_limit::bigint, c.payment_terms_days AS terms,
      coalesce(x.owed,0)::bigint AS owed, coalesce(x.overdue,0)::bigint AS overdue, coalesce(x.sales,0)::int AS sales, x.last::text
    FROM clients c LEFT JOIN (
      SELECT b.client_id, count(*) AS sales, max(b.business_date) AS last,
        SUM(CASE WHEN b.status IN ('issued','pending_issue','awaiting_credit') THEN b.sell_price - coalesce(p.paid,0) ELSE 0 END) AS owed,
        SUM(CASE WHEN b.status IN ('issued','pending_issue') AND b.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN b.sell_price - coalesce(p.paid,0) ELSE 0 END) AS overdue
      FROM bookings b LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
      WHERE b.status NOT IN ('void') GROUP BY b.client_id) x ON x.client_id = c.id
    WHERE ${type === "all" ? sql`true` : sql`c.type = ${type}`} AND ${like ? sql`(c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.contact_person ILIKE ${like})` : sql`true`}
    ORDER BY (c.type = 'retail'), owed DESC, c.name LIMIT 300`);
  const list = rows.map((r) => ({ ...r, credit_limit: Number(r.credit_limit), owed: Number(r.owed), overdue: Number(r.overdue) }));
  const totalOwed = list.reduce((s, r) => s + r.owed, 0);
  const totalOverdue = list.reduce((s, r) => s + r.overdue, 0);

  return (
    <>
      <PageHeader eyebrow={t("Relationships")} title={t("Clients & credit")} subtitle={t("Who owes what, against which limit. Contracted clients buy on credit up to their limit; everyone else needs director approval.")}
        actions={can(u, "clients.manage") && <LinkButton href="/adminwork/clients/new" variant="primary"><Plus className="size-4" />{t("New client")}</LinkButton>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card><div className="text-[13px] text-ink-3">{t("Owed by clients")}</div><div className="figure mt-4 text-[36px]" dir="ltr">{sar(totalOwed, { compact: true })}<span className="figure-unit">SAR</span></div></Card>
        <Card><div className="text-[13px] text-ink-3">{t("Overdue")}</div><div className={cx("figure mt-4 text-[36px]", totalOverdue > 0 && "text-bad")} dir="ltr">{sar(totalOverdue, { compact: true })}<span className="figure-unit">SAR</span></div></Card>
        <Card><div className="text-[13px] text-ink-3">{t("Clients")}</div><div className="figure mt-4 text-[36px]">{list.length}</div></Card>
      </div>
      <Tabs active={type} items={[
        { key: "all", label: t("All"), href: "/adminwork/clients" }, { key: "contracted", label: t("Contracted"), href: "/adminwork/clients?type=contracted" },
        { key: "noncontracted", label: t("Non-contracted"), href: "/adminwork/clients?type=noncontracted" }, { key: "retail", label: t("Retail"), href: "/adminwork/clients?type=retail" },
      ]} />
      <Card pad={false}>
        <form className="p-4" action="/adminwork/clients">
          {type !== "all" && <input type="hidden" name="type" value={type} />}
          <div className="relative"><Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input name="q" defaultValue={q} placeholder={t("Search name, phone or contact…")} className="field ps-10" /></div>
        </form>
        {list.length === 0 ? <Empty icon={<Users2 className="size-5" />} title={t("No clients found")} /> : (
          <Table>
            <thead><tr><Th>{t("Client")}</Th><Th>{t("Type")}</Th><Th>{t("Terms")}</Th><Th>{t("Credit used")}</Th><Th align="end">{t("Owed")}</Th><Th align="end">{t("Sales")}</Th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="group hover:bg-surface-2">
                  <Td><Link href={`/adminwork/clients/${c.id}`} className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-sunken text-[12px] text-ink-2">{c.type === "retail" ? c.name[0] : <Building2 className="size-4" />}</span>
                    <span><span className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{c.name}</span><span className="block text-[12px] text-ink-3">{c.contact_person ?? c.phone ?? ""}</span></span></Link></Td>
                  <Td><Badge tone={CLIENT_TYPE[c.type].tone}>{t(CLIENT_TYPE[c.type].label)}</Badge></Td>
                  <Td>{c.terms ? t("{n} days", { n: c.terms }) : "—"}</Td>
                  <Td className="min-w-[180px]">{c.type === "contracted" ? (<div><Meter value={c.owed} max={c.credit_limit} tone={c.owed / Math.max(1, c.credit_limit) > 0.85 ? "bad" : "brand"} /><div className="mt-1 text-[11.5px] text-ink-3 num" dir="ltr">{sar(c.owed, { compact: true })} / {sar(c.credit_limit, { compact: true })}</div></div>) : <span className="text-ink-4">—</span>}</Td>
                  <Td align="end"><span className={cx("num", c.overdue > 0 ? "text-bad" : "text-ink")} dir="ltr">{sar(c.owed)}</span>{c.overdue > 0 && <span className="block text-[11.5px] text-bad">{t("overdue")} <span dir="ltr" className="num">{sar(c.overdue)}</span></span>}</Td>
                  <Td align="end" className="num">{c.sales}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
