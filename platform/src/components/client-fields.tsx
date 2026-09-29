import { getT } from "@/lib/i18n";
import { Field, Input, Select, Textarea } from "./ui";
import { amountInput } from "@/lib/money";

type C = { name: string; type: string; phone: string | null; email: string | null; contactPerson: string | null; contractRef: string | null; paymentTermsDays: number; notes: string | null };

export async function ClientFields({ c, withLimit }: { c?: C; withLimit?: boolean }) {
  const t = await getT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Name")} required className="sm:col-span-2"><Input name="name" defaultValue={c?.name} required /></Field>
      <Field label={t("Type")} hint={t("Contracted clients get a standing credit limit. Everyone else needs director approval to pay later.")} className="sm:col-span-2">
        <Select name="type" defaultValue={c?.type ?? "retail"} options={[{ value: "retail", label: t("Retail (individual)") }, { value: "contracted", label: t("Contracted corporate") }, { value: "noncontracted", label: t("Non-contracted corporate") }]} />
      </Field>
      <Field label={t("Contact person")}><Input name="contactPerson" defaultValue={c?.contactPerson ?? ""} /></Field>
      <Field label={t("Phone")}><Input name="phone" defaultValue={c?.phone ?? ""} dir="ltr" /></Field>
      <Field label={t("Email")}><Input name="email" type="email" defaultValue={c?.email ?? ""} dir="ltr" /></Field>
      <Field label={t("Contract reference")}><Input name="contractRef" defaultValue={c?.contractRef ?? ""} dir="ltr" /></Field>
      <Field label={t("Payment terms (days)")}><Input name="paymentTermsDays" type="number" min={0} max={180} defaultValue={c?.paymentTermsDays ?? 0} /></Field>
      {withLimit && <Field label={t("Credit limit (SAR)")} hint={t("Contracted only. Goes to directors for approval.")}><Input name="creditLimit" inputMode="decimal" defaultValue={amountInput(0)} dir="ltr" /></Field>}
      <Field label={t("Notes")} className="sm:col-span-2"><Textarea name="notes" defaultValue={c?.notes ?? ""} rows={3} /></Field>
    </div>
  );
}
