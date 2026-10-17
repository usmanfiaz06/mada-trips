import Link from "next/link";
import { Smartphone } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { deskEsims, esimOrderingAllowed, markupBps } from "@/lib/app/esim/service";
import { supplierMode } from "@/lib/app/config";
import { airaloConfigured, airaloEnv } from "@/lib/app/suppliers/live/airalo";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, Empty, Money, Notice, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { esimResendAction, esimRefundAction, esimRetryAction } from "../esim-actions";

export const metadata = { title: "eSIMs · Desk" };

const TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  ordering: "info", ready: "info", installed: "ok", active: "ok", used_up: "neutral", expired: "neutral", refunded: "warn", stuck: "bad",
};
const LABEL: Record<string, string> = {
  ordering: "Ordering", ready: "Ready to install", installed: "Installed", active: "On", used_up: "All used", expired: "Ended", refunded: "Refunded", stuck: "No answer from Airalo",
};
const TABS = ["open", "stuck", "refunded", "all"] as const;

export default async function EsimsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof TABS)[number]) : "open";
  const all = await deskEsims();
  const rows = tab === "all" ? all : tab === "open" ? all.filter((e) => !["refunded", "expired", "used_up"].includes(e.status)) : all.filter((e) => e.status === tab);
  const mode = supplierMode("esim");
  const allowed = esimOrderingAllowed();
  return (
    <>
      <PageHeader eyebrow={t("App desk")} title={t("eSIMs")} subtitle={t("Bought on Airalo once the card is captured. One row per eSIM: send the install details again, refund, or order a stuck one again (Airalo is checked first, so nothing is bought twice).")} />
      <div className="mb-3 flex flex-wrap gap-2 text-[12.5px] text-ink-3">
        <Badge tone={mode === "live" ? "ok" : "neutral"}>{mode === "live" ? t("Airalo {env}", { env: airaloEnv() }) : t("Mock supplier")}</Badge>
        <span>{t("Markup {pct}%", { pct: (markupBps() / 100).toFixed(1) })}</span>
        {mode === "live" && !airaloConfigured() ? <Badge tone="bad">{t("AIRALO_CLIENT_ID and AIRALO_CLIENT_SECRET are not set")}</Badge> : null}
      </div>
      {!allowed.ok ? <div className="mb-3"><Notice tone="warn" title={t("eSIMs can't be sold here")}>{allowed.why}</Notice></div> : null}
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t({ open: "Open", stuck: "Stuck", refunded: "Refunded", all: "All" }[s]), href: `/adminwork/desk/esims?s=${s}`, count: s === "all" ? undefined : s === "open" ? all.filter((e) => !["refunded", "expired", "used_up"].includes(e.status)).length : all.filter((e) => e.status === s).length }))} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<Smartphone className="size-5" />} title={t("No eSIMs here")} hint={t("eSIMs bought in the app appear here the moment they're paid.")} /> : (
          <Table>
            <thead><tr><Th>{t("eSIM")}</Th><Th>{t("Traveller")}</Th><Th>{t("ICCID")}</Th><Th>{t("Status")}</Th><Th>{t("Order")}</Th><Th align="end">{t("Actions")}</Th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const plan = e.plan as { coverage?: { name?: string }; gb?: number | null; days?: number };
                const usage = e.usage as { leftMb?: number | null; totalMb?: number | null } | null;
                return (
                  <tr key={e.id} className="align-top">
                    <Td>
                      <span className="block text-ink">{plan.coverage?.name ?? ""} · {plan.gb === null ? t("Unlimited") : `${plan.gb} GB`} · {t("{n} days", { n: plan.days ?? 0 })}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{e.packageId}</span> · {fmtDate(e.createdAt, t.locale, true)}</span>
                      {e.topups.length ? <span className="block text-[12px] text-ink-3">{t("{n} top-ups", { n: e.topups.length })}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap">{e.ownerName ?? "—"}</Td>
                    <Td><span className="num text-[12.5px]">{e.iccid ?? "—"}</span>{usage?.totalMb ? <span className="block text-[12px] text-ink-3">{t("{left} of {total} MB left", { left: usage.leftMb ?? 0, total: usage.totalMb })}</span> : null}</Td>
                    <Td><Badge tone={TONE[e.status] ?? "neutral"}>{t(LABEL[e.status] ?? e.status)}</Badge>{e.problem && e.problem !== "ordering" ? <span className="mt-1 block max-w-[220px] text-[12px] text-ink-3">{e.problem}</span> : null}</Td>
                    <Td className="whitespace-nowrap"><Link href={`/adminwork/desk/orders/${e.orderId}`} className="num underline decoration-gold underline-offset-4">{e.ref ?? e.orderId.slice(0, 8)}</Link><span className="block"><Money v={e.total} /></span></Td>
                    <Td align="end">
                      <div className="flex flex-col items-end gap-1.5">
                        {e.iccid && e.status !== "refunded" ? <ActionForm action={esimResendAction}><input type="hidden" name="esimId" value={e.id} /><SubmitButton variant="outline" size="sm">{t("Send install details again")}</SubmitButton></ActionForm> : null}
                        {e.status === "stuck" ? <ActionForm action={esimRetryAction}><input type="hidden" name="orderId" value={e.orderId} /><SubmitButton size="sm">{t("Check Airalo and order")}</SubmitButton></ActionForm> : null}
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
      </Card>
    </>
  );
}
