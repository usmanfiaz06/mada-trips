import { Pressable, StyleSheet, View } from 'react-native';
import { DESK_PHONE } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { discardItem, retryItem, useOutboxStore, type OutboxItem } from '@/lib/net/outbox';
import { isOffline, useNet } from '@/lib/net/state';
import { callDesk } from '@/lib/net/talk';
import { toast } from '@/lib/toast';
import { colors, ff, font } from '@/theme';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ArtNoSignal } from './art';

/*
 * The Outbox (prototype OutboxSheet): everything waiting to reach Mada, one row each, Queued, Sending, or Didn't send
 * with Send again and Discard; what works without a connection; and the desk's number. Opened from the connection pill.
 */

const ICON: Record<string, IconName> = { message: 'doc', request: 'doc', disruption: 'flight', choice: 'flight', upload: 'up' };

function Row({ item }: { item: OutboxItem }) {
  const failed = item.state === 'failed';
  return (
    <View style={styles.row} testID={`outbox-row-${item.id}`}>
      <View style={styles.ic}><Icon name={ICON[item.kind] ?? 'doc'} size={18} /></View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <T v="callout" style={{ fontFamily: ff.ui600, color: colors.green }} numberOfLines={2}>{item.label}</T>
        {failed ? <T v="tiny">{item.problem || t('outbox.why')}</T> : <T v="tiny">{t('outbox.queuedLine')}</T>}
        {failed ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Button size="small" block={false} label={t('outbox.retry')} onPress={() => retryItem(item.id)} testID="outbox-retry" />
            <Button size="small" block={false} variant="secondary" label={t('outbox.discard')} onPress={() => { discardItem(item.id); toast(t('outbox.discarded')); }} style={{ backgroundColor: colors.mist }} testID="outbox-discard" />
          </View>
        ) : null}
      </View>
      <View style={[styles.state, failed ? styles.stateFailed : null]}>
        <View style={[styles.dot, { backgroundColor: failed ? colors.bad : item.state === 'sending' ? colors.ok : colors.goldDeep }]} />
        <T v="caption" style={{ fontFamily: ff.ui600, color: failed ? colors.badInk : colors.ink2 }}>
          {item.state === 'sending' ? t('outbox.sending') : failed ? t('outbox.stuck') : t('outbox.queued')}
        </T>
      </View>
    </View>
  );
}

export function OutboxSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const items = useOutboxStore((s) => s.items);
  const online = useNet((s) => s.online);
  const offline = online === false && isOffline();
  const line = online === false ? (offline ? t('outbox.offline') : t('outbox.down')) : items.length ? t('outbox.down') : t('outbox.allSent');
  return (
    <Sheet visible={visible} onClose={onClose} label={t('outbox.title')}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} testID="outbox-sheet">
        <View style={styles.art}><ArtNoSignal width={80} height={60} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={font('h2')} accessibilityRole="header">{items.length ? t('outbox.title') : t('outbox.empty')}</T>
          <T v="small">{line}</T>
        </View>
      </View>
      {items.length ? <View style={styles.list}>{items.map((i) => <Row key={i.id} item={i} />)}</View> : null}
      <View style={styles.works}>
        <T v="eyebrow">{t('outbox.works')}</T>
        <T v="small">{t('outbox.worksBody')}</T>
      </View>
      <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); callDesk(); }} style={styles.call} testID="outbox-call">
        <T v="callout" style={{ fontFamily: ff.ui600, color: colors.green }}>{t('outbox.call', { phone: DESK_PHONE })}</T>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  art: { width: 80, height: 64, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6efe2' },
  list: { gap: 2, borderRadius: 18, backgroundColor: colors.mist, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, paddingHorizontal: 12 },
  ic: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 24, borderRadius: 999, backgroundColor: colors.paper },
  stateFailed: { backgroundColor: '#f6e4de' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  works: { gap: 4, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(125,93,39,0.14)' },
  call: { height: 52, borderRadius: 999, backgroundColor: colors.mist, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
