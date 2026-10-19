/*
 * Who is travelling, and how well a stay fits them. Both are rules on facts, with no randomness: the same travellers
 * and the same hotels always give the same order, and a tie goes to the cheaper stay. docs/app/RANKING.md explains
 * them in plain words.
 *
 *   tripShape   from the travellers picked in "Who's staying?": their relation and their age on the check-in day.
 *   stayFit     a 0–100 score from stars, value against the other prices, where it is, free cancellation and
 *               breakfast, weighted for the shape (a family values connecting rooms and a pool; a couple stars and
 *               location; a pilgrim the walk to the Haram), plus the wishes said in chat. Every reason it gives is a
 *               fact that added to the score, so a pick never claims what the hotel's own content doesn't show.
 */
import { z } from 'zod';
import { t, tn, type CopyKey } from '../copy';
import { ageOn } from './booking-logic';
import { CITY_CENTRES, kmApart, landmarkById, LANDMARKS } from './landmarks';
import type { Person } from './people';
import type { StayAmenity, StayFacts } from './booking';

/* ───────────── the trip's shape ───────────── */

export const TripShape = z.enum(['family', 'couple', 'solo', 'group', 'pilgrimage']);
export type TripShape = z.infer<typeof TripShape>;

export type ShapeFacts = {
  shape: TripShape;
  travellers: number;
  /** Children under 12 on the day (their age from the date of birth). */
  under12: number;
  /** Generations on the trip: a parent and a child, or a grandparent, make two or more. */
  generations: number;
  /** In plain words, why this shape ("2 children under 12", "you and your spouse"). */
  because: string;
};

type Traveller = Pick<Person, 'relation' | 'dateOfBirth' | 'isSelf'>;
const GENERATION: Record<string, number> = { child: -1, parent: 1 };

/**
 * The trip's shape from facts: a child under 12, or two generations or more, is a family; you alone, solo; you and your
 * spouse, a couple; several adults otherwise, a group; Umrah or a wish for the Haram, a pilgrimage.
 */
export function tripShape(travellers: Traveller[], on: string, opts: { pilgrimage?: boolean } = {}): ShapeFacts {
  const people = travellers.filter((p) => p.relation !== 'helper');
  const ages = people.map((p) => ageOn(p, on));
  const under12 = ages.filter((a) => a !== null && a < 12).length;
  // A child of unknown age still counts as a generation below; an adult child travelling with a parent too.
  const gens = new Set(people.map((p, i) => GENERATION[p.relation] ?? ((ages[i] ?? 30) < 18 ? -1 : 0)));
  const generations = gens.size;
  const n = Math.max(1, people.length);
  const base = { travellers: n, under12, generations };
  if (opts.pilgrimage) return { shape: 'pilgrimage', ...base, because: t('shape.because.pilgrimage') };
  if (under12 > 0) return { shape: 'family', ...base, because: tn('shape.because.kids', under12) };
  if (generations >= 2) return { shape: 'family', ...base, because: t('shape.because.generations') };
  if (n === 1) return { shape: 'solo', ...base, because: t('shape.because.solo') };
  if (n === 2 && people.some((p) => p.relation === 'spouse')) return { shape: 'couple', ...base, because: t('shape.because.couple') };
  return { shape: 'group', ...base, because: tn('shape.because.group', n) };
}

/* ───────────── how well a stay fits ───────────── */

export const StayReason = z.discriminatedUnion('k', [
  z.object({ k: z.literal('stars'), n: z.number().int() }),
  z.object({ k: z.literal('has'), what: z.string() }),
  z.object({ k: z.literal('board'), board: z.string() }),
  z.object({ k: z.literal('freeCancel') }),
  z.object({ k: z.literal('near'), place: z.string(), km: z.number() }),
  z.object({ k: z.literal('value') }),
]);
export type StayReason = z.infer<typeof StayReason>;

