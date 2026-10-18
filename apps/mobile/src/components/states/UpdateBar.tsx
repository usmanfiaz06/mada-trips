import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { t } from '@/lib/i18n';
import { refreshToNew, useShellUpdate } from '@/lib/net/shell';
import { colors, ff, radii, shadow } from '@/theme';
import { T } from '../Text';

/*
 * The web app was deployed again while this tab was open (lib/net/shell.ts): one small calm bar, "A new version is
 * ready · Refresh", instead of quietly mixing the old app with the new. Nothing reloads by itself, so nothing typed is
 * lost; the next cold open is the new version anyway. Web only.
 */
export function UpdateBar() {
  const ready = useShellUpdate((s) => s.ready);
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'web' || !ready) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 100 }]}>
      <Animated.View entering={FadeIn.duration(300)} style={[styles.bar, shadow('card')]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="update-bar">
        <T v="small" style={{ flex: 1, color: colors.paper }}>{t('off.newVersion')}</T>
        <Pressable accessibilityRole="button" onPress={refreshToNew} hitSlop={8} style={styles.go} testID="update-refresh">
          <T v="caption" style={{ color: colors.green, fontFamily: ff.ui600 }}>{t('off.refresh')}</T>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: 420, width: '100%', paddingVertical: 10, paddingStart: 16, paddingEnd: 10, borderRadius: radii.card, backgroundColor: colors.green },
  go: { paddingHorizontal: 14, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
