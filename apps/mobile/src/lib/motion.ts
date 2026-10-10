import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { FadeInDown } from 'react-native-reanimated';

/** Reduce Motion replaces movement with stillness (EXPERIENCE.md §4.5). */
export function useReduceMotion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setOn).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

/** The prototype's `.rise` entrance (12 points up, 500 ms, its ease), staggered by `step` × 60 ms. */
export const rise = (step = 0) => FadeInDown.duration(500).delay(step * 60).withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
