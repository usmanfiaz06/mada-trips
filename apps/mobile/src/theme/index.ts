import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { isRTL } from '@/lib/i18n';
import { colors, fontFamilies, getDisplayPrefs, radii, shadows, sizes, space, typography, type TypeName } from '@mada/shared';
import { thmanyah } from './arabic-fonts';

export { colors, radii, sizes, space, typography };
export type { TypeName };

/** A text style from the shared type scale. Weight comes from the font family (one family per weight on native). */
export function font(name: TypeName, color?: string): TextStyle {
  const t = typography[name];
  const m = getDisplayPrefs().locale === 'ar' ? arabicMetrics(t.family, t.size, t.lineHeight) : { size: t.size, lineHeight: t.lineHeight, tracking: t.tracking };
  return {
    fontFamily: fontFamilies[t.family],
    fontSize: m.size,
    lineHeight: m.lineHeight,
    letterSpacing: m.tracking,
    color: color ?? ('color' in t && t.color ? colors[t.color] : colors.green),
    ...('uppercase' in t && t.uppercase ? { textTransform: 'uppercase' as const } : null),
    ...('tabular' in t && t.tabular ? { fontVariant: ['tabular-nums' as const] } : null),
  };
}

/**
 * Arabic type (COPY.md §7.4): about 2 pt larger with lines about 15% taller, body never below 16, and no letter
 * spacing (tracking breaks the joins between Arabic letters). Arabic display (Thmanyah Serif Display, or Reem Kufi as
 * the fallback) sets larger than Instrument Serif at the same size, so display styles come down a little. The hero number stays: it is digits.
 */
export function arabicMetrics(family: string, size: number, lineHeight: number) {
  if (family === 'display') {
    // Thmanyah Serif Display sits close to Instrument Serif; Reem Kufi (the fallback) sets much larger.
    const s = Math.round(size * (thmanyah ? 0.96 : 0.86));
    return { size: s, lineHeight: Math.round(s * (thmanyah ? 1.32 : 1.4)), tracking: 0 };
  }
  if (size >= 60) return { size, lineHeight, tracking: 0 };
  // Headlines keep their size (the layouts are tight); text grows a point. Lines open up for the marks.
  if (size >= 24) return { size, lineHeight: Math.max(Math.round(lineHeight * 1.1), Math.round(size * 1.32)), tracking: 0 };
  const s = size + 1;
  return { size: s, lineHeight: Math.max(Math.round(lineHeight * 1.15), Math.round(s * 1.5)), tracking: 0 };
}

/** Shadows as CSS box-shadow, which React Native supports on iOS, Android (new architecture) and web. */
export function shadow(name: keyof typeof shadows): ViewStyle {
  const s = shadows[name];
  const hex = Math.round(s.opacity * 255).toString(16).padStart(2, '0');
  return { boxShadow: `0px ${s.offsetY}px ${s.radius}px -${Math.round(s.radius / 2)}px ${s.color}${hex}` };
}

export const fontsToLoad = fontFamilies;
export { fontFamilies as ff } from '@mada/shared';

/**
 * Text aligned to the end of the line (right in English, left in Arabic). Native swaps 'right' itself in
 * right-to-left; the web build doesn't, so it gets the mirrored value.
 */
export const textEnd = (): 'left' | 'right' => (Platform.OS === 'web' && isRTL() ? 'left' : 'right');
/** Text pinned to the physical left whatever the language: machine-readable lines, codes drawn as on paper. */
export const textLeft = (): 'left' | 'right' => (Platform.OS !== 'web' && isRTL() ? 'right' : 'left');
/** Text pinned to the physical right: the start of a right-to-left line, for a Latin-only line inside Arabic. */
export const textRight = (): 'left' | 'right' => (Platform.OS !== 'web' && isRTL() ? 'left' : 'right');
