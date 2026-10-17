import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { agentForOps } from "@/lib/app/desk/agents";
import { deskInbox, inboxCounts } from "@/lib/app/desk/inbox";
import { onShift } from "@/lib/app/desk/routing";
import { DeskNav } from "@/components/desk/live";
import { StatusPill } from "@/components/desk/parts";
import { statusPillAction } from "./actions";
import { esimBalance } from "@/lib/app/esim/ops";
import { Notice } from "@/components/ui";
import Link from "next/link";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const [{ items, rota }, me, bal] = await Promise.all([deskInbox(), agentForOps(u.id), esimBalance().catch(() => null)]);
  const c = inboxCounts(items, me);
  const nav = [
    { href: "/adminwork/desk", label: t("Inbox"), count: c.breached || c.all, tone: c.breached ? "bad" as const : undefined },
    { href: "/adminwork/desk/orders", label: t("Orders"), count: c.by.order + c.by.ticketing },
    { href: "/adminwork/desk/requests", label: t("Requests"), count: c.by.request },
    { href: "/adminwork/desk/chats", label: t("Chats"), count: c.by.chat },
    { href: "/adminwork/desk/refunds", label: t("Refunds"), count: c.by.refund },
    { href: "/adminwork/desk/esims", label: t("eSIMs") },
    { href: "/adminwork/desk/disruptions", label: t("Disruptions"), count: c.by.disruption, tone: c.by.disruption ? "bad" as const : undefined },
    { href: "/adminwork/desk/moderation", label: t("Moderation"), count: c.by.moderation },
    { href: "/adminwork/desk/recovery", label: t("Account recovery"), count: c.by.recovery },
    { href: "/adminwork/desk/whats-on", label: t("What's on") },
    { href: "/adminwork/desk/team", label: can(u, "desk.admin") ? t("Team & rota") : t("Team") },
  ];
  return (
    <>
      <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1"><DeskNav items={nav} /></div>
        {me && <StatusPill agent={{ id: me.id, name: me.displayName, status: me.status }} onShift={onShift(me.id, rota.shifts, rota.now)} action={statusPillAction} />}
      </div>
      {bal?.low ? (
        <div className="mb-3"><Notice tone="bad" title={t("eSIM Access balance is low: ${usd}", { usd: (bal.usd ?? 0).toFixed(2) })}>{t("Top it up in the eSIM Access console, or paid eSIMs wait.")} <Link href="/adminwork/desk/esims" className="underline decoration-gold underline-offset-4">{t("eSIMs")}</Link></Notice></div>
      ) : null}
      {children}
    </>
  );
}
