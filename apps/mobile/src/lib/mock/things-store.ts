import type { TripIdea } from '@mada/shared';

/* "Add to my plan" in mock mode, kept apart so both the trips mock (the itinerary) and the things mock can read it. */
export const plannedIdeas = new Map<string, TripIdea[]>();
export const plannedFor = (tripId: string) => (plannedIdeas.get(tripId) ?? []).map((i) => ({ id: i.id, day: i.day, title: i.title, sub: i.sub }));
