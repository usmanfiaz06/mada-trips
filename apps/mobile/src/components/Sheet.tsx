import { useCallback, useEffect, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { buzz } from '@/lib/haptics';
import { colors, radii } from '@/theme';
import { useBottomInset } from './Layout';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Decisions happen in bottom sheets over their context, within thumb reach (EXPERIENCE.md §4.3).
 * Opens with the prototype's ease, closes on a tap outside or a pull down past 80 points.
 */
export function Sheet({ visible, onClose, children, label }: { visible: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const { height } = useWindowDimensions();
  const bottom = useBottomInset();
  const y = useSharedValue(height);
  const shade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      buzz('tap');
      y.value = height;
      y.value = withTiming(0, { duration: 450, easing: EASE });
      shade.value = withTiming(1, { duration: 250 });
    }
  }, [visible, height, y, shade]);

  const close = useCallback(() => {
    shade.value = withTiming(0, { duration: 200 });
    y.value = withTiming(height, { duration: 260, easing: EASE }, (done) => { if (done) scheduleOnRN(onClose); });
  }, [height, onClose, shade, y]);

  const pan = Gesture.Pan()
    .onChange((e) => { y.value = Math.max(0, y.value + e.changeY); })
    .onEnd((e) => {
      if (y.value > 80 || e.velocityY > 800) {
        shade.value = withTiming(0, { duration: 200 });
        y.value = withTiming(height, { duration: 220 }, (done) => { if (done) scheduleOnRN(onClose); });
      } else {
        y.value = withTiming(0, { duration: 250, easing: EASE });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: shade.value }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, shadeStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { maxHeight: height * 0.88, paddingBottom: 28 + bottom }, sheetStyle]} accessibilityViewIsModal accessibilityLabel={label}>
          <GestureDetector gesture={pan}>
            <View style={styles.grabZone}><View style={styles.grab} /></View>
          </GestureDetector>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.shade },
  sheet: { position: 'absolute', start: 0, end: 0, bottom: 0, backgroundColor: colors.paper, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  grabZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  grab: { width: 40, height: 5, borderRadius: 999, backgroundColor: colors.grab },
  body: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
});
