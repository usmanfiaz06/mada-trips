import { desc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { linesText, scrub, STATUS_LABEL, TRACK, type Delivery, type Line } from "@/lib/portal";
import { Badge, Card, Empty, Money, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Requests" };
const PLACE: Record<string, string> = { office: "Office", home: "Home", site: "Project site", collect: "Collect from Mada" };

export default async function Requests() {
  const u = await requireClientUser();
  const t = await getT();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, u.clientId));
  const rows = await db.select().from(schema.portalRequests).where(eq(schema.portalRequests.clientId, c.id)).orderBy(desc(schema.portalRequests.createdAt));
  const list = scrub(rows.map((r) => ({
    id: r.id, ref: r.ref, status: r.status, lines: linesText(r.lines as Line[]), term: r.term, monthly: r.monthly, at: r.createdAt,
    place: (r.delivery as Partial<Delivery>).place ?? "office", city: (r.delivery as Partial<Delivery>).city ?? "", note: r.decisionNote, billed: r.monthsBilled,
  })), c.hiddenNames);
  return (
    <>
      <PageHeader title={t("Requests")} subtitle={t("Everything {name} has asked Mada for, and where each one is.", { name: c.name })} />
      {list.length === 0 ? <Card><Empty icon={<FileText className="size-5" />} title={t("No requests yet")} hint={t("Build a plan on Home and send it.")} /></Card> : (
        <div className="space-y-3">
          {list.map((r) => {
            const step = TRACK.indexOf(r.status as (typeof TRACK)[number]);
            const closed = r.status === "declined" || r.status === "cancelled";
            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[15.5px] font-medium">{r.lines}</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-3"><span className="font-mono">{r.ref}</span> · {r.term} {t("months")} · {t(PLACE[r.place])}{r.city ? `, ${t(r.city)}` : ""} · {fmtDate(r.at, t.locale)}</div>
                  </div>
                  <div className="text-end"><Money v={r.monthly} className="text-[18px] font-medium text-ink" /><div className="text-[12px] text-ink-3">{t("per month, before VAT")}</div></div>
                </div>
                {closed ? <div className="mt-4 rounded-2xl bg-bad-soft px-4 py-2.5 text-[13px] text-bad">{t(STATUS_LABEL[r.status])}{r.note ? `: ${r.note}` : ""}</div> : (
                  <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {TRACK.map((s, i) => (
                      <li key={s} className="flex flex-col gap-1.5">
                        <span className={cx("h-1.5 rounded-full", i < step || r.status === "completed" ? "bg-ok" : i === step ? "bg-gold" : "bg-line")} />
                        <span className={cx("text-[11.5px]", i <= step ? "font-medium text-ink" : "text-ink-3")}>{t(s === "completed" ? "Lease complete" : s === "active" ? "Delivered" : s === "awaiting_approval" ? "Your approval" : STATUS_LABEL[s])}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {r.billed > 0 && <div className="mt-3"><Badge tone="info">{t("{n} of {m} months billed", { n: r.billed, m: r.term })}</Badge></div>}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
