import { create } from 'zustand';
import type { MrzField } from '@mada/shared';
import type { PickedFile } from './wallet';

/*
 * The passport flow's working copy (intro → camera → confirm), kept on the phone only. The two lines are read here;
 * nothing is sent until the traveller checks the details and confirms. Then the fields go (the number encrypted on
 * the server), and the photo or PDF of the page goes too only when they chose to keep a copy.
 */
export type PassportFields = { given: string; surname: string; number: string; nationality: string; dob: string; expiry: string; sex: string; issuer: string; issued: string };

export const BLANK: PassportFields = { given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '', sex: '', issuer: '', issued: '' };
/** The demo passport (the prototype's sample page): Omar's. */
export const DEMO_FIELDS: PassportFields = { given: 'OMAR', surname: 'ALHARBI', number: 'A08493141', nationality: 'Saudi Arabia', dob: '11/03/1984', expiry: '22/06/2031', sex: 'M', issuer: 'SAU', issued: '' };
export const SAMPLE_MRZ = ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', 'A08•••41<6SAU8403117M3106228<<<<<<<<<<<<<<02'] as const;

type Scan = {
  personId: string | null;
  fields: PassportFields;
  doubt: MrzField[];
  fromPhoto: boolean;
  manual: boolean;
  /** The photo or PDF of the photo page, on the phone. Sent only if `keepCopy` when they confirm. */
  copy: PickedFile | null;
  keepCopy: boolean;
  /** A file chosen on the intro ("Upload from files"), for the camera screen to read as it opens. */
  incoming: PickedFile | null;
  start: (personId: string | null) => void;
  set: (p: Partial<Omit<Scan, 'set' | 'start'>>) => void;
};

export const usePassportScan = create<Scan>((set) => ({
  personId: null,
  fields: BLANK,
  doubt: [],
  fromPhoto: false,
  manual: false,
  copy: null,
  keepCopy: true,
  incoming: null,
  start: (personId) => set({ personId, fields: BLANK, doubt: [], fromPhoto: false, manual: false, copy: null, keepCopy: true, incoming: null }),
  set: (p) => set(p),
}));

export const isPdf = (f: PickedFile | null | undefined) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
