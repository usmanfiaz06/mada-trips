/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { ImageResponse } from "next/og";
import { PLANS, coverArtSvg, coverTextTone, hasArabic, joinNames, planById, t, tn, type CircleCover, type CoverKey, type InvitePreview, type Lang, type PersonRef } from "@mada/shared";
import { approvedUploadDataUri } from "../circles/covers";
import { inLocale } from "../resilience/request";
import { asset } from "./assets";

/*
 * The pictures WhatsApp, iMessage and X show for a shared link (og:image, 1200×630): the circle's cover, who invited
 * you, the circle's name and who's in; or a plan's cover and title. next/og (Satori) shapes Arabic letters but lays
 * words out left to right, so Arabic lines are set word by word in a right-to-left row (rtlRuns).
 */

const W = 1200;
const H = 630;
const GOLD = "#d9b77a";
const PAPER = "#fffdf9";
const NIGHT = "#0f1a16";

async function fonts() {
  return [
    // The whole IBM Plex Sans Arabic (Arabic and Latin in one file): Satori keeps one font per name and weight.
    { name: "Plex", data: await asset("plex-400.ttf"), weight: 400 as const, style: "normal" as const },
    { name: "Plex", data: await asset("plex-600.ttf"), weight: 600 as const, style: "normal" as const },
    // Last, so text in "Plex" never falls back to it.
    { name: "Serif", data: await asset("instrument-serif.ttf"), weight: 400 as const, style: "normal" as const },
  ];
}
const dataUri = async (file: string, type: string) => `data:${type};base64,${(await asset(file)).toString("base64")}`;

/** A line of text that reads right to left when it holds Arabic: runs of words in a reversed row. */
function Line({ text, style }: { text: string; style: Record<string, string | number> }) {
  if (!hasArabic(text)) return <div style={{ display: "flex", ...style }}>{text}</div>;
  const runs: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const latin = !hasArabic(w);
    const last = runs[runs.length - 1];
    if (latin && last !== undefined && !hasArabic(last)) runs[runs.length - 1] = `${last} ${w}`;
    else runs.push(w);
  }
  return <div style={{ display: "flex", flexDirection: "row-reverse", justifyContent: "flex-start", ...style }}>{runs.map((r, i) => <span key={i} style={{ marginLeft: i === runs.length - 1 ? 0 : "0.25em" }}>{r}</span>)}</div>;
}

function Faces({ people }: { people: PersonRef[] }) {
  const bg = (tone: string) => (tone === "green" ? "#1e352d" : tone === "gold" ? GOLD : "#f6f2ec");
  const fg = (tone: string) => (tone === "green" ? "#e9e2d8" : "#1e352d");
  return (
    <div style={{ display: "flex" }}>
      {people.slice(0, 5).map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 999, marginLeft: i ? -16 : 0, border: `4px solid ${NIGHT}`, background: bg(p.tone), color: fg(p.tone), fontFamily: "Plex", fontWeight: 600, fontSize: 26 }}>{p.initial}</div>
      ))}
    </div>
  );
}

type Frame = { locale: Lang; cover: CoverKey | CircleCover | null; eyebrow: string; title: string; sub: string; people: PersonRef[] };
const HEADERS = { "Content-Type": "image/png", "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600", "X-Content-Type-Options": "nosniff" };

/**
 * Drawn up front, so a name the font tables can't shape (Satori's Arabic support has gaps) falls back to the same
 * picture without words rather than a broken image.
 */
async function frame(o: Frame): Promise<Response> {
  try {
    return new Response(await (await draw(o)).arrayBuffer(), { headers: HEADERS });
  } catch (e) {
    console.warn("[links] preview picture fell back:", (e as Error).message.slice(0, 120));
    return new Response(await (await draw({ ...o, eyebrow: "", title: "", sub: "" })).arrayBuffer(), { headers: HEADERS });
  }
}

