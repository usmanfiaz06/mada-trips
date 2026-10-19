import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

/** A springy pop in (the eSIM's tick) on a phone, unless Reduce Motion; the web's is CSS in `style` (PopIn.web.tsx). */
export function PopIn({ still, style, children }: { still?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <Animated.View entering={still ? undefined : ZoomIn.springify().damping(12)} style={style}>{children}</Animated.View>;
}
