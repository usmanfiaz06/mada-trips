import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shortDay, timeLabel, todayIn, weekdayName, type AskThreadRow, type CopyKey } from '@mada/shared';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { ChipWrap } from '@/components/booking/parts';
import { askThreadsApi } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';

/*
 * Ask's home: the chats (docs/app/ASK-INTEGRATED.md §2.4, §9.1, and the owner's U1+ row in §11): grouped Today /
 * Yesterday / This week / This month / Earlier by their last line, with filters All · Trips · Upcoming · Past · Archived
 * (Upcoming in trip order). Search reads titles, trip places and every line said, on the server; a row found by a line
 * shows that line, and opens the chat at it. The composer stays at the bottom: typing there starts a new chat, so the
 * list is never a wall in front of asking. Archive, rename and delete sit behind each row's "⋯"; deleting a chat never
 * touches its trip.
 */

export type ChatFilter = 'all' | 'trips' | 'upcoming' | 'past' | 'archived';
export const threadsKey = (q: string, filter: ChatFilter) => ['ask', 'threads', filter, q] as const;
const FILTERS: [ChatFilter, CopyKey][] = [['all', 'chat.list.filter.all'], ['trips', 'chat.list.filter.trips'], ['upcoming', 'chat.list.filter.upcoming'], ['past', 'chat.list.filter.past'], ['archived', 'chat.list.archivedTitle']];

/** Today, Yesterday, This week (the last 7 days), This month, Earlier: by the chat's last line, on the phone's calendar. */
export function groupOf(iso: string, now = new Date()): 'today' | 'yesterday' | 'week' | 'month' | 'earlier' {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = d.getTime();
  if (at >= start) return 'today';
  if (at >= start - DAY) return 'yesterday';
  if (at >= start - 6 * DAY) return 'week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'month';
  return 'earlier';
}
const GROUPS = [['today', 'chat.list.group.today'], ['yesterday', 'chat.list.group.yesterday'], ['week', 'chat.list.group.week'], ['month', 'chat.list.group.month'], ['earlier', 'chat.list.group.earlier']] as const;

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const DAY = 86_400_000;

/** "14:05" today, "Yesterday", "Mon" this week, "3 Oct" before that. */
function whenOf(iso: string, now = Date.now()): string {
  const locale = getLocale();
  const day = iso.slice(0, 10);
  const today = todayIn();
  const at = Date.parse(iso);
  if (day === today) return timeLabel(iso, { locale });
  if (now - at < 2 * DAY && new Date(now - DAY).toISOString().slice(0, 10) <= day) return t('circles.when.yesterday');
  if (now - at < 6 * DAY) return weekdayName(new Date(at).getDay(), { locale });
  return shortDay(day, locale);
}

const STATUS_KEY = { planning: 'chat.trip.planning', booked: 'chat.trip.booked', today: 'chat.trip.today', done: 'chat.trip.done' } as const;