/** What the server stores with each offer: the shape it was ranked for, the score and the facts that made it. */
export const StayFit = z.object({ shape: TripShape, score: z.number(), reasons: z.array(StayReason) });
export type StayFit = z.infer<typeof StayFit>;

type Weights = { star: number; price: number; where: number; refundable: number; breakfast: number; has: Partial<Record<StayAmenity, number>> };
/** The weights per shape. They add to about 1 before amenities; amenities only ever add. */
export const WEIGHTS: Record<TripShape, Weights> = {
  family: { star: 0.3, price: 0.28, where: 0.17, refundable: 0.04, breakfast: 0.06, has: { connecting: 0.08, familyRooms: 0.08, pool: 0.06, kidsClub: 0.06, beach: 0.03 } },
  couple: { star: 0.45, price: 0.2, where: 0.28, refundable: 0.04, breakfast: 0.03, has: { spa: 0.03, pool: 0.02 } },
  solo: { star: 0.25, price: 0.4, where: 0.28, refundable: 0.04, breakfast: 0.03, has: { wifi: 0.02, gym: 0.02 } },
  group: { star: 0.3, price: 0.38, where: 0.24, refundable: 0.04, breakfast: 0.04, has: { connecting: 0.05, parking: 0.02 } },
  pilgrimage: { star: 0.18, price: 0.2, where: 0.55, refundable: 0.04, breakfast: 0.03, has: { accessible: 0.03 } },
};

export type FitContext = {
  shape: TripShape;
  /** The cheapest and the median total of the list (value is judged against them). */
  prices: { min: number; median: number };
  /** Destination key: its centre, or the Haram / the Prophet's Mosque for a pilgrimage. */
  city: string | null;
  /** How far is still "in town" (km). */
  radiusKm: number;
  /** A place the traveller asked to be near ("closer to Dubai Mall"): measured from there instead of the centre. */
  nearId?: string | null;
};

const BREAKFAST = ['BB', 'HB', 'FB', 'AI'];

/** Where "near" is measured from: the place asked for, the Haram for a pilgrimage, else the centre. */
export function fitAnchor(ctx: Pick<FitContext, 'shape' | 'city' | 'nearId'>): { place: string; lat: number; lng: number } | null {
  const asked = ctx.nearId ? landmarkById(ctx.nearId) : null;
  if (asked) return { place: asked.id, lat: asked.lat, lng: asked.lng };
  if (ctx.shape === 'pilgrimage') {
    const holy = LANDMARKS.find((l) => l.city === ctx.city && l.view === 'haram');
    if (holy) return { place: holy.id, lat: holy.lat, lng: holy.lng };
  }
  const c = ctx.city ? CITY_CENTRES[ctx.city] : undefined;
  return c ? { place: 'centre', ...c } : null;
}

