import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { AIRPORT_GEO, DESTINATIONS } from '@mada/shared';
import { Button } from '../Button';
import { Sun } from '../Sun';
import { T } from '../Text';
import { Appear } from '../Appear';
import { Icon } from '../Icon';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import type { GiveUp } from '@/lib/net/give-up';
import { colors, ff, radii } from '@/theme';
import { Skeleton } from './Skeleton';
import { WaitTrouble } from './WaitTrouble';

/*
 * Waiting on a search that takes seconds (hotels, flights, eSIM plans, a pickup, things to do, a tool in the Ask chat),
 * as something to look at rather than a spinner: placeholders in the exact shape of the cards that are coming, with
 * the Skeleton's soft sheen (still under Reduce Motion), and one line above them that moves on with the clock and says
 * what is really being done ("Asking hotels in Istanbul for 10–13 Nov" → "Comparing rooms and prices" → …). The last
 * line owns up to a slow answer. When the app already knows one true thing about the place (the local time), it sits
 * under the line; nothing waits for it. At the give-up limit (lib/net/give-up.ts) the caller shows <GaveUp>.
 *
 *   const line = useStagedLine(lines, STAGES, runKey);
 *   <Waiting kind="stays" line={line} fact={localTimeFact('istanbul')} testID="stays-waiting" />
 */

export type WaitKind = 'stays' | 'flights' | 'esim' | 'pickup' | 'things';

/** When each line takes over, from the start of the wait (ms). Four lines for the live suppliers, three otherwise. */
export const STAGES_SUPPLIER = [0, 3000, 8000, 14000] as const;
export const STAGES_SHORT = [0, 3000, 8000] as const;

/**
 * The line for now: lines[i] from at[i] ms after `run` last changed (null: not waiting). A new run starts again at
 * the first line. `since` lets a caller start the clock earlier (the Ask chat keys it off the last status event).
 */
export function useStagedLine(lines: readonly string[], at: readonly number[], run: string | null, since?: number): { text: string; index: number } {
  const [index, setIndex] = useState(0);
  const started = useRef<{ run: string; at: number } | null>(null);
  useEffect(() => {
    if (run === null) { started.current = null; return undefined; }
    if (started.current?.run !== run) started.current = { run, at: since ?? Date.now() };
    const t0 = started.current.at;
    const now = Date.now() - t0;
    let cur = 0;
    at.forEach((ms, i) => { if (now >= ms) cur = i; });
    setIndex(cur);
    const ids = at.map((ms, i) => (ms > now ? setTimeout(() => setIndex(i), ms - now) : null)).filter((x): x is ReturnType<typeof setTimeout> => x !== null);
    return () => ids.forEach(clearTimeout);
  }, [run, since, at]);
  const i = Math.min(index, lines.length - 1);
  return { text: lines[i] ?? '', index: i };
}

/** "It's 14:20 in Istanbul right now", when the destination's airport and its clock are known; else null. */
export function localTimeFact(destination: string | null | undefined, now = new Date()): string | null {
  const d = destination ? DESTINATIONS[destination] : null;
  const zone = d ? AIRPORT_GEO[d.code]?.[2] : null;
  if (!d || !zone || zone === 'Asia/Riyadh') return null;
  try {
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    return t('waiting.fact.time', { time, city: d.name });
  } catch {
    return null;
  }
}

/** The line, the fact, and the cards to come. */
export function Waiting({ kind, line, fact, count, compact, testID }: {
  kind: WaitKind;
  line: { text: string; index: number };
  fact?: string | null;
  /** How many placeholder cards (2 by default; 3 for flights). */
  count?: number;
  /** Narrower placeholders, under a chat bubble. */
  compact?: boolean;
  testID?: string;
}) {
  const n = count ?? (kind === 'flights' ? 3 : 2);
  return (
    <View style={{ gap: 14 }} testID={testID}>
      <WaitingLine line={line} fact={fact} />
      <View style={kind === 'things' ? s.pair : { gap: 12 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: n }, (_, i) => <SkeletonFor key={i} kind={kind} compact={compact} first={i === 0} />)}
      </View>
    </View>
  );
}

