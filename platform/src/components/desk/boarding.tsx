import { Ticket, Upload } from "lucide-react";
import { CHECK_IN } from "@mada/shared";
import { Badge, Card, CardHead, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import type { T } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { deskPasses } from "@/lib/app/boarding";
import { boardingPassUploadAction } from "@/app/adminwork/(app)/desk/boarding-actions";

/*
 * On a desk order with flights: the airline's boarding passes on its trip, and an upload for the PDF, screenshot or
 * .pkpass the desk got from check-in. The barcode is only ever read from that file (lib/app/boarding).
 */
export async function BoardingPassesCard({ requestId, tripId, carrier, act, t }: { requestId: string; tripId: string | null; carrier: string | null; act: boolean; t: T }) {
  if (!tripId) return null;
  const passes = await deskPasses(tripId);
  const hours = (carrier && CHECK_IN[carrier]?.hours) || 24;
  return (
    <Card>
      <CardHead title={t("Boarding passes")} hint={t("Upload the airline's PDF, screenshot or .pkpass after check-in. Each barcode is read and matched to its traveller and flight; the traveller sees it in their Wallet.")} />
      {passes.length ? (
        <ul className="space-y-2">
          {passes.map((p) => (
            <li key={p.id} className="flex items-start gap-3 text-[13.5px]">
              <Ticket className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="text-ink"><span dir="ltr">{p.name}</span> · <span className="num" dir="ltr">{p.flight}</span></div>
                <div className="text-[12.5px] text-ink-3">{t("Seat {seat} · seq {seq}", { seat: p.seat || "–", seq: p.sequence })} · {p.traveller ?? t("No traveller matched")}</div>
                <div className="text-[12px] text-ink-3">{p.source === "desk" ? t("Added by {name}", { name: p.addedBy ?? "Mada" }) : t("Added by the traveller")} · {fmtDate(p.at, t.locale, true)}</div>
              </div>
              {!p.traveller && <Badge tone="warn">{t("No traveller matched")}</Badge>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-ink-3">{t("None yet. Check-in opens {hours} hours before departure.", { hours })}</p>}
      {act && (
        <ActionForm action={boardingPassUploadAction} className="mt-3 space-y-2" resetOnOk>
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="requestId" value={requestId} />
          <Input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,.pkpass,application/vnd.apple.pkpass" />
          <SubmitButton variant="outline" className="w-full"><Upload className="size-4" />{t("Upload boarding pass")}</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
