import type { TextStyle, ViewStyle } from 'react-native';
import { colors, fontFamilies, radii, shadows, sizes, space, typography, type TypeName } from '@mada/shared';

export { colors, radii, sizes, space, typography };
export type { TypeName };

/** A text style from the shared type scale. Weight comes from the font family (one family per weight on native). */
export function font(name: TypeName, color?: string): TextStyle {
  const t = typography[name];
  return {
    fontFamily: fontFamilies[t.family],
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: t.tracking,
    color: color ?? ('color' in t && t.color ? colors[t.color] : colors.green),
    ...('uppercase' in t && t.uppercase ? { textTransform: 'uppercase' as const } : null),
    ...('tabular' in t && t.tabular ? { fontVariant: ['tabular-nums' as const] } : null),
  };
}

/** Shadows as CSS box-shadow, which React Native supports on iOS, Android (new architecture) and web. */
export function shadow(name: keyof typeof shadows): ViewStyle {
  const s = shadows[name];
  const hex = Math.round(s.opacity * 255).toString(16).padStart(2, '0');
  return { boxShadow: `0px ${s.offsetY}px ${s.radius}px -${Math.round(s.radius / 2)}px ${s.color}${hex}` };
}

export const fontsToLoad = fontFamilies;
export { fontFamilies as ff } from '@mada/shared';
