import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { localizeDigits } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { colors, font } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';
import { AgentDot, MadaDot, enter } from './parts';

/*
 * The conversation's pieces: the traveller's words on the end side (green), Mada's on the start side, an answered
 * question that can be changed with a tap, the agent typing, the time a message was sent, and a summary chip row.
 * Every row uses start/end, so Arabic reads right to left without anything special.
 */

/** "14:05" in the traveller's language. */
export const clock = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return localizeDigits(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, getLocale());
};

/** What the traveller said, on the end side. */
export function MeBubble({ text, time, testID }: { text: string; time?: string | null; testID?: string }) {
  return (
    <Animated.View entering={enter(0)} style={styles.meWrap} testID={testID}>
      <View style={styles.me}><T style={[font('body', colors.mist), { fontSize: 16, lineHeight: 22 }]}>{text}</T></View>
      {time ? <T v="tiny" style={styles.timeEnd}>{time}</T> : null}
    </Animated.View>
  );
}

/** Mada asking, on the start side: the sun, then the question. */
export function MadaSays({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <View style={styles.says}>
      <MadaDot size={small ? 24 : 28} />
      <View style={{ flex: 1, gap: 4, paddingTop: small ? 1 : 3 }}>{children}</View>
    </View>
  );
}

/** A question already answered: Mada's question, small, and the answer as the traveller's bubble. Tap to change it. */
export function Answered({ q, a, onChange, testID }: { q: string; a: string; onChange?: () => void; testID?: string }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: 6 }}>
      <MadaSays small><T v="small">{q}</T></MadaSays>
      <Pressable accessibilityRole="button" accessibilityLabel={onChange ? t('ask.flow.changeIt', { what: a }) : a} disabled={!onChange}
        onPress={() => { buzz('select'); onChange?.(); }} style={styles.meWrap} testID={testID}>
        <View style={[styles.me, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <T style={[font('body', colors.mist), { fontSize: 15, lineHeight: 21, flexShrink: 1 }]}>{a}</T>
          {onChange ? <Icon name="edit" size={14} color="rgba(246,242,236,0.75)" /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The search in one calm card: where, when and who on a line each, one pencil. Tap a part to change just that part;
 * the pencil changes the first. Reads as "what I asked for", not as three loose buttons.
 */
export function SummaryChips({ items }: { items: { label: string; onPress: () => void; testID?: string; a11y?: string; icon?: 'pin' | 'calendar' | 'user' }[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.summary} testID="summary-bar">
      <View style={{ flex: 1, gap: 4 }}>
        {items.map((it, i) => (
          <Pressable key={it.label} accessibilityRole="button" accessibilityLabel={it.a11y ?? t('ask.flow.changeIt', { what: it.label })} onPress={() => { buzz('select'); it.onPress(); }}
            style={({ pressed }) => [styles.summaryRow, pressed ? { opacity: 0.6 } : null]} testID={it.testID}>
            {it.icon ? <Icon name={it.icon} size={15} color={i === 0 ? colors.green : colors.ink3} /> : null}
            <T style={[i === 0 ? font('h3') : font('small'), { fontSize: i === 0 ? 16 : 14, flexShrink: 1, color: i === 0 ? colors.green : colors.ink2 }]} numberOfLines={1}>{it.label}</T>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('ask.flow.changeIt', { what: items[0]!.label })} onPress={() => { buzz('select'); items[0]!.onPress(); }} style={styles.summaryEdit} testID="summary-edit">
        <Icon name="edit" size={15} color={colors.green} />
      </Pressable>
    </View>
  );
}

/** Three dots that breathe while the agent writes. */
export function TypingDots({ name }: { name: string }) {
  return (
    <View style={styles.theirRow} accessibilityLabel={t('presence.typing', { agent: name })} accessibilityLiveRegion="polite" testID="agent-typing">
      <AgentDot name={name} size={28} />
      <View style={[styles.bubbleThem, { flexDirection: 'row', gap: 5, paddingVertical: 14, paddingHorizontal: 16 }]}>
        {[0, 1, 2].map((i) => <Dot key={i} delay={i * 160} />)}
      </View>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const o = useSharedValue(0.3);
  useEffect(() => { o.set(withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1))); }, [o, delay]);
  const st = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[styles.dot, st]} />;
}

/** One message in a thread: who, what, when. */
export function ThreadBubble({ mine, name, text, time, children, queued }: { mine: boolean; name: string; text?: string; time?: string | null; children?: ReactNode; queued?: boolean }) {
  return (
    <View style={[styles.theirRow, mine ? styles.mineRow : null]}>
      {!mine ? <AgentDot name={name} size={28} /> : null}
      <View style={{ flexShrink: 1, gap: 3, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <View style={[mine ? styles.bubbleMine : styles.bubbleThem, { gap: 6 }]}>
          {text ? <T style={[font('callout', mine ? colors.mist : colors.green), { lineHeight: 21 }]}>{text}</T> : null}
          {children}
        </View>
        {time || queued ? <T v="tiny" style={{ paddingHorizontal: 6 }}>{queued ? t('ask.flow.sendsOnline') : mine ? time : `${name} · ${time}`}</T> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingEnd: 8, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  summaryEdit: { width: 36, height: 36, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist },
  meWrap: { alignSelf: 'flex-end', maxWidth: '82%', alignItems: 'flex-end', gap: 3 },
  me: { backgroundColor: colors.green, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, borderBottomEndRadius: 6 },
  timeEnd: { paddingHorizontal: 6 },
  says: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 38, maxWidth: '100%', borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  theirRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: '88%' },
  mineRow: { alignSelf: 'flex-end' },
  bubbleThem: { backgroundColor: colors.paper, borderRadius: 18, borderBottomStartRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleMine: { backgroundColor: colors.green, borderRadius: 18, borderBottomEndRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: colors.ink3 },
});

