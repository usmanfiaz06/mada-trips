/**
 * The Arabic catalogue, section by section, mirroring the English files. Sign-in's Arabic lives next to its English
 * (../auth.ar.ts) and is merged in ../index.ts.
 */
import { arCommon } from './common';
import { arWallet } from './wallet';
import { arCircles } from './circles';
import { arBooking } from './booking';
import { arDesk } from './desk';
import { arTripsToday } from './tripsToday';
import { arTripsUi } from './tripsUi';
import { arTripsUi2 } from './tripsUi2';
import { arTrips } from './trips';
import { arResilience } from './resilience';
import { arPlaces } from './places';

export const arSections: Readonly<Record<string, string>> = {
  ...arWallet,
  ...arCircles,
  ...arBooking,
  ...arDesk,
  ...arTripsToday,
  ...arTripsUi,
  ...arTripsUi2,
  ...arTrips,
  ...arResilience,
  ...arPlaces,
  ...arCommon,
} as Record<string, string>;
