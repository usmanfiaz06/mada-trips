import { AppError } from "../../http";

/** Thrown by a live adapter whose account or credentials don't exist yet. Surfaces as 501 NOT_CONFIGURED. */
export function notConfigured(supplier: string, missing: string[]): never {
  console.warn(`[app-api] ${supplier} is in live mode but not configured (missing: ${missing.join(", ")})`);
  throw new AppError("NOT_CONFIGURED");
}

export function requireEnv(supplier: string, names: string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) notConfigured(supplier, missing);
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string]));
}

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 10_000) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as unknown) : null;
}
