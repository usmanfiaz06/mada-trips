import { FadeInDown } from 'react-native-reanimated';

/**
 * The prototype's `.rise` entrance (12 points up, 500 ms, its ease), staggered by `step` × 60 ms, for `entering=`.
 *
 * Phones only: on the web, Reanimated's entering animations can stall and leave the view absolutely positioned
 * (top: -120px, over the next view), so there `rise()` is nothing (rise.web.ts) and the view sits in its normal place.
 * Pair it with `style={riseStyle(step)}` (motion.ts) to get the same movement on the web as a plain CSS animation.
 */
export const rise = (step = 0) => FadeInDown.duration(500).delay(step * 60).withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
