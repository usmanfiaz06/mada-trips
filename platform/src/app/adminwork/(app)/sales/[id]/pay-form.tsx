"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { recordPayment } from "../actions";

type Props = {
  id: string;
  owedInput: string;
  defaultMethod: string;
  defaultAccount: string;
  methods: { k: string; label: string }[];
  accounts: { value: string; label: string }[];
  staff: { id: string; name: string }[];
  myUserId: string;
};

/**
 * Record a payment on an existing sale. Cash is handled like the new-sale form: when the method is cash we
 * hide the bank selector (the money doesn't land in a bank) and ask who received it, so it's tracked as that
 * person's cash on hand. Everything else lands in the chosen bank and waits to clear.
 */
export function PayForm({ id, owedInput, defaultMethod, defaultAccount, methods, accounts, staff, myUserId }: Props) {
  const t = useT();
  const [method, setMethod] = useState(defaultMethod);
  const [account, setAccount] = useState(defaultAccount);
  const [cashHolder, setCashHolder] = useState(myUserId);
  const isCash = method === "cash";
  return (
    <ActionForm action={recordPayment} resetOnOk className="grid gap-2 border-t border-line p-6 sm:grid-cols-[1fr_130px_150px_1fr_auto]">
      <input type="hidden" name="id" value={id} />
      <input name="amount" defaultValue={owedInput} inputMode="decimal" className="field num" dir="ltr" aria-label={t("Amount")} />
      <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className="field" aria-label={t("Method")}>
        {methods.map((m) => <option key={m.k} value={m.k}>{t(m.label)}</option>)}
      </select>
      {isCash ? (
        <select name="cashHolder" value={cashHolder} onChange={(e) => setCashHolder(e.target.value)} className="field" aria-label={t("Who received the cash?")}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === myUserId ? ` (${t("me")})` : ""}</option>)}
        </select>
      ) : (
        <select name="account" value={account} onChange={(e) => setAccount(e.target.value)} className="field" aria-label={t("Into which bank account?")}>
          {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      )}
      <input name="reference" className="field" placeholder={t("Reference (optional)")} dir="ltr" />
      <SubmitButton>{t("Record payment")}</SubmitButton>
    </ActionForm>
  );
}
