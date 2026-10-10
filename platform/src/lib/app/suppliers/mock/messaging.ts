import type { EmailSupplier, SmsSupplier, WhatsAppSupplier } from "../types";
import { record } from "./outbox";

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
};

export const mockEmail: EmailSupplier = {
  name: "mock-email",
  async send(m) { return { id: record({ channel: "email", to: m.to, body: `${m.subject}\n\n${m.text}` }).id }; },
};
