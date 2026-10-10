import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { t } from '@/lib/i18n';
import { useNet } from '@/lib/net/state';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { Sun } from '../Sun';
import { T } from '../Text';

/**
 * After 4 seconds of waiting (2.5 on a weak connection): "Still working… This is slower than usual." with a way to
 * stop waiting. Sits where the content will appear, under the skeleton. useApiQuery's `view === 'slow'` shows it.
 */
export function SlowState({ onCancel, testID }: { onCancel?: () => void; testID?: string }) {
  const weak = useNet((s) => s.weak);
  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.row} accessibilityRole="progressbar" accessibilityLiveRegion="polite" testID={testID ?? 'slow-state'}>
      <Sun width={26} color={colors.goldDeep} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" style={{ fontFamily: ff.ui600, color: colors.green }}>{t('slow.title')}</T>
        <T v="tiny" color={colors.ink2}>{weak ? t('slow.bodyWeak') : t('slow.body')}</T>
      </View>
      {onCancel ? (
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.cancel} testID="slow-cancel">
          <Icon name="close" size={14} color={colors.ink2} />
          <T v="caption" style={{ color: colors.ink2, fontFamily: ff.ui500 }}>{t('slow.cancel')}</T>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.mist },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: 999, backgroundColor: colors.paper },
});
