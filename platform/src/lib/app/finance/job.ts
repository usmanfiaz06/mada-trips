import "server-only";
import { costsJob } from "./costs";
import { postingJob } from "./ops-posting";
import { refundsSentJob, sendLeadApproved } from "./refunds";

/*
 * The finance job (lib/app/jobs.ts "finance", every 5 minutes): cost lines for new captures, refunds a lead approved
 * sent, card refunds checked with the provider (approved → sent), then captured sales and finished refunds posted to
 * Ops. Each step is idempotent; one failing doesn't stop the others.
 */
export async function financeJob(now = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const step = async (name: string, fn: () => Promise<Record<string, number>>) => {
    try { for (const [k, v] of Object.entries(await fn())) out[`${name}_${k}`] = v; }
    catch (e) { out[`${name}_error`] = 1; console.error(`[finance] ${name} failed`, e instanceof Error ? e.message : ""); }
  };
  await step("costs", costsJob);
  await step("lead", sendLeadApproved);
  await step("refunds", () => refundsSentJob(now));
  await step("posted", postingJob);
  return out;
}
