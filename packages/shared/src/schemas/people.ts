import { z } from 'zod';
import { CountryCode3, Id, IsoDateTime, IsoDay } from './common';

/**
 * Travellers in the household. The account holder is one of them (isSelf).
 * A passport number never travels in full: the API only ever returns it masked ("A08•••41").
 */
export const Relation = z.enum(['self', 'spouse', 'child', 'parent', 'family', 'friend', 'helper', 'colleague']);
export type Relation = z.infer<typeof Relation>;
export const Sex = z.enum(['F', 'M', 'X']);

/** Passport numbers: letters and digits, 5 to 12 long (ICAO 9303 allows up to 9 in the MRZ, some countries print more). */
export const PassportNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5,12}$/, 'Letters and digits only, as on the photo page');

export const PassportInput = z.object({
  number: PassportNumber,
  issuingCountry: CountryCode3,
  nationality: CountryCode3,
  expiry: IsoDay,
  issued: IsoDay.optional(),
  /** How it was captured, for the audit trail and to know when to ask for a re-check. */
  source: z.enum(['scan', 'manual', 'import']).default('manual'),
});
export type PassportInput = z.input<typeof PassportInput>;

export const PassportMasked = z.object({
  numberMasked: z.string(),
  issuingCountry: CountryCode3,
  nationality: CountryCode3,
  expiry: IsoDay,
  source: z.enum(['scan', 'manual', 'import']),
  updatedAt: IsoDateTime,
});
export type PassportMasked = z.infer<typeof PassportMasked>;

const NamePart = z.string().trim().min(1).max(60);

export const Person = z.object({
  id: Id,
  isSelf: z.boolean(),
  /** Exactly as on the passport, every given name. */
  givenNames: z.string(),
  surname: z.string(),
  /** The name the interface uses (COPY.md §4: first names in the interface). */
  firstName: z.string(),
  relation: Relation,
  dateOfBirth: IsoDay.nullable(),
  sex: Sex.nullable(),
  nationality: CountryCode3.nullable(),
  passport: PassportMasked.nullable(),
  createdAt: IsoDateTime,
});
export type Person = z.infer<typeof Person>;

export const CreatePersonRequest = z.object({
  givenNames: NamePart,
  surname: NamePart,
  relation: Relation.exclude(['self']),
  dateOfBirth: IsoDay.optional(),
  sex: Sex.optional(),
  nationality: CountryCode3.optional(),
  passport: PassportInput.optional(),
});
export type CreatePersonRequest = z.input<typeof CreatePersonRequest>;

export const PeopleResponse = z.object({ people: z.array(Person) });
export type PeopleResponse = z.infer<typeof PeopleResponse>;
export const PersonResponse = z.object({ person: Person });
export type PersonResponse = z.infer<typeof PersonResponse>;

/** "A08•••41": the first three and last two characters. Short numbers show only the last two. */
export function maskPassportNumber(n: string): string {
  const s = n.toUpperCase();
  if (s.length > 5) return `${s.slice(0, 3)}•••${s.slice(-2)}`;
  return `•••${s.slice(-2)}`;
}

/** "Omar" from "OMAR ABDULLAH": the first given name, capitalised. */
export function firstNameOf(givenNames: string): string {
  const first = givenNames.trim().split(/\s+/)[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}
