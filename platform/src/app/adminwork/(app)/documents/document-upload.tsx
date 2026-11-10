"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { attachDocumentFile } from "./actions";

export function DocumentUpload({ id }: { id: string }) {
  const t = useT();
  const [name, setName] = useState("");
  return (
    <ActionForm action={attachDocumentFile} resetOnOk className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:border-ink/40 hover:text-ink">
        <Upload className="size-3.5" />{name || t("Choose PDF or image")}
        <input type="file" name="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} />
      </label>
      <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" name="hasQr" className="size-4 accent-[var(--gold)]" />
        {t("This ticket has a QR code")}
      </label>
      <SubmitButton variant="outline" size="sm">{t("Upload")}</SubmitButton>
    </ActionForm>
  );
}
