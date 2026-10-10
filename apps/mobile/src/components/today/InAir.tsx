import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useQuery } from '@tanstack/react-query';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { arrivalPickup, arriveInstant, departInstant, destinationOf, FlightPositionResponse, flightPositionPath, liveStay, outSegment, backSegment, type TripDetail } from '@mada/shared';
import { Icon, type IconName } from '@/components/Icon';
import { T } from '@/components/Text';
import { Box, Display, Dot, Grow, H3, Num, Photo, Rise, Row, Small, SmallButton, Spread, Tag, TalkLine, TextLink, Tiny, useTicker, Veil } from '@/components/trips/ui';
import { AddressSheet } from '@/components/trips/AddressSheet';
import { request } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { tripsApi, useDemo } from '@/lib/trips';
import { colors, ff, radii, shadow } from '@/theme';
import { useTripLocal } from './local';

/** Where airports are, for the arc: the plane sits at the real fraction of the way when ADS-B sees it. */
const AIRPORT_LL: Record<string, [number, number]> = {
  RUH: [24.957, 46.698], JED: [21.679, 39.156], DMM: [26.471, 49.798], MED: [24.553, 39.705], IST: [41.275, 28.752], SAW: [40.898, 29.309], DXB: [25.253, 55.365],
  DOH: [25.273, 51.608], CAI: [30.122, 31.406], LHR: [51.47, -0.454], GYD: [40.467, 50.047], TBS: [41.669, 44.955], AUH: [24.433, 54.651],
};
const rad = (d: number) => (d * Math.PI) / 180;
function km([a, b]: [number, number], [c, d]: [number, number]) {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function usePosition(flight: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['trips', 'position', flight],
    enabled: enabled && !!flight,
    refetchInterval: 60_000,
    retry: false,
    queryFn: () => request({ method: 'GET', path: flightPositionPath(flight!) }, FlightPositionResponse),
  });
}

/** The arc from home to there, the plane on it, and the time left. Estimated without signal; real when ADS-B sees the plane. */
function AirMap({ trip, now }: { trip: TripDetail; now: () => number }) {
  useTicker(1000);
  const offline = useOffline();
  const back = trip.clock.phase === 'inair' && backSegment(trip) && Date.parse(trip.clock.now) > departInstant(backSegment(trip)!).getTime();
  const seg = back ? backSegment(trip)! : outSegment(trip)!;
  const dep = departInstant(seg).getTime();
  const arr = arriveInstant(seg).getTime();
  const pos = usePosition(seg.flightNumber, !offline);
  const p = pos.data?.position;
  const a = AIRPORT_LL[seg.from];
  const b = AIRPORT_LL[seg.to];
  const live = !!(p && a && b && !p.onGround);
  const timeT = Math.min(1, Math.max(0, (now() - dep) / Math.max(1, arr - dep)));
  const tt = live ? Math.min(1, Math.max(0, km(a!, [p!.lat, p!.lon]) / Math.max(1, km(a!, b!)))) : timeT;
  const left = Math.max(0, Math.round((arr - now()) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const x = 20 + tt * 300;
  const y = 120 - Math.sin(tt * Math.PI) * 80;
  const dest = destinationOf(trip);
  return (
    <View style={[styles.story, shadow('focal')]} testID="in-air-map">
      <Photo k="inflight-window" style={[StyleSheet.absoluteFill, { borderRadius: 0, opacity: 0.45 }]} />
      <Veil id="air" />
      <Svg viewBox="0 0 340 150" width="100%" height={150} style={{ position: 'absolute', top: 18, start: 0, end: 0 }}>
        <Path d="M20 120 Q 170 -40 320 120" fill="none" stroke="rgba(255,253,249,.25)" strokeWidth={2} strokeDasharray="3 7" />
        <Path d="M20 120 Q 170 -40 320 120" fill="none" stroke={colors.gold} strokeWidth={2.5} strokeDasharray={`${tt * 360} 999`} />
        <Circle cx={20} cy={120} r={4} fill={colors.paper} /><Circle cx={320} cy={120} r={4} fill={colors.paper} />
        <G transform={`translate(${x} ${y}) rotate(${(0.5 - tt) * -60})`}>
          <Circle r={13} fill={colors.gold} />
          <Path d="M7 0c0-.4-.3-.7-.7-.7H2.6L.3-4.2h-.9l1.1 3.5H-1.6l-.7-.9h-.7l.5 1.6-.5 1.6h.7l.7-.9H.5l-1.1 3.5h.9l2.3-3.5h3.7c.4 0 .7-.3.7-.7z" fill={colors.green} transform="scale(1.4)" />
        </G>
        <SvgText x={30} y={124} fontFamily={ff.ui600} fontSize={11} fill="rgba(255,253,249,.8)">{seg.from}</SvgText>
        <SvgText x={310} y={124} textAnchor="end" fontFamily={ff.ui600} fontSize={11} fill="rgba(255,253,249,.8)">{seg.to}</SvgText>
      </Svg>
      <View style={{ padding: 18, gap: 6 }}>
        <T style={{ color: colors.gold, fontSize: 13, lineHeight: 17, fontFamily: ff.ui600 }}>{live ? t('td.air.live', { alt: Math.round((p!.altitudeFt ?? 0) / 100) * 100 }) : t('td.air.estimated')}</T>
        <Row align="baseline" gap={8}><Num size={44} color={colors.paper}>{`${h}h ${String(m).padStart(2, '0')}m`}</Num><T style={{ fontSize: 18, lineHeight: 22, fontFamily: ff.ui500, color: colors.paper }}>{t('td.air.to', { city: back ? (trip.segments[0]?.from === 'RUH' ? 'Riyadh' : seg.to) : trip.city })}</T></Row>
        {dest.city === 'Istanbul' && !back ? <T v="small" color="rgba(255,253,249,0.88)">{t('td.air.lookLeft')}</T> : null}
        {live ? <Tiny color="rgba(255,253,249,0.6)">{pos.data!.attribution}</Tiny> : null}
      </View>
    </View>
  );
}

/** Swipe right on what sounds good for the first evening; Mada books them on landing. */
function SwipeDeck({ trip }: { trip: TripDetail }) {
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
    x.set(withTiming(yes ? 420 : -420, { duration: 260 }, () => { scheduleOnRN(setI, i + 1); x.set(0); }));
  };
  const pan = Gesture.Pan()
    .onChange((e) => { x.set(x.get() + e.changeX); })
    .onEnd(() => {
      const v = x.get();
      if (v > 90) scheduleOnRN(decide, true);
      else if (v < -90) scheduleOnRN(decide, false);
      else x.set(withTiming(0, { duration: 300 }));
    });
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { rotate: `${x.get() / 18}deg` }] }));
  const yesStyle = useAnimatedStyle(() => ({ opacity: x.get() > 30 ? 1 : 0 }));
  const noStyle = useAnimatedStyle(() => ({ opacity: x.get() < -30 ? 1 : 0 }));
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