async function draw(o: Frame) {
  const rtl = o.locale === "ar";
  const c = o.cover;
  // A photo we ship, an approved upload (JPEG or PNG), or one of Mada's drawings drawn to the frame's size.
  const cover = !c ? null : typeof c === "string" ? await dataUri(`${c}.jpg`, "image/jpeg") : c.kind === "photo" ? await dataUri(`${c.id}.jpg`, "image/jpeg")
    : c.kind === "upload" ? await approvedUploadDataUri(c.fileId)
      : `data:image/svg+xml;base64,${Buffer.from(coverArtSvg(c, { width: W, height: H, side: rtl ? "left" : "right" })).toString("base64")}`;
  // Words on a light drawing are ink, with the veil in the drawing's own colour; everything else is paper on night.
  const drawn = !!c && typeof c !== "string" && c.kind === "icon";
  const light = drawn && coverTextTone((c as Extract<CircleCover, { kind: "icon" }>).color) === "ink";
  const veil = light ? "rgba(255,253,249," : "rgba(15,26,22,";
  const ink = light ? "#1e352d" : PAPER;
  const mark = await dataUri("symbol-gold.svg", "image/svg+xml");
  const word = await dataUri("wordmark-sand.svg", "image/svg+xml");
  const arTitle = hasArabic(o.title);
  const size = o.title.length > 28 ? 64 : o.title.length > 18 ? 78 : 92;
  const align = rtl ? "flex-end" : "flex-start";
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: W, height: H, background: NIGHT, position: "relative", fontFamily: "Plex" }}>
        {cover
          ? <img src={cover} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }} alt="" />
          : <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", background: "radial-gradient(circle at 78% 30%, #2a4a40 0%, #1e352d 40%, #0f1a16 100%)" }} />}
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", background: rtl
          ? `linear-gradient(270deg, ${veil}${light ? 0.86 : 0.94}) 0%, ${veil}${light ? 0.55 : 0.78}) 42%, ${veil}${drawn ? 0 : 0.15}) ${drawn ? 75 : 100}%)`
          : `linear-gradient(90deg, ${veil}${light ? 0.86 : 0.94}) 0%, ${veil}${light ? 0.55 : 0.78}) 42%, ${veil}${drawn ? 0 : 0.15}) ${drawn ? 75 : 100}%)` }} />
        {!cover ? <img src={mark} width={330} height={221} style={{ position: "absolute", top: 150, [rtl ? "left" : "right"]: 90, opacity: 0.9 }} alt="" /> : null}
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 72px", alignItems: align }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexDirection: rtl ? "row-reverse" : "row" }}>
            <img src={mark} width={60} height={40} alt="" />
            <img src={word} width={104} height={46} alt="" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: align, maxWidth: 820 }}>
            {o.people.length ? <Faces people={o.people} /> : null}
            {o.eyebrow ? <Line text={o.eyebrow} style={{ color: light ? "#7d5d27" : GOLD, fontSize: rtl ? 30 : 24, fontWeight: 600, letterSpacing: rtl ? 0 : 3, textTransform: rtl ? "none" : "uppercase" }} /> : null}
            {o.title ? <Line text={o.title} style={{ color: ink, fontFamily: arTitle ? "Plex" : "Serif", fontWeight: arTitle ? 600 : 400, fontSize: arTitle ? Math.round(size * 0.82) : size, lineHeight: arTitle ? 1.25 : 1.02, letterSpacing: arTitle ? 0 : -1 }} /> : null}
            {o.sub ? <Line text={o.sub} style={{ color: light ? "rgba(30,53,45,0.8)" : "rgba(255,253,249,0.86)", fontSize: 28 }} /> : null}
          </div>
        </div>
      </div>
    ),
    {
      width: W, height: H, fonts: await fonts(),
    },
  );
}

/** The invite's picture. A link that no longer works, or one we don't know, gets Mada's plain card. */
export function joinImage(p: InvitePreview | null, locale: Lang) {
  return inLocale(locale, async () => {
    if (!p || p.status !== "open") return frame({ locale, cover: null, eyebrow: t("links.plan.eyebrow"), title: locale === "ar" ? "مادا للرحلات" : "Mada Trips", sub: t("links.join.ogDesc"), people: [] });
    const from = p.from.short;
    if (!p.circle) return frame({ locale, cover: null, eyebrow: t("circles.join.invitedYou", { name: from }), title: t("circles.join.madaTitle", { name: from }), sub: t("links.join.ogDesc"), people: [p.from] });
    const c = p.circle;
    const names = c.members.map((m) => m.short);
    const inLine = c.memberCount > names.length ? tn("circles.join.peopleIn", c.memberCount, { count: c.memberCount })
      : names.length === 1 ? t("circles.join.isIn", { names: names[0]! }) : t("circles.join.areIn", { names: joinNames(names) });
    return frame({ locale, cover: c.cover, eyebrow: t("circles.join.invitedYou", { name: from }), title: c.name, sub: [c.trip, inLine].filter(Boolean).join(" · "), people: c.members });
  });
}

export function planImage(id: string, locale: Lang) {
  return inLocale(locale, async () => {
    const sum = planById(id);
    if (!sum || !PLANS[id]) return frame({ locale, cover: null, eyebrow: t("links.plan.eyebrow"), title: locale === "ar" ? "مادا للرحلات" : "Mada Trips", sub: "", people: [] });
    return frame({ locale, cover: sum.photoKey, eyebrow: t("links.plan.eyebrow"), title: sum.title, sub: `${sum.city} · ${tn("links.plan.days", sum.days, { count: sum.days })}`, people: [] });
  });
}
