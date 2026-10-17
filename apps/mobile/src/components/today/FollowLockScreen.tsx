import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { TripDetail } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { followable, liveSupport, startLive, stopLive, useLive, useLiveFlight } from '@/lib/live-activity';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';

/**
 * Today's one line about the lock screen (docs/app/NATIVE.md): "Follow on lock screen" from a day before the flight,
 * "On your lock screen · Stop" while it's there. It also keeps the lock screen in step with the trip while Mada is open
 * and starts it by itself 4 hours before take-off. Nothing on the web or where the phone can't do it.
 */
export function FollowLockScreen({ trip, now }: { trip: TripDetail; now: () => number }) {
  useLiveFlight(trip, now);
  const running = useLive((s) => s.running);
  const support = liveSupport();
  if (support === 'none') return null;
  const seg = followable(trip, now());
  if (!seg) return null;
  const on = !!running[seg.id];

  if (support === 'off') {
    return (
      <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); void Linking.openSettings(); }} style={styles.row} testID="live-follow-off">
        <Icon name="lock" size={16} color={colors.ink2} />
        <T v="small" style={{ flex: 1, color: colors.ink2 }}>{t('live.follow.off')}</T>
        <T v="caption" style={styles.action}>{t('live.follow.settings')}</T>
      </Pressable>
    );
  }
  if (on) {
    return (
      <View style={[styles.row, styles.on]} testID="live-follow-on" accessibilityLiveRegion="polite">
        <Icon name="flight" size={16} color={colors.mist} />
        <View style={{ flex: 1 }}>
          <T v="small" style={{ color: colors.mist, fontFamily: ff.ui600 }}>{t('live.follow.on')}</T>
          <T v="tiny" color={colors.onDark2}>{support === 'android' ? t('live.follow.onAndroid') : t('live.follow.onSub')}</T>
        </View>
        <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); void stopLive(seg.id).then(() => toast(t('live.follow.stopped'))); }} hitSlop={8} style={styles.stop} testID="live-follow-stop">
          <T v="caption" style={{ color: colors.green, fontFamily: ff.ui600 }}>{t('live.follow.stop')}</T>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('live.follow.title')} onPress={() => { buzz('tap'); void startLive(trip, now()); }} style={styles.row} testID="live-follow">
      <Icon name="flight" size={16} color={colors.green} />
      <View style={{ flex: 1 }}>
        <T v="small" style={{ color: colors.green, fontFamily: ff.ui600 }}>{t('live.follow.title')}</T>
        <T v="tiny">{t('live.follow.sub', { flight: seg.flightNumber })} {t('live.follow.auto')}</T>
      </View>
      <Icon name="chevron" size={14} color={colors.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist },
  on: { backgroundColor: colors.green },
  stop: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.mist },
  action: { color: colors.green, fontFamily: ff.ui600 },
});
