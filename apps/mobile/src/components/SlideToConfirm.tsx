import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { buzz, tick } from '@/lib/haptics';
import { colors, font, shadow, sizes } from '@/theme';
import { Sun } from './Sun';
import { T } from './Text';

const PAD = 4;
const KNOB = sizes.sliderKnob;
const SPRING = Easing.bezier(0.2, 0.9, 0.25, 1.15);

/**
 * Slide to confirm (EXPERIENCE.md §4.2): the commitment gesture for anything that costs money. Drag the sun across;
 * ticks strengthen at 25/50/75%, a firm thunk on release past 90%. Screen readers get a single "activate" action.
 */
export function SlideToConfirm({ label, busyLabel, busy, disabled, onConfirm }: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; onConfirm: () => void }) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const ticks = useSharedValue(0);
  const max = Math.max(1, width - KNOB - PAD * 2);

  const confirm = () => { buzz('thunk'); onConfirm(); };

  const pan = Gesture.Pan()
    .enabled(!disabled && !busy && width > 0)
    .onBegin(() => { ticks.set(0); })
    .onChange((e) => {
      x.set(Math.min(max, Math.max(0, x.get() + e.changeX)));
      const p = x.get() / max;
      while (ticks.get() < 3 && p >= [0.25, 0.5, 0.75][ticks.get()]!) { scheduleOnRN(tick, ticks.get() as 0 | 1 | 2); ticks.set(ticks.get() + 1); }
    })
    .onEnd(() => {
      if (x.get() / max > 0.9) { x.set(withTiming(max, { duration: 120 })); scheduleOnRN(confirm); }
      else x.set(withTiming(0, { duration: 450, easing: SPRING }));
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: busy ? max : x.get() }] }));
  const fill = useAnimatedStyle(() => ({ width: (busy ? max : x.get()) + KNOB + PAD * 2 }));
  const text = useAnimatedStyle(() => ({ opacity: busy ? 1 : interpolate(x.get(), [0, max / 1.7], [1, 0], 'clamp') }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, disabled ? { opacity: 0.45 } : null]}
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate' && !disabled && !busy) confirm(); }}
    >
      <Animated.View style={[styles.fill, fill]} />
      <Animated.View style={[styles.labelWrap, busy ? null : { paddingStart: 44 }, text]} pointerEvents="none">
        {busy ? <ActivityIndicator color={colors.green} style={{ marginEnd: 10 }} /> : null}
        <T style={font('button', busy ? colors.green : colors.mist)}>{busy ? busyLabel ?? label : label}</T>
      </Animated.View>
      {!busy && (
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.knob, shadow('knob'), knob]} hitSlop={12}>
            <Sun width={30} color={colors.green} />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: sizes.slider, borderRadius: 999, backgroundColor: colors.green, overflow: 'hidden', justifyContent: 'center', alignSelf: 'stretch' },
  fill: { position: 'absolute', start: 0, top: 0, bottom: 0, borderRadius: 999, backgroundColor: colors.gold },
  labelWrap: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  knob: { position: 'absolute', start: PAD, top: PAD, width: KNOB, height: KNOB, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
});
