import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { DESK_PHONE } from '@mada/shared';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtWaiting } from '@/components/states/art';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';

const R = 26;
const C = 2 * Math.PI * R;
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Too many wrong codes or passwords in a row: a short, friendly pause with a countdown (the prototype's RateLimitSheet),
 * never a lock-out with no end. When it reaches zero the primary action comes back; Mada's desk is a call away.
 */
export function PauseSheet({ visible, seconds, onDone, doneLabel, onClose }: {
  visible: boolean; seconds: number; onDone: () => void; doneLabel: string; onClose: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { if (visible) setLeft(seconds); }, [visible, seconds]);
  useEffect(() => {
    if (!visible || left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [visible, left]);

  return (
    <Sheet visible={visible} onClose={onClose} label={t('auth.pause.title')}>
      <View style={{ alignItems: 'center' }} accessible={false}><ArtWaiting width={160} height={120} /></View>
      <T v="h2" accessibilityRole="header">{t('auth.pause.title')}</T>
      <T v="small">{t('auth.pause.body')}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} accessibilityRole="timer" accessibilityLiveRegion="polite" testID="pause-timer">
        <Svg width={64} height={64} viewBox="0 0 64 64">
          <Circle cx={32} cy={32} r={R} fill="none" stroke={colors.line} strokeWidth={5} />
          <Circle cx={32} cy={32} r={R} fill="none" stroke={colors.gold} strokeWidth={5} strokeLinecap="round" strokeDasharray={C}
            strokeDashoffset={C * (1 - Math.max(0, left) / Math.max(1, seconds))} transform="rotate(-90 32 32)" />
        </Svg>
        <View>
          <T v="tiny">{left > 0 ? t('auth.pause.wait') : t('auth.pause.ready')}</T>
          <T v="h1" style={{ fontVariant: ['tabular-nums'] }}>{mmss(Math.max(0, left))}</T>
        </View>
      </View>
      <Button label={doneLabel} disabled={left > 0} onPress={() => { buzz('tap'); onDone(); }} testID="pause-done" />
      <Button variant="ghost" label={t('auth.pause.call')} onPress={() => { void Linking.openURL(`tel:${DESK_PHONE.replace(/\s/g, '')}`).catch(() => {}); }} />
    </Sheet>
  );
}
