import type { getT } from "@/lib/i18n";
import { Field, Input, Select } from "../ui";

/* The traveller-facing half of an agent: the name travellers see, languages and pronoun. Used by Add agent and Edit. */

type T = Awaited<ReturnType<typeof getT>>;
export const AGENT_LANGS = [["ar", "العربية"], ["en", "English"], ["ur", "اردو"], ["hi", "हिन्दी"], ["tr", "Türkçe"], ["fr", "Français"]] as const;

export function ProfileFields({ t, a }: { t: T; a?: { displayName: string; displayNameAr: string | null; languages: string[]; pronoun: string } }) {
  return (
    <>
      <Field label={t("First name travellers see")}><Input name="displayName" required maxLength={30} defaultValue={a?.displayName ?? ""} placeholder="Faisal" /></Field>
      <Field label={t("In Arabic")}><Input name="displayNameAr" maxLength={30} defaultValue={a?.displayNameAr ?? ""} placeholder="فيصل" dir="rtl" /></Field>
      <Field label={t("Languages")} className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {AGENT_LANGS.map(([v, l]) => (
            <label key={v}><input type="checkbox" name="languages" value={v} defaultChecked={a ? a.languages.includes(v) : v === "ar" || v === "en"} className="peer sr-only" />
              <span className="inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] text-ink-3 ring-1 ring-line-strong transition peer-checked:bg-ink peer-checked:text-bg peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-gold">{l}</span></label>
          ))}
        </div>
      </Field>
      <Field label={t("Says")}><Select name="pronoun" defaultValue={a?.pronoun ?? "he"} options={[{ value: "he", label: t("He has your whole trip") }, { value: "she", label: t("She has your whole trip") }]} /></Field>
    </>
  );
}

export function RoleTeamFields({ t, role, team, roles }: { t: T; role?: string; team?: string; roles: { key: string; name: string; nameAr: string }[] }) {
  return (
    <>
      <Field label={t("Role")}><Select name="role" defaultValue={role ?? "support_agent"} options={roles.map((r) => ({ value: r.key, label: t.locale === "ar" ? r.nameAr : r.name }))} /></Field>
      <Field label={t("Team")}><Select name="team" defaultValue={team ?? "riyadh"} options={[{ value: "riyadh", label: t("Riyadh") }, { value: "pakistan", label: t("Pakistan") }]} /></Field>
    </>
  );
}
