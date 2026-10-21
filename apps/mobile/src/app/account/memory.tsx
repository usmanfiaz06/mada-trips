import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MemoryFact } from '@mada/shared';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { Group, Row } from '@/components/wallet/ui';
import type { IconName } from '@/components/Icon';
import { useForget, useMemory } from '@/lib/ask-memory';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { fmtDate } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

const ICON: Record<MemoryFact['kind'], IconName> = {
  home_airport: 'pin', airline: 'flight', cabin: 'flight', seat: 'flight', budget: 'card', food: 'food',
  mobility: 'umrah', health: 'star', family: 'circles', contact: 'phone', other: 'star',
};

/** Account → What Mada remembers (docs/app/ASK-CHAT.md §7): every fact Ask keeps, each removable, or all at once. */
export default function Memory() {
  const memory = useMemory();
  const forget = useForget();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const facts = memory.data ?? [];

  const removeOne = async (f: MemoryFact) => {
    setBusy(f.id);
    try { await forget.one(f.id); buzz('success'); toast(t('memory.removed')); } catch { toast(t('error.internal')); } finally { setBusy(null); }
  };
  const removeAll = async () => {
    setBusy('all');
    try { await forget.all(); buzz('warn'); setSheet(false); toast(t('memory.forgetAll.done')); } catch { toast(t('error.internal')); } finally { setBusy(null); }
  };

  return (
    <AccountScreen title={t('memory.title')} testID="memory" query={memory}>
      <T v="small" style={{ paddingHorizontal: 4 }}>{t('memory.intro')}</T>
      {facts.length ? (
        <Group label={t('memory.group')}>
          {facts.map((f) => (
            <Row key={f.id} icon={ICON[f.kind]} label={t(`memory.kind.${f.kind}`)} value={f.text} testID={`memory-${f.kind}`}
              sub={t(f.source === 'booking' ? 'memory.source.booking' : 'memory.source.chat', { date: fmtDate(f.createdAt) })}
              right={(
                <Pressable accessibilityRole="button" accessibilityLabel={t('memory.remove.a11y', { text: f.text })} disabled={!!busy} onPress={() => { void removeOne(f); }} hitSlop={8} testID={`memory-remove-${f.id}`}>
                  <T v="caption" color={colors.badInk} style={{ fontFamily: ff.ui600, fontSize: 13, textDecorationLine: 'underline', opacity: busy === f.id ? 0.5 : 1 }}>{t('memory.remove')}</T>
                </Pressable>
              )} />
          ))}
        </Group>
      ) : (
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: colors.paper }} testID="memory-empty"><T v="body">{t('memory.empty')}</T></View>
      )}
      {facts.length ? <Button variant="ghost" color={colors.badInk} label={t('memory.forgetAll')} onPress={() => setSheet(true)} testID="memory-forget-all" /> : null}
      <T v="tiny" style={{ paddingHorizontal: 4 }}>{t('memory.footer')}</T>

      <Sheet visible={sheet} onClose={() => setSheet(false)} label={t('memory.forgetAll.title')}>
        <T v="h2">{t('memory.forgetAll.title')}</T>
        <T v="body">{t('memory.forgetAll.body')}</T>
        <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('memory.forgetAll')} busy={busy === 'all'} onPress={() => { void removeAll(); }} testID="memory-forget-confirm" />
        <Button label={t('memory.forgetAll.keep')} onPress={() => setSheet(false)} />
      </Sheet>
    </AccountScreen>
  );
}
