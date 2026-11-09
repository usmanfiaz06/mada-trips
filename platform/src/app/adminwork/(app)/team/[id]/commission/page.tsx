import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { cycleFor, businessDate, riyadhDate } from "@/lib/dates";
import { memberSalesDetail } from "@/lib/reports";
import { CommissionCalc } from "./commission-calc";

export const metadata = { title: "Commission" };

type SP = { from?: string; to?: string };
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function CommissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // A partner / director works out commission; it isn't paid automatically.
  const me = await requirePerm("finance.view");
  const t = await getT();
  const sp = await searchParams;
  const [m] = await db.select({ id: schema.users.id, name: schema.users.name, rate: schema.users.commissionBps, partnerId: schema.users.partnerId }).from(schema.users).where(eq(schema.users.id, id));
  if (!m) notFound();

  const s = await getSettings();
  const cyc = cycleFor(businessDate(new Date(), s.closeHour), s.cutoffDay);
  const from = isDate(sp.from) ? sp.from : cyc.start;
  const to = isDate(sp.to) && sp.to >= from ? sp.to : riyadhDate();
  const rows = await memberSalesDetail(undefined, id, from, to);

  return (
    <>
      <Link href={`/adminwork/team/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink print:hidden"><ArrowLeft className="size-4 rtl:rotate-180" />{m.name}</Link>
      <CommissionCalc memberName={m.name} isPartner={!!m.partnerId} byName={me.name} defaultRate={m.rate / 100} from={from} to={to} rows={rows} basePath={`/adminwork/team/${id}/commission`} />
    </>
  );
}