/** The score and the facts behind it. Deterministic; nothing here is guessed. */
export function stayFit(o: { facts: StayFacts | null | undefined; total: number }, ctx: FitContext): StayFit {
  const w = WEIGHTS[ctx.shape];
  const f = o.facts;
  const stars = f?.stars ?? 0;
  const star = stars ? Math.min(1, Math.max(0, (stars - 1) / 4)) : 0.35;
  const spread = Math.max(1, ctx.prices.median * 1.6 - ctx.prices.min);
  const price = Math.min(1, Math.max(0, 1 - (o.total - ctx.prices.min) / spread));
  const at = fitAnchor(ctx);
  const km = at && f?.lat != null && f?.lng != null ? kmApart(at, { lat: f.lat, lng: f.lng }) : null;
  const radius = ctx.nearId || ctx.shape === 'pilgrimage' ? Math.min(ctx.radiusKm, 3) : ctx.radiusKm;
  const where = km == null ? 0.4 : Math.max(0, 1 - km / Math.max(2, radius));
  const breakfast = BREAKFAST.includes(f?.board ?? '');
  let score = w.star * star + w.price * price + w.where * where + (f?.refundable ? w.refundable : 0) + (breakfast ? w.breakfast : 0);
  const has = (Object.entries(w.has) as [StayAmenity, number][]).filter(([a]) => f?.amenities.includes(a));
  for (const [, v] of has) score += v;

  // The reasons, most telling first for this shape, each a fact that added to the score.
  const reasons: StayReason[] = [];
  const nearR: StayReason | null = km != null && at && (km <= radius * 0.5 || ctx.nearId || ctx.shape === 'pilgrimage') ? { k: 'near', place: at.place, km: Math.round(km * 10) / 10 } : null;
  const hasR = has.sort((a, b) => b[1] - a[1]).map(([a]): StayReason => ({ k: 'has', what: a }));
  const starsR: StayReason | null = stars >= 4 ? { k: 'stars', n: stars } : null;
  const valueR: StayReason | null = o.total <= ctx.prices.median ? { k: 'value' } : null;
  const boardR: StayReason | null = breakfast ? { k: 'board', board: f!.board! } : null;
  const freeR: StayReason | null = f?.refundable ? { k: 'freeCancel' } : null;
  const order: (StayReason | null)[] =
    ctx.shape === 'family' ? [...hasR, boardR, nearR, starsR, freeR, valueR]
      : ctx.shape === 'pilgrimage' ? [nearR, starsR, ...hasR, valueR, freeR]
        : ctx.shape === 'couple' ? [starsR, nearR, ...hasR, boardR, freeR]
          : [valueR, nearR, starsR, boardR, ...hasR, freeR];
  for (const r of order) if (r) reasons.push(r);
  return { shape: ctx.shape, score: Math.round(score * 1000) / 10, reasons };
}

/* ───────────── shared rooms and hostels ───────────── */

/** Room names that mean a bed among strangers or a bathroom down the hall ("8-bed mixed with external shared bathroom"). */
const SHARED_ROOM = /\bdorm(?:itory|itories|s)?\b|\bbed in (?:a |an )?(?:\d+[- ]?bed )?(?:mixed|male|female|shared|dorm)|\b\d+[- ]bed\b(?!\s*(?:apartment|flat|villa|house|suite|room|bedroom))|\bmixed (?:room|ward)\b|\b(?:mixed|female|male)[- ]only\b|\bshared (?:bath(?:room)?s?|toilets?|showers?|facilities|room|w\.?c)\b|\b(?:external|communal|common) (?:bath(?:room)?s?|toilets?|showers?)\b|\bcapsule\b|\bpod\b/i;
/** Hotelbeds room type codes (the part before the dot) for a dorm or a bed: "DOR.ST", "BED.MX". */
const SHARED_ROOM_CODE = /^(?:DOR|BED|SHR|DRM)\b/i;
/** Hostels by category code ("HS", "HSR1", Hotelbeds' hostel classes), category name or accommodation type. */
const HOSTEL_CATEGORY = /^HS(?:R\d?|\d)?$|^ALBER/i;
const HOSTEL_WORDS = /\bhostels?\b|\bbackpackers?\b|\byouth hostel\b|\bauberge de jeunesse\b/i;

/**
 * Whether a stay is a shared room or a hostel: a dorm bed, a room with a shared bathroom, or any room in a hostel (by
 * Hotelbeds category or accommodation type, or a name that says hostel). Mada's travellers are families, couples and
 * business people: these are never a pick and stay out of the list until someone asks for shared rooms.
 */
export function sharedStay(x: { room?: string | null; roomCode?: string | null; hotelName?: string | null; categoryCode?: string | null; categoryName?: string | null; accommodationType?: string | null }): boolean {
  if (x.room && SHARED_ROOM.test(x.room)) return true;
  if (x.roomCode && SHARED_ROOM_CODE.test(x.roomCode)) return true;
  if (x.categoryCode && HOSTEL_CATEGORY.test(x.categoryCode.trim())) return true;
  if (x.accommodationType && /hostel/i.test(x.accommodationType)) return true;
  return HOSTEL_WORDS.test(`${x.categoryName ?? ''} | ${x.hotelName ?? ''}`);
}

