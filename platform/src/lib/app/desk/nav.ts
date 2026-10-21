import { can, type CurrentUser } from "@/lib/auth";
import type { NavItem, NavSection } from "@/components/shell/sidebar";
import type { DeskNavCounts } from "./inbox";
import { canDeskFinance } from "@/lib/app/finance/access";

/*
 * The desk's sidebar sections (DESK-PLAN.md §4.1). Entries marked `soon` are screens later units build: they stay
 * hidden until the unit that builds the page deletes the flag (and points `href` at it if it moved).
 */

type Item = NavItem & { show?: boolean; soon?: boolean };

export function deskSections(u: CurrentUser, t: (s: string) => string, c: DeskNavCounts): NavSection[] {
  if (!can(u, "desk.view")) return [];
  const D = "/adminwork/desk";
  const sections: { label: string; items: Item[] }[] = [
    { label: t("Support"), items: [
      { href: D, label: t("My queue"), icon: "Headset", count: c.queue },
      { href: `${D}/tickets`, label: t("Tickets"), icon: "TicketCheck" },
      { href: `${D}/chats`, label: t("Chats"), icon: "MessagesSquare", count: c.chats },
      { href: `${D}/ask`, label: t("Ask threads"), icon: "Bot", soon: true },
      { href: `${D}/customers`, label: t("Customers"), icon: "Contact" },
    ] },
    { label: t("App bookings"), items: [
      // The live board shows every booking by lifecycle; Orders stays as the desk's work list for flights and stays.
      { href: `${D}/bookings`, label: t("Live board"), icon: "ShoppingBag" },
      { href: `${D}/orders`, label: t("Orders"), icon: "ShoppingBag", count: c.orders },
      { href: `${D}/drop-offs`, label: t("Drop-offs"), icon: "TrendingDown" },
      { href: `${D}/requests`, label: t("Requests"), icon: "Receipt", count: c.requests },
      { href: `${D}/refunds`, label: t("Refunds & credits"), icon: "Undo2", count: c.refunds },
      { href: `${D}/esims`, label: t("eSIMs"), icon: "Smartphone", count: c.esims, tone: "bad" },
      { href: `${D}/disruptions`, label: t("Disruptions"), icon: "TriangleAlert", count: c.disruptions, tone: "bad" },
    ] },
    { label: t("App finance"), items: [
      { href: `${D}/finance`, label: t("App revenue & margin"), icon: "ChartLine", show: canDeskFinance(u) },
      { href: `${D}/finance/reconciliation`, label: t("Reconciliation"), icon: "Scale", show: canDeskFinance(u) },
      { href: `${D}/finance/balances`, label: t("Supplier balances"), icon: "Gauge", show: canDeskFinance(u) },
      { href: `${D}/finance/esim-pricing`, label: t("eSIM pricing"), icon: "Tags", show: can(u, "settings.manage") },
    ] },
    { label: t("Support admin"), items: [
      { href: `${D}/team`, label: can(u, "desk.admin") ? t("Team & rota") : t("Team"), icon: "UsersRound" },
      { href: `${D}/agents`, label: t("Agents & roles"), icon: "UserCog", soon: true },
      { href: `${D}/rota`, label: t("Rota & time"), icon: "CalendarClock", soon: true },
      { href: `${D}/performance`, label: t("Performance"), icon: "Activity", soon: true },
      { href: `${D}/macros`, label: t("Saved replies & macros"), icon: "MessageSquareText", soon: true },
      { href: `${D}/moderation`, label: t("Moderation"), icon: "Flag", count: c.moderation, show: can(u, "desk.moderate") },
      { href: `${D}/recovery`, label: t("Account recovery"), icon: "KeyRound", count: c.recovery },
      { href: `${D}/whats-on`, label: t("What's on"), icon: "CalendarDays" },
    ] },
  ];
  return sections
    .map((s) => ({ label: s.label, items: s.items.filter((i) => !i.soon && i.show !== false).map(({ show: _s, soon: _n, ...i }) => i) }))
    .filter((s) => s.items.length > 0);
}
