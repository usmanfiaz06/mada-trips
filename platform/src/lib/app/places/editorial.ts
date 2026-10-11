import type { CityGuide, GuideSection } from "@mada/shared";

/*
 * What we won't show from open text (Wikipedia, Wikivoyage) on a city page (LIVE-AUDIT P1-16). Wikivoyage's voice is
 * a travel writer's, and on Saudi cities it has called Riyadh "the Dead Center of the Kingdom" with a "brutal climate"
 * and "tribal Wahhabi conservatism": not words Mada puts in front of a traveller, least of all about home.
 *
 *  - Saudi cities: no Wikivoyage sections at all; the page keeps Wikipedia's lead (filtered below) and our own facts.
 *  - Everywhere: a paragraph that judges a people, a faith or a government, or calls a place dull, is dropped whole
 *    (never reworded: the text stays the source's). A block left empty is left out.
 */

const JUDGING = new RegExp([
  "wahhab\\w*", "salafi\\w*", "sectarian", "tribal", "conservatism", "puritan\\w*", "fundamentalis\\w*", "extremis\\w*", "religious police", "mutaww?a\\w*",
  "dead cent(?:er|re)", "local wags", "brutal", "boring", "dull", "nothing to (?:do|see)", "soulless", "ugly", "business-only", "not (?:much|a lot) to (?:do|see)",
  "dictator\\w*", "regime", "authoritarian", "beheading\\w*", "executions?", "chop[- ]chop", "human rights", "repress\\w*",
].map((w) => `\\b${w}\\b`).join("|"), "i");

/** The text without its judging paragraphs; null when nothing is left. */
export function fitText(text: string | null | undefined): string | null {
  if (!text) return null;
  const kept = text.split(/\n{2,}/).filter((p) => !JUDGING.test(p)).join("\n\n").trim();
  return kept || null;
}

export function fitGuide(g: CityGuide): CityGuide {
  const saudi = g.countryCode === "SA";
  const sections: GuideSection[] = saudi ? [] : g.sections.flatMap((s) => { const text = fitText(s.text); return text ? [{ ...s, text, trimmed: s.trimmed || text !== s.text }] : []; });
  const summaryText = g.summary ? fitText(g.summary.text) : null;
  const summary = g.summary && summaryText ? { ...g.summary, text: summaryText } : null;
  const attributions = g.attributions.filter((a) => (a.source !== "wikivoyage" || sections.length > 0) && (a.source !== "wikipedia" || !!summary));
  return { ...g, sections, summary, attributions };
}
