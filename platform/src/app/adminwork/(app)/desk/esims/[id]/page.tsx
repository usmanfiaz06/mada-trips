import Link from "next/link";
import { canDeskFinance } from "@/lib/app/finance/access";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { deskEsim } from "@/lib/app/esim/service";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, CardHead, KV, Meter, Money, Notice, PageHeader, Textarea } from "@/components/ui";
import { esimNoteAction, esimRefundAction, esimResendAction, esimRetryAction, esimTopupAction } from "../../esim-actions";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "eSIM · Desk" };

/*
 * One eSIM for support: ICCID, where it stands (installed, on, data used and left, until when), what was added, and the
 * actions: send the install details again, top up on the traveller's behalf (Mada pays), a note to the traveller,
 * order a stuck one again, cancel and refund (the supplier cancels an eSIM that was never installed).
 */

const LABEL: Record<string, string> = {
  ordering: "Ordering", ready: "Ready to install", installed: "Installed", active: "On", used_up: "All used", expired: "Ended", refunded: "Refunded", stuck: "With Mada",
};
const gb = (mb: number) => (mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

export default async function EsimPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const { id } = await params;
  const e = await deskEsim(id);
  if (!e) notFound();
  const plan = e.plan as { coverage?: { name?: string; code?: string }; gb?: number | null; days?: number; daily?: boolean; operator?: string };
  const usage = e.usage as { leftMb?: number | null; totalMb?: number | null; unlimited?: boolean; expiresAt?: string | null; state?: string } | null;
  const install = e.install as { lpa?: string; apn?: { value?: string | null } } | null;
  const used = usage?.totalMb ? usage.totalMb - (usage.leftMb ?? 0) : null;
  const tops = (e.topups ?? []) as { gb?: number | null; days?: number; at?: string; by?: string }[];
  return (
    <>
      <Link href="/adminwork/desk/esims" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("eSIMs")}</Link>
      <PageHeader eyebrow={t("App bookings")} title={`${plan.coverage?.name ?? ""} · ${plan.gb === null ? t("Unlimited") : `${plan.gb} GB${plan.daily ? ` ${t("a day")}` : ""}`} · ${t("{n} days", { n: plan.days ?? 0 })}`}
        subtitle={<><CustomerLink id={e.ownerId}>{e.ownerName ?? "—"}</CustomerLink> · <Link href={`/adminwork/desk/orders/${e.orderId}`} className="num underline decoration-gold underline-offset-4">{e.ref ?? e.orderId.slice(0, 8)}</Link> · <Money v={e.total} /></>} />
      {e.status === "stuck" && e.problem === "low_balance" ? <div className="mb-3"><Notice tone="bad" title={t("Paid, waiting on our supplier balance")}>{t("Promised to the traveller by {when}. Top up the balance: it is ordered again within 15 minutes, or refunded at that time.", { when: e.dueAt ? fmtDate(e.dueAt, t.locale, true) : "—" })}</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHead title={t("This eSIM")} action={<Badge tone={e.status === "stuck" ? "bad" : e.status === "refunded" ? "warn" : e.status === "active" || e.status === "installed" ? "ok" : "info"}>{t(LABEL[e.status] ?? e.status)}</Badge>} />
            <KV items={[
              [t("ICCID"), <span key="i" className="num" dir="ltr">{e.iccid ?? "—"}</span>],
              [t("Supplier"), <span key="s">{e.supplier}{e.supplierRef ? <span className="num text-ink-3" dir="ltr"> · {e.supplierRef}</span> : null}</span>],
              [t("Installed"), e.installedAt ? fmtDate(e.installedAt, t.locale, true) : t("Not yet")],
              [t("Until"), usage?.expiresAt ? fmtDate(usage.expiresAt, t.locale, true) : t("Starts when it connects")],
              [t("Operator"), plan.operator || "—"],
              [t("APN"), install?.apn?.value ? <span key="a" className="num" dir="ltr">{install.apn.value}</span> : t("Sets itself")],
            ]} />
            {usage?.unlimited ? <p className="mt-3 text-[13px] text-ink-2">{t("Unlimited")}</p> : usage?.totalMb ? (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-[13px]"><span>{t("{used} used", { used: gb(used ?? 0) })}</span><span className="text-ink-3">{t("{left} left of {total}", { left: gb(usage.leftMb ?? 0), total: gb(usage.totalMb) })}</span></div>
                <Meter value={used ?? 0} max={usage.totalMb} tone={(usage.leftMb ?? 0) / usage.totalMb < 0.15 ? "bad" : "brand"} />
                <p className="text-[12px] text-ink-3">{t("The supplier updates usage every few hours.")}</p>
              </div>
            ) : null}
            {e.problem && e.problem !== "ordering" && e.problem !== "low_balance" ? <p className="mt-3 text-[12.5px] text-ink-3">{e.problem}</p> : null}
          </Card>
          {tops.length ? (
            <Card>
              <CardHead title={t("Top-ups")} />
              <ul className="space-y-1 text-[13px]">{tops.map((x, i) => <li key={i}>{x.gb === null ? t("Unlimited") : `${x.gb} GB`} · {t("{n} days", { n: x.days ?? 0 })} · <span className="text-ink-3">{x.at ? fmtDate(x.at, t.locale, true) : ""}{x.by ? ` · ${t("by {name}", { name: x.by })}` : ""}</span></li>)}</ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          {can(u, "desk.act") && e.iccid && e.status !== "refunded" ? (
            <Card>
              <CardHead title={t("Help the traveller")} />
              <div className="space-y-3">
                <ActionForm action={esimResendAction}><input type="hidden" name="esimId" value={e.id} /><SubmitButton variant="outline" size="sm">{t("Send install details again")}</SubmitButton></ActionForm>
                <ActionForm action={esimNoteAction} className="space-y-2" resetOnOk>
                  <input type="hidden" name="esimId" value={e.id} />
                  <Textarea name="note" rows={3} maxLength={300} placeholder={t("A line to the traveller, in your words")} />
                  <SubmitButton size="sm">{t("Send note")}</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ) : null}
          {can(u, "desk.refund") && e.topupPlans.length ? (
            <Card>
              <CardHead title={t("Top up on Mada")} hint={t("Bought now on our balance; the traveller pays nothing.")} />
              <ActionForm action={esimTopupAction} className="space-y-2">
                <input type="hidden" name="esimId" value={e.id} />
                <input type="hidden" name="ask" value={randomUUID()} />
                <select name="packageId" className="field h-9 w-full text-[13px]" defaultValue="">
                  <option value="" disabled>{t("Pick a top-up")}</option>
                  {e.topupPlans.slice(0, 20).map((p) => <option key={p.id} value={p.id}>{p.gb === null ? t("Unlimited") : `${p.gb} GB`} · {t("{n} days", { n: p.days })}{canDeskFinance(u) ? ` · $${p.netUsd.toFixed(2)}` : ""}</option>)}
                </select>
                <SubmitButton size="sm" confirm={t("Top this eSIM up on Mada?")}>{t("Top up")}</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {e.status === "stuck" && can(u, "desk.act") ? <Card><ActionForm action={esimRetryAction}><input type="hidden" name="orderId" value={e.orderId} /><SubmitButton size="sm">{t("Check the supplier and order")}</SubmitButton></ActionForm></Card> : null}
          {e.status !== "refunded" && can(u, "desk.refund") ? (
            <Card>
              <CardHead title={t("Cancel and refund")} hint={e.installedAt ? t("Installed: the supplier won't take it back, Mada carries the cost.") : t("Never installed: the supplier cancels it and returns its cost.")} />
              <ActionForm action={esimRefundAction} className="flex items-center gap-1.5">
                <input type="hidden" name="esimId" value={e.id} />
                <select name="reason" className="field h-8 py-0 text-[12.5px]" defaultValue={e.installedAt ? "INSTALLATION_FAILURE" : "TRIP_CANCELLATION"}>
                  {["INSTALLATION_FAILURE", "NO_COVERAGE", "TRIP_CANCELLATION", "WRONG_PURCHASE", "INCOMPATIBLE_DEVICE", "OTHERS"].map((r) => <option key={r} value={r}>{t(r)}</option>)}
                </select>
                <SubmitButton variant="danger" size="sm" confirm={t("Refund this eSIM to the traveller?")}>{t("Refund")}</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
