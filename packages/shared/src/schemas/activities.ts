import { z } from 'zod';
import { Id, IsoDateTime, IsoDay, Money } from './common';
import { BookingRequestView } from './booking';
import { PlaceAttribution, PlaceImage } from './places';

/*
 * Things to do: real, current things for any city, from sources we're allowed to use.
 *
 *  - Places worth a visit (museums, viewpoints, parks, old towns, big mosques…) come from OpenStreetMap (ODbL),
 *    described and pictured through Wikidata (CC0) and Wikimedia Commons (per-file free licences), ranked by
 *    Wikipedia pageviews and Wikidata sitelinks. Loaded and refreshed on a schedule (platform/src/lib/app/activities).
 *  - Bookable experiences come from partner APIs behind supplier adapters: Hotelbeds Activities first, then
 *    GetYourGuide and Viator when keys are set. "Book with Mada" always makes a desk request; nobody is sent to a
 *    partner's site.
 *  - What's on: events from Ticketmaster's Discovery API where it covers the city, and a list the desk curates
 *    (Saudi events have no open API).
 *  - Today: Open-Meteo's forecast turns very hot or rainy days towards indoor ideas; prayer times are worked out on
 *    the phone and server alike (prayerTimes in activities-logic.ts).
 */

export const ActivityKind = z.enum(['attraction', 'museum', 'gallery', 'viewpoint', 'park', 'theme_park', 'zoo', 'aquarium', 'water_park', 'historic', 'mosque']);
export type ActivityKind = z.infer<typeof ActivityKind>;

/** A place worth a visit, from open data. */
export const Activity = z.object({
  /** "osm:n123", "osm:w456", "osm:r789". */
  id: z.string().regex(/^osm:[nwr]\d+$/),
  placeId: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  kind: ActivityKind,
  lat: z.number(),
  lon: z.number(),
  /** Wikidata's one-line description, unmodified. */
  summary: z.string().nullable(),
  summaryAr: z.string().nullable(),
  image: PlaceImage.nullable(),
  /** Our own photo key (apps/mobile/assets/photos), for places we know by hand. Wins over `image`. */
  photo: z.string().nullable(),
  /** OpenStreetMap's opening_hours, as mapped ("Tu-Su 09:00-17:00"). */
  hours: z.string().nullable(),
  /** Open at the moment we answered, in the city's time. Null when the hours are unknown or too complex to read. */
  openNow: z.boolean().nullable(),
  /** "17:00" when open now and we know the closing time today. */
  closesAt: z.string().nullable(),
  indoor: z.boolean(),
  /** Good with children: zoos, aquariums, parks, theme and water parks, children's and science museums. */
  family: z.boolean(),
  /** OSM fee=no. Null when unknown. */
  free: z.boolean().nullable(),
  website: z.url().nullable(),
  wikipedia: z.url().nullable(),
  /** 0–100 within the city: Wikipedia pageviews, Wikidata sitelinks, a photo. */
  popularity: z.number().int().min(0).max(100),
  /** From the hotel (or wherever `near` pointed), straight line. */
  distanceKm: z.number().nonnegative().nullable(),
  attributions: z.array(PlaceAttribution),
});
export type Activity = z.infer<typeof Activity>;

export const ExperienceSupplier = z.enum(['hotelbeds', 'getyourguide', 'viator']);
export type ExperienceSupplier = z.infer<typeof ExperienceSupplier>;

