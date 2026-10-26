"use client";
import { useActionState, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import { Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Stamp as StampIcon, PenLine, Printer, Languages, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { createLetter } from "./actions";

type Box = { on: boolean; x: number; y: number; w: number }; // x,y top-left and w width, all % of the sheet
type Sig = Box & { kind: "image" | "text"; src?: string; text?: string; font?: string };

const FONTS = [
  { label: "Signature 1", css: "'Great Vibes', cursive" },
  { label: "Signature 2", css: "'Dancing Script', cursive" },
  { label: "Signature 3", css: "'Sacramento', cursive" },
];

// Starter drafts. [square brackets] mark the bits to fill in.
const TEMPLATES: { key: string; label: string; subject: string; recipient: string; body: string }[] = [
  { key: "blank", label: "Blank letter", subject: "", recipient: "", body: "" },
  {
    key: "concern", label: "To whom it may concern", subject: "To whom it may concern", recipient: "To whom it may concern",
    body: "<p>To whom it may concern,</p><p>This is to certify that [subject of the letter].</p><p>This letter is issued upon request for [purpose] and may be relied upon for that purpose only.</p><p>For any verification, please contact us using the details on this letterhead.</p><p>Sincerely,</p>",
  },
  {
    key: "auth", label: "Authorisation letter", subject: "Authorisation letter", recipient: "",
    body: "<p>Dear Sir/Madam,</p><p>We, <b>Mada Trips</b> (C.R. No. 7055256312), Riyadh, Kingdom of Saudi Arabia, hereby authorise <b>[full name]</b>, holder of ID / Iqama No. <b>[number]</b>, to act on behalf of the company for the purpose of <b>[purpose]</b>.</p><p>This authorisation is valid [from [date] until [date] / until further notice].</p><p>Yours faithfully,</p>",
  },
  {
    key: "employment", label: "Employment / salary certificate", subject: "Employment certificate", recipient: "To whom it may concern",
    body: "<p>To whom it may concern,</p><p>This is to certify that <b>[full name]</b>, holder of ID / Iqama No. <b>[number]</b>, has been employed with <b>Mada Trips</b> as <b>[job title]</b> since <b>[start date]</b>.</p><p>[Optional: Their current total monthly salary is SAR [amount].]</p><p>This certificate is issued upon the employee's request without any liability on the company.</p><p>Sincerely,</p>",
  },
];

export function LetterEditor({ today, stampSrc }: { today: string; stampSrc: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(createLetter, {} as { error?: string });
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHidden = useRef<HTMLInputElement>(null);
  const designHidden = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [recipient, setRecipient] = useState("");
  const [date, setDate] = useState(today);
  const [stamp, setStamp] = useState<Box>({ on: false, x: 60, y: 66, w: 24 });
  const [sig, setSig] = useState<Sig>({ on: false, x: 12, y: 70, w: 22, kind: "text", text: "", font: FONTS[0].css });
  const [rtl, setRtl] = useState(false);
  const [sigPanel, setSigPanel] = useState(false);

  const cmd = (c: string, v?: string) => { document.execCommand(c, false, v); bodyRef.current?.focus(); };

  function applyTemplate(key: string) {
    const tpl = TEMPLATES.find((x) => x.key === key);
    if (!tpl) return;
    if (bodyRef.current?.innerHTML.trim() && !window.confirm(t("Replace the current letter with this template?"))) return;
    setSubject(tpl.subject); setRecipient(tpl.recipient);
    if (bodyRef.current) bodyRef.current.innerHTML = tpl.body;
  }

  function drag(e: RPointerEvent, get: () => Box, set: (b: Box) => void) {
    e.preventDefault();
    const sheet = sheetRef.current!.getBoundingClientRect();
    const start = get(); const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const nx = start.x + ((ev.clientX - sx) / sheet.width) * 100;
      const ny = start.y + ((ev.clientY - sy) / sheet.height) * 100;
      set({ ...start, x: Math.max(0, Math.min(96, nx)), y: Math.max(0, Math.min(97, ny)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function resize(e: RPointerEvent, get: () => Box, set: (b: Box) => void) {
    e.preventDefault(); e.stopPropagation();
    const sheet = sheetRef.current!.getBoundingClientRect();
    const start = get(); const sx = e.clientX;
    const move = (ev: PointerEvent) => set({ ...start, w: Math.max(6, Math.min(60, start.w + ((ev.clientX - sx) / sheet.width) * 100)) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function onIssue() {
    if (bodyHidden.current) bodyHidden.current.value = bodyRef.current?.innerHTML ?? "";
    if (designHidden.current) designHidden.current.value = JSON.stringify({ stamp: stamp.on ? stamp : null, signature: sig.on ? sig : null, rtl });
  }

  const onSigFile = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setSig((s) => ({ ...s, on: true, kind: "image", src: String(r.result) }));
    r.readAsDataURL(file);
  };

  const Tool = ({ onClick, title, children, active }: { onClick: () => void; title: string; children: ReactNode; active?: boolean }) => (
    <button type="button" onClick={onClick} title={title} className={`grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-sunken ${active ? "bg-sunken text-ink" : ""}`}>{children}</button>
  );
  const Handle = ({ get, set }: { get: () => Box; set: (b: Box) => void }) => (
    <span onPointerDown={(e) => resize(e, get, set)} className="no-print absolute -bottom-1.5 -end-1.5 size-3.5 cursor-se-resize rounded-full border border-white bg-gold shadow" />
  );

  return (
    <div className="mx-auto max-w-[900px]">
      {/* Toolbar — never printed */}
      <div className="no-print sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/90 p-2 backdrop-blur">
        <select onChange={(e) => { applyTemplate(e.target.value); e.target.selectedIndex = 0; }} defaultValue="" title={t("Start from a template")}
          className="h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-[12.5px] font-medium text-ink-2 outline-none">
          <option value="" disabled>{t("Template…")}</option>
          {TEMPLATES.map((tp) => <option key={tp.key} value={tp.key}>{t(tp.label)}</option>)}
        </select>
        <div className="flex items-center gap-0.5 border-s border-line ps-2">
          <Tool onClick={() => cmd("bold")} title={t("Bold")}><Bold className="size-4" /></Tool>
          <Tool onClick={() => cmd("italic")} title={t("Italic")}><Italic className="size-4" /></Tool>
          <Tool onClick={() => cmd("underline")} title={t("Underline")}><Underline className="size-4" /></Tool>
        </div>
        <div className="flex items-center gap-0.5 border-s border-line ps-2">
          <Tool onClick={() => cmd("insertUnorderedList")} title={t("Bullets")}><List className="size-4" /></Tool>
          <Tool onClick={() => cmd("insertOrderedList")} title={t("Numbered")}><ListOrdered className="size-4" /></Tool>
          <Tool onClick={() => cmd("justifyLeft")} title={t("Align left")}><AlignLeft className="size-4" /></Tool>
          <Tool onClick={() => cmd("justifyCenter")} title={t("Centre")}><AlignCenter className="size-4" /></Tool>
          <Tool onClick={() => cmd("justifyRight")} title={t("Align right")}><AlignRight className="size-4" /></Tool>
          <Tool onClick={() => setRtl((r) => !r)} title={t("Arabic / English direction")} active={rtl}><Languages className="size-4" /></Tool>
        </div>
        <div className="flex items-center gap-0.5 border-s border-line ps-2">
          <Tool onClick={() => setStamp((s) => ({ ...s, on: !s.on }))} title={t("Add stamp")} active={stamp.on}><StampIcon className="size-4" /></Tool>
          <Tool onClick={() => setSigPanel(true)} title={t("Add signature")} active={sig.on}><PenLine className="size-4" /></Tool>
        </div>
        <button type="button" onClick={() => window.print()} className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:border-ink/40"><Printer className="size-4" />{t("Print / PDF")}</button>
        <button type="submit" form="letter-form" onClick={onIssue} disabled={pending} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-85 disabled:opacity-50">{pending ? t("Saving…") : t("Issue & save")}</button>
      </div>
      {state?.error && <div className="no-print mb-3 rounded-xl border border-bad/30 bg-bad-soft px-4 py-2.5 text-[13px] text-bad">{state.error}</div>}

      {/* Hidden form that carries the sheet's content to the server */}
      <form id="letter-form" action={action} className="hidden">
        <input name="subject" value={subject} readOnly />
        <input name="recipient" value={recipient} readOnly />
        <input name="date" value={date} readOnly />
        <input ref={bodyHidden} name="bodyHtml" type="hidden" />
        <input ref={designHidden} name="design" type="hidden" />
      </form>

      {/* The A4 sheet — this is what prints */}
      <div className="print-area overflow-auto pb-10">
        <div ref={sheetRef} className="sheet relative mx-auto bg-white text-[#14211c] shadow-card">
          <img src="/adminwork/letterhead.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} />
          <div className="absolute flex flex-col" style={{ top: "14%", bottom: "13%", insetInlineStart: "11%", insetInlineEnd: "11%" }} dir={rtl ? "rtl" : "ltr"}>
            <input value={date} onChange={(e) => setDate(e.target.value)} type="date" dir="ltr" className="w-[150px] bg-transparent text-[12.5px] text-ink-3 outline-none" style={{ alignSelf: rtl ? "flex-start" : "flex-end" }} />
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={t("Recipient (optional)")} className="mt-3 bg-transparent text-[13.5px] font-medium outline-none placeholder:text-[#b4bcb4]" />
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Subject")} className="mt-1 bg-transparent text-[13.5px] font-semibold outline-none placeholder:text-[#b4bcb4]" />
            <div ref={bodyRef} contentEditable suppressContentEditableWarning data-ph={t("Write the letter…")}
              className="editable mt-3 min-h-0 flex-1 text-[13.5px] leading-[1.9] outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6" />
          </div>

          {stamp.on && (
            <div className="group absolute" style={{ left: `${stamp.x}%`, top: `${stamp.y}%`, width: `${stamp.w}%` }} onPointerDown={(e) => drag(e, () => stamp, setStamp)}>
              <img src={stampSrc} alt="stamp" draggable={false} onError={(e) => (e.currentTarget.style.opacity = "0.15")} className="w-full cursor-move select-none" />
              <Handle get={() => stamp} set={setStamp} />
            </div>
          )}
          {sig.on && (
            <div className="group absolute" style={{ left: `${sig.x}%`, top: `${sig.y}%`, width: `${sig.w}%` }} onPointerDown={(e) => drag(e, () => sig, (b) => setSig((s) => ({ ...s, ...b })))}>
              {sig.kind === "image"
                ? <img src={sig.src} alt="signature" draggable={false} className="w-full cursor-move select-none" />
                : <span className="block cursor-move select-none whitespace-nowrap leading-none" style={{ fontFamily: sig.font, fontSize: `${sig.w / 4}cqw` }}>{sig.text}</span>}
              <Handle get={() => sig} set={(b) => setSig((s) => ({ ...s, ...b }))} />
            </div>
          )}
        </div>
      </div>

      {sigPanel && (
        <div className="no-print fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={() => setSigPanel(false)}>
          <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-[15px] font-semibold">{t("Signature")}</h3><button onClick={() => setSigPanel(false)} className="text-ink-3 hover:text-ink"><X className="size-5" /></button></div>
            <div className="space-y-3">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-3">{t("Type a name")}</span>
                <input value={sig.kind === "text" ? sig.text ?? "" : ""} onChange={(e) => setSig((s) => ({ ...s, kind: "text", text: e.target.value }))} className="field h-10" placeholder={t("e.g. Abdulaziz")} /></label>
              <div className="flex flex-wrap gap-2">
                {FONTS.map((f) => (
                  <button key={f.css} type="button" onClick={() => setSig((s) => ({ ...s, kind: "text", font: f.css }))}
                    className={`rounded-lg border px-3 py-1.5 text-[22px] leading-none ${sig.font === f.css && sig.kind === "text" ? "border-gold" : "border-line"}`} style={{ fontFamily: f.css }}>{sig.text || "Mada"}</button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[12px] text-ink-4"><span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" /></div>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-3">{t("Upload a signature image")}</span>
                <input type="file" accept="image/*" onChange={(e) => onSigFile(e.target.files?.[0])} className="text-[13px]" /></label>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setSig((s) => ({ ...s, on: false })); setSigPanel(false); }} className="rounded-full px-3.5 py-2 text-[13px] text-ink-3 hover:text-ink">{t("Remove")}</button>
                <button type="button" onClick={() => { setSig((s) => ({ ...s, on: true })); setSigPanel(false); }} className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-85">{t("Place on letter")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .sheet { width: 210mm; min-height: 297mm; container-type: inline-size; }
        .editable:empty:before { content: attr(data-ph); color: #9aa39d; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; overflow: visible !important; padding: 0 !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
