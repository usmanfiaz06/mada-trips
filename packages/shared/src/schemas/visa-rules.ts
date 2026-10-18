/*
 * A visa asked for in Ask ("a UK visa for me and my wife in December"): the entry rules first, per passport, before any
 * form. A Saudi passport going to the UK needs an ETA (online, GBP 16, about 3 days), never a VFS appointment; Türkiye,
 * the UAE, Egypt, Azerbaijan and Georgia need nothing to apply for; Schengen and the US need a visa with an appointment.
 * The flight entry checks (booking-logic entryChecks) read the same ENTRY_RULES. Pure, no I/O.
 */
import { t, type CopyKey } from '../copy';
import type { Lang } from '../locale';
import { formatSar, sarToHalalas } from '../money';
import { DESK_PRICES, DESTINATIONS, ENTRY_RULES } from './booking-data';
import { nationalityOf, personName } from './booking-logic';
import { listOf } from './booking-words';
import type { Person } from './people';

/** Where the visa is for, from the form's answer or the words: an ENTRY_RULES country, or Schengen / the US. */
export type VisaPlace = 'GB' | 'SCHENGEN' | 'US' | keyof typeof ENTRY_RULES;

const ANSWER_PLACE: Record<string, VisaPlace> = { UK: 'GB', Schengen: 'SCHENGEN', 'United States': 'US' };

/** The place a visa request is for: the form's answer ("UK"), else a destination named in the words ("Turkey"). */
export function visaPlaceOf(answer: string | null | undefined, words: string): VisaPlace | null {
  if (answer && ANSWER_PLACE[answer]) return ANSWER_PLACE[answer]!;
  const s = words.toLowerCase();
  const d = Object.values(DESTINATIONS).find((x) => x.words.test(s));
  const c = d?.country;
  return c && c !== 'SA' && ENTRY_RULES[c] ? (c as VisaPlace) : null;
}

/** Per passport, for the places Ask's visa form names that the flight table doesn't (it has no Schengen or US rows). */
const EXTRA: Record<'SCHENGEN' | 'US', { name: CopyKey; SAU: CopyKey }> = {
  SCHENGEN: { name: 'visa.place.schengen', SAU: 'visa.rule.schengen' },
  US: { name: 'visa.place.us', SAU: 'visa.rule.us' },
};

export type VisaAdvice = {
  /** eta: every traveller needs only the UK ETA; none: nothing to apply for; visa: an appointment; mixed: some of each. */
  kind: 'eta' | 'none' | 'visa' | 'mixed';
  title: string;
  /** One line per passport group ("Saudi passports need a UK ETA, not a visa: online, GBP 16, about 3 days."). */
  lines: string[];
  /** The service Mada sends instead of a visa appointment (uk_eta), with its price for everyone. */
  service: 'uk_eta' | null;
  priceSar: number;
  priceLine: string | null;
};

/** The entry rules for these travellers going there, said before anything is asked. Null for a place with no rules here. */
export function visaAdvice(place: VisaPlace | null, travellers: Person[], locale?: Lang): VisaAdvice | null {
  if (!place || !travellers.length) return null;
  const l = locale;
  const names = (ps: Person[]) => listOf(ps.map((p) => personName(p, t('heard.you', undefined, l))), l);
  const saudi = travellers.filter((p) => nationalityOf(p) === 'SAU');
  const others = travellers.filter((p) => nationalityOf(p) !== 'SAU');
  const lines: string[] = [];
  let needEta = false;
  let needVisa = false;
  let country = '';
  if (place === 'SCHENGEN' || place === 'US') {
    country = t(EXTRA[place].name, undefined, l);
    if (saudi.length) { lines.push(t(EXTRA[place].SAU, undefined, l)); needVisa = true; }
    if (others.length) { lines.push(t('visa.rule.otherPassport', { names: names(others), country }, l)); needVisa = true; }
  } else {
    const rule = ENTRY_RULES[place];
    if (!rule || rule.domestic) return null;
    country = rule.name;
    if (saudi.length) {
      if (rule.SAU?.eta) { lines.push(t('visa.rule.eta', undefined, l)); needEta = true; }
      else if (rule.SAU?.ok) lines.push(t('visa.rule.saudiOk', { ok: rule.SAU.ok, country: rule.name }, l));
    }
    for (const p of others) {
      const r = nationalityOf(p) === 'PHL' ? rule.PHL : undefined;
      if (r && 'need' in r && r.need) { lines.push((r.text ?? '').replace('{name}', personName(p))); needVisa = true; }
      else if (r && 'ok' in r && r.ok) lines.push(t('visa.rule.personOk', { name: personName(p), ok: r.ok }, l));
      else { lines.push(t('visa.rule.otherPassport', { names: personName(p), country: rule.name }, l)); needVisa = true; }
    }
  }
  const kind: VisaAdvice['kind'] = needEta && needVisa ? 'mixed' : needEta ? 'eta' : needVisa ? 'visa' : 'none';
  const priceSar = kind === 'eta' ? DESK_PRICES.ukEtaEach * saudi.length : 0;
  const price = formatSar(sarToHalalas(priceSar), { locale: l });
  const title = kind === 'eta' ? t('visa.title.eta', undefined, l) : kind === 'none' ? t('visa.title.none', { country }, l) : t('visa.title.visa', { country }, l);
  return {
    kind, title, lines, service: kind === 'eta' ? 'uk_eta' : null, priceSar,
    priceLine: kind === 'eta' ? t(saudi.length === 2 ? 'visa.eta.priceBoth' : 'visa.eta.price', { names: names(saudi), price }, l) : null,
  };
}
