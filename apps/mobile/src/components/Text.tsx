import { Text as RNText, type TextProps } from 'react-native';
import { font, type TypeName } from '@/theme';

/** Text in one of the shared type styles. `v="display"` is Instrument Serif: one per screen, for moments that should be felt. */
export function T({ v = 'body', color, style, ...rest }: TextProps & { v?: TypeName; color?: string }) {
  return <RNText {...rest} style={[font(v, color), style]} />;
}
