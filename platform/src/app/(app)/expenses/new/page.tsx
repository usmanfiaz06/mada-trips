import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { EXPENSE_CATEGORY } from "@/lib/labels";
import { riyadhDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Add expense" };

export default async function NewExpense() {
  const u = await requirePerm("expenses.create");
  const t = await getT();
  return (
    <>
      <PageHeader eyebrow={t("Expenses")} title={t("Add expense")} subtitle={t("Amount, proof and reason. That's all verification needs.")} />
      <ExpenseForm categories={Object.entries(EXPENSE_CATEGORY)} isPartner={!!u.partnerId} today={riyadhDate()} />
    </>
  );
}
