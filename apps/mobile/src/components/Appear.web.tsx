import type { ComponentProps } from 'react';
import { View, type ViewStyle } from 'react-native';
import type { AppearIn, AppearOut } from './Appear';

const FROM: Record<AppearIn, object> = {
  fade: { opacity: 0 },
  fadeDown: { opacity: 0, transform: 'translateY(-16px)' },
  fadeUp: { opacity: 0, transform: 'translateY(16px)' },
  slideUp: { transform: 'translateY(-100%)' },
};
const TO: Record<AppearIn, object> = {
  fade: { opacity: 1 },
  fadeDown: { opacity: 1, transform: 'translateY(0px)' },
  fadeUp: { opacity: 1, transform: 'translateY(0px)' },
  slideUp: { transform: 'translateY(0%)' },
};

/** The same entrances as Appear.tsx, as CSS animations (the web shows no exit: the view simply goes). */
export function Appear({ enter, ms, exit: _exit, exitMs: _exitMs, style, ...props }: ComponentProps<typeof View> & { enter: AppearIn; ms: number; exit?: AppearOut; exitMs?: number }) {
  const motion = { animationKeyframes: [{ from: FROM[enter], to: TO[enter] }], animationDuration: `${ms}ms`, animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', animationFillMode: 'both' } as unknown as ViewStyle;
  return <View style={[motion, style]} {...props} />;
}
