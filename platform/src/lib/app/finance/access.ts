import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/*
 * Who sees App finance (revenue and margin, reconciliation, supplier balances): Ops finance (finance.view), or the
 * desk's own finance right (desk.finance, DESK-PLAN §4.3) once the roles carry it.
 */
export const canDeskFinance = (u: { permissions: ReadonlySet<string> }) => u.permissions.has("finance.view") || u.permissions.has("desk.finance");

export async function requireDeskFinance() {
  const u = await requireUser();
  if (!canDeskFinance(u)) redirect("/adminwork?denied=1");
  return u;
}
