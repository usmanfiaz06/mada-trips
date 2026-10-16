import { CircleCheck, Clock } from "lucide-react";
import { formatSar, type RequestProgress, type RequestResult } from "@mada/shared";
import type { T } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { Badge, Card, CardHead, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { outcomeAction, promiseAction } from "@/app/adminwork/(app)/desk/actions";

/*
 * The request's outcome and promise on the desk (lib/app/outcomes.ts). While it's open: what we're doing, by when and
 * the cost, which the traveller sees at once. To close it: issued, refused, partial or cancelled, with the reason in
 * the traveller's words (picked, so it reads in their language), the money and the next step.
 */

export const OUTCOME_KINDS = [["issued", "Issued: all done"], ["partial", "Partial: some of it"], ["refused", "Refused: couldn't be done"], ["cancelled", "Cancelled by Mada"]] as const;
export const OUTCOME_REASONS = [
  ["done", "Done as asked"], ["part", "Part of it could be done"], ["sold_out", "Sold out for those dates"], ["rules", "Airline or hotel rules"], ["price", "The price went up"],
  ["documents", "Documents or entry rules"], ["no_reply", "No answer in time"], ["too_late", "Too close to the date"], ["payment", "Payment didn't go through"],
  ["you_asked", "The traveller asked to stop"], ["mada", "We stopped it"], ["other", "Something else (say in the note)"],
] as const;
const STEPS = [["reading", "Reading the request"], ["asking_airline", "Asking the airline"], ["asking_hotel", "Asking the hotel"], ["asking_embassy", "Checking visa rules"], ["searching", "Finding options"], ["pricing", "Pricing it"], ["booking", "Booking it"], ["issuing", "Issuing tickets"], ["refunding", "Sorting the refund"]] as const;
const MONEY = [["none", "Nothing charged"], ["refund", "Refund to the card"], ["credit", "Back as Mada credit"], ["kept", "Kept for the part done"], ["charged", "Paid in full"]] as const;
const NEXT = [["other_dates", "Try other dates"], ["book_again", "Book another"], ["talk", "Talk to Mada"], ["see_trip", "See the trip"]] as const;
const COST = [["later", "Price comes with the answer"], ["free", "No cost"], ["quoted", "Quoted"], ["paid", "Paid"]] as const;

const opts = (t: T, xs: readonly (readonly [string, string])[]) => xs.map(([value, label]) => ({ value, label: t(label) }));

export function OutcomeCard({ requestId, act, open, result, progress, t }: { requestId: string; act: boolean; open: boolean; result: RequestResult | null; progress: RequestProgress | null; t: T }) {
  const L = t.locale;
  if (result) {
    const label = OUTCOME_KINDS.find(([k]) => k === result.kind)?.[1] ?? (result.kind === "withdrawn" ? "Withdrawn by the traveller" : result.kind);
    return (
      <Card>
        <CardHead title={t("Outcome")} action={<Badge tone={result.kind === "issued" ? "ok" : result.kind === "partial" ? "warn" : "neutral"} dot>{t(label)}</Badge>} />
        <dl className="space-y-1.5 text-[13.5px]">
          <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("Reason")}</dt><dd>{t(OUTCOME_REASONS.find(([k]) => k === result.reason)?.[1] ?? result.reason)}{result.with ? ` · ${result.with}` : ""}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("Money")}</dt><dd>{t(MONEY.find(([k]) => k === result.money.kind)?.[1] ?? result.money.kind)}{result.money.amount ? ` · ${formatSar(result.money.amount.amount)}` : ""}{result.money.by ? ` · ${result.money.by}` : ""}</dd></div>
          {result.note && <p className="rounded-2xl bg-surface-2 px-3.5 py-2 text-ink-2">“{result.note}”</p>}
          <div className="text-[12.5px] text-ink-3">{result.by ?? "Mada"} · {fmtDate(new Date(result.at), L, true)}</div>
        </dl>
      </Card>
    );
  }
  if (!act || !open) return null;
  const late = progress && Date.parse(progress.dueAt) < Date.now();
  return (
    <Card>
      <CardHead title={t("What the traveller sees")} hint={t("Always what we're doing, by when, and the cost.")} action={progress ? <Badge tone={late ? "bad" : "info"} dot><Clock className="size-3" />{fmtDate(new Date(progress.dueAt), L, true)}</Badge> : null} />
      {progress?.nudgedAt && <p className="mb-3 rounded-2xl bg-bad-soft px-3.5 py-2 text-[13px] text-bad">{t("The traveller nudged {when}: past the time we gave.", { when: fmtDate(new Date(progress.nudgedAt), L, true) })}</p>}
      <ActionForm action={promiseAction} className="space-y-2">
        <input type="hidden" name="id" value={requestId} />
        <div className="grid grid-cols-2 gap-2">
          <Select name="step" defaultValue={progress?.step ?? "pricing"} options={opts(t, STEPS)} aria-label={t("What we're doing")} />
          <Input name="with" maxLength={60} defaultValue={progress?.with ?? ""} placeholder={t("With (Saudia, the hotel's name)")} />
          <Input type="datetime-local" name="due" required aria-label={t("Answer by (Riyadh time)")} />
          <Select name="cost" defaultValue={progress?.cost.kind ?? "later"} options={opts(t, COST)} aria-label={t("Cost")} />
          <Input name="amount" inputMode="decimal" placeholder={t("Amount, SAR")} />
        </div>
        <SubmitButton variant="outline" className="w-full"><Clock className="size-4" />{t("Tell the traveller")}</SubmitButton>
      </ActionForm>
      <details className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink"><CircleCheck className="size-4 text-ink-3" />{t("Close with an outcome")}</summary>
        <ActionForm action={outcomeAction} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={requestId} />
          <div className="grid grid-cols-2 gap-2">
            <Select name="kind" defaultValue="issued" options={opts(t, OUTCOME_KINDS)} aria-label={t("Outcome")} />
            <Select name="reason" defaultValue="done" options={opts(t, OUTCOME_REASONS)} aria-label={t("Reason")} />
            <Input name="with" maxLength={60} placeholder={t("Who said it (airline, hotel)")} />
            <Select name="money" defaultValue="none" options={opts(t, MONEY)} aria-label={t("Money")} />
            <Input name="amount" inputMode="decimal" placeholder={t("Amount, SAR")} />
            <Input type="date" name="by" aria-label={t("Refund lands by")} />
          </div>
          <Textarea name="note" rows={2} maxLength={300} placeholder={t("A line for the traveller: what was and wasn't done")} />
          <fieldset className="flex flex-wrap gap-3 text-[13px] text-ink-2">
            <legend className="mb-1 text-[12.5px] text-ink-3">{t("Next step buttons (none ticked: Mada picks)")}</legend>
            {NEXT.map(([v, label]) => <label key={v} className="flex items-center gap-1.5"><input type="checkbox" name="next" value={v} />{t(label)}</label>)}
          </fieldset>
          <p className="text-[12px] text-ink-3">{t("This tells the traveller. A refund itself is issued on Refunds.")}</p>
          <SubmitButton className="w-full" confirm={t("Close this request with this outcome? The traveller is told.")}><CircleCheck className="size-4" />{t("Close and tell the traveller")}</SubmitButton>
        </ActionForm>
      </details>
    </Card>
  );
}
