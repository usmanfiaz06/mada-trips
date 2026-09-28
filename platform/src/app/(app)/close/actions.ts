"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { dailyReport } from "@/lib/daily";
import { businessDate, riyadhDate, riyadhTime } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { toHalalas, sar } from "@/lib/money";
import { flash, optStr, str, toState, type ActionState } from "@/lib/actions";

export async function submitClose(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("close.submit");
  const team = u.team === "management" ? str(fd, "team") : u.team;
  if (team !== "riyadh" && team !== "pakistan") return { error: "Choose the team you're closing for" };
  try {
    const s = await getSettings();
    const date = str(fd, "date") || businessDate(new Date(), s.closeHour);
    const counted = team === "riyadh" ? toHalalas(str(fd, "cashCounted")) : 0;
    const note = optStr(fd, "note");
    await db.transaction(async (tx) => {
      const [exists] = await tx.select().from(schema.dailyCloses).where(and(eq(schema.dailyCloses.businessDate, date), eq(schema.dailyCloses.team, team)));
      if (exists) throw new Error("This day is already closed for your team");
      const report = await dailyReport(tx, date, team);
      if (report.issues.length && !note) throw new Error("Some items are still open. Fix them, or add a note explaining each one");
      const variance = counted - report.totals.cash;
      if (team === "riyadh" && variance !== 0 && !note) throw new Error(`Cash counted differs by ${sar(variance, { sign: true })}. Add a note explaining the difference`);
      // Late if submitted after the 22:00 cut-off of that business day.
      const late = riyadhDate() > date || (riyadhDate() === date && Number(riyadhTime().slice(0, 2)) >= s.closeHour);
      await tx.insert(schema.dailyCloses).values({ businessDate: date, team, cashExpected: report.totals.cash, cashCounted: counted, snapshot: report, note, submittedBy: u.id, lateSubmission: late });
      await audit(tx, { actorId: u.id, action: "close.submitted", entityType: "close", entityRef: `${date} · ${team}`,
        summary: `Submitted ${team === "riyadh" ? "Riyadh" : "Pakistan"} daily close for ${date}: ${report.totals.count} sales, margin ${sar(report.totals.margin)}${team === "riyadh" ? `, cash ${sar(counted)}` : ""}${late ? " (late)" : ""}` });
    });
    await flash("Day closed and sent to Abdulaziz");
  } catch (e) { return toState(e); }
  revalidatePath("/", "layout");
  redirect("/close");
}

export async function verifyClose(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("close.verify");
  const id = str(fd, "id");
  const outcome = str(fd, "outcome") === "flag" ? "flagged" : "verified";
  const note = optStr(fd, "verifyNote");
  if (outcome === "flagged" && !note) return { error: "Say what's wrong so the team can fix it" };
  try {
    const [c] = await db.select().from(schema.dailyCloses).where(eq(schema.dailyCloses.id, id));
    if (!c) throw new Error("Close not found");
    if (c.status !== "submitted") throw new Error("Already reviewed");
    if (c.submittedBy === u.id) throw new Error("Someone else must verify your own close");
    await db.transaction(async (tx) => {
      await tx.update(schema.dailyCloses).set({ status: outcome, verifiedBy: u.id, verifiedAt: new Date(), verifyNote: note }).where(eq(schema.dailyCloses.id, id));
      await audit(tx, { actorId: u.id, action: `close.${outcome}`, entityType: "close", entityId: c.id, entityRef: `${c.businessDate} · ${c.team}`, summary: `${outcome === "verified" ? "Verified" : "Flagged"} ${c.team} close for ${c.businessDate}${note ? `: "${note}"` : ""}` });
    });
    await flash(outcome === "verified" ? "Close verified" : "Close flagged");
  } catch (e) { return toState(e); }
  revalidatePath("/", "layout");
  redirect(`/close/${str(fd, "date")}?team=${str(fd, "team")}`);
}
