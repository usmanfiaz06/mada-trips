import { StyleSheet, View } from 'react-native';
import type { Described } from '@/lib/net/describe';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { T } from '../Text';

/**
 * A part of a screen that didn't load, said quietly where it would have been: "This didn't load." with Try again.
 * The rest of the screen carries on. Offline gets the offline glyph and "We'll load it the moment you're back."
 */
export function InlineError({ problem, onRetry, title, testID }: { problem?: Described | null; onRetry?: () => void; title?: string; testID?: string }) {
  const offline = problem?.kind === 'offline';
  const text = title ?? (offline ? t('net.offline.title') : problem?.kind === 'supplier' || problem?.kind === 'contract' ? problem.title : t('problem.inline'));
  const sub = offline ? t('net.offline.retryOnline') : problem?.kind === 'timeout' ? t('timeout.body') : problem?.kind === 'supplier' ? problem.body : null;
  return (
    <View style={styles.row} accessibilityRole="alert" testID={testID ?? 'inline-error'}>
      <View style={styles.ic}><Icon name={offline ? 'wifiOff' : 'refund'} size={18} color={colors.goldInk} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" style={{ fontFamily: ff.ui600, color: colors.green }}>{text}</T>
        {sub ? <T v="tiny" color={colors.ink2}>{sub}</T> : null}
      </View>
      {onRetry && !offline ? <Button size="small" block={false} variant="secondary" label={t('common.tryAgain')} onPress={onRetry} style={styles.btn} testID="inline-retry" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.mist, borderWidth: 1, borderColor: 'rgba(125,93,39,0.12)' },
  ic: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldWash },
  btn: { height: 36, paddingHorizontal: 14, backgroundColor: colors.paper },
});
