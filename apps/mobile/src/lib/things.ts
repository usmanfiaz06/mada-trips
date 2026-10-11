import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  BookThingResponse, RideThingResponse, ThingsResponse, TripIdea, TripIdeasResponse, formatSar, localizeDigits, type Activity, type AddTripIdeaRequest, type BookThingRequest, type Experience, type RideThingRequest,
  type ThingsQuery, type WhatsOn,
} from '@mada/shared';
import { z } from 'zod';
import { request } from './api';
import { t } from './i18n';
import { persistQueries } from './net/persist';

/*
 * Things to do: a city's open-data places, bookable experiences, what's on and today's ideas, in a trip or not.
 * Kept on the phone for a week (FLOWS.md §12: the itinerary's ideas work without signal), refetched when online.
 */

const DAY = 86_400_000;
persistQueries('things', 7 * DAY);

const qs = (q: ThingsQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '' && v !== false && v !== 'all') p.set(k, v === true ? '1' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const thingsApi = {
  forPlace: (id: string, q: ThingsQuery = {}) => request({ method: 'GET', path: `/places/${encodeURIComponent(id)}/things${qs(q)}` }, ThingsResponse),
  forTrip: (tripId: string, q: ThingsQuery = {}) => request({ method: 'GET', path: `/trips/${tripId}/things${qs(q)}` }, ThingsResponse),
  book: (b: BookThingRequest) => request({ method: 'POST', path: '/things/book', body: b }, BookThingResponse),
  ride: (b: RideThingRequest) => request({ method: 'POST', path: '/things/ride', body: b }, RideThingResponse),
  ideas: (tripId: string) => request({ method: 'GET', path: `/trips/${tripId}/ideas` }, TripIdeasResponse),
  addIdea: (tripId: string, b: AddTripIdeaRequest) => request({ method: 'POST', path: `/trips/${tripId}/ideas`, body: b }, z.object({ idea: TripIdea })),
  removeIdea: (tripId: string, ideaId: string) => request({ method: 'DELETE', path: `/trips/${tripId}/ideas/${ideaId}` }, z.object({ ok: z.boolean() })),
};

export const thingsKeys = {
  list: (scope: 'place' | 'trip', id: string, q: ThingsQuery) => ['things', scope, id, q] as const,
  ideas: (tripId: string) => ['things', 'ideas', tripId] as const,
};

export type ThingsScope = { placeId: string; tripId?: string | null };

export function useThings(scope: ThingsScope, q: ThingsQuery = {}) {
  const trip = scope.tripId ?? null;
  return useQuery({
    queryKey: thingsKeys.list(trip ? 'trip' : 'place', trip ?? scope.placeId, q),
    queryFn: () => (trip ? thingsApi.forTrip(trip, q) : thingsApi.forPlace(scope.placeId, q)),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    // The first visit to a city gathers in the background: ask again shortly.
    refetchInterval: (query) => (query.state.data?.status === 'gathering' ? 6000 : false),
  });
}

export function useTripIdeas(tripId: string | null | undefined) {
  return useQuery({ queryKey: thingsKeys.ideas(tripId ?? ''), enabled: !!tripId, queryFn: async () => (await thingsApi.ideas(tripId!)).ideas });
}

export function useIdeaMutations(tripId: string | null | undefined) {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['things', 'ideas', tripId ?? ''] });
    void qc.invalidateQueries({ queryKey: ['trips'] });
  };
  const add = useMutation({ mutationFn: (b: AddTripIdeaRequest) => thingsApi.addIdea(tripId!, b), onSuccess: done });
  const remove = useMutation({ mutationFn: (ideaId: string) => thingsApi.removeIdea(tripId!, ideaId), onSuccess: done });
  return { add, remove };
}

/* ───────── words ───────── */

export type Thing = { kind: 'activity'; a: Activity } | { kind: 'experience'; e: Experience } | { kind: 'event'; w: WhatsOn };
export const thingId = (x: Thing) => (x.kind === 'activity' ? x.a.id : x.kind === 'experience' ? x.e.id : x.w.id);
export const thingTitle = (x: Thing, ar: boolean) => (x.kind === 'activity' ? (ar && x.a.nameAr) || x.a.name : x.kind === 'experience' ? x.e.title : x.w.title);

export function openLine(a: Activity): string {
  if (a.openNow === true) return a.closesAt ? t('things.openUntil', { time: localizeDigits(a.closesAt) }) : t('things.openAllDay');
  if (a.openNow === false) return t('things.closedNow');
  return a.hours ? '' : t('things.hoursUnknown');
}

export function durationLine(min: number | null): string {
  if (!min) return '';
  if (min >= 1440) return t('things.duration.days', { n: Math.round(min / 1440) });
  if (min < 60) return t('things.duration.min', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t('things.duration.hm', { h, m }) : t('things.duration.h', { n: h });
}

export const priceLine = (e: Experience) => t('things.from', { price: formatSar(e.priceFrom.amount) });
export const SUPPLIER_NAME: Record<Experience['supplier'], string> = { hotelbeds: 'Hotelbeds', getyourguide: 'GetYourGuide', viator: 'Viator' };
