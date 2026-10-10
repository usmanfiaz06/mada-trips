import { Flag, UserRound } from "lucide-react";
import { getT } from "@/lib/i18n";
import { itemRoute } from "@/lib/app/desk/inbox";
import { Avatar, Card, CardHead, cx } from "../ui";
import { ActionForm, SubmitButton } from "../client";
import { escalateAction, reassignAction } from "@/app/adminwork/(app)/desk/actions";

/** Who has this, why (their agent, covering, or by hand), and the two moves: hand it on, or escalate. */
export async function AssignCard({ kind, id, userId, canAct }: { kind: string; id: string; userId: string | null; canAct: boolean }) {
  const t = await getT();
  const { route, agents, escalated, escalationNote, primaryId } = await itemRoute(kind, id, userId);
  const who = agents.find((a) => a.id === route.agentId);
  const usual = agents.find((a) => a.id === primaryId);
  return (
    <Card>
      <CardHead title={t("Who has it")} hint={usual ? t("{name} is this traveller's agent", { name: usual.displayName }) : t("No agent chosen for this traveller yet")} />
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
        {who ? <Avatar name={who.displayName} size={36} /> : <span className="grid size-9 place-items-center rounded-full bg-warn-soft text-warn"><UserRound className="size-4" /></span>}
        <div className="min-w-0 text-[13.5px] leading-tight">
          <div className="text-ink">{who?.displayName ?? t("Shared queue")}</div>
          <div className="text-[12px] text-ink-3">{t(route.reason === "primary" ? "Their agent, on shift" : route.reason === "covering" ? "Covering tonight" : route.reason === "manual" ? "Assigned by hand" : "First free hand takes it")}</div>
        </div>
      </div>
      {escalated && <div className="mb-4 flex gap-2 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad"><Flag className="mt-0.5 size-3.5 shrink-0" /><span>{escalationNote}</span></div>}
      {canAct && (
        <div className="space-y-3">
          <ActionForm action={reassignAction} className="flex gap-2">
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="itemId" value={id} />
            <select name="agentId" defaultValue={route.reason === "manual" ? route.agentId ?? "rota" : "rota"} className="field min-w-0 flex-1" aria-label={t("Give it to")}>
              <option value="rota">{t("Follow the rota")}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
            <SubmitButton variant="outline">{t("Hand on")}</SubmitButton>
          </ActionForm>
          <ActionForm action={escalateAction} className={cx("flex gap-2")}>
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="itemId" value={id} />
            {escalated ? (
              <><input type="hidden" name="on" value="no" /><SubmitButton variant="ghost" className="w-full">{t("Clear escalation")}</SubmitButton></>
            ) : (
              <><input name="note" className="field min-w-0 flex-1" placeholder={t("What's needed?")} maxLength={200} /><SubmitButton variant="outline"><Flag className="size-3.5" />{t("Escalate")}</SubmitButton></>
            )}
          </ActionForm>
        </div>
      )}
    </Card>
  );
}
