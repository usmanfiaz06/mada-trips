import Link from "next/link";
import { Contact } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { CUSTOMER_FILTERS, PAGE_SIZE, pageCustomers } from "@/lib/app/desk/customers";
import { Avatar, Badge, Card, Empty, Money, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Customers · Desk" };
const LABEL: Record<string, string> = { all: "All", open: "Something open", blocked: "Blocked", credit: "Has credit", new: "New this month" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const lang = sp.lang === "ar" || sp.lang === "en" ? sp.lang : undefined;
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const data = await pageCustomers({ q: sp.q, f: sp.f, lang, offset });
  const href = listHref("/adminwork/desk/customers", { f: sp.f, q: sp.q, lang });
  const searching = !!sp.q?.trim() || !!lang;
  return (
    <>
      <PageHeader eyebrow={t("Support")} title={t("Customers")} subtitle={t("Everyone with the app. Find someone by name, phone, email, PNR, booking ref or ICCID, then see everything about them on one page.")} />
      <Tabs active={data.filter} items={CUSTOMER_FILTERS.map((f) => ({ key: f, label: t(LABEL[f]!), href: href({ f: f === "all" ? undefined : f, page: undefined }), count: f === "all" ? undefined : data.counts[f] }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/customers" q={sp.q} keep={{ f: sp.f }} placeholder={t("Name, phone, email, PNR, booking ref, ICCID…")} clear={searching ? href({ q: undefined, lang: undefined, page: undefined }) : null}>
          <select name="lang" defaultValue={lang ?? ""} className="field w-auto" aria-label={t("Language")}>
            <option value="">{t("Any language")}</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} customers", { n: data.total })}</span>
          <span>{t("Something open")} <span className="num text-ink">{data.counts.open}</span></span>
          <span>{t("Blocked")} <span className="num text-ink">{data.counts.blocked}</span></span>
          <span>{t("Has credit")} <span className="num text-ink">{data.counts.credit}</span></span>
        </SummaryStrip>
        {data.rows.length === 0 ? <Empty icon={<Contact className="size-5" />} title={searching ? t("No customers match") : t("No customers here")} hint={searching ? t("Try the phone without the country code, the last digits of an ICCID, or a PNR.") : t("Travellers appear here once they sign in to the app.")} /> : (
          <Table>
            <thead><tr><Th>{t("Customer")}</Th><Th>{t("Contact")}</Th><Th>{t("Primary agent")}</Th><Th>{t("Open")}</Th><Th align="end">{t("Bookings")}</Th><Th align="end">{t("Lifetime value")}</Th><Th align="end">{t("Credit")}</Th></tr></thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id} className="group transition hover:bg-surface-2">
                  <Td><Link href={`/adminwork/desk/customers/${c.id}`} className="flex items-center gap-3">
                    <Avatar name={c.name} size={32} />
                    <span className="min-w-0">
                      <bdi className="block max-w-[260px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{c.name}</bdi>
                      <span className="flex items-center gap-1.5 text-[12px] text-ink-3">{c.locale === "ar" ? "العربية" : "English"} · {t("joined {date}", { date: fmtDate(c.createdAt, L) })}
                        {c.blocked && <Badge tone="bad" dot>{t("Blocked")}</Badge>}{c.deleted && <Badge tone="neutral">{t("Deleted")}</Badge>}</span>
                    </span></Link></Td>
                  <Td className="whitespace-nowrap"><span className="num block text-ink-2" dir="ltr">{c.phone ?? "—"}</span><span className="block max-w-[220px] truncate text-[12px] text-ink-3" dir="ltr">{c.email ?? ""}</span></Td>
                  <Td className="whitespace-nowrap">{c.agentName ?? <span className="text-ink-4">{t("Queue")}</span>}</Td>
                  <Td>{c.open > 0 ? <Badge tone="gold" dot>{t("{n} open", { n: c.open })}</Badge> : <span className="text-ink-4">—</span>}</Td>
                  <Td align="end" className="num">{c.bookings}</Td>
                  <Td align="end"><Money v={c.lifetime} /></Td>
                  <Td align="end">{c.credit ? <span className="num text-ok" dir="ltr">{sar(c.credit)}</span> : <span className="text-ink-4">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={PAGE_SIZE} href={href} />
      </Card>
    </>
  );
}
