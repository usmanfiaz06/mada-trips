/*
 * Pay later (Tabby, Tamara): the traveller pays in instalments, the provider pays Mada in full and carries the
 * credit risk. Server side: a checkout session (the provider's page opens in the app), the webhook that says the
 * traveller was approved, capture when the booking is confirmed, refund, cancel. Amounts in SAR halalas.
 * The pay sheet shows `instalments` ("4 payments of SAR 250, the first today").
 */

export type PayLaterProvider = "tabby" | "tamara";

export type PayLaterItem = { reference: string; title: string; quantity: number; unitPrice: number; category: "flight" | "stay" | "transfer" | "activity" | "esim" | "other" };

export type PayLaterCheckoutInput = {
  /** Our order id: the provider keeps it (order reference) and the webhook carries it back. */
  reference: string;
  amount: number;
  description: string;
  buyer: { firstName: string; lastName: string; email: string; phone: string; dateOfBirth?: string | null };
  items: PayLaterItem[];
  /** Tamara wants an address; for travel it's the buyer's home city. */
  city: string;
  urls: { success: string; cancel: string; failure: string; notification?: string };
  language?: "en" | "ar";
};

export type Instalment = { due: string; amount: number };
export type InstalmentPlan = { provider: PayLaterProvider; count: number; schedule: Instalment[]; fee: number; firstToday: boolean };

export type PayLaterStatus = "created" | "approved" | "authorized" | "captured" | "refunded" | "cancelled" | "rejected" | "expired";

export type PayLaterSession = {
  provider: PayLaterProvider;
  /** The provider's payment id (Tabby) or order id (Tamara): what capture and refund take. */
  id: string;
  reference: string;
  status: "created" | "rejected";
  /** Open this in the app's browser sheet. Null when rejected. */
  checkoutUrl: string | null;
  /** Why the provider said no up front (for the team; the traveller sees "Pay later isn't available for this"). */
  rejectedReason: string | null;
  instalments: InstalmentPlan;
};

export type PayLaterPayment = { provider: PayLaterProvider; id: string; reference: string | null; status: PayLaterStatus; amount: number; captured: number; refunded: number };

/** A webhook we have verified and confirmed with the provider. */
export type PayLaterEvent = { provider: PayLaterProvider; id: string; reference: string | null; status: PayLaterStatus };

export interface PayLaterSupplier {
  readonly provider: PayLaterProvider;
  readonly name: string;
  /** Whether this amount can be offered at all (the provider's limits), before a checkout is made. */
  eligible(amount: number): boolean;
  instalments(amount: number, today: string): InstalmentPlan;
  createCheckout(input: PayLaterCheckoutInput): Promise<PayLaterSession>;
  payment(id: string): Promise<PayLaterPayment>;
  /** Tamara: after the approved webhook, authorise the order (Tabby authorises by itself). */
  authorise(id: string): Promise<PayLaterPayment>;
  /** Capture when the booking is confirmed (ticketed, booked). Idempotent on `reference`. */
  capture(id: string, amount: number, reference: string): Promise<PayLaterPayment>;
  refund(id: string, amount: number, reference: string, reason?: string): Promise<PayLaterPayment>;
  /** Before capture: let the traveller's instalments go (nothing is charged). */
  cancel(id: string): Promise<PayLaterPayment>;
  /** The webhook's raw body and headers → the event, or null when it isn't genuinely from the provider. */
  verifyWebhook(raw: string, headers: Headers, url: string): Promise<PayLaterEvent | null>;
}
