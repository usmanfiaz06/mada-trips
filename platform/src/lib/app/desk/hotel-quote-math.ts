import { costHalalas, sellHalalas, type PricingRules } from "@/lib/app/suppliers/hotelbeds/money";

/*
 * The price of a room the desk found by hand, worked out exactly as an instant stay is (suppliers/hotelbeds/money.ts:
 * APP_FX_RATES, APP_FX_BUFFER_BPS, APP_STAY_MARKUP_BPS): what it costs us, what the traveller pays, and the margin.
 * Pure, so the quote form shows the same numbers before sending (the server passes the rules down) that the server
 * charges after. Amounts are halalas.
 */

/** Where the agent found the room. Internal: it never reaches the app. */
export const HAND_SUPPLIERS = ["hotelbeds_portal", "tbo_portal", "hotel_direct", "other"] as const;
export type HandSupplier = (typeof HAND_SUPPLIERS)[number];
export const HAND_SUPPLIER_LABEL: Record<HandSupplier, string> = { hotelbeds_portal: "Hotelbeds portal", tbo_portal: "TBO portal", hotel_direct: "Hotel direct", other: "Other" };
/** As app_order_costs names the supplier. */
export const HAND_SUPPLIER_FINANCE: Record<HandSupplier, string> = { hotelbeds_portal: "hotelbeds", tbo_portal: "tbo", hotel_direct: "hotel", other: "other" };

export const BOARDS = ["RO", "BB", "HB", "FB", "AI"] as const;
export const BOARD_LABEL: Record<(typeof BOARDS)[number], string> = { RO: "Room only", BB: "Breakfast", HB: "Half board", FB: "Full board", AI: "All inclusive" };

/** A stay request from Ask (or a plan item): searched by hand, quoted from the request page until it's paid. */
export const isStayAsk = (d: unknown): boolean => {
  const x = (d ?? {}) as { source?: string; askKind?: string };
  return x.source === "ask" && x.askKind === "stay";
};

export type HandStayPrice = { cost: number; sell: number; margin: number };

/** Net cost in the supplier's currency → cost to us, the selling price (instant-stay rules) and the margin. */
export function handStayPrice(net: number, currency: string, rules: PricingRules): HandStayPrice {
  const cost = costHalalas(net, currency, rules);
  const sell = sellHalalas(net, currency, "stay", { rules });
  return { cost, sell, margin: sell - cost };
}

/** Desk-only: what each option costs, where it was found, and the price as worked out. Kept under `wholesale`. */
export type HandStayCost = {
  id: string; supplier: HandSupplier; supplierRef: string | null; netAmount: string; currency: string;
  costHalalas: number; autoSell: number; sell: number; marginHalalas: number; overrideReason: string | null;
};

/** The desk-only costs kept with a hotel quote's snapshot (empty for any other quote). */
export function handStayCostsOf(snapshot: unknown): HandStayCost[] {
  const w = (snapshot as { wholesale?: unknown } | null)?.wholesale;
  return Array.isArray(w) ? (w as HandStayCost[]) : [];
}
