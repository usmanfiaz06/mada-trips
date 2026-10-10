/*
 * Reading the open guides: Wikipedia's page summary, the lead image's licence on Wikimedia Commons, the matching
 * Wikivoyage article (found through Wikidata, so London, Ontario never gets London's guide) and its sections.
 * Every request names us and how to reach us (User-Agent), waits at most a few seconds, and a failure only means
 * that part of the guide is left out. Nothing is rewritten: extracts are cut at a sentence, never reworded.
 * No server-only import, so tests can call it with a fake fetch.
 */
import type { GuideSection, GuideSectionKey, PlaceAttribution, PlaceImage } from "@mada/shared";
import { placesUserAgent } from "./ingest";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5000;
const CC_BY_SA = { licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };

async function getJson(f: Fetch, url: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  try {
    const res = await f(url, { headers: { Accept: "application/json", "User-Agent": placesUserAgent(), "Api-User-Agent": placesUserAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

const title = (t: string) => encodeURIComponent(t.replace(/ /g, "_"));
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

export type WikiSummary = { text: string; url: string; qid: string | null; imageFile: string | null; lat: number | null; lon: number | null };

export async function wikipediaSummary(f: Fetch, pageTitle: string): Promise<WikiSummary | null | "unavailable"> {
  const r = await getJson(f, `https://en.wikipedia.org/api/rest_v1/page/summary/${title(pageTitle)}?redirect=true`);
  if (!r.ok) return r.status === 404 ? null : "unavailable";
  const d = r.data as { type?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; wikibase_item?: string; originalimage?: { source?: string }; thumbnail?: { source?: string }; coordinates?: { lat: number; lon: number } };
  if (d.type === "disambiguation" || !d.extract) return null;
  const src = d.originalimage?.source ?? d.thumbnail?.source ?? null;
  return {
    text: d.extract.trim(), url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title(pageTitle)}`, qid: d.wikibase_item ?? null,
    imageFile: src ? commonsFileOf(src) : null, lat: d.coordinates?.lat ?? null, lon: d.coordinates?.lon ?? null,
  };
}

/** Only files on Commons (free licences). Files kept on English Wikipedia itself are often fair use: never ours to show. */
export function commonsFileOf(url: string): string | null {
  const m = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return m[1]!; }
}

const FREE = /^(CC[ -]?BY|CC[ -]?BY[ -]?SA|CC0|Public domain|PD|GFDL|FAL|Attribution)/i;

export async function commonsImage(f: Fetch, file: string): Promise<PlaceImage | null> {
  const r = await getJson(f, `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1280&titles=${encodeURIComponent(`File:${file}`)}`);
  if (!r.ok) return null;
  const page = (r.data as { query?: { pages?: { imageinfo?: Record<string, unknown>[] }[] } }).query?.pages?.[0];
  const info = page?.imageinfo?.[0] as { thumburl?: string; url?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> } | undefined;
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const licence = plain(meta.LicenseShortName?.value ?? "");
  if (!licence || !FREE.test(licence)) return null;
  const url = info.thumburl ?? info.url;
  if (!url || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url)) return null;
  const author = plain(meta.Artist?.value ?? "").slice(0, 120) || null;
  const licenceUrl = meta.LicenseUrl?.value && /^https?:\/\//.test(meta.LicenseUrl.value) ? meta.LicenseUrl.value.replace(/^http:/, "https:") : null;
  return {
    url, width: info.thumbwidth ?? info.width ?? null, height: info.thumbheight ?? info.height ?? null, source: "wikimedia", author, licence, licenceUrl,
    pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${title(`File:${file}`)}`,
  };
}

/** The English Wikivoyage article for a Wikidata item, if there is one. */
export async function wikivoyageTitle(f: Fetch, qid: string): Promise<string | null | "unavailable"> {
  if (!/^Q\d+$/.test(qid)) return null;
  const r = await getJson(f, `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwikivoyage&ids=${qid}`);
  if (!r.ok) return "unavailable";
  const e = (r.data as { entities?: Record<string, { sitelinks?: { enwikivoyage?: { title?: string } } }> }).entities?.[qid];
  return e?.sitelinks?.enwikivoyage?.title ?? null;
}

const SECTIONS: [GuideSectionKey, string][] = [["understand", "Understand"], ["getIn", "Get in"], ["see", "See"], ["do", "Do"], ["eat", "Eat"], ["staySafe", "Stay safe"]];

/** Cut at a sentence end once there is enough to read; never mid-word, never reworded. */
export function trimExtract(text: string, min = 260, max = 640): { text: string; trimmed: boolean } {
  // Prose only: listings (a map number, a phone, "(updated Oct 2018)") are addresses, not reading.
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 40 && !/^[*•]/.test(p) && !/^\d{1,3}\s/.test(p) && !/☏|\(updated [A-Z][a-z]{2} \d{4}\)|\bfax:/.test(p));
  let out = "";
  for (const p of paras) {
    if (out.length >= min) break;
    out = out ? `${out}\n\n${p}` : p;
  }
  if (!out) return { text: "", trimmed: false };
  if (out.length <= max) return { text: out, trimmed: out.length < text.trim().length };
  const cut = out.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return { text: end > min / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`, trimmed: true };
}

/** Wikivoyage's plain-text extract split into the sections we show. Level-2 headings only; text before subheadings first. */
export function splitSections(extract: string, pageTitle: string): GuideSection[] {
  const parts = new Map<string, string>();
  let current: string | null = null;
  const buf: Record<string, string[]> = {};
  for (const line of extract.split("\n")) {
    const h2 = /^==\s*([^=].*?)\s*==\s*$/.exec(line);
    if (h2) { current = h2[1]!.trim(); buf[current] = []; continue; }
    if (/^===+.*===+\s*$/.test(line)) { if (current) buf[current]!.push(""); continue; }
    if (current) buf[current]!.push(line);
  }
  for (const [k, v] of Object.entries(buf)) parts.set(k.toLowerCase(), v.join("\n"));
  const out: GuideSection[] = [];
  for (const [key, heading] of SECTIONS) {
    const body = parts.get(heading.toLowerCase());
    if (!body) continue;
    const t = trimExtract(body);
    if (!t.text) continue;
    out.push({ key, title: heading, text: t.text, trimmed: t.trimmed, url: `https://en.wikivoyage.org/wiki/${title(pageTitle)}#${encodeURIComponent(heading.replace(/ /g, "_"))}` });
  }
  return out;
}

export async function wikivoyageSections(f: Fetch, pageTitle: string): Promise<{ title: string; sections: GuideSection[] } | null | "unavailable"> {
  const r = await getJson(f, `https://en.wikivoyage.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(pageTitle)}`);
  if (!r.ok) return "unavailable";
  const page = (r.data as { query?: { pages?: { title?: string; missing?: boolean; extract?: string }[] } }).query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;
  const t = page.title ?? pageTitle;
  return { title: t, sections: splitSections(page.extract, t) };
}

export const attributionFor = {
  wikipedia: (url: string): PlaceAttribution => ({ source: "wikipedia", text: "From Wikipedia, CC BY-SA", url, ...CC_BY_SA }),
  wikivoyage: (pageTitle: string): PlaceAttribution => ({ source: "wikivoyage", text: "From Wikivoyage, CC BY-SA", url: `https://en.wikivoyage.org/wiki/${title(pageTitle)}`, ...CC_BY_SA }),
  image: (img: PlaceImage): PlaceAttribution => ({ source: "wikimedia", text: `Photo${img.author ? `: ${img.author}` : ""}, ${img.licence ?? "Wikimedia Commons"}`, url: img.pageUrl ?? img.url, licence: img.licence ?? "", licenceUrl: img.licenceUrl }),
  geonames: (): PlaceAttribution => ({ source: "geonames", text: "Places from GeoNames, CC BY 4.0", url: "https://www.geonames.org/", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" }),
  ourairports: (): PlaceAttribution => ({ source: "ourairports", text: "Airports from OurAirports, public domain", url: "https://ourairports.com/data/", licence: "Public domain", licenceUrl: null }),
};
