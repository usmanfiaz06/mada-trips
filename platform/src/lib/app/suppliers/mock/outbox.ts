/** Everything the mock messaging suppliers "sent", newest first, for tests and the dev console. Capped. */
export type OutboxItem = { channel: "sms" | "whatsapp" | "email"; to: string; body: string; at: string; id: string };

const g = globalThis as unknown as { __madaOutbox?: OutboxItem[] };
export const outbox: OutboxItem[] = (g.__madaOutbox ??= []);

export function record(item: Omit<OutboxItem, "at" | "id">): OutboxItem {
  const full = { ...item, at: new Date().toISOString(), id: `mock_${item.channel}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` };
  outbox.unshift(full);
  if (outbox.length > 200) outbox.length = 200;
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.info(`[mock ${item.channel}] → ${item.to}: ${item.body}`);
  return full;
}
