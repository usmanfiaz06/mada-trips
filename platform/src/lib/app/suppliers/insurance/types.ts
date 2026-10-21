/*
 * Travel insurance: quote, bind (buy), cancel, status. Cover Genius XCover live, a priced table in mock. Premiums are
 * the insurer's own price in SAR halalas (insurance can't carry our markup: Mada earns the partner commission), and
 * every write takes our order id as its reference so a retry never buys twice.
 */

export type InsuranceTraveller = { id: string; firstName: string; lastName: string; age: number; residence: string };

export type InsuranceQuoteInput = {
  /** Our order id: the quote and the policy carry it. */
  reference: string;
  trip: {
    /** ISO alpha-2. */
    from: string;
    to: string[];
    depart: string;
    return: string;
    /** What the trip costs (flights, stays…), in halalas: the cancellation cover is sized from it. */
    tripCost: number;
  };
  travellers: InsuranceTraveller[];
  language?: "en" | "ar";
};

export type InsuranceCover = { name: string; limit: number | null };

export type InsuranceOption = {
  id: string;
  product: "basic" | "comprehensive" | "cancellation";
  name: string;
  /** For everyone, all-in, halalas SAR. */
  premium: number;
  covers: InsuranceCover[];
  excess: number | null;
  /** Product disclosure / policy wording the traveller must be shown before buying. */
  wordingUrl: string | null;
  /** Schengen visa applications need medical cover of at least EUR 30,000: true when this option meets it. */
  schengenOk: boolean;
};

export type InsuranceQuote = {
  /** The quote package (XCover `id`). */
  id: string;
  supplier: "xcover" | "mock";
  reference: string;
  options: InsuranceOption[];
  expiresAt: string;
};

export type InsurancePolicy = {
  /** The booking id at the insurer. */
  id: string;
  reference: string;
  status: "confirmed" | "pending" | "cancelled";
  /** Policy numbers and certificates, one per traveller or one for the group. */
  policies: { number: string; certificateUrl: string | null }[];
  premium: number;
};

export type InsuranceHolder = { firstName: string; lastName: string; email: string; phone: string; country: string };

export interface InsuranceSupplier {
  readonly name: "xcover" | "mock";
  quote(input: InsuranceQuoteInput): Promise<InsuranceQuote>;
  /** Buy the chosen option(s) of a quote. Idempotent on the reference. */
  bind(input: { quoteId: string; optionIds: string[]; holder: InsuranceHolder; reference: string }): Promise<InsurancePolicy>;
  /** Within the cooling-off period it's a full refund; after, what the insurer's terms say. */
  cancel(policyId: string, reason: string): Promise<{ cancelled: boolean; refund: number }>;
  status(policyId: string): Promise<InsurancePolicy>;
}
