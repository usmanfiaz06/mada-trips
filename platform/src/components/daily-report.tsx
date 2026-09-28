import Link from "next/link";
import { getT } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { BOOKING_STATUS, METHOD, ACCOUNT } from "@/lib/labels";
import type { dailyReport } from "@/lib/daily";
import { Badge, Table, Td, Th, cx } from "./ui";

type R = Awaited<ReturnType<typeof dailyReport>>;

export async function ReportTotals({ r }: { r: R }) {
  const t = await getT();
  const items: [string, string, boolean?][] = [
    [t("Sales"), String(r.totals.count)], [t("Net cost"), sar(r.totals.net)], [t("Sold"), sar(r.totals.sell)],
    [t("Gross margin"), sar(r.totals.margin), r.totals.margin < 0], [t("Collected"), sar(r.totals.collected)], [t("On credit"), sar(r.totals.onCredit)],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([k, v, bad]) => (
        <div key={k} className="bg-surface p-4"><div className="text-[12px] text-ink-3">{k}</div><div className={cx("figure mt-2 text-[24px]", bad && "text-bad")} dir="ltr">{v}</div></div>
      ))}
    </div>
  );
}

export async function ReportTable({ r }: { r: R }) {
  const t = await getT();
  return (
    <>
      <Table>
        <thead><tr><Th>{t("Ref")}</Th><Th>PNR · {t("Ticket")}</Th><Th>{t("Client · passenger")}</Th><Th align="end">{t("Net")}</Th><Th align="end">{t("Sell")}</Th><Th align="end">{t("Margin")}</Th><Th>{t("Method")}</Th><Th>{t("Collection")}</Th></tr></thead>
        <tbody>
          {r.rows.map((x) => {
            const m = x.sell_price - x.net_cost;
            const coll = x.status === "void" ? ["neutral", "Void"] : x.paid >= x.sell_price ? ["ok", "Collected"] : x.on_credit ? ["info", "On credit"] : x.paid > 0 ? ["warn", "Part paid"] : ["bad", "Not collected"];
            return (
              <tr key={x.id} className={cx(x.status === "void" && "opacity-50")}>
                <Td><Link href={`/adminwork/sales/${x.id}`} className="num whitespace-nowrap font-medium text-ink hover:underline">{x.ref}</Link><span className="block text-[11.5px] text-ink-3">{x.preparer.split(" ")[0]}</span></Td>
                <Td><span className="num block whitespace-nowrap tracking-wider" dir="ltr">{x.pnr ?? "—"}</span><span className="num block whitespace-nowrap text-[11.5px] text-ink-3" dir="ltr">{x.ticket_numbers ?? t(BOOKING_STATUS[x.status].label)}</span></Td>
                <Td><span className="block max-w-[200px] truncate text-ink">{x.client}</span><span className="block max-w-[200px] truncate text-[12px] text-ink-3">{x.passengers}</span></Td>
                <Td align="end"><span className="num" dir="ltr">{sar(x.net_cost)}</span></Td>
                <Td align="end"><span className="num text-ink" dir="ltr">{sar(x.sell_price)}</span></Td>
                <Td align="end"><span className={cx("num", m < 0 && "text-bad")} dir="ltr">{sar(m)}</span></Td>
                <Td>{x.methods ? x.methods.split(", ").map((k) => t(METHOD[k] ?? k)).join(", ") : "—"}</Td>
                <Td><Badge tone={coll[0] as "ok"} dot>{t(coll[1])}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {r.methods.length > 0 && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line px-6 py-4 text-[13px]">
          {r.methods.map((m) => <span key={m.method + m.account} className="text-ink-3">{t(METHOD[m.method])} · {t(ACCOUNT[m.account])} <span className="num ms-1 text-ink" dir="ltr">{sar(m.total)}</span></span>)}
        </div>
      )}
    </>
  );
}
