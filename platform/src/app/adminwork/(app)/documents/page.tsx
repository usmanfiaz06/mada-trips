import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileBadge, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { DOCUMENT_TYPE } from "@/lib/labels";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  await requirePerm("documents.issue");
  const t = await getT();
  const L = t.locale;
  const rows = await db.select({ d: schema.documents, by: schema.users.name })
    .from(schema.documents).leftJoin(schema.users, eq(schema.users.id, schema.documents.createdBy))
    .orderBy(desc(schema.documents.createdAt)).limit(300);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Documents")} title={t("Tickets & receipts")}
        subtitle={t("Mada-branded flight tickets, hotel vouchers and receipts. Every one issued is logged here.")}
        actions={<LinkButton href="/adminwork/documents/new" variant="primary"><Plus className="size-4" />{t("New document")}</LinkButton>} />
      <Card pad={false}>
        {rows.length ? (
          <Table>
            <thead><tr><Th>{t("Reference")}</Th><Th>{t("Type")}</Th><Th>{t("Details")}</Th><Th>{t("For")}</Th><Th>{t("Date")}</Th><Th>{t("Issued by")}</Th></tr></thead>
            <tbody>
              {rows.map(({ d, by }) => {
                const m = DOCUMENT_TYPE[d.type] ?? { label: d.type, tone: "neutral" as const };
                return (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <Td><Link href={`/adminwork/documents/${d.id}`} className="num font-medium text-ink hover:underline">{d.ref}</Link></Td>
                    <Td><Badge tone={m.tone}>{t(m.label)}</Badge></Td>
                    <Td>{d.title}</Td>
                    <Td className="text-ink-3">{d.forName ?? "—"}</Td>
                    <Td className="text-ink-3">{fmtDate(d.docDate, L)}</Td>
                    <Td className="text-ink-3">{by ?? "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="p-6"><Empty icon={<FileBadge className="size-6" />} title={t("No documents yet")} hint={t("Create your first Mada-branded ticket, voucher or receipt.")}
            action={<LinkButton href="/adminwork/documents/new" variant="primary" size="sm"><Plus className="size-4" />{t("New document")}</LinkButton>} /></div>
        )}
      </Card>
    </div>
  );
}
