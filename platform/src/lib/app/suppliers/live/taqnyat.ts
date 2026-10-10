import type { SmsSupplier } from "../types";
import { postJson, requireEnv } from "./not-configured";

/**
 * Taqnyat SMS (REST, api.taqnyat.sa). A Saudi sender with a CST-registered sender name, like Unifonic.
 *   TAQNYAT_BEARER_TOKEN  the application token from the Taqnyat portal
 *   TAQNYAT_SENDER_NAME   the registered sender name ("MadaTrips")
 * Chosen with SMS_PROVIDER=taqnyat (Unifonic is the default live SMS adapter).
 */
export const taqnyatSms: SmsSupplier = {
  name: "taqnyat",
  async send(to, text) {
    const env = requireEnv("taqnyat", ["TAQNYAT_BEARER_TOKEN", "TAQNYAT_SENDER_NAME"]);
    const data = (await postJson("https://api.taqnyat.sa/v1/messages", {
      recipients: [to.replace(/^\+/, "")], body: text, sender: env.TAQNYAT_SENDER_NAME,
    }, { Authorization: `Bearer ${env.TAQNYAT_BEARER_TOKEN}` })) as { statusCode?: number; messageId?: string | number; message?: string } | null;
    if (!data || (data.statusCode && data.statusCode >= 300)) throw new Error(`Taqnyat refused the message: ${data?.message ?? "no answer"}`);
    return { id: String(data.messageId ?? "") };
  },
};