/** Something bookable from a partner: a tour, a ticket, a class. Priced by the partner, booked by the desk. */
export const Experience = z.object({
  /** "hotelbeds:E-E10-PF2SHOW" */
  id: z.string().regex(/^(hotelbeds|getyourguide|viator):[\w.~-]{1,80}$/),
  supplier: ExperienceSupplier,
  /** The supplier's own code for the product (Hotelbeds activity code, GYG tour id, Viator product code). */
  code: z.string(),
  /** Hotelbeds: the modality we'd book (cheapest that fits), so the desk can book it in one step. */
  modality: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  image: z.object({ url: z.url(), credit: z.string() }).nullable(),
  photo: z.string().nullable(),
  /** From this, per adult, in SAR (converted by the supplier or the desk's rate table). */
  priceFrom: Money,
  durationMin: z.number().int().positive().nullable(),
  /** Out of 5. */
  rating: z.number().min(0).max(5).nullable(),
  reviews: z.number().int().nonnegative().nullable(),
  family: z.boolean(),
  /** Youngest age allowed, when the supplier says. */
  minAge: z.number().int().min(0).max(99).nullable(),
  /** Free cancellation until shortly before, when the supplier says so. */
  freeCancel: z.boolean().nullable(),
});
export type Experience = z.infer<typeof Experience>;

/** Something on for a few days: a concert, a season, a festival. */
export const WhatsOn = z.object({
  /** "desk:<uuid>" or "tm:<ticketmaster id>". */
  id: z.string().regex(/^(desk|tm):[\w-]{1,80}$/),
  source: z.enum(['desk', 'ticketmaster']),
  placeId: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  startsOn: IsoDay,
  endsOn: IsoDay,
  /** "20:30", when the event has one start time. */
  time: z.string().nullable(),
  venue: z.string().nullable(),
  image: z.object({ url: z.url(), credit: z.string().nullable() }).nullable(),
  photo: z.string().nullable(),
  /** The organiser's page, shown as a source, never as a way to book. */
  link: z.url().nullable(),
  family: z.boolean(),
});
export type WhatsOn = z.infer<typeof WhatsOn>;

export const WeatherMood = z.enum(['hot', 'rain', 'cold', 'fine']);
export type WeatherMood = z.infer<typeof WeatherMood>;
export const TodayWeather = z.object({
  tempC: z.number(),
  maxC: z.number(),
  minC: z.number(),
  /** Percent, today. */
  rainChance: z.number().int().min(0).max(100),
  /** WMO weather code (Open-Meteo). */
  code: z.number().int(),
  mood: WeatherMood,
  /** Very hot, raining or cold: indoor things come first. */
  indoorFirst: z.boolean(),
  at: IsoDateTime,
});
export type TodayWeather = z.infer<typeof TodayWeather>;

