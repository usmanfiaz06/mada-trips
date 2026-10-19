import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { destinationOf, type TripDetail } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { Box, Display, H3, Photo, Row, Small, Tag, TextLink, Veil } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { dirSign, t } from '@/lib/i18n';
import { tripsApi } from '@/lib/trips';
import { colors } from '@/theme';
import { useTripLocal } from './local';

/** Swipe right on what sounds good for the first evening; Mada books them on landing. */
export function SwipeDeck({ trip }: { trip: TripDetail }) {
  const dest = destinationOf(trip);
  const [local, update] = useTripLocal(trip.id);
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<string[]>(trip.picks);
  const x = useSharedValue(0);
  const cards = dest.picks;
  useEffect(() => { update(() => ({})); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = (yes: boolean) => {
    const card = cards[i];
    if (!card) return;
    buzz(yes ? 'select' : 'tap');
    const next = yes ? [...picks, card.id] : picks;
    setPicks(next);
    if (yes) void tripsApi.patch(trip.id, { picks: next }).catch(() => {});
    x.set(withTiming((yes ? 420 : -420) * dirSign(), { duration: 260 }, () => { scheduleOnRN(setI, i + 1); x.set(0); }));
  };
  // Yes is a swipe towards the end of the line: right in English, left in Arabic.
  const dir = dirSign();
  const pan = Gesture.Pan()
    .onChange((e) => { x.set(x.get() + e.changeX); })
    .onEnd(() => {
      const v = x.get() * dir;
      if (v > 90) scheduleOnRN(decide, true);
      else if (v < -90) scheduleOnRN(decide, false);
      else x.set(withTiming(0, { duration: 300 }));
    });
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { rotate: `${x.get() / 18}deg` }] }));
  const yesStyle = useAnimatedStyle(() => ({ opacity: x.get() * dir > 30 ? 1 : 0 }));
  const noStyle = useAnimatedStyle(() => ({ opacity: x.get() * dir < -30 ? 1 : 0 }));
  void local;
  if (i >= cards.length) {
    const chosen = cards.filter((c) => picks.includes(c.id));
    return (
      <Box tone="focal" gap={8} testID="deck-done">
        <H3 color={colors.mist}>{chosen.length ? t(chosen.length === 1 ? 'td.deck.picks.one' : 'td.deck.picks.other', { n: chosen.length }) : t('td.deck.free')}</H3>
        <Small color={colors.onDark2}>{chosen.length ? t('td.deck.saved') : t('td.deck.nothing')}</Small>
        {chosen.map((c) => <Row key={c.id}><Icon name="check" size={16} color={colors.gold} width={2.4} /><T v="small" color="#e9e2d8">{c.title}</T></Row>)}
        <TextLink light label={t('td.deck.again')} onPress={() => { setPicks([]); setI(0); void tripsApi.patch(trip.id, { picks: [] }).catch(() => {}); }} />
      </Box>
    );
  }
  const card = cards[i]!;
  const next = cards[i + 1];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ height: 300 }}>
        {next ? <Photo k={next.photo} style={[StyleSheet.absoluteFill, styles.deckCard, { transform: [{ scale: 0.95 }, { translateY: 10 }], opacity: 0.7 }]}><Veil id={`deck-n-${next.id}`} /></Photo> : null}
        <GestureDetector gesture={pan}>
          <Animated.View style={[StyleSheet.absoluteFill, cardStyle]} accessibilityLabel={card.title} testID="deck-card">
            <Photo k={card.photo} style={[StyleSheet.absoluteFill, styles.deckCard]}>
              <Veil id={`deck-${card.id}`} />
              <View style={styles.deckTop}><Tag tone="glass" label={card.tag} /><Tag tone="glass" label={t('td.deck.of', { i: i + 1, n: cards.length })} /></View>
              <Animated.View style={[styles.stampYes, yesStyle]}><Tag tone="gold" label={t('td.deck.yes')} /></Animated.View>
              <Animated.View style={[styles.stampNo, noStyle]}><Tag label={t('td.deck.skip')} /></Animated.View>
              <View style={{ flex: 1, justifyContent: 'flex-end', padding: 18, gap: 6 }}>
                <Display size={27} color={colors.paper}>{card.title}</Display>
                <T v="small" color="rgba(255,253,249,0.88)">{card.note}</T>
              </View>
            </Photo>
          </Animated.View>
        </GestureDetector>
      </View>
      <Row gap={16} style={{ justifyContent: 'center' }}>
        <Pressable testID="deck-skip" accessibilityRole="button" accessibilityLabel={t('td.deck.skip')} onPress={() => decide(false)} style={[styles.round, { backgroundColor: colors.paper }]}><Icon name="close" /></Pressable>
        <Pressable testID="deck-yes" accessibilityRole="button" accessibilityLabel={t('td.deck.yesA11y')} onPress={() => decide(true)} style={[styles.round, { backgroundColor: colors.green }]}><Icon name="check" color={colors.gold} width={2.4} /></Pressable>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  deckCard: { borderRadius: 28 },
  deckTop: { position: 'absolute', top: 14, start: 14, end: 14, flexDirection: 'row', justifyContent: 'space-between', zIndex: 1 },
  stampYes: { position: 'absolute', top: 60, start: 18, transform: [{ rotate: '-8deg' }], zIndex: 2 },
  stampNo: { position: 'absolute', top: 60, end: 18, transform: [{ rotate: '8deg' }], zIndex: 2 },
  round: { width: 56, height: 56, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
});
