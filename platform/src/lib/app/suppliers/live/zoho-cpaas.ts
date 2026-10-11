import type { Sent, WhatsAppSupplier } from "../types";
import { WhatsAppUndeliverable } from "../whatsapp-errors";
import { notConfigured, requireEnv } from "./not-configured";

/*
 * WhatsApp through Zoho CPaaS (cpaas.zoho.com: Zoho's messaging platform, home of ZeptoMail and a WhatsApp channel).
 * Used for sign-in codes (the Send SMS hook) with an approved Authentication-category template. docs/app/AUTH.md,
 * "Phone codes on WhatsApp (Zoho CPaaS)", has the setup.
 *
 * What Zoho's public API reference says (OpenAPI 1.1.0, https://www.zoho.com/sites/zweb/json/api/cpaas/oas.json,
 * pages under https://www.zoho.com/cpaas/help/api/api-home.html), confirmed:
 *   POST https://cpaas.zoho.com/v1.1/whatsapp        one templated message to one number
 *   Authorization: Zoho-enczapikey <API key>         the agent's API key ("SMTP/API" tab); the agent comes from the key
 *   body { from, to, template_key | template_alias, merge_info: { <placeholder>: <value> }, client_reference? }
 *        from/to with the country code ("+9665…"); template_key is a UUID, template_alias the template's alias
 *   200  { status: "success", data: { code: "MSG_101", message_id, message: "Message queued", request_id } }
 *   400  TM_3301 / TM_3201 (details SERR_110, GE_102, with `target`), 401 TM_4001 (SERR_157 bad key, WA_103 template
 *        not valid for the agent), 403 TM_3601 (WSE_107 sender belongs to another agent)
 *   GET  /v1.1/whatsapp/logs/{message_id}           status: sent | delivered | read | undelivered | failed | process_failed
 *   Sending is asynchronous: "queued on acceptance", and a missing variable or an undeliverable number only shows in
 *   the logs. The logs list is rate limited to 40 requests a minute; no limit is published for sending.
 *
 * Not in the public docs (assumed; check against the Zoho console before going live, AUTH.md lists them):
 *   - the merge key: we send the code under ZOHO_CPAAS_MERGE_KEY (default "code", as in Zoho's own OTP example);
 *   - the copy-code / one-tap button: assumed to take the same code automatically (Meta fills an Authentication
 *     template's button from the body's code); there is no separate button field in the API;
 *   - other data centres (.eu, .in, .sa …): ZOHO_CPAAS_BASE_URL overrides the .com default. Mada is on .com;
 *   - how quickly "undelivered" shows for a number that isn't on WhatsApp: we look for up to ZOHO_CPAAS_CONFIRM_MS
 *     (default 1500 ms) so a fallback to SMS still fits inside Supabase's 5-second hook timeout.
 *
 * Environment:
 *   ZOHO_CPAAS_API_KEY            the agent's API key (with or without the "Zoho-enczapikey " prefix)
 *   ZOHO_CPAAS_WHATSAPP_SENDER    the WhatsApp sender number connected in Zoho, with the country code (+9665…)
 *   ZOHO_CPAAS_TEMPLATE_EN        the English Authentication template: its template key (UUID) or alias
 *   ZOHO_CPAAS_TEMPLATE_AR        the Arabic one (falls back to English when unset)
 *   ZOHO_CPAAS_MERGE_KEY          the template's code placeholder (default "code")
 *   ZOHO_CPAAS_BASE_URL           default https://cpaas.zoho.com/v1.1
 *   ZOHO_CPAAS_CONFIRM_MS         how long to watch the logs for a refusal (default 1500; 0 turns it off)
 */

const DEFAULT_BASE = "https://cpaas.zoho.com/v1.1";
const SEND_TIMEOUT_MS = 3_000;
const POLL_EVERY_MS = 500;
/** Statuses that mean the number won't get it (the message logs). */
const REFUSED = new Set(["undelivered", "failed", "process_failed"]);
/** Statuses that mean it's on its way. */
const ACCEPTED = new Set(["sent", "delivered", "read"]);

export const ZOHO_WHATSAPP_ENV = ["ZOHO_CPAAS_API_KEY", "ZOHO_CPAAS_WHATSAPP_SENDER", "ZOHO_CPAAS_TEMPLATE_EN"] as const;

/** Every variable sending a code needs. */
export const zohoWhatsAppConfigured = () => ZOHO_WHATSAPP_ENV.every((n) => !!process.env[n]);

