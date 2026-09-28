import { getT } from "@/lib/i18n";
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { Card, Field, Input } from "./ui";
import { ActionForm, SubmitButton } from "./client";
import { saveRole } from "@/app/(app)/team/actions";

/** Role editor: the permission matrix, grouped by area, as switches. */
export async function RoleForm({ role }: { role?: { id: string; name: string; nameAr: string; description: string | null; permissions: string[] } }) {
  const t = await getT();
  const L = t.locale;
  const groups = Object.keys(PERMISSION_GROUPS) as (keyof typeof PERMISSION_GROUPS)[];
  return (
    <ActionForm action={saveRole} className="space-y-4">
      <input type="hidden" name="id" value={role?.id ?? ""} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Role name (English)")} required><Input name="name" defaultValue={role?.name} /></Field>
          <Field label={t("Role name (Arabic)")} required><Input name="nameAr" defaultValue={role?.nameAr} dir="rtl" /></Field>
          <Field label={t("What is this role for?")} className="sm:col-span-2"><Input name="description" defaultValue={role?.description ?? ""} /></Field>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const perms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => PERMISSIONS[p].group === g);
          return (
            <Card key={g}>
              <div className="mb-4 text-[15px]">{L === "ar" ? PERMISSION_GROUPS[g].ar : PERMISSION_GROUPS[g].en}</div>
              <ul className="space-y-1">
                {perms.map((p) => (
                  <li key={p}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                      <input type="checkbox" name="permissions" value={p} defaultChecked={role?.permissions.includes(p)} className="peer sr-only" />
                      <span className="relative h-6 w-10 shrink-0 rounded-full bg-line-strong transition peer-checked:bg-ok peer-focus-visible:ring-2 peer-focus-visible:ring-gold after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
                      <span className="min-w-0"><span className="block text-[13.5px] text-ink">{L === "ar" ? PERMISSIONS[p].ar : PERMISSIONS[p].en}</span><span className="block font-mono text-[11px] text-ink-4">{p}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-4 z-10 flex justify-end"><SubmitButton variant="gold" size="lg" className="shadow-float">{role ? t("Save role") : t("Create role")}</SubmitButton></div>
    </ActionForm>
  );
}
