import { getT } from "@/lib/i18n";
import type { Traveller } from "@/lib/services";
import { cx } from "./ui";

/** The people on a sale, from the traveller list (or the older single passengers line). */
export function travellerNames(b: { travellers: unknown; passengers: string; paxCount: number }): string[] {
  const list = Array.isArray(b.travellers) ? (b.travellers as Traveller[]).map((x) => x.name) : [];
  if (list.length) return list.map((n, i) => n || `#${i + 1}`);
  return b.paxCount > 1 ? Array.from({ length: b.paxCount }, (_, i) => `#${i + 1}`) : [b.passengers];
}

/** One ticket-number box per passenger, labelled with their name, so nobody is issued twice or missed. */
export async function TicketInputs({ booking, className }: { booking: { travellers: unknown; passengers: string; paxCount: number }; className?: string }) {
  const t = await getT();
  const names = travellerNames(booking);
  return (
    <div className={cx("grid gap-2", names.length > 1 && "sm:grid-cols-2", className)}>
      {names.map((n, i) => (
        <label key={i} className="block">
          {names.length > 1 && <span className="mb-1 block truncate text-[12px] text-ink-3">{n}</span>}
          <input name="ticket" required className="field num" dir="ltr" placeholder={names.length > 1 ? t("Ticket number") : t("Ticket number(s)")} aria-label={t("Ticket number for {name}", { name: n })} />
        </label>
      ))}
    </div>
  );
}
