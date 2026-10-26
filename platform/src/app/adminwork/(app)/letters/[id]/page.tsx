import "@fontsource/great-vibes";
import "@fontsource/dancing-script";
import "@fontsource/sacramento";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { PrintButton } from "../print-button";

export const metadata = { title: "Letter" };

type Box = { x: number; y: number; w: number };
type Design = { stamp?: Box | null; signature?: (Box & { kind: "image" | "text"; src?: string; text?: string; font?: string }) | null; rtl?: boolean };

export default async function LetterView({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("letters.manage");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [l] = await db.select().from(schema.letters).where(eq(schema.letters.id, id));
  if (!l) notFound();
  const d = (l.design ?? {}) as Design;
  const sig = d.signature;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/adminwork/letters" className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t("All letters")}</Link>
        <div className="text-[13.5px] text-ink-2"><span className="num font-medium text-ink">{l.ref}</span> · {l.subject}</div>
        <div className="ms-auto"><PrintButton /></div>
      </div>

      <div className="print-area overflow-auto">
        <div className="sheet relative mx-auto bg-white text-[#14211c] shadow-card">
          <img src="/adminwork/letterhead.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full" />
          <div className="absolute" style={{ top: "14%", bottom: "13%", insetInlineStart: "11%", insetInlineEnd: "11%" }} dir={d.rtl ? "rtl" : "ltr"}>
            <div className="mb-4 text-[12.5px] text-ink-3" dir="ltr" style={{ textAlign: d.rtl ? "start" : "end" }}>{fmtDate(l.letterDate, L)}</div>
            {l.recipient && <div className="text-[13.5px] font-medium">{l.recipient}</div>}
            <div className="mt-1 text-[13.5px] font-semibold">{l.subject}</div>
            <div className="mt-3 text-[13.5px] leading-[1.9] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6" dangerouslySetInnerHTML={{ __html: l.bodyHtml }} />
          </div>
          {d.stamp && <img src="/adminwork/stamp.png" alt="stamp" className="absolute" style={{ left: `${d.stamp.x}%`, top: `${d.stamp.y}%`, width: `${d.stamp.w}%` }} />}
          {sig && (sig.kind === "image"
            ? <img src={sig.src} alt="signature" className="absolute" style={{ left: `${sig.x}%`, top: `${sig.y}%`, width: `${sig.w}%` }} />
            : <span className="absolute whitespace-nowrap leading-none" style={{ left: `${sig.x}%`, top: `${sig.y}%`, fontFamily: sig.font, fontSize: `${sig.w / 4}cqw` }}>{sig.text}</span>)}
        </div>
      </div>

      <style>{`
        .sheet { width: 210mm; min-height: 297mm; container-type: inline-size; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; overflow: visible !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
