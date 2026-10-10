import { Children, useState } from 'react';
import { StyleSheet, Text as RNText, View, type TextProps, type TextStyle } from 'react-native';
import { fontFamilies, nameIn, typography } from '@mada/shared';
import { font, textRight, type TypeName } from '@/theme';
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

function localName<C>(c: C): C {
  if (typeof c !== 'string' || !/[A-Za-z]/.test(c)) return c;
  return c.split(' · ').map((part) => {
    const lead = /^\s*/.exec(part)![0];
    const trail = /\s*$/.exec(part)![0];
    const core = part.trim();
    const named = nameIn(core, 'ar');
    return named === core ? part : `${lead}${named}${trail}`;
  }).join(' · ') as C;
}

/**
 * Arabic safety net for styles written with Latin metrics: Arabic marks sit above and below the line, so a tight
 * line height clips them, and letter spacing breaks the joins between letters (COPY.md §7.4).
 */
function arabicFix(flat: TextStyle, text: string, own: TextStyle | undefined): TextStyle | null {
  if (!isRTL()) return null;
  const fixed: TextStyle = {};
  // Reem Kufi sets much larger than Instrument Serif: a display size written in a screen's own style comes down too.
  if (own?.fontSize && flat.fontFamily === fontFamilies.display) fixed.fontSize = Math.round(own.fontSize * 0.86);
  const size = fixed.fontSize ?? flat.fontSize ?? 16;
  // An Arabic paragraph reads right to left even when it starts with a Latin name or code. A line with no Arabic at
  // all (an English chat message, a hotel's name, "14°") keeps its own direction, so its punctuation stays put, but still
  // starts at the right like the rest of the screen.
  const out: TextStyle = fixed;
  if (!flat.writingDirection) {
    if (/[A-Za-z0-9]/.test(text) && !ARABIC.test(text)) {
      out.writingDirection = 'ltr';
      if (!flat.textAlign) out.textAlign = textRight();
    } else out.writingDirection = 'rtl';
  }
  if (ARABIC.test(text) && flat.lineHeight && flat.lineHeight < size * 1.4) out.lineHeight = Math.round(size * (flat.fontFamily === fontFamilies.display ? 1.4 : 1.45));
  if (flat.letterSpacing && ARABIC.test(text)) out.letterSpacing = 0;
  return Object.keys(out).length ? out : null;
}

export function T({ v = 'body', color, style: styleIn, balance, ...rest }: TextProps & { v?: TypeName; color?: string; balance?: boolean }) {
  const [width, setWidth] = useState(0);
  let style = styleIn;
  // A place, airline or agent name (or a well-known supplier phrase) that arrived in English shows in Arabic: exact
  // matches only, also between the middle dots of a line like "Saudia · 4 travellers" (see NAMES_AR).
  if (isRTL()) rest.children = Array.isArray(rest.children) ? rest.children.map((c) => localName(c)) : localName(rest.children);
  const base = font(v, color);
  const text = Children.toArray(rest.children).filter((c) => typeof c === 'string' || typeof c === 'number').join('');
  const flat = StyleSheet.flatten([base, style]) as TextStyle;
  const size = flat.fontSize ?? typography[v].size;
  const fix = arabicFix(flat, text, styleIn ? (StyleSheet.flatten(styleIn) as TextStyle) : undefined);
  if (fix) style = [style, fix];
  const doBalance = (balance ?? (BALANCED.has(v) || size >= 24)) && text.length > 12 && !rest.numberOfLines;
  if (!doBalance) return <RNText {...rest} style={[base, style]} />;

  const serif = String(flat.fontFamily ?? '').startsWith('Instrument');
  // Arabic sets narrower per character than the Latin estimate.
  const estimate = text.length * size * (serif ? AVG.display : AVG.ui) * (isRTL() ? 0.82 : 1);
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
