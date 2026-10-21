import Link from "next/link";
import { LayoutList, TrendingDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { BOARD_PRODUCT, BOARD_STAGE, BOARD_SUPPLIER, PAY_STATUS } from "@/lib/labels";
import { PAGE_SIZE } from "@/lib/app/desk/adapters";
import { BOARD_PRODUCTS, BOARD_SUPPLIERS, BOARD_TABS, STUCK_MINUTES, boardAgents, boardHref, customerHref, pageBoard, type BoardTab } from "@/lib/app/desk/board";
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { StatusBadge } from "@/components/desk/parts";
import { AutoRefresh } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Live board · Desk" };

const HINT: Record<BoardTab, string> = {
  searching: "Searches in the last day with no order after them, and requests the desk hasn't quoted yet.",
  held: "A price held for them that isn't paid: a bank check, a friend's share, a quote sent.",
  paid: "Paid or authorised and with the desk: confirm, hold, answer and issue.",
  confirmed: "Booked and ticketed, before the trip starts.",
  travelling: "Away now: between the first day and the last, or an eSIM in use.",
  done: "Back home, used up, or cancelled.",
  problem: "Declined, ticketing failed, a capture that didn't go through, a stuck eSIM, or a cancelled flight.",
};

/** How long something has sat where it is, short: 12 min, 3 h, 2 days. */
function age(since: Date, t: Awaited<ReturnType<typeof getT>>) {
  const m = Math.max(0, Math.round((Date.now() - since.getTime()) / 60_000));
  return m < 60 ? t("{n} min", { n: m }) : m < 48 * 60 ? t("{n} h", { n: Math.floor(m / 60) }) : t("{n} days", { n: Math.floor(m / 1440) });
}

export default async function LiveBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const [data, agents] = await Promise.all([
    pageBoard({ tab: sp.s, q: sp.q, product: sp.product, supplier: sp.supplier, agent: sp.agent, from: sp.from, to: sp.to, stuck: sp.stuck === "1", offset }),
    boardAgents(),
  ]);
  const filters = { q: sp.q, product: sp.product, supplier: sp.supplier, agent: sp.agent, from: sp.from, to: sp.to, stuck: sp.stuck };
  const href = listHref("/adminwork/desk/bookings", { s: sp.s, ...filters });
  const filtered = Object.values(filters).some(Boolean);
  const tab = data.tab;
  const threshold = STUCK_MINUTES[tab];
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("App bookings")} title={t("Live board")}
        subtitle={t("Every booking from the app, flights to Umrah, by where it is now. Each one sits in exactly one tab; anything waiting too long is marked stuck.")}
        actions={<LinkButton href="/adminwork/desk/drop-offs" variant="outline"><TrendingDown className="size-4" />{t("Drop-offs")}</LinkButton>} />
      <Tabs active={tab} items={BOARD_TABS.map((s) => ({ key: s, label: <>{t(BOARD_STAGE[s]!.label)}{data.stuckBy[s] > 0 && <span className="size-1.5 rounded-full bg-bad" aria-label={t("Stuck")} />}</>, href: href({ s: s === "paid" ? undefined : s, page: undefined }), count: data.counts[s] }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/bookings" q={sp.q} keep={{ s: sp.s }} placeholder={t("Ref, PNR, traveller, phone, what they booked…")} clear={filtered ? listHref("/adminwork/desk/bookings", { s: sp.s })() : null}>
          <select name="product" defaultValue={sp.product ?? ""} className="field w-auto" aria-label={t("Product")}>
            <option value="">{t("All products")}</option>
            {BOARD_PRODUCTS.map((p) => <option key={p} value={p}>{t(BOARD_PRODUCT[p]!)}</option>)}
          </select>
          <select name="supplier" defaultValue={sp.supplier ?? ""} className="field w-auto" aria-label={t("Supplier")}>
            <option value="">{t("All suppliers")}</option>
            {BOARD_SUPPLIERS.map((p) => <option key={p} value={p}>{t(BOARD_SUPPLIER[p]!)}</option>)}
          </select>
          <select name="agent" defaultValue={sp.agent ?? ""} className="field w-auto" aria-label={t("Agent")}>
            <option value="">{t("Any agent")}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="date" name="from" defaultValue={sp.from} className="field w-auto" aria-label={t("From")} />
          <input type="date" name="to" defaultValue={sp.to} className="field w-auto" aria-label={t("To")} />
          <label className="flex h-[42px] items-center gap-2 rounded-full bg-sunken px-4 text-[13px] text-ink-2">
            <input type="checkbox" name="stuck" value="1" defaultChecked={sp.stuck === "1"} className="accent-[var(--color-bad)]" />{t("Stuck only")}
          </label>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} bookings", { n: data.total })}</span>
          <span>{t("Value")} <span className="num text-ink" dir="ltr">{sar(data.value)}</span></span>
          {threshold !== undefined && <span>{t("Stuck")} <span className={cx("num", data.stuck ? "text-bad" : "text-ink")}>{data.stuck}</span> <span className="text-ink-4">· {t("over {n} min here", { n: threshold })}</span></span>}
          <span className="text-ink-4">{t(HINT[tab])}</span>
        </SummaryStrip>
        {data.rows.length === 0 ? <Empty icon={<LayoutList className="size-5" />} title={filtered ? t("No bookings match") : t("Nothing here right now")} hint={filtered ? t("Try a different filter or search.") : t(HINT[tab])} /> : (
          <Table>
            <thead><tr><Th>{t("Booking")}</Th><Th>{t("Product")}</Th><Th>{t("Traveller")}</Th><Th>{t("Stage")}</Th><Th>{t("In stage")}</Th><Th>{t("Dates")}</Th><Th>{t("Card")}</Th><Th>{t("Supplier")}</Th><Th align="end">{t("Total")}</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.source}:${r.id}`} className={cx("group transition hover:bg-surface-2", r.stuck && "bg-bad-soft/40")}>
                  <Td><Link href={boardHref(r)} className="block">
                    <span className="block max-w-[260px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.summary}</span>
                    <span className="block text-[12px] text-ink-3">{r.ref && <><span className="num">{r.ref}</span> · </>}{r.source === "search" ? t("Searched") : timeAgo(r.createdAt, L)}</span></Link></Td>
                  <Td className="whitespace-nowrap">{t(BOARD_PRODUCT[r.product] ?? r.product)}</Td>
                  <Td className="whitespace-nowrap"><Link href={customerHref(r.userId)} className="block text-ink decoration-gold decoration-2 underline-offset-4 hover:underline"><bdi>{r.userName}</bdi></Link>{r.phone && <span className="num block text-[12px] text-ink-3" dir="ltr">{r.phone}</span>}</Td>
                  <Td className="whitespace-nowrap"><StatusBadge map={BOARD_STAGE} value={r.stage} />{r.disrupted && r.stage === "problem" && <span className="block pt-1 text-[12px] text-bad">{t("Flight cancelled or diverted")}</span>}</Td>
                  <Td className="whitespace-nowrap">{r.stuck ? <Badge tone="bad" dot>{t("Stuck")} · {age(r.since, t)}</Badge> : <span className="num text-[12.5px] text-ink-3">{age(r.since, t)}</span>}</Td>
                  <Td className="whitespace-nowrap text-[12.5px]">{r.start ? <span className="num">{fmtDate(r.start, L)}{r.end && r.end !== r.start ? ` – ${fmtDate(r.end, L)}` : ""}</span> : <span className="text-ink-4">—</span>}</Td>
                  <Td className="whitespace-nowrap">{r.pay ? <StatusBadge map={PAY_STATUS} value={r.pay} /> : <span className="text-ink-4">—</span>}</Td>
                  <Td className="whitespace-nowrap">{r.supplier ? <span className="block">{t(BOARD_SUPPLIER[r.supplier] ?? r.supplier)}</span> : <span className="text-ink-4">—</span>}
                    {(r.supplierRef || r.agentName) && <span className="block text-[12px] text-ink-3">{r.supplierRef && <span className="num tracking-wider" dir="ltr">{r.supplierRef}</span>}{r.supplierRef && r.agentName && " · "}{r.agentName}</span>}</Td>
                  <Td align="end">{r.value ? <Money v={r.value} /> : <span className="text-ink-4">—</span>}</Td>
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
