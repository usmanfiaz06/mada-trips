import { CalendarHeart, EyeOff } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { listWhatsOn } from "@/lib/app/desk/whats-on";
import { Badge, Card, CardHead, Empty, Field, Input, PageHeader, Tabs, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { saveWhatsOnAction, toggleWhatsOnAction } from "./actions";

export const metadata = { title: "What's on · Desk" };

/*
 * The curated "What's on" list: events for a city that no open API carries (Riyadh Season, Diriyah, AlUla's winter
 * season). The app shows them in Things to do, in English or Arabic, next to Ticketmaster's where it covers the city.
 * A photo needs its credit; links are the organiser's page, shown as the source (travellers book through us).
 */

type Row = Awaited<ReturnType<typeof listWhatsOn>>[number];

function EventForm({ r, t }: { r?: Row; t: Awaited<ReturnType<typeof getT>> }) {
  const w = r?.w;
  return (
    <ActionForm action={saveWhatsOnAction} className="space-y-3" resetOnOk={!w}>
      {w && <input type="hidden" name="id" value={w.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Title")} required><Input name="title" defaultValue={w?.title} required minLength={2} maxLength={120} /></Field>
        <Field label={t("Title in Arabic")}><Input name="titleAr" defaultValue={w?.titleAr ?? ""} maxLength={120} dir="rtl" /></Field>
        <Field label={t("City (GeoNames id)")} required hint={t("Riyadh 108410 · Jeddah 105343 · AlUla 108841 · Dubai 292223")}><Input name="placeId" defaultValue={w ? String(w.placeId) : ""} required pattern="\d{1,10}" inputMode="numeric" /></Field>
        <Field label={t("Venue")}><Input name="venue" defaultValue={w?.venue ?? ""} maxLength={120} /></Field>
        <Field label={t("From")} required><Input type="date" name="startsOn" defaultValue={w?.startsOn} required /></Field>
        <Field label={t("To")} required><Input type="date" name="endsOn" defaultValue={w?.endsOn} required /></Field>
        <Field label={t("Starts at")}><Input type="time" name="time" defaultValue={w?.time ?? ""} /></Field>
        <Field label={t("Organiser's page")}><Input type="url" name="link" defaultValue={w?.link ?? ""} placeholder="https://" /></Field>
        <Field label={t("Photo link")}><Input type="url" name="imageUrl" defaultValue={w?.imageUrl ?? ""} placeholder="https://" /></Field>
        <Field label={t("Photo credit")} hint={t("Needed with a photo: who took it, and the licence or permission.")}><Input name="imageCredit" defaultValue={w?.imageCredit ?? ""} maxLength={160} /></Field>
      </div>
      <Field label={t("A line about it")}><Textarea name="body" defaultValue={w?.body ?? ""} maxLength={600} rows={2} /></Field>
      <Field label={t("A line about it, in Arabic")}><Textarea name="bodyAr" defaultValue={w?.bodyAr ?? ""} maxLength={600} rows={2} dir="rtl" /></Field>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-2"><input type="checkbox" name="family" value="yes" defaultChecked={w?.family} />{t("Good for families")}</label>
      <SubmitButton size="sm" variant={w ? "outline" : "gold"}>{w ? t("Save") : t("Add to What's on")}</SubmitButton>
    </ActionForm>
  );
}

export default async function WhatsOnPage({ searchParams }: { searchParams: Promise<{ s?: string; edit?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const past = sp.s === "past";
  const act = can(u, "desk.act");
  const rows = await listWhatsOn({ past });
  return (
    <>
      <PageHeader eyebrow={t("Support admin")} title={t("What's on")}
        subtitle={t("Events the app shows in Things to do. Saudi events have no open feed, so we keep them here: dates, city, a photo with its credit, and both languages.")} />
      <Tabs active={past ? "past" : "now"} items={[
        { key: "now", label: t("On now and coming up"), count: past ? undefined : rows.length, href: "/adminwork/desk/whats-on" },
        { key: "past", label: t("Over"), href: "/adminwork/desk/whats-on?s=past" },
      ]} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-3">
          {rows.length === 0 ? <Card><Empty icon={<CalendarHeart className="size-5" />} title={past ? t("Nothing here yet") : t("Nothing on yet")} hint={t("Add the season's events and they show in the app the same minute.")} /></Card> : rows.map((r) => (
            <Card key={r.w.id} className={cx(!r.w.active && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <Badge tone="info">{r.city}</Badge>
                <span className="num" dir="ltr">{r.w.startsOn} → {r.w.endsOn}{r.w.time ? ` · ${r.w.time}` : ""}</span>
                {r.w.family && <Badge tone="ok">{t("Families")}</Badge>}
                {!r.w.active && <Badge tone="neutral"><EyeOff className="size-3" />{t("Hidden")}</Badge>}
              </div>
              <div className="mt-2 flex gap-3">
                {r.w.imageUrl && <img src={r.w.imageUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0">
                  <div className="text-[17px] font-medium">{r.w.title}</div>
                  {r.w.titleAr && <div className="text-[15px] text-ink-2" dir="rtl">{r.w.titleAr}</div>}
                  {r.w.body && <p className="mt-1 text-[13px] text-ink-2">{r.w.body}</p>}
                  {r.w.imageCredit && <p className="mt-1 text-[12px] text-ink-3">{t("Photo")}: {r.w.imageCredit}</p>}
                </div>
              </div>
              {act && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[13px] text-ink-3">{t("Edit")}</summary>
                  <div className="mt-3"><EventForm r={r} t={t} /></div>
                  <ActionForm action={toggleWhatsOnAction} className="mt-3">
                    <input type="hidden" name="id" value={r.w.id} />
                    <input type="hidden" name="active" value={r.w.active ? "no" : "yes"} />
                    <SubmitButton size="sm" variant="outline">{r.w.active ? t("Hide from the app") : t("Show in the app")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>
          ))}
        </div>
        {act && <Card><CardHead title={t("Add an event")} /><EventForm t={t} /></Card>}
      </div>
    </>
  );
}
