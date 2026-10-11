import type { EmailSupplier, SmsSupplier, WhatsAppSupplier } from "../types";
import { WhatsAppUndeliverable } from "../whatsapp-errors";
import { record } from "./outbox";

/** In mock mode a number ending in these digits "isn't on WhatsApp", so the fallback to SMS can be tried. */
export const MOCK_NOT_ON_WHATSAPP_SUFFIX = "0000";

/** Logs the message (including sign-in codes) instead of sending it. */
export const mockSms: SmsSupplier = {
  name: "mock-sms",
  async send(to, text) { return { id: record({ channel: "sms", to, body: text }).id }; },
};

export const mockWhatsApp: WhatsAppSupplier = {
  name: "mock-whatsapp",
  async sendTemplate(to, template, params, locale = "en") {
    return { id: record({ channel: "whatsapp", to, body: `${template}[${locale}](${params.join(" | ")})` }).id };
  },
  async sendAuthCode(to, code, locale) {
    if (to.replace(/\D/g, "").endsWith(MOCK_NOT_ON_WHATSAPP_SUFFIX)) throw new WhatsAppUndeliverable("undelivered", "mock");
    return { id: record({ channel: "whatsapp", to, body: `auth_code[${locale}](${code})` }).id };
  },
};

export const mockEmail: EmailSupplier = {
  name: "mock-email",
  async send(m) { return { id: record({ channel: "email", to: m.to, body: `${m.subject}\n\n${m.text}` }).id }; },
};