export function ChatList({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const bottom = useBottomInset();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const archived = filter === 'archived';
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const term = q.trim();
  const list = useQuery({
    queryKey: threadsKey(term, filter),
    queryFn: () => askThreadsApi.list({ q: term || undefined, archived, filter: filter === 'all' || archived ? undefined : filter }),
    placeholderData: (prev) => prev,
  });
  // Back from a chat: its new line and title show at once.
  const { refetch } = list;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const rows = list.data?.threads ?? [];
  // Upcoming trips read in trip order; everything else in groups by the last line.
  const upcoming = filter === 'upcoming' ? [...rows].sort((a, b) => (a.tripStart ?? '').localeCompare(b.tripStart ?? '')) : [];
  const groups = filter === 'upcoming' ? [] : GROUPS.map(([g, key]) => ({ g, key, items: rows.filter((r) => groupOf(r.lastAt) === g) })).filter((x) => x.items.length);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ask', 'threads'] });

  // Found by a line said in it: the chat opens at that line.
  const open = (r: AskThreadRow) => { buzz('tap'); setMenu(null); router.push({ pathname: '/ask/[threadId]', params: { threadId: r.id, from: 'list', ...(term && r.match ? { find: term } : {}) } }); };
  const start = (text?: string) => {
    buzz('tap');
    router.push({ pathname: '/ask/[threadId]', params: { threadId: 'new', from: 'list', ...(text ? { prefill: text } : {}) } });
    setDraft('');
  };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); if (done) toast(done); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); }
    setMenu(null); setConfirm(null); setRenaming(null);
    await refresh();
  };

  const row = (r: AskThreadRow) => {
    const title = r.title ?? t('chat.list.untitled');
    const when = whenOf(r.lastAt);
    const line = r.match ? r.match : r.mode === 'agent' && r.agent ? t('chat.list.agentHere', { agent: r.agent }) : r.ended ? t('chat.list.ended') : r.preview;
    return (
      <View key={r.id} style={styles.rowWrap} testID="ask-thread-row">
        <Pressable accessibilityRole="button" accessibilityLabel={t('chat.list.a11y.row', { title, when }) + (r.unread ? `. ${t('chat.list.a11y.unread')}` : '')}
          onPress={() => open(r)} onLongPress={() => { buzz('soft'); setMenu(r.id); }} style={styles.row} testID={`ask-thread-${r.id}`}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <T v="body" numberOfLines={1} style={{ fontFamily: ff.ui600, color: colors.green }} testID="ask-thread-title">{title}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {r.tripStatus ? <View style={[styles.chip, r.tripStatus === 'planning' ? styles.chipPlan : null]}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t(STATUS_KEY[r.tripStatus])}</T></View> : null}
              {line ? <T v="small" color={r.mode === 'agent' && !r.match ? colors.goldInk : colors.ink2} numberOfLines={1} style={{ flex: 1 }} testID={r.match ? 'ask-thread-match' : undefined}>{line}</T> : null}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <T v="tiny" color={colors.muted}>{when}</T>
            {r.unread ? <View style={styles.dot} testID="ask-thread-unread" /> : <View style={{ height: 8 }} />}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat.list.more')} hitSlop={10} onPress={() => { buzz('tap'); setConfirm(null); setRenaming(null); setMenu(menu === r.id ? null : r.id); }} style={styles.more} testID="ask-thread-more">
            <Icon name="more" size={18} color={colors.ink2} />
          </Pressable>
        </Pressable>
        {menu === r.id ? (
          confirm === r.id ? (
            <View style={styles.menu}>
              <T v="small">{t('chat.list.deleteAsk')}</T>
              <ChipWrap>
                <Chip label={t('chat.list.deleteYes')} background={colors.paper} onPress={() => { void act(() => askThreadsApi.remove(r.id)); }} testID="ask-thread-delete-yes" />
                <Chip label={t('chat.list.keep')} background={colors.paper} onPress={() => setConfirm(null)} />
              </ChipWrap>
            </View>
          ) : renaming?.id === r.id ? (
            <View style={[styles.menu, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput value={renaming.title} onChangeText={(v) => setRenaming({ id: r.id, title: v })} autoFocus maxLength={80} accessibilityLabel={t('chat.list.rename')}
                style={[styles.renameInput, webNoOutline]} testID="ask-thread-rename-input" onSubmitEditing={() => { void act(() => askThreadsApi.patch(r.id, { title: renaming.title })); }} />
              <Chip label={t('chat.list.save')} background={colors.paper} onPress={() => { void act(() => askThreadsApi.patch(r.id, { title: renaming.title })); }} testID="ask-thread-rename-save" />
            </View>
          ) : (
            <View style={styles.menu}>
              <ChipWrap>
                <Chip label={r.archived ? t('chat.list.unarchive') : t('chat.list.archive')} background={colors.paper}
                  onPress={() => { void act(() => askThreadsApi.patch(r.id, { archived: !r.archived })); }} testID="ask-thread-archive" />
                <Chip label={t('chat.list.rename')} background={colors.paper} onPress={() => setRenaming({ id: r.id, title: r.title ?? '' })} testID="ask-thread-rename" />
                <Chip label={t('chat.list.delete')} background={colors.paper} onPress={() => setConfirm(r.id)} testID="ask-thread-delete" />
              </ChipWrap>
            </View>
          )
        ) : null}
      </View>
    );
  };

  const section = (label: string, items: AskThreadRow[], testID: string) => items.length ? (
    <View key={testID} style={{ gap: 2 }} testID={testID}>
      <T v="tiny" color={colors.muted} style={styles.section} accessibilityRole="header">{label}</T>
      {items.map(row)}
    </View>
  ) : null;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar onBack={archived ? () => setFilter('all') : onBack} backLabel={archived ? t('chat.list.back') : t('ask.close')} home={false}
          title={archived ? t('chat.list.archivedTitle') : t('chat.list.title')} right={(
            <Pressable accessibilityRole="button" accessibilityLabel={t('chat.newChat.a11y')} onPress={() => start()} style={styles.plus} testID="ask-list-new">
              <Icon name="plus" size={20} color={colors.green} />
            </Pressable>
          )} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: 120 + bottom }]} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => { void list.refetch(); }} />} testID="ask-list">
          <View style={styles.search}>
            <TextInput value={q} onChangeText={setQ} placeholder={t('chat.list.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('chat.list.search')}
              returnKeyType="search" style={[styles.searchInput, webNoOutline]} testID="ask-list-search" />
            {q ? <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => setQ('')} hitSlop={8}><Icon name="close" size={16} color={colors.muted} /></Pressable> : null}
          </View>
          {list.isFetching && list.data ? <T v="tiny" color={colors.muted}>{t('chat.list.updating')}</T> : null}
          {list.isError ? <T v="small" color={colors.ink2} testID="ask-list-error">{t('chat.list.error')}</T> : null}
          {list.isPending ? [0, 1, 2].map((i) => <View key={i} style={styles.skeleton} />) : null}
          {list.data && !rows.length && term ? <T v="small" color={colors.ink2} testID="ask-list-none">{t('chat.list.none', { q: term })}</T> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} testID="ask-list-filters">
            {FILTERS.map(([f, key]) => (
              <Chip key={f} label={t(key)} on={filter === f} background={filter === f ? undefined : colors.paper}
                onPress={() => { buzz('tap'); setMenu(null); setFilter(f); }} testID={`ask-filter-${f}`} />
            ))}
          </ScrollView>
          {section(t('chat.list.upcoming'), upcoming, 'ask-list-upcoming')}
          {groups.map((x) => section(t(x.key), x.items, `ask-list-${x.g}`))}
          {filter === 'all' && !term && (list.data?.archivedCount ?? 0) > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); setMenu(null); setFilter('archived'); }} style={styles.archivedRow} testID="ask-list-archived">
              <T v="body" color={colors.green}>{t('chat.list.archived', { count: list.data!.archivedCount })}</T>
              <Icon name="chevron" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={[styles.act, { paddingBottom: 24 + bottom }]} pointerEvents="box-none">
          <View style={styles.composer}>
            <TextInput value={draft} onChangeText={setDraft} placeholder={t('chat.list.composer')} placeholderTextColor={colors.muted} accessibilityLabel={t('ask.a11y.input')}
              onSubmitEditing={() => { if (draft.trim()) start(draft.trim()); }} returnKeyType="send" style={[styles.input, webNoOutline]} testID="ask-input" />
            <Pressable accessibilityRole="button" accessibilityLabel={t('ask.a11y.send')} onPress={() => (draft.trim() ? start(draft.trim()) : start())} style={styles.send} testID="ask-send">
              <Icon name="up" color={colors.mist} size={20} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 14, paddingTop: 4 },
  search: { height: 44, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 15, color: colors.green },
  section: { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6, marginBottom: 4, fontFamily: ff.ui600 },
  rowWrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  chip: { paddingHorizontal: 8, height: 20, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  chipPlan: { backgroundColor: colors.goldWash },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  more: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  menu: { gap: 8, paddingBottom: 12 },
  renameInput: { flex: 1, minWidth: 0, height: 40, borderRadius: 12, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, fontFamily: ff.ui400, fontSize: 15, color: colors.green },
  archivedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  skeleton: { height: 56, borderRadius: 14, backgroundColor: 'rgba(30,53,45,0.06)' },
  plus: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.goldWash, alignItems: 'center', justifyContent: 'center' },
  act: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 20, backgroundColor: 'rgba(233,226,216,0.96)' },
  composer: { height: 56, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 20, paddingEnd: 6, flexDirection: 'row', alignItems: 'center', gap: 8, boxShadow: '0px 10px 30px -18px rgba(30,53,45,0.4)' },
  input: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  send: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
