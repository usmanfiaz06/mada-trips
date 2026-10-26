import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Letters" };

export default async function LettersPage() {
  await requirePerm("letters.manage");
  const t = await getT();
  const L = t.locale;
  const rows = await db.select({ l: schema.letters, by: schema.users.name })
    .from(schema.letters).leftJoin(schema.users, eq(schema.users.id, schema.letters.createdBy))
    .orderBy(desc(schema.letters.createdAt)).limit(300);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Documents")} title={t("Letters")} subtitle={t("Official letters issued on the company letterhead. Every one is logged here.")}
        actions={<LinkButton href="/adminwork/letters/new" variant="primary"><Plus className="size-4" />{t("New letter")}</LinkButton>} />
      <Card pad={false}>
        {rows.length ? (
          <Table>
            <thead><tr><Th>{t("Reference")}</Th><Th>{t("Subject")}</Th><Th>{t("Recipient")}</Th><Th>{t("Date")}</Th><Th>{t("Issued by")}</Th></tr></thead>
            <tbody>
              {rows.map(({ l, by }) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <Td><Link href={`/adminwork/letters/${l.id}`} className="num font-medium text-ink hover:underline">{l.ref}</Link></Td>
                  <Td>{l.subject}</Td>
                  <Td className="text-ink-3">{l.recipient ?? "—"}</Td>
                  <Td className="text-ink-3">{fmtDate(l.letterDate, L)}</Td>
                  <Td className="text-ink-3">{by ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-6"><Empty icon={<FileText className="size-6" />} title={t("No letters yet")} hint={t("Write your first one on the company letterhead.")}
            action={<LinkButton href="/adminwork/letters/new" variant="primary" size="sm"><Plus className="size-4" />{t("New letter")}</LinkButton>} /></div>
        )}
      </Card>
    </div>
  );
}
