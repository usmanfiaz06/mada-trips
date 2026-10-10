import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ArtCircles, ArtFriends } from '@/components/art/Arts';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/** Circles with nobody in it yet: make the first circle, bring your people (prototype Circles). */
export default function Circles() {
  const top = useTopInset();
  const [tab, setTab] = useState<'discover' | 'circles'>('circles');
  const soon = () => toast(t('ask.soon'));
  return (
    <Screen>
      <Scroll top={top + 10}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', gap: 18, alignItems: 'baseline' }} accessibilityRole="tablist">
            {(['discover', 'circles'] as const).map((k) => (
              <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => { buzz('select'); setTab(k); }}>
                <T v="h1" color={tab === k ? colors.green : colors.muted}>{t(`circles.tab.${k}`)}</T>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('circles.friends.add')} onPress={soon} style={[styles.round, { backgroundColor: colors.paper }]}><Icon name="circles" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('circles.empty.action')} onPress={soon} style={[styles.round, { backgroundColor: colors.green }]}><Icon name="plus" color={colors.mist} /></Pressable>
          </View>
        </View>
        <T v="h2">{t('circles.yours')}</T>
        <Animated.View entering={rise(0)}>
          <EmptyState art={<ArtCircles />} title={t('circles.empty.title')} body={t('circles.empty.body')}
            action={<Button label={t('circles.empty.action')} onPress={soon} />}
            ideas={(['family', 'eid', 'weekend', 'cousins'] as const).map((k) => [t(`circles.idea.${k}`), soon] as [string, () => void])} />
        </Animated.View>
        <T v="h2">{t('circles.friends')}</T>
        <Animated.View entering={rise(1)}>
          <EmptyState compact art={<ArtFriends width={100} height={75} />} title={t('circles.friends.emptyTitle')} body={t('circles.friends.emptyBody')}
            action={<Button size="small" block={false} label={t('circles.friends.add')} onPress={soon} />} />
        </Animated.View>
      </Scroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