function Flashcards({ trip }: { trip: TripDetail }) {
  const dest = destinationOf(trip);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const w = dest.words[i];
  if (!w) return null;
  return (
    <View style={{ gap: 10 }}>
      <Pressable testID="flashcard" accessibilityRole="button" accessibilityLabel={flip ? `${w[1]}, ${w[2]}` : `${w[0]}. ${t('td.words.tap')}`} onPress={() => { buzz('tap'); setFlip(!flip); }}
        style={[styles.flash, { backgroundColor: flip ? colors.green : colors.paper }]}>
        <Tiny color={flip ? colors.gold : undefined}>{flip ? t('td.words.in', { lang: dest.language ?? '' }) : t('td.words.english')}</Tiny>
        <Display size={34} color={flip ? colors.mist : colors.green} center>{flip ? w[1] : w[0]}</Display>
        <T v="small" color={flip ? colors.onDark2 : undefined}>{flip ? t('td.words.say', { say: w[2] }) : t('td.words.tapFlip')}</T>
      </Pressable>
      <Spread>
        <Row gap={6}>{dest.words.map((_, k) => <Dot key={k} color={k === i ? colors.green : '#d6cec2'} />)}</Row>
        <SmallButton testID="flash-next" tone="paper" label={i === dest.words.length - 1 ? t('td.words.again') : t('td.words.next')} onPress={() => { setI((i + 1) % dest.words.length); setFlip(false); }} />
      </Spread>
    </View>
  );
}

export function InAir({ trip, now }: { trip: TripDetail; now: () => number }) {
  const [sheet, setSheet] = useState(false);
  const dest = destinationOf(trip);
  const arrive = arrivalPickup(trip);
  const st = liveStay(trip);
  const rows: [IconName, string][] = [
    ['visa', t('td.land.passport')],
    ['bag', t('td.land.carousel')],
    ['car', arrive ? t('td.land.driver', { driver: arrive.driverName ?? '', door: arrive.meetingPoint ?? '' }) : t('td.land.noCar')],
  ];
  return (
    <>
      <Rise><AirMap trip={trip} now={now} /></Rise>
      {dest.picks.length ? (<>
        <View style={{ gap: 4, marginTop: 6 }}><T v="h2" style={{ fontSize: 22, lineHeight: 27 }}>{t('td.deck.title')}</T><Small>{t('td.deck.body')}</Small></View>
        <SwipeDeck trip={trip} />
      </>) : null}
      {dest.words.length ? (<>
        <View style={{ gap: 4, marginTop: 6 }}><T v="h2" style={{ fontSize: 22, lineHeight: 27 }}>{t('td.words.title', { city: trip.city })}</T><Small>{t('td.words.body')}</Small></View>
        <Flashcards trip={trip} />
      </>) : null}
      <Box style={{ marginTop: 6 }}>
        <H3>{t('td.land.title')}</H3>
        {rows.map(([ic, line]) => <Row key={line}><Icon name={ic} size={18} /><T v="small" color={colors.green} style={{ flex: 1 }}>{line}</T></Row>)}
        <SmallButton testID="in-air-address" tone="soft" label={!st && !trip.noStay ? t('td.land.where') : arrive ? t('td.land.forDriver') : t('td.land.gettingThere')} onPress={() => setSheet(true)} />
      </Box>
      <TalkLine note={t('td.talk.wifi', { agent: trip.agent.name })} agentInitial={trip.agent.initial} about={trip.city} />
      <AddressSheet trip={trip} open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  story: { height: 290, borderRadius: 28, overflow: 'hidden', backgroundColor: '#0e1c2b', justifyContent: 'flex-end' },
  deckCard: { borderRadius: 28 },
  deckTop: { position: 'absolute', top: 14, start: 14, end: 14, flexDirection: 'row', justifyContent: 'space-between', zIndex: 1 },
  stampYes: { position: 'absolute', top: 60, start: 18, transform: [{ rotate: '-8deg' }], zIndex: 2 },
  stampNo: { position: 'absolute', top: 60, end: 18, transform: [{ rotate: '8deg' }], zIndex: 2 },
  round: { width: 56, height: 56, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  flash: { height: 150, borderRadius: 24, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 6 },
});

void radii;
void Grow;
