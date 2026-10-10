import { Children, useState } from 'react';
import { StyleSheet, Text as RNText, View, type TextProps, type TextStyle } from 'react-native';
import { typography } from '@mada/shared';
import { font, type TypeName } from '@/theme';

const BALANCED: ReadonlySet<TypeName> = new Set(['hero', 'displayXL', 'display', 'displaySmall', 'h1', 'title']);
/** Average glyph width as a share of the font size, for the balance estimate. */
const AVG = { display: 0.33, ui: 0.45 };

/**
 * Text in one of the shared type styles. `v="display"` is Instrument Serif: one per screen, for moments that should
 * be felt. Headlines are balanced across lines (COPY.md §7.3: no single word on the last line), like CSS
 * `text-wrap: balance` in the prototype: the line width is narrowed to share the words evenly.
 */
export function T({ v = 'body', color, style, balance, ...rest }: TextProps & { v?: TypeName; color?: string; balance?: boolean }) {
  const [width, setWidth] = useState(0);
  const base = font(v, color);
  const text = Children.toArray(rest.children).filter((c) => typeof c === 'string' || typeof c === 'number').join('');
  const flat = StyleSheet.flatten([base, style]) as TextStyle;
  const size = flat.fontSize ?? typography[v].size;
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