const base = () => (process.env.ZOHO_CPAAS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
const authHeader = (key: string) => (/^Zoho-enczapikey /i.test(key.trim()) ? key.trim() : `Zoho-enczapikey ${key.trim()}`);
const e164 = (n: string) => `+${n.replace(/\D/g, "")}`;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Codes only in our errors: never the number, never the message text. */
const safe = (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);

type ZohoDetail = { code?: string; message?: string; target?: string };
type ZohoError = { error?: { code?: string; message?: string; details?: ZohoDetail[] } };
type ZohoSent = { status?: string; data?: { code?: string; message_id?: string } };
type ZohoLog = { data?: { status?: string; error_message?: ZohoError } };

/** The template for this language: a key (UUID) or an alias. */
export function zohoTemplate(locale: "en" | "ar"): { template_key: string } | { template_alias: string } {
  const ref = ((locale === "ar" && process.env.ZOHO_CPAAS_TEMPLATE_AR) || process.env.ZOHO_CPAAS_TEMPLATE_EN || "").trim();
  return isUuid(ref) ? { template_key: ref } : { template_alias: ref };
}

/** The request body for one code. client_reference never carries the code (Zoho echoes it in the logs). */
export function zohoAuthCodeBody(to: string, code: string, locale: "en" | "ar") {
  return {
    from: e164(process.env.ZOHO_CPAAS_WHATSAPP_SENDER ?? ""),
    to: e164(to),
    ...zohoTemplate(locale),
    merge_info: { [process.env.ZOHO_CPAAS_MERGE_KEY || "code"]: code },
    client_reference: `mada-otp-${Date.now().toString(36)}`,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** One look at the message log. null when it can't tell yet (or the log can't be read, which isn't the traveller's problem). */
async function statusOf(id: string, key: string): Promise<{ status: string; detail: string } | null> {
  try {
    const res = await fetch(`${base()}/whatsapp/logs/${encodeURIComponent(id)}`, {
      headers: { Authorization: authHeader(key), Accept: "application/json" }, signal: AbortSignal.timeout(1_000),
    });
    if (!res.ok) return null;
    const log = (await readJson(res)) as ZohoLog | null;
    const status = log?.data?.status?.toLowerCase();
    if (!status) return null;
    return { status, detail: safe(log?.data?.error_message?.error?.details?.[0]?.code ?? log?.data?.error_message?.error?.code) };
  } catch {
    return null;
  }
}

/** Watch the log briefly: a refusal throws, anything else (on its way, or still unknown) returns. */
async function confirm(id: string, key: string) {
  const budget = Number(process.env.ZOHO_CPAAS_CONFIRM_MS ?? 1500);
  if (!id || !Number.isFinite(budget) || budget <= 0) return;
  const until = Date.now() + budget;
  while (Date.now() < until) {
    await sleep(Math.min(POLL_EVERY_MS, Math.max(0, until - Date.now())));
    const s = await statusOf(id, key);
    if (!s) continue;
    if (REFUSED.has(s.status)) throw new WhatsAppUndeliverable(s.status, s.detail || undefined);
    if (ACCEPTED.has(s.status)) return;
  }
}

export const zohoWhatsApp: WhatsAppSupplier = {
  name: "zoho-cpaas",

  async sendAuthCode(to, code, locale): Promise<Sent> {
    const env = requireEnv("whatsapp (Zoho CPaaS)", [...ZOHO_WHATSAPP_ENV]);
    const key = env.ZOHO_CPAAS_API_KEY!;
    const res = await fetch(`${base()}/whatsapp`, {
      method: "POST",
      headers: { Authorization: authHeader(key), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(zohoAuthCodeBody(to, code, locale)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data = (await readJson(res)) as (ZohoSent & ZohoError) | null;
    if (!res.ok || data?.error || data?.status !== "success") {
      // 5xx and the like: transport trouble, which the circuit breaker counts.
      if (res.status >= 500) throw new Error(`cpaas.zoho.com answered ${res.status}`);
      const top = safe(data?.error?.code) || String(res.status);
      const detail = data?.error?.details?.[0];
      // The number itself was refused (malformed, or not a number WhatsApp can reach).
      if (detail?.target === "to") throw new WhatsAppUndeliverable(top, safe(detail.code));
      // Anything else is ours to fix: the key (SERR_157), the template (WA_103), the sender (WSE_107), a missing field.
      throw new Error(`Zoho CPaaS refused the WhatsApp message: ${top}${detail?.code ? `/${safe(detail.code)}` : ""}`);
    }
    const id = data.data?.message_id ?? "";
    await confirm(id, key);
    return { id };
  },

  /** Other templates (invites) still go through Meta's Cloud API adapter; this one is for sign-in codes. */
  async sendTemplate() {
    return notConfigured("whatsapp (Zoho CPaaS) templates other than sign-in codes", ["not built: invites use WHATSAPP_PROVIDER=meta"]);
  },
};
