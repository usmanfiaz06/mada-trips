import { requirePerm } from "@/lib/auth";
import { db, schema } from "@/db";
import { getT } from "@/lib/i18n";
import { EXPENSE_CATEGORY } from "@/lib/labels";
import { riyadhDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Add expense" };

export default async function NewExpense() {
  const u = await requirePerm("expenses.create");
  const t = await getT();
  // Partners can record what any partner paid personally (e.g. Abdulaziz entering Bader's receipt).
  const partners = u.partnerId ? (await db.select({ id: schema.partners.id, name: schema.partners.name, nameAr: schema.partners.nameAr }).from(schema.partners).orderBy(schema.partners.sort))
    .map((p) => ({ id: p.id, name: t.locale === "ar" ? p.nameAr : p.name })) : [];
  return (
    <>
      <PageHeader eyebrow={t("Expenses")} title={t("Add expense")} subtitle={t("Enter the amount, attach proof, and add a reason. That's all a verifier needs.")} />
      <ExpenseForm categories={Object.entries(EXPENSE_CATEGORY).filter(([k]) => k !== "commission")} isPartner={!!u.partnerId} myPartnerId={u.partnerId} partners={partners} today={riyadhDate()} />
    </>
  );
}