/** Rank: higher score first, a tie to the cheaper stay, then by name so the order never wobbles. */
export function rankByFit<T extends { total: { amount: number }; name: string; fit?: StayFit | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || a.total.amount - b.total.amount || a.name.localeCompare(b.name));
}

/** A reason in the traveller's language ("Connecting rooms", "2.1 km to Dubai Mall", "5-star"). */
export function reasonLabel(r: StayReason, lang: 'en' | 'ar' = 'en'): string {
  switch (r.k) {
    case 'stars': return t('stay.stars', { n: r.n });
    case 'has': return t(`wish.has.${r.what}` as CopyKey);
    case 'board': return t(`stay.board.${r.board}` as CopyKey);
    case 'freeCancel': return t('wish.freeCancel');
    case 'value': return t('fit.value');
    case 'near': {
      const l = landmarkById(r.place);
      const place = l ? (lang === 'ar' ? l.nameAr : l.name) : t('fit.centre');
      const d = r.km < 1 ? t('ev.m', { n: Math.max(50, Math.round((r.km * 1000) / 50) * 50) }) : t('ev.km', { n: r.km < 10 ? r.km.toFixed(1).replace(/\.0$/, '') : String(Math.round(r.km)) });
      return t('ev.near', { distance: d, place });
    }
  }
}

/** "Connecting rooms, pool, 2.1 km to Dubai Mall": up to three reasons; a plain line when the facts are thin. */
export function reasonsLine(reasons: StayReason[], lang: 'en' | 'ar' = 'en', max = 3): string {
  const labels = reasons.slice(0, max).map((r) => reasonLabel(r, lang));
  if (!labels.length) return t('fit.plain');
  if (lang === 'ar') return labels.join('، ');
  // Mid-sentence in English: "connecting rooms, pool" (a word like "Wi-Fi" keeps its capital).
  return labels.map((l) => (/^[A-Z][a-z]/.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l)).join(', ');
}

/**
 * A whole list ranked for this trip: each stay's fit, the order, and exactly one "Best for you" (the best fit at 3
 * stars and up) and one "Lowest price" (the cheapest). The server runs it on every search, for every supplier.
 * Shared rooms and hostels (facts.shared) are scored on their own and come after every private room: they never carry
 * a badge, and they don't set the prices value is judged against (a dorm bed would make every hotel look dear).
 */
export function rankStays<T extends { total: { amount: number }; name: string; facts?: StayFacts | null }>(list: T[], ctx: Omit<FitContext, 'prices'>): (T & { fit: StayFit; score: number; badge: 'best' | 'lowest' | null })[] {
  if (!list.length) return [];
  const privateOnes = list.filter((x) => !x.facts?.shared);
  const sharedOnes = list.filter((x) => !!x.facts?.shared);
  const rank = (xs: T[]) => {
    if (!xs.length) return [];
    const totals = xs.map((x) => x.total.amount).sort((a, b) => a - b);
    const prices = { min: totals[0]!, median: totals[Math.floor(totals.length / 2)]! };
    return rankByFit(xs.map((x) => ({ ...x, fit: stayFit({ facts: x.facts, total: x.total.amount }, { ...ctx, prices }) })));
  };
  const ranked = rank(privateOnes);
  const lowest = ranked.length ? ranked.reduce((m, y) => (y.total.amount < m.total.amount ? y : m)) : null;
  const best = ranked.find((y) => (y.facts?.stars ?? 0) >= 3 && y !== lowest) ?? ranked.find((y) => y !== lowest) ?? null;
  return [
    ...ranked.map((y) => ({ ...y, score: y.fit.score, badge: y === best ? 'best' as const : y === lowest ? 'lowest' as const : null })),
    ...rank(sharedOnes).map((y) => ({ ...y, score: y.fit.score, badge: null })),
  ];
}
