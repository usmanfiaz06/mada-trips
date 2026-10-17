import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { isLow, savedAt, useBattery } from '@/lib/low-power';
import { useNet } from '@/lib/net/state';
import { useTrip, useTrips } from '@/lib/trips';
import { colors, ff } from '@/theme';

/*
 * Two quiet lines under Today's header (critique item 14):
 *   - offline, with a saved copy on screen: "You're offline. This is what we had at 14:05.";
 *   - the way into the low-battery screen: a small link while a trip is on, and a suggestion when the browser says
 *     the battery is at 15% or less and not charging (once per launch; "Switch" or let it be).
 * It also reads the next trip after the current one, so both are saved on the phone for a reload with no signal.
 */
let suggestionSetAside = false;

export function LowPowerEntry() {
  const router = useRouter();
  const trips = useTrips();
  const currentId = trips.data?.currentId ?? null;
  const current = useTrip(currentId);
  const nextId = trips.data?.upcoming.find((c) => c.id !== currentId)?.id ?? null;
  useTrip(nextId);
  const online = useNet((s) => s.online);
  const battery = useBattery();
  const [, redraw] = useState(0);

  const phase = current.data?.trip.clock.phase;
  const tripOn = !!phase && phase !== 'none' && phase !== 'home';
  const at = current.dataUpdatedAt || trips.dataUpdatedAt;
  const offlineLine = online === false && at ? t('off.had', { time: savedAt(at) }) : null;
  const suggest = tripOn && isLow(battery) && !suggestionSetAside;
  const open = () => { buzz('tap'); router.push('/battery' as Href); };

  if (!offlineLine && !tripOn) return null;
  return (
    <View style={{ gap: 8 }}>
      {offlineLine ? (
        <View style={styles.offline} testID="offline-had" accessibilityLiveRegion="polite">
          <Icon name="wifiOff" size={16} color={colors.ink2} />
          <T v="small" style={{ flex: 1, color: colors.ink2 }}>{offlineLine}</T>
        </View>
      ) : null}
      {suggest ? (
        <View style={styles.suggest} testID="battery-suggest">
          <T v="small" style={{ flex: 1, color: colors.mist }}>{t('lp.suggest', { percent: Math.round((battery?.level ?? 0) * 100) })}</T>
          <Pressable accessibilityRole="button" onPress={open} hitSlop={8} testID="battery-suggest-open" style={styles.suggestBtn}>
            <T v="caption" style={{ color: colors.green, fontFamily: ff.ui600 }}>{t('lp.suggestOpen')}</T>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.notNow')} onPress={() => { suggestionSetAside = true; redraw((n) => n + 1); }} hitSlop={8}>
            <Icon name="close" size={16} color={colors.mist} />
          </Pressable>
        </View>
      ) : tripOn ? (
        <Pressable accessibilityRole="button" onPress={open} hitSlop={6} testID="battery-entry" style={styles.entry}>
          <T v="caption" style={{ color: colors.ink2, fontFamily: ff.ui600 }}>{t('lp.entry')}</T>
          <Icon name="chevron" size={14} color={colors.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.green },
  suggestBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.mist },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
});
