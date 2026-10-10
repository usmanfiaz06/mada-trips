import { Children, useState } from 'react';
import { StyleSheet, Text as RNText, View, type TextProps, type TextStyle } from 'react-native';
import { typography } from '@mada/shared';
import { font, type TypeName } from '@/theme';
import { isRTL } from '@/lib/i18n';

const BALANCED: ReadonlySet<TypeName> = new Set(['hero', 'displayXL', 'display', 'displaySmall', 'h1', 'title']);
/** Average glyph width as a share of the font size, for the balance estimate. */
const AVG = { display: 0.33, ui: 0.45 };

/**
 * Text in one of the shared type styles. `v="display"` is Instrument Serif: one per screen, for moments that should
 * be felt. Headlines are balanced across lines (COPY.md §7.3: no single word on the last line), like CSS
 * `text-wrap: balance` in the prototype: the line width is narrowed to share the words evenly.
 */
const ARABIC = /[\u0600-\u06FF]/;

/**
 * Arabic safety net for styles written with Latin metrics: Arabic marks sit above and below the line, so a tight
 * line height clips them, and letter spacing breaks the joins between letters (COPY.md §7.4).
 */
function arabicFix(flat: TextStyle, text: string): TextStyle | null {
  if (!isRTL()) return null;
  const size = flat.fontSize ?? 16;
  const out: TextStyle = {};
  if (flat.lineHeight && flat.lineHeight < size * 1.4) out.lineHeight = Math.round(size * 1.45);
  if (flat.letterSpacing && ARABIC.test(text)) out.letterSpacing = 0;
  return Object.keys(out).length ? out : null;
}

export function T({ v = 'body', color, style: styleIn, balance, ...rest }: TextProps & { v?: TypeName; color?: string; balance?: boolean }) {
  const [width, setWidth] = useState(0);
  let style = styleIn;
  const base = font(v, color);
  const text = Children.toArray(rest.children).filter((c) => typeof c === 'string' || typeof c === 'number').join('');
  const flat = StyleSheet.flatten([base, style]) as TextStyle;
  const size = flat.fontSize ?? typography[v].size;
  const fix = arabicFix(flat, text);
  if (fix) style = [style, fix];
  const doBalance = (balance ?? (BALANCED.has(v) || size >= 24)) && text.length > 12 && !rest.numberOfLines;
  if (!doBalance) return <RNText {...rest} style={[base, style]} />;

  const serif = String(flat.fontFamily ?? '').startsWith('Instrument');
  const estimate = text.length * size * (serif ? AVG.display : AVG.ui);
  let maxWidth: number | undefined;
  if (width > 0 && estimate > width) {
    const lines = Math.ceil(estimate / width);
    maxWidth = Math.min(width, (estimate / lines) * 1.06);
  }
  const align = flat.textAlign === 'center' ? 'center' : 'flex-start';
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ alignItems: align }}>
      <RNText {...rest} style={[base, style, maxWidth ? { maxWidth } : null]} />
    </View>
  );
}
