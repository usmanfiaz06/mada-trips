/*
 * Thmanyah, Mada's Arabic typeface (font.thmanyah.com), when its files are on this machine.
 *
 * Thmanyah's licence allows shipping it inside the app but not re-hosting the files, and this repository is public, so
 * the files never go into git. Put the downloaded files in assets/fonts/thmanyah/ (ignored by git, included in EAS
 * builds through .easignore). metro.config.js then writes arabic-fonts.local.ts next to this file and resolves this
 * module to it. Without the files this fallback answers null and Arabic uses IBM Plex Sans Arabic and Reem Kufi.
 */
export type ArabicFonts = { display: number; ui400: number; ui500: number; ui600: number; ui700: number };
export const thmanyah: ArabicFonts | null = null;
