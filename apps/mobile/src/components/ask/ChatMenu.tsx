import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { askThreadsApi } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';

/*
 * A conversation's own menu (docs/app/ASK-INTEGRATED.md §9.2 "⋯": rename, plan, archive, delete), the same actions
 * the chats list has on each row. A chat about a trip opens its plan and its trip from here. Deleting a chat never
 * touches its trip, plan or bookings (said before it's done). The shared trip chat is the organiser's to rename or
 * delete; anyone in it can open the plan and the trip.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export function ChatMenu({ threadId, visible, onClose, onGone }: { threadId: string; visible: boolean; onClose: () => void; onGone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ask', 'thread', threadId], queryFn: () => askThreadsApi.get(threadId), enabled: visible });
  const row = q.data?.thread;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = row?.mine !== false;
  const close = () => { setRenaming(null); setConfirm(false); onClose(); };
  const act = async (fn: () => Promise<unknown>, done: string, gone = false) => {
    setBusy(true);
    try {
      await fn();
      buzz('success');
      toast(done);
      void qc.invalidateQueries({ queryKey: ['ask'] });
      close();
      if (gone) onGone();
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const go = (href: string) => { close(); router.push(href as Href); };
  return (
    <Sheet visible={visible} onClose={close} label={t('chat.menu.title')}>
      <View style={{ gap: 14 }} testID="chat-menu">
        <T v="h2">{row?.title ?? t('chat.menu.title')}</T>
        {row?.tripId ? (
          <View style={styles.chips}>
            <Chip label={t('chat.menu.plan')} onPress={() => go(`/trip/${row.tripId}/plan`)} testID="chat-menu-plan" />
            <Chip label={t('chat.menu.trip')} onPress={() => go(`/trip/${row.tripId}`)} testID="chat-menu-trip" />
          </View>
        ) : null}
        {mine && row ? (
          renaming !== null ? (
            <View style={{ gap: 8 }}>
              <TextInput value={renaming} onChangeText={setRenaming} autoFocus maxLength={80} accessibilityLabel={t('chat.list.rename')} style={[styles.input, webNoOutline]} testID="chat-menu-rename-input"
                onSubmitEditing={() => { void act(() => askThreadsApi.patch(threadId, { title: renaming }), t('chat.menu.renamed')); }} />
              <Button label={t('chat.list.save')} busy={busy} onPress={() => { void act(() => askThreadsApi.patch(threadId, { title: renaming }), t('chat.menu.renamed')); }} testID="chat-menu-rename-save" />
            </View>
          ) : confirm ? (
            <View style={{ gap: 8 }}>
              <T v="small">{t('chat.list.deleteAsk')}</T>
              <View style={styles.chips}>
                <Chip label={t('chat.list.deleteYes')} onPress={() => { void act(() => askThreadsApi.remove(threadId), t('chat.menu.deleted'), true); }} testID="chat-menu-delete-yes" />
                <Chip label={t('chat.list.keep')} onPress={() => setConfirm(false)} />
              </View>
            </View>
          ) : (
            <View style={styles.chips}>
              <Chip label={t('chat.list.rename')} onPress={() => setRenaming(row.title ?? '')} testID="chat-menu-rename" />
              <Chip label={row.archived ? t('chat.list.unarchive') : t('chat.list.archive')} testID="chat-menu-archive"
                onPress={() => { void act(() => askThreadsApi.patch(threadId, { archived: !row.archived }), row.archived ? t('chat.list.unarchive') : t('chat.menu.archived'), !row.archived); }} />
              <Chip label={t('chat.list.delete')} onPress={() => setConfirm(true)} testID="chat-menu-delete" />
            </View>
          )
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
});
