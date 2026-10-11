/**
 * Mada's own editorial content (Discover's events, the curated plans) is data with English in it. The words a
 * traveller reads come from the catalogue by id (ev.*, pl.* in copy/words.ts), so Arabic mode reads Arabic. An id the
 * catalogue doesn't know (new content from the server) shows as it came.
 */
import { hasKey, t, tn, type CopyKey } from '../copy';
import { formatSar } from '../money';
import { localeOr, type Lang } from '../locale';
import type { DiscoverEvent, PlanSummary } from './circles';
import type { CuratedPlan, PlanStop } from './booking-data';

const say = (key: string, fallback: string, vars?: Record<string, string | number>, locale?: Lang) =>
  (hasKey(key) ? t(key as CopyKey, vars, locale) : fallback);

/** A Discover card's title, times, place and tag in the display language. */
export function eventWords(e: DiscoverEvent, locale?: Lang): { title: string; when: string; where: string; tag: string } {
  const price = /SAR ([\d,]+)/.exec(e.when);
  const vars = price ? { price: formatSar(Number(price[1]!.replace(/,/g, '')) * 100, { locale }) } : undefined;
  return {
    title: say(`ev.${e.id}.title`, e.title, undefined, locale),
    when: say(`ev.${e.id}.when`, e.when, vars, locale),
    where: say(`ev.${e.id}.where`, e.where, undefined, locale),
    tag: say(`ev.tag.${e.tag}`, e.tag, undefined, locale),
  };
}

/** A plan's title and line. */
export function planWords(p: Pick<PlanSummary | CuratedPlan, 'id' | 'title' | 'sub'>, locale?: Lang): { title: string; sub: string } {
  return { title: say(`pl.${p.id}.title`, p.title, undefined, locale), sub: say(`pl.${p.id}.sub`, p.sub, undefined, locale) };
}

/** "Day 1" in the display language. */
export const planDay = (i: number, locale?: Lang) => t('pl.day', { n: i + 1 }, locale);

/**
 * One stop of a plan, said for who's actually going: the notes are written per party size (`.one` / `.other`)
 * and with or without children (`.kids`).
 */
export function planStopWords(planId: string, day: number, i: number, stop: PlanStop, who: { n: number; kids: boolean }, locale?: Lang): { title: string; note: string } {
  const base = `pl.${planId}.${day}.${i}`;
  const title = say(`${base}.title`, stop.title, undefined, locale);
  let note = stop.note;
  if (hasKey(`${base}.note.one`)) note = tn(`${base}.note`, who.n, {}, locale);
  else if (who.kids && hasKey(`${base}.note.kids`)) note = t(`${base}.note.kids` as CopyKey, undefined, locale);
  else if (hasKey(`${base}.note`)) note = t(`${base}.note` as CopyKey, undefined, locale);
  return { title, note };
}

/** A name the runtime's Intl knows in the reader's language ("SA" → "السعودية"), or the fallback as it came. */
function displayName(type: 'region' | 'currency', code: string, fallback: string, locale?: Lang): string {
  const l = localeOr(locale);
  if (l === 'en') return fallback;
  try {
    const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string | undefined } }).DisplayNames;
    const name = DN ? new DN([l], { type }).of(code) : undefined;
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

/** A country's name from its two-letter code, in the display language. */
export const countryNameIn = (code2: string, fallback: string, locale?: Lang) => displayName('region', code2.toUpperCase(), fallback, locale);
/** A currency's name from its code ("SAR" → "ريال سعودي"), in the display language. */
export const currencyNameIn = (code: string, fallback: string, locale?: Lang) => displayName('currency', code.toUpperCase(), fallback, locale);
