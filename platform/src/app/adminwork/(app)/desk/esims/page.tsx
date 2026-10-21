import Link from "next/link";
import { Smartphone } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { esimOrderingAllowed } from "@/lib/app/esim/service";
import { ESIM_TABS, pageEsims, PAGE_SIZE } from "@/lib/app/desk/adapters";
import { ESIM_STATUS } from "@/lib/labels";
import { esimBalance } from "@/lib/app/esim/ops";
import { catalogueStatus } from "@/lib/app/esim/catalogue";
import { pricingRules } from "@/lib/app/esim/pricing";
import { esimVendor } from "@/lib/app/suppliers";
import { airaloConfigured, airaloEnv } from "@/lib/app/suppliers/live/airalo";
import { esimAccessConfigured } from "@/lib/app/suppliers/live/esimaccess";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, LinkButton, Money, Notice, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { esimBalanceAction, esimResendAction, esimRefundAction, esimRetryAction } from "../esim-actions";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "eSIMs · Desk" };

const TABS = Object.keys(ESIM_TABS);

export default async function EsimsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = TABS.includes(sp.s ?? "") ? sp.s! : "open";
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const data = await pageEsims({ tab, q: sp.q, offset });
  const rows = data.rows;
  const href = listHref("/adminwork/desk/esims", { s: sp.s, q: sp.q });
  const vendor = esimVendor();
  const allowed = esimOrderingAllowed();
  const [bal, cat, rules] = await Promise.all([esimBalance(), catalogueStatus(), pricingRules()]);
  const keysMissing = (vendor === "esimaccess" && !esimAccessConfigured()) || (vendor === "airalo" && !airaloConfigured());
  return (
    <>
      <PageHeader eyebrow={t("App bookings")} title={t("eSIMs")} subtitle={t("Bought from the supplier once the card is captured. One row per eSIM: open it for usage, top-ups and notes, send the install details again, refund, or order a stuck one again (the supplier is checked first, so nothing is bought twice).")}
        actions={can(u, "settings.manage") ? <LinkButton href="/adminwork/desk/finance/esim-pricing" variant="outline" size="sm">{t("eSIM pricing")}</LinkButton> : null} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <Badge tone={vendor !== "mock" ? "ok" : "neutral"}>{vendor === "esimaccess" ? t("eSIM Access") : vendor === "airalo" ? t("Airalo {env}", { env: airaloEnv() }) : t("Mock supplier")}</Badge>
        <span>{t("Margin {pct}%, at least SAR {min} a plan", { pct: rules.marginPct, min: rules.minProfitSar })}</span>
        {keysMissing ? <Badge tone="bad">{vendor === "esimaccess" ? t("ESIMACCESS_ACCESS_CODE and ESIMACCESS_SECRET_KEY are not set") : t("AIRALO_CLIENT_ID and AIRALO_CLIENT_SECRET are not set")}</Badge> : null}
      </div>
      {!allowed.ok ? <div className="mb-3"><Notice tone="warn" title={t("eSIMs can't be sold here")}>{allowed.why}</Notice></div> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] text-ink-3">{t("Supplier balance")}</div>
              <div className={`num text-[26px] leading-tight ${bal.low ? "text-bad" : "text-ink"}`} dir="ltr">{bal.usd === null ? "—" : `$${bal.usd.toFixed(2)}`}</div>
              <div className="text-[12px] text-ink-3">{t("Alert below ${min}. A usual day costs about ${day}.", { min: bal.thresholdUsd.toFixed(0), day: bal.dayUsd.toFixed(2) })}{bal.at ? ` · ${t("checked {when}", { when: fmtDate(bal.at, t.locale, true) })}` : ""}</div>
              {bal.error ? <div className="mt-1 text-[12px] text-bad">{bal.error}</div> : null}
            </div>
            <ActionForm action={esimBalanceAction}><SubmitButton variant="outline" size="sm">{t("Check now")}</SubmitButton></ActionForm>
          </div>
          {bal.low ? <div className="mt-3"><Notice tone="bad" title={t("Top up the eSIM Access balance")}>{t("Below what the next orders need. Paid eSIMs wait and are ordered again within 15 minutes of the top-up; past the time promised, they are refunded.")}</Notice></div> : null}
        </Card>
        <Card>
          <div className="text-[12px] text-ink-3">{t("Supplier catalogue")}</div>
          <div className="num text-[26px] leading-tight text-ink">{cat.total || "—"}</div>
          <div className="text-[12px] text-ink-3">{cat.at ? t("Synced {when}, every day", { when: fmtDate(cat.at, t.locale, true) }) : t("Not synced yet: the daily job does it, or Sync now on the pricing page.")}</div>
          {cat.up.length ? <div className="mt-2"><Badge tone="warn">{t("Cost went up on {n} plans", { n: cat.up.length })}</Badge> <span className="text-[12px] text-ink-3">{t("Sell prices follow the rules, never below the guard.")}</span></div> : null}
          {cat.down.length ? <div className="mt-1"><Badge tone="ok">{t("Cost went down on {n} plans", { n: cat.down.length })}</Badge></div> : null}
        </Card>
      </div>
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t({ open: "Open", stuck: "Stuck", refunded: "Refunded", all: "All" }[s] ?? s), href: href({ s: s === "open" ? undefined : s, page: undefined }), count: s === "all" ? undefined : data.counts[s] ?? 0 }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/esims" q={sp.q} keep={{ s: sp.s }} placeholder={t("Traveller, ICCID, country, order ref…")} clear={sp.q ? href({ q: undefined, page: undefined }) : null} />
        <SummaryStrip>
          <span>{t("{n} eSIMs", { n: data.total })}</span>
          <span>{t("Stuck")} <span className="num text-ink">{data.counts.stuck ?? 0}</span></span>
        </SummaryStrip>
        {rows.length === 0 ? <Empty icon={<Smartphone className="size-5" />} title={sp.q ? t("No eSIMs match") : t("No eSIMs here")} hint={sp.q ? t("Try a different filter or search.") : t("eSIMs bought in the app appear here the moment they're paid.")} /> : (
          <Table>
            <thead><tr><Th>{t("eSIM")}</Th><Th>{t("Traveller")}</Th><Th>{t("ICCID")}</Th><Th>{t("Status")}</Th><Th>{t("Order")}</Th><Th align="end">{t("Actions")}</Th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const plan = e.plan as { coverage?: { name?: string }; gb?: number | null; days?: number };
                const usage = e.usage as { leftMb?: number | null; totalMb?: number | null } | null;
                return (
                  <tr key={e.id} className="align-top">
                    <Td>
                      <Link href={`/adminwork/desk/esims/${e.id}`} className="block text-ink underline decoration-gold underline-offset-4">{plan.coverage?.name ?? ""} · {plan.gb === null ? t("Unlimited") : `${plan.gb} GB`} · {t("{n} days", { n: plan.days ?? 0 })}</Link>
                      <span className="block text-[12px] text-ink-3"><span className="num">{e.packageId}</span> · {fmtDate(e.createdAt, t.locale, true)}</span>
                      {e.topups.length ? <span className="block text-[12px] text-ink-3">{t("{n} top-ups", { n: e.topups.length })}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap"><CustomerLink id={e.ownerId}>{e.ownerName ?? "—"}</CustomerLink></Td>
                    <Td><span className="num text-[12.5px]">{e.iccid ?? "—"}</span>{usage?.totalMb ? <span className="block text-[12px] text-ink-3">{t("{left} of {total} MB left", { left: usage.leftMb ?? 0, total: usage.totalMb })}</span> : null}</Td>
                    <Td><Badge tone={ESIM_STATUS[e.status]?.tone ?? "neutral"}>{t(ESIM_STATUS[e.status]?.label ?? e.status)}</Badge>{e.problem === "low_balance" ? <span className="mt-1 block max-w-[220px] text-[12px] text-bad">{t("Waiting on our supplier balance. Promised by {when}", { when: e.dueAt ? fmtDate(e.dueAt, t.locale, true) : "—" })}</span> : e.problem && e.problem !== "ordering" ? <span className="mt-1 block max-w-[220px] text-[12px] text-ink-3">{e.problem}</span> : null}</Td>
                    <Td className="whitespace-nowrap"><Link href={`/adminwork/desk/orders/${e.orderId}`} className="num underline decoration-gold underline-offset-4">{e.ref ?? e.orderId.slice(0, 8)}</Link><span className="block"><Money v={e.total} /></span></Td>
                    <Td align="end">
                      <div className="flex flex-col items-end gap-1.5">
                        {e.iccid && e.status !== "refunded" ? <ActionForm action={esimResendAction}><input type="hidden" name="esimId" value={e.id} /><SubmitButton variant="outline" size="sm">{t("Send install details again")}</SubmitButton></ActionForm> : null}
                        {e.status === "stuck" ? <ActionForm action={esimRetryAction}><input type="hidden" name="orderId" value={e.orderId} /><SubmitButton size="sm">{t("Check the supplier and order")}</SubmitButton></ActionForm> : null}
                        {e.status !== "refunded" ? (
                          <ActionForm action={esimRefundAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="esimId" value={e.id} />
                            <select name="reason" className="field h-8 py-0 text-[12.5px]" defaultValue={e.installedAt ? "INSTALLATION_FAILURE" : "TRIP_CANCELLATION"}>
                              {["INSTALLATION_FAILURE", "NO_COVERAGE", "TRIP_CANCELLATION", "WRONG_PURCHASE", "INCOMPATIBLE_DEVICE", "OTHERS"].map((r) => <option key={r} value={r}>{t(r)}</option>)}
                            </select>
                            <SubmitButton variant="danger" size="sm" confirm={t("Refund this eSIM to the traveller?")}>{t("Refund")}</SubmitButton>
                          </ActionForm>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={PAGE_SIZE} href={href} />
      </Card>
    </>
  );
}
