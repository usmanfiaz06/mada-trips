import { StyleSheet, View } from 'react-native';
import { useFreshness } from '@/lib/net/freshness';
import { useNet } from '@/lib/net/state';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { T } from '../Text';

/**
 * "Updated 12 min ago", with a dot: green when live, gold when this is the copy saved on the phone (offline, or the
 * last refresh didn't work). Put it under a title or at the end of a card's caption row.
 */
export function StaleBadge({ updatedAt, stale, dark, testID }: { updatedAt: number | string | null | undefined; stale?: boolean; dark?: boolean; testID?: string }) {
  const label = useFreshness(updatedAt);
  const offline = useNet((s) => s.online === false);
  if (!label) return null;
  const saved = offline || stale;
  const text = saved && offline ? t('fresh.offline', { when: label.replace(/^Updated /, '') }) : label;
  return (
    <View style={[styles.pill, dark ? styles.dark : null]} accessibilityLabel={text} testID={testID ?? 'stale-badge'}>
      <View style={[styles.dot, { backgroundColor: saved ? colors.goldDeep : colors.ok }]} />
      <T v="caption" style={{ color: dark ? colors.onDark2 : colors.ink2, fontFamily: ff.ui500 }}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, height: 24, borderRadius: 999, backgroundColor: 'rgba(255,253,249,0.7)' },
  dark: { backgroundColor: 'rgba(233,226,216,0.12)' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
