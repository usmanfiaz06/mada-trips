import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { rise } from '@/lib/motion';

/** A view with the rise entrance (motion.ts) on a phone; on the web a plain view (Entering.web.tsx). */
export function Entering({ step = 0, style, children }: { step?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <Animated.View entering={rise(step)} style={style}>{children}</Animated.View>;
}
