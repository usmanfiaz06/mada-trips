import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { agentForOps } from "@/lib/app/desk/agents";
import { deskInbox, inboxCounts } from "@/lib/app/desk/inbox";
import { onShift } from "@/lib/app/desk/routing";
import { DeskNav } from "@/components/desk/live";
import { StatusPill } from "@/components/desk/parts";
import { statusPillAction } from "./actions";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const [{ items, rota }, me] = await Promise.all([deskInbox(), agentForOps(u.id)]);
  const c = inboxCounts(items, me);
  const nav = [
    { href: "/adminwork/desk", label: t("Inbox"), count: c.breached || c.all, tone: c.breached ? "bad" as const : undefined },
    { href: "/adminwork/desk/orders", label: t("Orders"), count: c.by.order + c.by.ticketing },
    { href: "/adminwork/desk/requests", label: t("Requests"), count: c.by.request },
    { href: "/adminwork/desk/chats", label: t("Chats"), count: c.by.chat },
    { href: "/adminwork/desk/refunds", label: t("Refunds"), count: c.by.refund },
    { href: "/adminwork/desk/disruptions", label: t("Disruptions"), count: c.by.disruption, tone: c.by.disruption ? "bad" as const : undefined },
    { href: "/adminwork/desk/moderation", label: t("Moderation"), count: c.by.moderation },
    { href: "/adminwork/desk/recovery", label: t("Account recovery"), count: c.by.recovery },
    { href: "/adminwork/desk/team", label: can(u, "desk.admin") ? t("Team & rota") : t("Team") },
  ];
  return (
    <>
      <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1"><DeskNav items={nav} /></div>
        {me && <StatusPill agent={{ id: me.id, name: me.displayName, status: me.status }} onShift={onShift(me.id, rota.shifts, rota.now)} action={statusPillAction} />}
      </div>
      {children}
    </>
  );
}
