import Link from "next/link";
import { Download, History } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { queryActivity } from "@/lib/activity";
import { Card, Empty, PageHeader, btn } from "@/components/ui";
import { ActivityList } from "@/components/activity-list";

export const metadata = { title: "Activity log" };

const AREAS = [["booking", "Sales"], ["approval", "Approvals"], ["expense", "Expenses"], ["client", "Clients"], ["lead", "Website leads"], ["close", "Daily close"], ["settlement", "Settlement"], ["ledger", "Partner ledger"], ["bsp", "BSP"], ["user", "Team"], ["role", "Roles"], ["auth", "Sign-ins"]] as const;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("activity.view");
  const t = await getT();
  const sp = await searchParams;
  const limit = Math.min(5000, Math.max(100, Number(sp.limit ?? 150)));
  const [items, people] = await Promise.all([queryActivity(sp, limit), db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(schema.users.name)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "limit") as [string, string][]).toString();

  return (
    <>
      <PageHeader eyebrow={t("Append-only · cannot be edited or deleted")} title={t("Activity log")}
        subtitle={t("Every sign-in, sale, issue, payment, approval, remark and setting change: who, what, when and from where.")}
        actions={<a href={`/adminwork/api/activity?${qs}`} className={btn("outline")}><Download className="size-4" />{t("Export CSV")}</a>} />
      <Card className="mb-6" pad={false}>
        <form action="/adminwork/activity" className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto]">
          <input name="q" defaultValue={sp.q} placeholder={t("Search: ref, name, PNR, action…")} className="field" />
          <select name="who" defaultValue={sp.who ?? ""} className="field"><option value="">{t("Everyone")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select name="area" defaultValue={sp.area ?? ""} className="field"><option value="">{t("All areas")}</option>{AREAS.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
          <input type="date" name="from" defaultValue={sp.from} className="field" aria-label={t("From")} />
          <input type="date" name="to" defaultValue={sp.to} className="field" aria-label={t("To")} />
          <button className="h-[42px] rounded-full bg-ink px-5 text-[13.5px] text-bg">{t("Filter")}</button>
        </form>
        {qs && <div className="border-t border-line px-6 py-2.5 text-[12.5px] text-ink-3">{t("{n} entries match", { n: items.length })} · <Link href="/adminwork/activity" className="underline">{t("Clear filters")}</Link></div>}
      </Card>
      {items.length === 0 ? <Card><Empty icon={<History className="size-5" />} title={t("No activity matches")} /></Card> : <ActivityList items={items} showIp />}
      {items.length === limit && (
        <div className="mt-6 flex justify-center"><Link href={`/adminwork/activity?${qs}${qs ? "&" : ""}limit=${limit + 300}`} scroll={false} className={btn("outline")}>{t("Show older activity")}</Link></div>
      )}
    </>
  );
}
