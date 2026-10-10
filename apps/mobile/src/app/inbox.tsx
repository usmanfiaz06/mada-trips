import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon, type IconName } from '@/components/Icon';
import { Scroll, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { QuietRadar } from '@/components/wallet/Arts';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useInbox, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { fmtDate, nextTrip } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

type Filter = 'all' | 'trips' | 'money' | 'circles';
const MONEY = new Set(['refund_moved']);
const CIRCLE = new Set(['circle']);
const ICON: Partial<Record<Notification['kind'], IconName>> = { refund_moved: 'refund', agent_reply: 'doc', agent_needs_answer: 'doc', booking_confirmed: 'check', circle: 'circles', document_problem: 'visa' };
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? t('inbox.justNow') : m < 60 ? t('inbox.minAgo', { n: m }) : m < 1440 ? t('inbox.hAgo', { n: Math.round(m / 60) }) : fmtDate(iso); };

/** Updates (prototype Support.jsx Inbox): everything that happened, so a missed banner is never lost. */
export default function Inbox() {
  const router = useRouter();
  const qc = useQueryClient();
  const inbox = useInbox();
  const trips = useTrips();
  const [filter, setFilter] = useState<Filter>('all');
  const all = inbox.data ?? [];
  const items = all.filter((n) => filter === 'all' || (filter === 'money' ? MONEY.has(n.kind) : filter === 'circles' ? CIRCLE.has(n.kind) : !MONEY.has(n.kind) && !CIRCLE.has(n.kind)));
  const unread = all.filter((n) => !n.readAt);
  const markRead = async (ids: string[]) => {
    const now = new Date().toISOString();
    qc.setQueryData<Notification[]>(walletKeys.notifications, (old) => old?.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    await walletApi.markNotificationsRead(ids);
  };
  const trip = nextTrip(trips.data);
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
        right={unread.length ? <Pressable accessibilityRole="button" onPress={() => markRead(unread.map((n) => n.id))} style={{ paddingHorizontal: 8 }} testID="inbox-mark-read"><T v="h3" style={{ fontSize: 15, textDecorationLine: 'underline' }}>{t('inbox.markRead')}</T></Pressable> : undefined} />
      <Scroll top={4} contentStyle={{ gap: 12 }} bottomPad={60}>
        <T v="h1" accessibilityRole="header">{t('inbox.title')}</T>
        <View style={{ flexDirection: 'row', gap: 16 }} accessibilityLabel={t('inbox.filter')}>
          {(['all', 'trips', 'money', 'circles'] as const).map((id) => (
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: filter === id }} onPress={() => { buzz('select'); setFilter(id); }} style={{ paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: filter === id ? colors.gold : 'transparent' }} testID={`inbox-${id}`}>
              <T style={{ fontFamily: ff.ui600, fontSize: 15, color: filter === id ? colors.green : colors.muted }}>{t(`inbox.${id}`)}</T>
            </Pressable>
          ))}
        </View>
        {items.length === 0 ? (
          <EmptyState art={<QuietRadar />} stageHeight={170} title={t('inbox.empty.title')}
            body={filter === 'money' ? t('inbox.empty.money') : filter === 'circles' ? t('inbox.empty.circles') : trip ? t('inbox.empty.watching') : t('inbox.empty.body')}
            action={!trip && (filter === 'all' || filter === 'trips') ? <Button block={false} label={t('inbox.empty.plan')} onPress={() => router.push('/ask')} /> : undefined} />
        ) : items.map((n) => (
          <Pressable key={n.id} accessibilityRole="button" onPress={() => { markRead([n.id]); if (n.href) router.push(n.href as '/today'); }} style={[styles.row, !n.readAt ? { backgroundColor: colors.paper } : null]}>
            <View style={styles.icon}><Icon name={ICON[n.kind] ?? 'flight'} size={20} color={n.readAt ? colors.muted : colors.green} /></View>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <T v="h3" style={{ fontSize: 15, flexShrink: 1 }}>{n.title}</T>
                <T v="tiny" style={{ marginEnd: n.readAt ? 0 : 14 }}>{ago(n.createdAt)}</T>
              </View>
              <T v="small" color={colors.inkSoft}>{n.body}</T>
            </View>
            {!n.readAt ? <View style={styles.dot} accessibilityLabel={t('inbox.unread')} /> : null}
          </Pressable>
        ))}
      </Scroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 20 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 18, end: 14, width: 8, height: 8, borderRadius: 9, backgroundColor: colors.goldDeep },
});
