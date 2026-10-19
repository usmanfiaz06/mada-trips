import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { useGates } from '@/lib/net/gates';
import { buzz } from '@/lib/haptics';
import { colors, ff } from '@/theme';
import { Appear } from '../Appear';
import { Icon } from '../Icon';
import { T } from '../Text';
import { STRIP, type PillMode } from './net-pill-mode';

/** The pill under the status bar (NetChrome.tsx): what's wrong with the connection, and the way into the Outbox. */
export function NetPill({ mode, text, top, onOpen }: { mode: PillMode | null; text: string; top: number; onOpen: () => void }) {
  const still = useReduceMotion();
  if (!mode) return null;
  const tone = PILL[mode];
  return (
    <Appear enter={still ? 'fade' : 'slideUp'} ms={still ? 150 : 380} exit="fade" exitMs={still ? 150 : 200}
      style={[styles.strip, { top }]} pointerEvents="box-none">
      <Pressable
        onPress={() => { buzz('tap'); if (mode === 'maint') { useGates.setState({ maintenanceDismissed: false }); } else onOpen(); }}
        accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={t('pill.a11y', { text })}
        style={({ pressed }) => [styles.pill, { backgroundColor: tone.bg }, mode === 'weak' ? styles.pillWeak : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}
        testID={mode === 'offline' ? 'offline-banner' : mode === 'maint' ? 'maintenance-banner' : `net-pill-${mode}`}>
        {mode === 'sending' ? <ActivityIndicator size="small" color={tone.fg} style={{ transform: [{ scale: 0.7 }] }} /> : <View style={[styles.dot, { backgroundColor: tone.dot }]} />}
        <T v="caption" numberOfLines={1} style={[styles.text, { color: tone.fg }]}>{text}</T>
        {mode !== 'sending' ? <Icon name="chevron" size={14} color={tone.fg} /> : null}
      </Pressable>
    </Appear>
  );
}

const PILL: Record<PillMode, { bg: string; fg: string; dot: string }> = {
  offline: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  held: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  sending: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  down: { bg: '#3a3324', fg: '#f6eedd', dot: colors.gold },
  weak: { bg: 'rgba(255,253,249,0.94)', fg: colors.green, dot: colors.goldDeep },
  maint: { bg: colors.goldWash, fg: colors.green, dot: colors.goldDeep },
};

const styles = StyleSheet.create({
  strip: { position: 'absolute', start: 0, end: 0, height: STRIP, zIndex: 80, alignItems: 'center', justifyContent: 'center' },
  pill: { height: 30, maxWidth: '86%', paddingStart: 10, paddingEnd: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 7, boxShadow: '0px 10px 24px -14px rgba(15,26,22,0.8)' },
  pillWeak: { borderWidth: 1, borderColor: 'rgba(30,53,45,0.08)' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: ff.ui600, fontSize: 12.5, flexShrink: 1 },
});
