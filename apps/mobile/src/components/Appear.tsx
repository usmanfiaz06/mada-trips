import type { ComponentProps } from 'react';
import type { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, FadeOutDown, FadeOutUp, SlideInUp } from 'react-native-reanimated';

export type AppearIn = 'fade' | 'fadeDown' | 'fadeUp' | 'slideUp';
export type AppearOut = 'fade' | 'fadeDown' | 'fadeUp';

const IN = { fade: FadeIn, fadeDown: FadeInDown, fadeUp: FadeInUp, slideUp: SlideInUp };
const OUT = { fade: FadeOut, fadeDown: FadeOutDown, fadeUp: FadeOutUp };

/**
 * A view that comes in (and goes) with one of Reanimated's entrances, by name, on a phone. The web's (Appear.web.tsx)
 * is the same entrance in CSS, so the toast, the offline pill and the state cards don't need Reanimated there.
 */
export function Appear({ enter, ms, exit, exitMs = 200, ...props }: ComponentProps<typeof View> & { enter: AppearIn; ms: number; exit?: AppearOut; exitMs?: number }) {
  return <Animated.View entering={IN[enter].duration(ms)} exiting={exit ? OUT[exit].duration(exitMs) : undefined} {...props} />;
}
