import { authCopyAr } from './auth.ar';
import { arSections } from './ar';

/** Every Arabic string: the sections in ./ar and sign-in's (auth.ar.ts). Read through ./index.ts (installCatalogue). */
export const arCatalogue: Readonly<Record<string, string>> = { ...arSections, ...authCopyAr };
