"use client";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "@/components/ui";
import { Picker, type PickerItem } from "@/components/picker";
import {
  BOARD, CITIES, EVENT_TYPES, HOTEL_SUPPLIERS, PACKAGE_INCLUDES, TRANSPORT_TYPES, VISA_COUNTRIES, VISA_ENTRIES, VISA_PROVIDERS, VISA_SPEED, VISA_TYPES,
  describeService, type Opt,
} from "@/lib/services";

const CITY_ITEMS: PickerItem[] = CITIES.map((c) => ({ value: c.city, code: c.country, primary: c.city, secondary: c.cityAr, keywords: `${c.city} ${c.cityAr ?? ""} ${c.country}` }));
const COUNTRY_ITEMS: PickerItem[] = VISA_COUNTRIES.map((c) => ({ value: c.code, code: c.code, primary: c.en, secondary: c.ar, keywords: `${c.code} ${c.en} ${c.ar}` }));

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <span className="mb-1.5 block text-[12.5px] text-ink-3">{children}{required && <span className="text-gold-2"> *</span>}</span>;
}

/** Pill buttons for a short list of choices. */
function Chips({ options, value, onChange, multi }: { options: Opt[]; value: string | string[]; onChange: (v: string) => void; multi?: boolean }) {
  const t = useT();
  const on = (v: string) => (multi ? (value as string[]).includes(v) : value === v);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on(o.value)}
          className={cx("flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition", on(o.value) ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 ring-1 ring-line hover:ring-line-strong")}>
          {multi && on(o.value) && <Check className="size-3.5" />}{t.locale === "ar" ? o.ar : o.en}
        </button>
      ))}
    </div>
  );
}

/** The questions for visa, hotel, package, transport and event sales. Sends a JSON "details" field; the server builds the description. */
export function ServiceDetails({ service, invalid }: { service: string; invalid?: boolean }) {
  const t = useT();
  const [d, setD] = useState<Record<string, unknown>>({ rooms: 1, speed: "normal", entries: "single", includes: ["flight", "hotel"] });
  const set = (k: string, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const toggle = (k: string, v: string) => setD((x) => { const cur = (x[k] as string[]) ?? []; return { ...x, [k]: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] }; });
  const preview = useMemo(() => describeService(service, d), [service, d]);
  const nights = str("checkIn") && str("checkOut") ? Math.round((new Date(str("checkOut")).getTime() - new Date(str("checkIn")).getTime()) / 86_400_000) : 0;

  return (
    <div className="space-y-4 sm:col-span-6">
      {service === "visa" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label required>{t("Country")}</Label><Picker items={COUNTRY_ITEMS} value={str("country")} onChange={(v) => set("country", v)} label={t("Country")} placeholder={t("e.g. Schengen, UK, Türkiye")} invalid={invalid && !str("country")} /></div>
            <div><Label required>{t("Processed through")}</Label><Chips options={VISA_PROVIDERS} value={str("provider")} onChange={(v) => set("provider", v)} /></div>
          </div>
          <div><Label required>{t("Visa type")}</Label><Chips options={VISA_TYPES} value={str("type")} onChange={(v) => set("type", v)} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label required>{t("Entries")}</Label><Chips options={VISA_ENTRIES} value={str("entries")} onChange={(v) => set("entries", v)} /></div>
            <div><Label required>{t("Processing")}</Label><Chips options={VISA_SPEED} value={str("speed")} onChange={(v) => set("speed", v)} /></div>
          </div>
        </>
      )}

      {service === "hotel" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label required>{t("City")}</Label><Picker items={CITY_ITEMS} value={str("city")} onChange={(v) => set("city", v)} label={t("City")} placeholder={t("e.g. Makkah, Dubai, Istanbul")} invalid={invalid && !str("city")} /></div>
            <label><Label required>{t("Hotel name")}</Label><input value={str("hotel")} onChange={(e) => set("hotel", e.target.value)} className="field" placeholder={t("e.g. Swissôtel Makkah")} aria-invalid={invalid && !str("hotel")} /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label><Label required>{t("Check-in")}</Label><input type="date" value={str("checkIn")} onChange={(e) => set("checkIn", e.target.value)} className="field" /></label>
            <label><Label required>{t("Check-out")}</Label><input type="date" value={str("checkOut")} min={str("checkIn") || undefined} onChange={(e) => set("checkOut", e.target.value)} className="field" /></label>
            <label><Label required>{t("Rooms")}</Label><input type="number" min={1} max={50} value={String(d.rooms ?? 1)} onChange={(e) => set("rooms", Number(e.target.value))} className="field num" /></label>
          </div>
          {nights > 0 && <p className="-mt-2 text-[12.5px] text-ink-3">{nights === 1 ? t("1 night") : t("{n} nights", { n: nights })}</p>}
          <div><Label required>{t("Meal plan")}</Label><Chips options={BOARD} value={str("board")} onChange={(v) => set("board", v)} /></div>
          <div><Label required>{t("Booked through")}</Label><Chips options={HOTEL_SUPPLIERS} value={str("provider")} onChange={(v) => set("provider", v)} /></div>
        </>
      )}

      {service === "package" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label required>{t("Destination")}</Label><Picker items={CITY_ITEMS} value={str("city")} onChange={(v) => set("city", v)} label={t("Destination")} placeholder={t("e.g. Istanbul, Baku, Bali")} invalid={invalid && !str("city")} /></div>
            <label><Label required>{t("Nights")}</Label><input type="number" min={1} max={90} value={String(d.nights ?? "")} onChange={(e) => set("nights", Number(e.target.value))} className="field num" /></label>
          </div>
          <div><Label required>{t("Includes")}</Label><Chips multi options={PACKAGE_INCLUDES} value={(d.includes as string[]) ?? []} onChange={(v) => toggle("includes", v)} /></div>
        </>
      )}

      {service === "transport" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label required>{t("Type")}</Label><Chips options={TRANSPORT_TYPES} value={str("type")} onChange={(v) => set("type", v)} /></div>
          <div><Label required>{t("City")}</Label><Picker items={CITY_ITEMS} value={str("city")} onChange={(v) => set("city", v)} label={t("City")} placeholder={t("e.g. Jeddah")} invalid={invalid && !str("city")} /></div>
        </div>
      )}

      {service === "event" && (
        <>
          <div><Label required>{t("Event type")}</Label><Chips options={EVENT_TYPES} value={str("type")} onChange={(v) => set("type", v)} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label required>{t("City")}</Label><Picker items={CITY_ITEMS} value={str("city")} onChange={(v) => set("city", v)} label={t("City")} placeholder={t("e.g. Riyadh")} invalid={invalid && !str("city")} /></div>
            <label><Label>{t("Venue")}</Label><input value={str("venue")} onChange={(e) => set("venue", e.target.value)} className="field" placeholder={t("e.g. Riyadh Front")} /></label>
          </div>
        </>
      )}

      {service === "other" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label><Label required>{t("Description")}</Label><input value={str("text")} onChange={(e) => set("text", e.target.value)} className="field" placeholder={t("What was sold")} /></label>
          <label><Label>{t("Supplier")}</Label><input name="supplier" className="field" /></label>
        </div>
      )}

      <input type="hidden" name="details" value={JSON.stringify(d)} />
      {preview.ok && preview.description && (
        <p className="rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2"><span className="text-ink-3">{t("Saved as")}: </span>{preview.description}</p>
      )}
    </div>
  );
}
