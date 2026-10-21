"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { flash, str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { addShift, removeShift } from "@/lib/app/desk/agents";
import { createAgent, deactivateAgent, deleteCanned, reactivateAgent, saveCanned, updateAgent } from "@/lib/app/desk/agent-admin";

/*
 * Support admin (DESK-PLAN.md U7): agents and roles, the rota, saved replies. Each action checks the signed-in
 * person, hands the work to lib/app/desk (which checks again and writes both audit trails), and refreshes the desk.
 */

const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk", "layout"); return { ok }; };
const uuid = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new DeskError("Not found", "NOT_FOUND"); return v; };
const riyadh = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new DeskError("Choose a start and end time");
  return new Date(`${v}:00+03:00`);
};
const Role = z.enum(["support_agent", "support_lead"]);
const Team = z.enum(["riyadh", "pakistan"]);

/** Where a new agent signs in: this deployment's own Ops login page. */
async function signInUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/adminwork/login`;
}

/** Add agent, in one step. The temporary password comes back once, in `fields`, for the form to show. */
export async function addAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const r = await createAgent(u, {
      name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone") || null,
      role: Role.catch("support_agent").parse(str(fd, "role")), team: Team.catch("riyadh").parse(str(fd, "team")),
      displayName: str(fd, "displayName"), displayNameAr: str(fd, "displayNameAr") || null,
      languages: fd.getAll("languages").map(String), pronoun: str(fd, "pronoun") === "she" ? "she" : "he",
    }, { signInUrl: await signInUrl() });
    revalidatePath("/adminwork/desk", "layout");
    return { ok: r.emailed ? "Agent added. The invite email is on its way" : "Agent added", fields: { password: r.password, link: r.signInUrl, agentId: r.agentId } };
  } catch (e) { return toState(e); }
}

export async function updateAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const role = str(fd, "role");
    const changed = await updateAgent(u, uuid(fd, "agentId"), {
      role: role ? Role.parse(role) : undefined, team: str(fd, "team") ? Team.parse(str(fd, "team")) : undefined,
      displayName: str(fd, "displayName"), displayNameAr: str(fd, "displayNameAr") || null,
      languages: fd.getAll("languages").map(String), pronoun: str(fd, "pronoun") === "she" ? "she" : "he",
      replyMinutes: Number(str(fd, "replyMinutes") || 2),
    });
    return done(changed ? "Saved" : "No changes");
  } catch (e) { return toState(e); }
}

export async function deactivateAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const to = str(fd, "toAgentId");
    const r = await deactivateAgent(u, uuid(fd, "agentId"), { toAgentId: to && isUuid(to) ? to : null });
    revalidatePath("/adminwork/desk", "layout");
    return { ok: "Deactivated. Their open tickets and travellers were handed on", fields: { tickets: String(r.tickets), travellers: String(r.travellers), shifts: String(r.shifts) } };
  } catch (e) { return toState(e); }
}

export async function reactivateAgentAction(fd: FormData) {
  const u = await requirePerm("desk.admin");
  const id = str(fd, "agentId");
  if (isUuid(id)) await reactivateAgent(u, id).then(() => flash("Reactivated. They start signed off, with nothing routed until they're on the rota"), (e) => flash(e instanceof Error ? e.message : "Something went wrong"));
  revalidatePath("/adminwork/desk", "layout");
  redirect(`/adminwork/desk/agents/${id}`);
}

/* ───────────── rota ───────────── */

export async function addShiftsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const cover = str(fd, "coveringForId");
    const weeks = str(fd, "repeat") === "weekly" ? Math.max(1, Math.min(26, Number(str(fd, "weeks") || 8))) : 1;
    const days = weeks > 1 ? fd.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    const r = await addShift(u, { agentId: uuid(fd, "agentId"), startsAt: riyadh(str(fd, "startsAt")), endsAt: riyadh(str(fd, "endsAt")), coveringForId: cover && isUuid(cover) ? cover : null, note: str(fd, "note") || null, weeks, days });
    return done(r.added > 1 ? (r.skipped ? "Weekly shifts added; overlapping weeks were skipped" : "Weekly shifts added") : "Shift added");
  } catch (e) { return toState(e); }
}

export async function removeShiftsAction(fd: FormData) {
  const u = await requirePerm("desk.admin");
  const id = str(fd, "id");
  if (isUuid(id)) await removeShift(u, id, { series: str(fd, "series") === "yes" }).catch(() => {});
  revalidatePath("/adminwork/desk", "layout");
}

/* ───────────── saved replies ───────────── */

export async function saveCannedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const id = str(fd, "id");
    await saveCanned(u, id && isUuid(id) ? id : null, { title: str(fd, "title"), bodyEn: str(fd, "bodyEn"), bodyAr: str(fd, "bodyAr"), sort: Number(str(fd, "sort") || 0) });
    return done(id ? "Saved" : "Saved reply added");
  } catch (e) { return toState(e); }
}

export async function deleteCannedAction(fd: FormData) {
  const u = await requirePerm("desk.admin");
  const id = str(fd, "id");
  if (isUuid(id)) await deleteCanned(u, id).then(() => flash("Saved reply deleted"), () => flash("Saved reply not found"));
  revalidatePath("/adminwork/desk", "layout");
}
