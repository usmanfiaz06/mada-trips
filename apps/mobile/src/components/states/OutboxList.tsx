import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/lib/i18n';
import { discardItem, retryItem, useOutbox, type OutboxItem } from '@/lib/net/outbox';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';

/** The state line under one queued thing: "Sends when you're online" · "Sending…" · "Not sent." with Send again / Remove. */
export function OutboxStatus({ item }: { item: OutboxItem }) {
  if (item.state === 'failed') {
    return (
      <View style={styles.row} testID={`outbox-${item.id}`}>
        <T v="tiny" color={colors.badInk}>{t('outbox.stuck')}</T>
        <Pressable accessibilityRole="button" onPress={() => retryItem(item.id)} hitSlop={8} testID="outbox-retry"><T v="tiny" style={styles.link}>{t('outbox.retry')}</T></Pressable>
        <Pressable accessibilityRole="button" onPress={() => discardItem(item.id)} hitSlop={8} testID="outbox-discard"><T v="tiny" style={styles.link}>{t('outbox.discard')}</T></Pressable>
      </View>
    );
  }
  return (
    <View style={styles.row} testID={`outbox-${item.id}`}>
      <Icon name={item.state === 'sending' ? 'up' : 'wifiOff'} size={12} color={colors.ink3} />
      <T v="tiny">{item.state === 'sending' ? `${t('outbox.sending')}…` : t('outbox.queuedLine')}</T>
    </View>
  );
}

/** Everything waiting to send (or one kind of it), as a quiet list: for a thread, a requests list, Account. */
export function OutboxList({ kind, match }: { kind?: string; match?: (i: OutboxItem) => boolean }) {
  const items = useOutbox(kind, match);
  if (!items.length) return null;
  return (
    <View style={styles.list} accessibilityLabel={t('outbox.title')} testID="outbox-list">
      <T v="eyebrow">{t('outbox.title')}</T>
      {items.map((i) => (
        <View key={i.id} style={styles.item}>
          <T v="callout" style={{ fontFamily: ff.ui500, color: colors.green }} numberOfLines={2}>{i.label}</T>
          <OutboxStatus item={i} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.mist },
  item: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: colors.green, fontFamily: ff.ui600, textDecorationLine: 'underline' },
});
