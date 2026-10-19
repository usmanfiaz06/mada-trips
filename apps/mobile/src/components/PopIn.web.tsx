import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** The web's pop is the CSS animation the caller puts in `style`. */
export function PopIn({ style, children }: { still?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={style}>{children}</View>;
}
