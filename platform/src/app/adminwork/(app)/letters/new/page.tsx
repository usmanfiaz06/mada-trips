import "@fontsource/great-vibes";
import "@fontsource/dancing-script";
import "@fontsource/sacramento";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { riyadhDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { LetterEditor } from "../letter-editor";

export const metadata = { title: "New letter" };

export default async function NewLetterPage() {
  await requirePerm("letters.manage");
  const t = await getT();
  return (
    <div className="space-y-4">
      <div className="no-print"><PageHeader eyebrow={t("Documents")} title={t("New letter")} subtitle={t("Write on the company letterhead, add the stamp and a signature, then print or save as PDF.")} /></div>
      <LetterEditor today={riyadhDate()} stampSrc="/adminwork/stamp.png" />
    </div>
  );
}
