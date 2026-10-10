import { MessageCircle, PlaneTakeoff, Receipt, ShieldAlert, ShoppingBag, Ticket, Undo2 } from "lucide-react";

/** How each kind of desk work looks in lists: label, icon, colour. Shared by server and client components. */
export const KIND_META: Record<string, { label: string; icon: typeof Ticket; tone: string }> = {
  order: { label: "Order", icon: ShoppingBag, tone: "bg-gold-soft text-gold-2" },
  ticketing: { label: "Ticketing", icon: Ticket, tone: "bg-info-soft text-info" },
  chat: { label: "Chat", icon: MessageCircle, tone: "bg-ok-soft text-ok" },
  request: { label: "Request", icon: Receipt, tone: "bg-sunken text-ink-2" },
  refund: { label: "Refund", icon: Undo2, tone: "bg-warn-soft text-warn" },
  disruption: { label: "Disruption", icon: PlaneTakeoff, tone: "bg-bad-soft text-bad" },
  moderation: { label: "Moderation", icon: ShieldAlert, tone: "bg-sunken text-ink-2" },
};
