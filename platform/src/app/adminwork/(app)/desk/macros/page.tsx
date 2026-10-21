import { MessageSquareText, Trash2 } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { listCanned } from "@/lib/app/desk/agent-admin";
import { Card, CardHead, Empty, Field, Input, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ListFilter, SummaryStrip } from "@/components/desk/list";
import { deleteCannedAction, saveCannedAction } from "../agent-actions";

export const metadata = { title: "Saved replies · Desk" };

export default async function MacrosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const admin = can(u, "desk.admin");
  const q = sp.q?.trim().toLowerCase().slice(0, 60) ?? "";
  const all = await listCanned();
  const rows = all.filter((c) => !q || [c.title, c.bodyEn, c.bodyAr].some((s) => s.toLowerCase().includes(q)));
  return (
    <>
      <PageHeader eyebrow={t("Support admin")} title={t("Saved replies & macros")}
        subtitle={t("Replies the team sends often, in English and Arabic. Every reply box on the desk (chats, tickets, orders, requests) lists them under Saved replies and drops in the one for the traveller's language.")} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card pad={false} className="min-w-0">
          <ListFilter action="/adminwork/desk/macros" q={sp.q} placeholder={t("Title or words in the reply…")} clear={q ? "/adminwork/desk/macros" : null} />
          <SummaryStrip><span>{t("{n} saved replies", { n: rows.length })}</span></SummaryStrip>
          {rows.length === 0 ? <Empty icon={<MessageSquareText className="size-5" />} title={q ? t("No saved replies match") : t("No saved replies yet")} hint={admin ? t("Add the answers you type most: a bag tag photo, how refunds work, the visa checklist.") : undefined} /> : (
            <Table>
              <thead><tr><Th>{t("Title")}</Th><Th>{t("English")}</Th><Th>{t("Arabic")}</Th><Th align="end">{t("Order")}</Th>{admin && <Th>{""}</Th>}</tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="align-top">
                    <Td className="w-[200px]"><span className="text-ink">{c.title}</span><span className="block text-[12px] text-ink-3">{timeAgo(c.updatedAt ?? c.createdAt, L)}</span></Td>
                    <Td><span className="line-clamp-3 max-w-[300px] whitespace-pre-wrap text-ink-2" dir="ltr">{c.bodyEn}</span></Td>
                    <Td><span className="line-clamp-3 max-w-[300px] whitespace-pre-wrap text-ink-2" dir="rtl">{c.bodyAr}</span></Td>
                    <Td align="end" className="num">{c.sort}</Td>
                    {admin && (
                      <Td className="w-[110px]">
                        <details className="group relative [&_summary::-webkit-details-marker]:hidden">
                          <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">{t("Edit")}</summary>
                          <div className="absolute end-0 z-10 mt-2 w-[420px] max-w-[85vw] rounded-2xl bg-surface p-4 shadow-float">
                            <CannedForm t={t} c={c} />
                            <form action={deleteCannedAction} className="mt-2 border-t border-line pt-2"><input type="hidden" name="id" value={c.id} />
                              <SubmitButton variant="ghost" size="sm" className="text-bad" confirm={t("Delete this saved reply?")}><Trash2 className="size-3.5" />{t("Delete")}</SubmitButton></form>
                          </div>
                        </details>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {admin && (
          <aside>
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Add saved reply")} hint={t("In both languages; the reply box picks the one for your screen.")} action={<MessageSquareText className="size-4 text-ink-3" />} />
              <CannedForm t={t} />
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}

function CannedForm({ t, c }: { t: Awaited<ReturnType<typeof getT>>; c?: { id: string; title: string; bodyEn: string; bodyAr: string; sort: number } }) {
  return (
    <ActionForm action={saveCannedAction} resetOnOk={!c} className="space-y-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label={t("Title")}><Input name="title" required maxLength={60} defaultValue={c?.title} placeholder={t("Title, e.g. Bag tag photo")} /></Field>
      <Field label={t("English")}><Textarea name="bodyEn" required rows={3} maxLength={1000} defaultValue={c?.bodyEn} dir="ltr" /></Field>
      <Field label={t("Arabic")}><Textarea name="bodyAr" required rows={3} maxLength={1000} defaultValue={c?.bodyAr} dir="rtl" /></Field>
      <Field label={t("Order")} hint={t("Lower comes first in the reply box.")}><Input name="sort" type="number" min={0} max={999} defaultValue={c?.sort ?? 0} /></Field>
      <SubmitButton variant={c ? "primary" : "outline"} className="w-full">{c ? t("Save") : t("Add saved reply")}</SubmitButton>
    </ActionForm>
  );
}
