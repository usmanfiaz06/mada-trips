import { z } from 'zod';
import { CURRENCY, MAX_HALALAS } from '../money';
import { isIsoDay } from '../dates';
import { E164_SAUDI_MOBILE } from '../phone';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** A calendar day, "2027-03-09". */
export const IsoDay = z.string().refine(isIsoDay, { message: 'Expected a calendar day as YYYY-MM-DD' });
/** An instant with a zone offset or Z. */
export const IsoDateTime = z.iso.datetime({ offset: true });
/** A wall-clock time at a place, "2027-03-09T09:40", paired with an IANA zone. */
export const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:MM');
export const TimeZone = z.string().min(3).max(64);

export const HalalasAmount = z.number().int().refine((n) => Math.abs(n) <= MAX_HALALAS, { message: 'Amount out of range' });
export const Money = z.object({ amount: HalalasAmount, currency: z.literal(CURRENCY) });
export type Money = z.infer<typeof Money>;

export const Locale = z.enum(['en', 'ar']);
export const PhoneE164 = z.string().regex(E164_SAUDI_MOBILE, 'Expected a Saudi mobile number in +9665XXXXXXXX form');

export const AirportCode = z.string().regex(/^[A-Z]{3}$/);
export const CarrierCode = z.string().regex(/^([A-Z][A-Z0-9]|[0-9][A-Z])$/);
export const FlightNumber = z.string().regex(/^([A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}$/);
/** ISO 3166-1 alpha-3 as printed in passports ("SAU", "PHL"). */
export const CountryCode3 = z.string().regex(/^[A-Z]{3}$/);
/** A supplier booking reference, shown in full and copyable. */
export const BookingRef = z.string().regex(/^[A-Z0-9]{5,8}$/);

/** A named person who acted. Only ever set when that person really did the thing (COPY.md §1). */
export const AgentRef = z.object({ id: z.string(), name: z.string(), photoUrl: z.url().nullable() });
export type AgentRef = z.infer<typeof AgentRef>;

/** Cursor pagination for every list endpoint. */
export const Page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), next: z.string().nullable() });
