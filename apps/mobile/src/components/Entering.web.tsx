import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** The web has no Reanimated entrance here (motion.ts): a plain view, with whatever CSS rise the style carries. */
export function Entering({ style, children }: { step?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={style}>{children}</View>;
}