export const NextPrayer = z.object({ name: z.enum(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']), at: z.string().regex(/^\d\d:\d\d$/) });
export type NextPrayer = z.infer<typeof NextPrayer>;

/** "Today" for someone in the city: a few ideas that suit the weather, the hour and who's with them. */
export const TodayIdeas = z.object({
  day: IsoDay,
  /** Activity ids, best first. */
  ids: z.array(z.string()).max(6),
  /** Why these: the copy key's last part (things.today.why.*). */
  why: z.enum(['hot', 'rain', 'cold', 'evening', 'open', 'family']),
  prayer: NextPrayer.nullable(),
});
export type TodayIdeas = z.infer<typeof TodayIdeas>;

const flag = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true').optional();
export const ThingsQuery = z.object({
  /** "41.0256,28.9741": sort by distance from here (the hotel, or the phone). */
  near: z.string().regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/).optional(),
  open: flag,
  family: flag,
  /** Children's ages, "3,7". From the household when a trip is given. */
  ages: z.string().regex(/^\d{1,2}(,\d{1,2}){0,9}$/).optional(),
  /** The day being planned (a trip day). Events are those on that day; "open now" only applies to today. */
  day: IsoDay.optional(),
  kind: z.enum(['all', 'see', 'indoor', 'outdoor']).default('all'),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type ThingsQuery = z.input<typeof ThingsQuery>;

export const ThingsStatus = z.enum(['ready', 'gathering', 'none']);
export const ThingsResponse = z.object({
  place: z.object({ id: z.string(), name: z.string(), nameAr: z.string().nullable(), lat: z.number(), lon: z.number(), timezone: z.string(), countryCode: z.string().length(2) }),
  /** ready, or gathering the first time anyone opens the city (ask again in a few seconds), or none found. */
  status: ThingsStatus,
  /** The day these are for, in the city. */
  day: IsoDay,
  /** The city's time now, "14:05". */
  localTime: z.string(),
  weather: TodayWeather.nullable(),
  today: TodayIdeas.nullable(),
  activities: z.array(Activity),
  experiences: z.array(Experience),
  events: z.array(WhatsOn),
  /** From the trip: where we measured "near" from. */
  near: z.object({ lat: z.number(), lon: z.number(), label: z.enum(['hotel', 'you', 'centre']) }).nullable(),
  /** Children's ages we filtered for. */
  ages: z.array(z.number().int()),
  attributions: z.array(PlaceAttribution),
  fetchedAt: IsoDateTime.nullable(),
});
export type ThingsResponse = z.infer<typeof ThingsResponse>;

/** What "Book with Mada" asks the desk for. */
export const ThingRef = z.object({
  kind: z.enum(['activity', 'experience', 'event']),
  id: z.string().min(3).max(100),
});
export type ThingRef = z.infer<typeof ThingRef>;

export const BookThingRequest = z.object({
  ref: ThingRef,
  placeId: z.string().regex(/^\d{1,10}$/),
  day: IsoDay.optional(),
  /** How many are going, when they haven't picked people. */
  travellers: z.number().int().min(1).max(30).optional(),
  travellerIds: z.array(Id).max(30).default([]),
  /** Children's ages, so the desk prices child tickets. */
  ages: z.array(z.number().int().min(0).max(17)).max(10).default([]),
  tripId: Id.optional(),
  message: z.string().trim().min(1).max(600).optional(),
  clientId: z.string().min(8).max(80),
});
export type BookThingRequest = z.input<typeof BookThingRequest>;
export const BookThingResponse = z.object({ request: BookingRequestView, message: z.string() });
export type BookThingResponse = z.infer<typeof BookThingResponse>;

/** "Add to my plan": an idea on a day of the itinerary. Not booked, not held. */
export const TripIdea = z.object({
  id: Id,
  tripId: Id,
  ref: ThingRef,
  day: IsoDay.nullable(),
  title: z.string(),
  sub: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type TripIdea = z.infer<typeof TripIdea>;
export const AddTripIdeaRequest = z.object({
  ref: ThingRef,
  placeId: z.string().regex(/^\d{1,10}$/),
  day: IsoDay.nullable().default(null),
});
export type AddTripIdeaRequest = z.input<typeof AddTripIdeaRequest>;
export const TripIdeasResponse = z.object({ ideas: z.array(TripIdea) });
export type TripIdeasResponse = z.infer<typeof TripIdeasResponse>;

/** The desk's "What's on" list. */
export const WhatsOnInput = z.object({
  placeId: z.string().regex(/^\d{1,10}$/),
  title: z.string().trim().min(2).max(120),
  titleAr: z.string().trim().max(120).nullable().default(null),
  body: z.string().trim().max(600).nullable().default(null),
  bodyAr: z.string().trim().max(600).nullable().default(null),
  startsOn: IsoDay,
  endsOn: IsoDay,
  time: z.string().regex(/^\d\d:\d\d$/).nullable().default(null),
  venue: z.string().trim().max(120).nullable().default(null),
  imageUrl: z.url().refine((u) => u.startsWith('https://'), 'Use an https link').nullable().default(null),
  imageCredit: z.string().trim().max(160).nullable().default(null),
  link: z.url().refine((u) => u.startsWith('https://'), 'Use an https link').nullable().default(null),
  family: z.boolean().default(false),
}).refine((v) => v.endsOn >= v.startsOn, { message: 'Ends before it starts', path: ['endsOn'] })
  .refine((v) => !v.imageUrl || !!v.imageCredit, { message: 'Say whose photo it is', path: ['imageCredit'] });
export type WhatsOnInput = z.input<typeof WhatsOnInput>;
