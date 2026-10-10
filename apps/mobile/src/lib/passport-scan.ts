import { create } from 'zustand';
import type { MrzField } from '@mada/shared';

/*
 * The passport flow's working copy (intro → camera → confirm), kept on the phone only. Nothing is sent until the
 * traveller checks the details and taps Save; then only the fields go, never the photo.
 */
export type PassportFields = { given: string; surname: string; number: string; nationality: string; dob: string; expiry: string; sex: string; issuer: string };

export const BLANK: PassportFields = { given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '', sex: '', issuer: '' };
/** The demo passport (the prototype's sample page): Omar's. */
export const DEMO_FIELDS: PassportFields = { given: 'OMAR', surname: 'ALHARBI', number: 'A08493141', nationality: 'Saudi Arabia', dob: '11/03/1984', expiry: '22/06/2031', sex: 'M', issuer: 'SAU' };
export const SAMPLE_MRZ = ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', 'A08•••41<6SAU8403117M3106228<<<<<<<<<<<<<<02'] as const;

type Scan = {
  personId: string | null;
  fields: PassportFields;
  doubt: MrzField[];
  fromPhoto: boolean;
  manual: boolean;
  start: (personId: string | null) => void;
  set: (p: Partial<Omit<Scan, 'set' | 'start'>>) => void;
};

export const usePassportScan = create<Scan>((set) => ({
  personId: null,
  fields: BLANK,
  doubt: [],
  fromPhoto: false,
  manual: false,
  start: (personId) => set({ personId, fields: BLANK, doubt: [], fromPhoto: false, manual: false }),
  set: (p) => set(p),
}));
