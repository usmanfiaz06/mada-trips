import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/*
 * A stored document (passport copy, national ID, visa, insurance), the way a person looks at a photo: pinch to zoom,
 * two fingers to move it around, double-tap to zoom in on that spot and again to go back. The image stays inside its
 * frame; a double-tap resets it. One finger is left to the sheet, so dragging it closed keeps working.
 */
const MAX = 4;
const TAP_ZOOM = 2.5;

export function ZoomImage({ uri, label, height, style, testID }: { uri: string; label: string; height: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const scale = useSharedValue(1);
  const base = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const frameW = useSharedValue(0);

  const settle = () => {
    'worklet';
    if (scale.get() < 1.02) { scale.set(withTiming(1)); tx.set(withTiming(0)); ty.set(withTiming(0)); }
    else if (scale.get() > MAX) scale.set(withTiming(MAX));
  };
  const pinch = Gesture.Pinch()
    .onStart(() => { base.set(scale.get()); })
    .onUpdate((e) => { scale.set(Math.max(0.6, Math.min(MAX + 1, base.get() * e.scale))); })
    .onEnd(() => settle());
  const pan = Gesture.Pan().minPointers(2)
    .onStart(() => { startX.set(tx.get()); startY.set(ty.get()); })
    .onUpdate((e) => { if (scale.get() > 1) { tx.set(startX.get() + e.translationX); ty.set(startY.get() + e.translationY); } });
  const doubleTap = Gesture.Tap().numberOfTaps(2)
    .onEnd((e) => {
      if (scale.get() > 1.02) { scale.set(withTiming(1)); tx.set(withTiming(0)); ty.set(withTiming(0)); return; }
      // Zoom in with the tapped spot kept under the finger (the frame's centre is the transform's origin).
      scale.set(withTiming(TAP_ZOOM));
      tx.set(withTiming((e.x - frameW.get() / 2) * (1 - TAP_ZOOM)));
      ty.set(withTiming((e.y - height / 2) * (1 - TAP_ZOOM)));
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.frame, { height }, style]} testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} onLayout={(ev) => frameW.set(ev.nativeEvent.layout.width)}>
        <Animated.View style={[StyleSheet.absoluteFill, moving]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors transition={150} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: '#0f1a16' },
});
