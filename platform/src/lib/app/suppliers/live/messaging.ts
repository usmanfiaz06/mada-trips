import type { EmailSupplier, SmsSupplier, WhatsAppSupplier } from "../types";
import { notConfigured, postJson, requireEnv } from "./not-configured";

/** Unifonic SMS (REST). Needs a registered sender ID ("MadaTrips") with CST. */
export const unifonicSms: SmsSupplier = {
  name: "unifonic",
  async send(to, text) {
    const env = requireEnv("unifonic", ["UNIFONIC_APP_SID", "UNIFONIC_SENDER_ID"]);
    const form = new URLSearchParams({ AppSid: env.UNIFONIC_APP_SID!, SenderID: env.UNIFONIC_SENDER_ID!, Recipient: to.replace(/^\+/, ""), Body: text });
    const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean | string; data?: { MessageID?: string | number }; message?: string } | null;
    if (!res.ok || !data || String(data.success) !== "true") throw new Error(`Unifonic refused the message: ${data?.message ?? res.status}`);
    return { id: String(data.data?.MessageID ?? "") };
  },
};

/** WhatsApp Business Platform, Meta Cloud API directly (no middleman fee). Templates must be approved by Meta first. */
export const metaWhatsApp: WhatsAppSupplier = {
  name: "meta-cloud-api",
  async sendTemplate(to, template, params, locale = "en") {
    const env = requireEnv("whatsapp", ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
    const data = (await postJson(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
      template: { name: template, language: { code: locale === "ar" ? "ar" : "en" }, components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [] },
    }, { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` })) as { messages?: { id: string }[] };
    return { id: data.messages?.[0]?.id ?? "" };
  },
};

/** Amazon SES: the live adapter (SigV4 signing) lands with the first email flow in M2. */
export const sesEmail: EmailSupplier = {
  name: "amazon-ses",
  async send() { return notConfigured("email (Amazon SES)", ["live adapter not built yet"]); },
};
