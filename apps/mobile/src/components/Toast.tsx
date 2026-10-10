import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useToast } from '@/lib/toast';
import { colors, shadow, ff } from '@/theme';
import { useBottomInset } from './Layout';
import { T } from './Text';

/** One quiet line at the bottom: "New code sent.", "Sign-in cancelled. Nothing was shared." */
export function ToastHost() {
  const { text, id } = useToast();
  const bottom = useBottomInset();
  useEffect(() => {}, [id]);
  if (!text) return null;
  return (
    <Animated.View key={id} entering={FadeInDown.duration(300)} exiting={FadeOutDown.duration(200)} style={[styles.toast, shadow('focal'), { bottom: 104 + bottom }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <T v="callout" color={colors.mist} style={{ fontFamily: ff.ui500 }}>{text}</T>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', start: 20, end: 20, zIndex: 60, backgroundColor: colors.green, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16 },
});
