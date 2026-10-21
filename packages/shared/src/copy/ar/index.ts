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
import { arLanguage } from './language';
import { arThings } from './things';
import { arStore } from './store';
import { arTransfers } from './transfers';
import { arBeta } from './beta';
import { arWords } from './words';
import { arAskFlow } from './askFlow';
import { arStays } from './stays';
import { arNow } from './now';
import { arAskChat } from './askChat';
import { arAskMemory } from './askMemory';
import { arAskDocs } from './askDocs';
import { arTodayIdeas } from './todayIdeas';
import { arOutcomes } from './outcomes';
import { arOffline } from './offline';
import { arUmrah } from './umrah';
import { arNative } from './native';
import { arEsim } from './esim';
import { arGuest } from './guest';
import { arAskHeard } from './askHeard';
import { arPayFamily } from './payFamily';
import { arWaiting } from './waiting';

export const arSections: Readonly<Record<string, string>> = {
  ...arWallet,
  ...arPayFamily,
  ...arCircles,
  ...arBooking,
  ...arDesk,
  ...arTripsToday,
  ...arTripsUi,
  ...arTripsUi2,
  ...arTrips,
  ...arResilience,
  ...arPlaces,
  ...arLanguage,
  ...arThings,
  ...arStore,
  ...arTransfers,
  ...arBeta,
  ...arWords,
  ...arAskFlow,
  ...arStays,
  ...arNow,
  ...arAskChat,
  ...arAskMemory,
  ...arAskDocs,
  ...arTodayIdeas,
  ...arAskHeard,
  ...arAskHeard,
  ...arOutcomes,
  ...arOffline,
  ...arUmrah,
  ...arNative,
  ...arEsim,
  ...arGuest,
  ...arWaiting,
  ...arCommon,
} as Record<string, string>;