/** The moving line alone: Mada's sun, the words fading from one to the next, the breathing dots. */
export function WaitingLine({ line, fact, style }: { line: { text: string; index: number }; fact?: string | null; style?: StyleProp<ViewStyle> }) {
  const still = useReduceMotion();
  return (
    <View style={[s.lineWrap, style]} accessible accessibilityRole="progressbar" accessibilityLabel={t('waiting.a11y', { line: line.text })} accessibilityLiveRegion="polite">
      <View style={s.sun}><Sun width={30} color={colors.goldDeep} /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={s.lineRow}>
          {/* Keyed by the stage: each new line fades in where the last one was, the same height (no jump). */}
          <Appear key={line.index} enter="fade" ms={still ? 1 : 360} style={{ flexShrink: 1 }}>
            <T v="body" color={colors.green} style={{ fontFamily: ff.ui500 }} testID="waiting-line">{line.text}</T>
          </Appear>
          <Breathing still={still} />
        </View>
        {fact ? (
          <View style={s.factRow} testID="waiting-fact">
            <Icon name="globe" size={14} color={colors.ink3} />
            <T v="tiny" color={colors.ink3}>{fact}</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Breathing({ still }: { still: boolean }) {
  return <View style={s.dots}>{[0, 1, 2].map((i) => <Dot key={i} delay={i * 160} still={still} />)}</View>;
}

function Dot({ delay, still }: { delay: number; still: boolean }) {
  const o = useSharedValue(still ? 0.6 : 0.25);
  useEffect(() => {
    if (still) { o.set(0.6); return; }
    o.set(withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.25, { duration: 420 })), -1)));
  }, [o, delay, still]);
  const st = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[s.dot, st]} />;
}

/* ───────────── the cards to come, shaped like the real ones ───────────── */

export function SkeletonFor({ kind, compact, first }: { kind: WaitKind; compact?: boolean; first?: boolean }) {
  switch (kind) {
    case 'stays': return <SkeletonStay compact={compact} />;
    case 'flights': return compact ? <SkeletonFlightRow /> : <SkeletonFlight first={first} />;
    case 'esim': return <SkeletonPlan />;
    case 'pickup': return <SkeletonPickup />;
    case 'things': return <SkeletonThing />;
  }
}

/** StayCard: the photo across the top (132, or 96 compact), the name and price, the room, the cancellation line. */
export function SkeletonStay({ compact }: { compact?: boolean }) {
  return (
    <View style={[s.card, { padding: 0, overflow: 'hidden', gap: 0 }]}>
      <Skeleton height={compact ? 96 : 132} radius={0} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 8 }}>
        <View style={s.spread}>
          <Skeleton width="58%" height={17} radius={8} />
          <View style={{ alignItems: 'flex-end', gap: 5 }}><Skeleton width={78} height={17} radius={8} /><Skeleton width={56} height={10} /></View>
        </View>
        <Skeleton width="44%" height={12} />
        <View style={s.rowSmall}><Skeleton width={16} height={16} radius={8} /><Skeleton width="52%" height={12} /></View>
      </View>
    </View>
  );
}

/** The flight option: the airline's mark and name with its label, the price, the leg, the one-line reason. */
export function SkeletonFlight({ first }: { first?: boolean }) {
  return (
    <View style={[s.card, { paddingVertical: 14, gap: 12 }]}>
      <View style={s.spread}>
        <View style={s.rowSmall}>
          <Skeleton width={36} height={36} radius={18} />
          <View style={{ gap: 6 }}><Skeleton width={92} height={14} /><Skeleton width={first ? 72 : 60} height={20} radius={10} /></View>
        </View>
        <Skeleton width={82} height={18} radius={9} />
      </View>
      <View style={s.spread}>
        <Skeleton width={52} height={20} radius={8} />
        <Skeleton width="38%" height={2} radius={1} />
        <Skeleton width={52} height={20} radius={8} />
      </View>
      <Skeleton width="70%" height={12} />
    </View>
  );
}

