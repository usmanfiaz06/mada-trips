import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Gift, MessagesSquare, ShieldCheck } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { getSettings } from "@/lib/settings";
import { sar } from "@/lib/money";
import { CUSTOMER_TABS, getCustomer, type CustomerTab } from "@/lib/app/desk/customers";
import { Badge, Card, CardHead, Input, KV, Money, PageHeader, Stat, Tabs, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { blockCustomerAction, goodwillAction, unblockCustomerAction } from "../actions";
import { AuditTab, BookingsTab, ChatsTab, CreditTab, EsimsTab, MemoryTab, OverviewTab, PaymentsTab, PlansTab, RequestsTab, OPEN_KIND } from "./tabs";

export const metadata = { title: "Customer · Desk" };
const TAB_LABEL: Record<CustomerTab, string> = {
  overview: "Overview", bookings: "Bookings", plans: "Trips & plans", payments: "Payments & refunds", credit: "Credit ledger", esims: "eSIMs", requests: "Requests",
  chats: "Chats", memory: "What Mada remembers", audit: "History",
};

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; ask?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [c, s] = await Promise.all([getCustomer(id), getSettings()]);
  if (!c) notFound();
  const tab: CustomerTab = (CUSTOMER_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as CustomerTab) : "overview";
  const base = `/adminwork/desk/customers/${id}`;
  const { user, stats, flags } = c;
  const next = c.open[0] ?? null;
  const supportThread = c.lastChat?.threadId ?? null;
  const lead = can(u, "desk.admin");
  const alone = can(u, "desk.refund");
  return (
    <>
      <PageHeader eyebrow={<Link href="/adminwork/desk/customers" className="hover:text-ink">{t("Customers")}</Link>}
        title={<bdi>{user.name || t("Traveller")}</bdi>}
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num" dir="ltr">{user.phone ?? t("No phone")}</span>
          <span>{user.locale === "ar" ? "العربية" : "English"}</span>
          <span>{c.agent ? t("Primary agent {name}", { name: c.agent.name }) : t("No primary agent")}</span>
          {flags.blocked && <Badge tone="bad" dot>{t("Blocked")}</Badge>}
          {flags.deleted && <Badge tone="neutral" dot>{t("Account deleted")}</Badge>}
        </span>}
        actions={supportThread ? <Link href={`/adminwork/desk/chats?t=support:${supportThread}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[13.5px] text-ink shadow-card transition hover:bg-surface-2"><MessagesSquare className="size-4" />{t("Open the chat")}</Link> : undefined} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t("Lifetime value")} value={<Money v={stats.lifetime} muted compact />} sub={t("Paid, less refunds")} />
        <Stat label={t("Bookings")} value={<span className="num">{stats.bookings}</span>} href={`${base}?tab=bookings`} />
        <Stat label={t("Mada credit")} value={<Money v={stats.credit} muted />} href={`${base}?tab=credit`} tone={stats.credit > 0 ? "ok" : undefined} />
        <Stat label={t("Open items")} value={<span className="num">{stats.open}</span>} tone={stats.open ? "gold" : undefined} sub={stats.open ? t("Oldest {ago}", { ago: timeAgo(c.open[0]!.at, L) }) : t("Nothing waiting on us")} />
      </div>

      <Tabs active={tab} items={CUSTOMER_TABS.map((k) => ({ key: k, label: t(TAB_LABEL[k]), href: k === "overview" ? base : `${base}?tab=${k}` }))} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {tab === "overview" && <OverviewTab c={c} canReveal={can(u, "desk.issue")} />}
          {tab === "bookings" && <BookingsTab userId={id} />}
          {tab === "plans" && <PlansTab userId={id} />}
          {tab === "payments" && <PaymentsTab userId={id} />}
          {tab === "credit" && <CreditTab userId={id} />}
          {tab === "esims" && <EsimsTab userId={id} />}
          {tab === "requests" && <RequestsTab userId={id} />}
          {tab === "chats" && <ChatsTab actor={u} userId={id} hasOpen={c.open.length > 0} ask={sp.ask && isUuid(sp.ask) ? sp.ask : null} />}
          {tab === "memory" && <MemoryTab userId={id} />}
          {tab === "audit" && <AuditTab userId={id} />}
        </div>

        <aside className="space-y-4">
          <Card className="ring-2 ring-gold/40">
            <CardHead title={t("Next step")} hint={next ? t("The oldest thing this customer is waiting on.") : t("Nothing is waiting on the desk for this customer.")} />
            {next ? (
              <>
                <div className="mb-4 rounded-2xl bg-surface-2 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-[12px] text-ink-3"><span>{t(OPEN_KIND[next.kind])}</span><span>{timeAgo(next.at, L)}</span></div>
                  <div className="mt-1 truncate text-[14px] text-ink">{next.title}</div>
                </div>
                <Link href={next.href} className="flex h-11 w-full items-center justify-center rounded-full bg-gold text-[14px] font-medium text-[#1a140a] transition hover:brightness-105">{t("Open it")}</Link>
                {c.open.length > 1 && <p className="mt-3 text-center text-[12.5px] text-ink-3">{t("{n} more open on the overview", { n: c.open.length - 1 })}</p>}
              </>
            ) : <p className="text-[13px] text-ink-3">{c.trip ? t("Next trip: {city}, {date}", { city: c.trip.city, date: fmtDate(c.trip.startDate, L) }) : t("No upcoming trips.")}</p>}
          </Card>

          {can(u, "desk.act") && !flags.deleted && (
            <Card>
              <CardHead title={<span className="inline-flex items-center gap-2"><Gift className="size-4 text-gold" />{t("Goodwill credit")}</span>}
                hint={lead ? t("Goes on their Mada credit at once. The traveller sees the reason.") : alone
                  ? t("Up to {limit} at once, {daily} a day. More goes to a support lead in Approvals.", { limit: `SAR ${sar(s.deskGoodwillLimit)}`, daily: `SAR ${sar(s.deskAgentDailyLimit)}` })
                  : t("A support lead approves it in Approvals, then it lands on their Mada credit.")} />
              <ActionForm action={goodwillAction} className="space-y-2" resetOnOk>
                <input type="hidden" name="userId" value={id} />
                <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} required dir="ltr" className="num" aria-label={t("Amount (SAR)")} />
                <Textarea name="note" rows={2} required minLength={5} maxLength={200} placeholder={t("Why, in words the traveller will read")} />
                <SubmitButton variant="outline" className="w-full">{alone || lead ? t("Add credit") : t("Ask a lead to approve")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card>
            <CardHead title={t("Account")} />
            <KV cols={1} items={[
              [t("Signs in with"), user.authProviders.length ? user.authProviders.join(", ") : user.phone ? t("Phone") : "—"],
              [t("Joined"), fmtDate(user.createdAt, L)],
              [t("Devices"), c.devices.length ? `${c.devices.length} · ${t("last seen {ago}", { ago: timeAgo(c.devices[0]!.lastSeenAt, L) })}` : "—"],
            ]} />
            {can(u, "desk.moderate") && !flags.deleted && (
              <div className="mt-5 border-t border-line pt-4">
                {c.block ? (
                  <ActionForm action={unblockCustomerAction} className="space-y-2">
                    <p className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[12.5px] text-bad"><Ban className="me-1.5 inline size-3.5" />{t("Blocked {ago} by {name}: {reason}", { ago: timeAgo(c.block.at, L), name: c.block.by ?? t("the team"), reason: c.block.reason })}</p>
                    <input type="hidden" name="userId" value={id} />
                    <SubmitButton variant="outline" size="sm" className="w-full"><ShieldCheck className="size-4" />{t("Lift the block")}</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={blockCustomerAction} className="space-y-2">
                    <input type="hidden" name="userId" value={id} />
                    <Textarea name="reason" rows={2} required minLength={5} maxLength={300} placeholder={t("Why, for the team (the traveller doesn't see it)")} />
                    <SubmitButton variant="danger" size="sm" className={cx("w-full")} confirm={t("Block this account from posting and messaging?")}><Ban className="size-4" />{t("Block account")}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
