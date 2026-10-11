/**
 * WhatsApp answered, and the answer is that this number can't get the message: not on WhatsApp, the template refused,
 * the sender not allowed, or the message marked undelivered. An answer, not an outage, so the circuit breaker doesn't
 * count it (resilience/breaker.ts counts transport trouble only). The Send SMS hook may fall back to SMS on it.
 * `code` is the provider's own code (e.g. Zoho CPaaS "WA_103", or the delivery status "undelivered").
 */
export class WhatsAppUndeliverable extends Error {
  override readonly name = "WhatsAppUndeliverable";
  constructor(readonly code: string, detail?: string) {
    super(`WhatsApp can't deliver to this number (${code}${detail ? `: ${detail}` : ""})`);
  }
}
