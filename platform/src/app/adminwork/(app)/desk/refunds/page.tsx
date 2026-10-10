import Link from "next/link";
import { Undo2, Wallet, CreditCard } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { listRefunds } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, Empty, Money, PageHeader, Tabs, Textarea, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SlaClock } from "@/components/desk/live";
import { approveRefundAction, rejectRefundAction } from "../actions";

export const metadata = { title: "Refunds · Desk" };
const STAGES = ["requested", "approved", "sent", "rejected"] as const;
const STAGE: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "To decide", tone: "gold" }, approved: { label: "Approved · on its way", tone: "info" }, sent: { label: "Sent", tone: "ok" }, rejected: { label: "Declined", tone: "bad" },
};

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ s?: string; focus?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const stage = (STAGES as readonly string[]).includes(sp.s ?? "") ? sp.s! : "requested";
  const all = await listRefunds();
  const rows = all.filter((f) => f.stage === stage);
  const decide = can(u, "desk.refund");
  return (
    <>
      <PageHeader eyebrow={t("App desk")} title={t("Refunds and changes")} subtitle={t("Approve to the card it came from or to Mada credit, which is instant. A declined refund shows the traveller your reason.")} />
      <Tabs active={stage} items={STAGES.map((s) => ({ key: s, label: t(STAGE[s]!.label), href: `/adminwork/desk/refunds?s=${s}`, count: s === "requested" ? all.filter((f) => f.stage === s).length : undefined }))} />
      {rows.length === 0 ? <Card><Empty icon={<Undo2 className="size-5" />} title={stage === "requested" ? t("No refunds waiting") : t("Nothing here")} hint={t("Cancellations and refund requests from the app show up here.")} /></Card> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((f) => {
            const inst = f.payment.method === "tabby" ? "Tabby" : f.payment.method === "tamara" ? "Tamara" : null;
            const sla = f.stage === "requested" ? slaFor("refund", f.createdAt) : null;
            return (
              <Card key={f.id} id={f.id} className={cx(sp.focus === f.id && "ring-2 ring-gold")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3"><span className="num">{f.ref}</span><Badge tone={STAGE[f.stage]?.tone ?? "neutral"} dot>{t(STAGE[f.stage]?.label ?? f.stage)}</Badge>{sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}</div>
                    <h2 className="mt-1.5 truncate text-[17px] font-[450] tracking-[-0.02em]">{f.summary ?? t("Refund")}</h2>
                    <div className="text-[13px] text-ink-3">{f.userName} · {timeAgo(f.createdAt, L)}{f.requestId && <> · <Link href={`/adminwork/desk/orders/${f.requestId}`} className="underline decoration-gold decoration-2 underline-offset-2">{t("Open the order")}</Link></>}</div>
                  </div>
                  <Money v={f.amount} className="text-[26px] font-[350] tracking-[-0.03em]" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-3 text-[13px] sm:grid-cols-3">
                  <div><div className="text-[11.5px] text-ink-3">{t("Paid with")}</div><div className="text-ink">{inst ?? f.payment.label ?? f.payment.method}</div></div>
                  <div><div className="text-[11.5px] text-ink-3">{t("Paid")}</div><Money v={f.payment.amount} className="text-ink" /></div>
                  <div><div className="text-[11.5px] text-ink-3">{t("Reason given")}</div><div className="truncate text-ink">{f.stage === "rejected" ? "—" : f.reason ?? "—"}</div></div>
                </div>
                {inst && <p className="mt-3 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[12.5px] text-info">{t("Paid with {provider}. Refunding to the card cancels the remaining payments with {provider}, and what was paid goes back to their card. Mada credit is instant instead.", { provider: inst })}</p>}
                {f.stage === "rejected" && <p className="mt-3 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">{t("Traveller reads:")} {f.reason}</p>}
                {f.stage !== "requested" && f.stage !== "rejected" && <p className="mt-3 text-[12.5px] text-ink-3">{f.destination === "credit" ? t("To Mada credit") : t("To {card}", { card: f.payment.label ?? t("the card") })}{f.expectedBy ? ` · ${t("expected by {date}", { date: fmtDate(f.expectedBy, L) })}` : ""}</p>}
                {f.stage === "requested" && (decide ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={approveRefundAction} className="space-y-2">
                      <input type="hidden" name="id" value={f.id} />
                      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-sunken p-1">
                        {[["original", inst ?? t("Card"), CreditCard], ["credit", t("Mada credit"), Wallet]].map(([v, l, I]) => {
                          const Icon = I as typeof Wallet;
                          return (
                            <label key={String(v)} className="block">
                              <input type="radio" name="destination" value={String(v)} defaultChecked={v === "original"} className="peer sr-only" />
                              <span className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[12.5px] text-ink-3 transition peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-card"><Icon className="size-3.5" />{String(l)}</span>
                            </label>
                          );
                        })}
                      </div>
                      <SubmitButton variant="gold" className="w-full">{t("Approve refund")}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={rejectRefundAction} className="space-y-2">
                      <input type="hidden" name="id" value={f.id} />
                      <Textarea name="reason" rows={2} required minLength={10} maxLength={300} placeholder={t("Why not, in words the traveller will read")} />
                      <SubmitButton variant="outline" className="w-full">{t("Decline with reason")}</SubmitButton>
                    </ActionForm>
                  </div>
                ) : <p className="mt-4 text-[12.5px] text-ink-3">{t("Refund decisions need the desk refund right.")}</p>)}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
