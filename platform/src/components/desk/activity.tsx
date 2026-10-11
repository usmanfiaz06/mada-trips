import { Ticket } from "lucide-react";
import type { T } from "@/lib/i18n";
import { activityOf } from "@/lib/app/activities/book";
import type { HotelbedsBookingNote } from "@/lib/app/desk/whats-on";
import { Badge, Card, Money, btn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { bookOnHotelbedsAction } from "@/app/adminwork/(app)/desk/whats-on/actions";

/** On an activity request: what they want to do, the supplier's code, and "Book on Hotelbeds" in one step. */
export function ActivityCard({ id, details, act, t }: { id: string; details: Record<string, unknown>; act: boolean; t: T }) {
  const a = activityOf(details);
  if (!a) return null;
  const booked = (details.desk as { hotelbeds?: HotelbedsBookingNote } | undefined)?.hotelbeds;
  const hb = a.supplier === "hotelbeds";
  const kids = a.ages.filter((x) => x < 18);
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="info"><Ticket className="size-3" />{t("Activity")}</Badge><span className="text-[12.5px] text-ink-3">{t("Things to do: book it and send the quote.")}</span></div>
        <div className="text-[22px] font-[400] tracking-[-0.02em]">{a.title}</div>
        <div className="mt-1 text-[13px] text-ink-3">{a.city} · {a.day ?? t("Day not chosen")} · {t("{n} going", { n: a.travellers })}{kids.length ? ` · ${t("children {ages}", { ages: kids.join(", ") })}` : ""}</div>
        <div className="mt-1 text-[13px] text-ink-3" dir="ltr">{a.supplier ?? "—"}{a.code ? ` · ${a.code}` : ""}{a.modality ? ` · ${a.modality}` : ""}</div>
        {a.priceFrom ? <div className="mt-1 text-[13px] text-ink-2">{t("From")} <Money v={a.priceFrom} /> {t("per adult in the app")}</div> : null}
        {booked && <p className="mt-2 rounded-2xl bg-ok-soft px-3.5 py-2 text-[13px] text-ok">{t("Booked on Hotelbeds")}: <span className="num" dir="ltr">{booked.reference}</span> · {booked.total.amount} {booked.total.currency} · {booked.by}</p>}
      </div>
      <div className="flex flex-col items-end gap-2">
        {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className={btn("outline", "sm")}>{a.supplier === "openstreetmap" ? t("On the map") : t("Source")} ↗</a>}
        {hb && !booked && act && (
          <ActionForm action={bookOnHotelbedsAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton size="sm" variant="gold" confirm={t("Book this on Hotelbeds now, for the day and people asked?")}>{t("Book on Hotelbeds")}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