/** The chat's compact flight row: the mark, two lines, the price. */
export function SkeletonFlightRow() {
  return (
    <View style={[s.card, s.rowCard]}>
      <Skeleton width={32} height={32} radius={16} />
      <View style={{ flex: 1, gap: 6 }}><Skeleton width="72%" height={13} /><Skeleton width="46%" height={10} /></View>
      <Skeleton width={70} height={14} />
    </View>
  );
}

/** The eSIM plan tile: its size and the round tick, the big GB and the price, the bar, the line under. */
export function SkeletonPlan() {
  return (
    <View style={[s.card, { gap: 12 }]}>
      <View style={s.spread}><Skeleton width={64} height={11} /><Skeleton width={24} height={24} radius={12} /></View>
      <View style={[s.spread, { alignItems: 'flex-end' }]}>
        <View style={s.rowSmall}><Skeleton width={84} height={36} radius={10} /><Skeleton width={54} height={12} /></View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}><Skeleton width={70} height={18} radius={8} /><Skeleton width={36} height={10} /></View>
      </View>
      <Skeleton height={6} radius={3} />
      <View style={s.spread}><Skeleton width="34%" height={10} /><Skeleton width="30%" height={10} /></View>
    </View>
  );
}

/** A pickup option: the car's mark, its name and what fits, the price. */
export function SkeletonPickup() {
  return (
    <View style={[s.card, s.rowCard, { paddingVertical: 16 }]}>
      <Skeleton width={44} height={44} radius={12} />
      <View style={{ flex: 1, gap: 7 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={11} /></View>
      <Skeleton width={72} height={16} radius={8} />
    </View>
  );
}

/** A thing to do: the photo tile and two lines, two to a row. */
export function SkeletonThing() {
  return (
    <View style={[s.card, { flex: 1, padding: 0, overflow: 'hidden', gap: 0 }]}>
      <Skeleton height={120} radius={0} />
      <View style={{ padding: 12, gap: 7 }}><Skeleton width="80%" height={13} /><Skeleton width="50%" height={10} /></View>
    </View>
  );
}

/**
 * The give-up for a live supplier search: what happened in plain words, Try again, and Mada finding it by hand.
 * A failure, or a sign-in that ran out, keeps the usual honest card (WaitTrouble).
 */
export function GaveUp({ wait, kind, onFind, testID }: { wait: GiveUp; kind: 'stays' | 'flights'; onFind: () => void; testID?: string }): ReactNode {
  if (wait.view !== 'timeout') return <WaitTrouble wait={wait} testID={testID} />;
  return (
    <Appear enter="fade" ms={300} style={[s.card, { gap: 12, padding: 18 }]} testID={testID ?? 'wait-timeout'}>
      <View style={s.rowSmall}>
        <Icon name={kind === 'stays' ? 'stay' : 'flight'} size={22} />
        <T v="h3" style={{ flex: 1 }} accessibilityRole="header">{t(`waiting.gaveUp.${kind}.title`)}</T>
      </View>
      <T v="small">{t(`waiting.gaveUp.${kind}.body`)}</T>
      <View style={{ gap: 8 }}>
        <Button label={t('common.tryAgain')} onPress={wait.retry} testID="state-retry" />
        <Button variant="secondary" label={t('waiting.gaveUp.find')} onPress={onFind} testID="state-find" />
      </View>
    </Appear>
  );
}

const s = StyleSheet.create({
  lineWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  sun: { marginTop: 3 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 24 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dots: { flexDirection: 'row', gap: 4, paddingTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 99, backgroundColor: colors.goldDeep },
  card: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 10 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  rowSmall: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pair: { flexDirection: 'row', gap: 12 },
});
