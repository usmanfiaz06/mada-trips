import { useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { AgentDot } from '@/components/booking/parts';
import { ReplyBar, SentRequest } from '@/components/booking/Requests';
import { useBookingRequest, useThread } from '@/lib/booking';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';

/*
 * One request as a conversation with the agent: who it's with and where it stands at the top, the request, the
 * answer with its price and the replies in between, and one reply box at the bottom (the Pay button sits in the
 * answer, never in the box's place). Opened from Trips → Requests, from "Mada replied", and after sending one in Ask.
 */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bottom = useBottomInset();
  const rid = String(id ?? '');
  const r = useBookingRequest(rid).data;
  const th = useThread(rid);
  const scroll = useRef<ScrollView>(null);
  const agent = r?.agent?.name ?? 'Mada';
  const status = !r ? '' : th.data?.agentTyping ? t('presence.typing', { agent }) : r.status === 'quoted' ? t('ask.req.status.answered') : r.status === 'paid' || r.status === 'done' ? t('ask.req.status.paid')
    : r.status === 'reviewing' ? t('ask.req.status.onIt', { agent }) : r.status === 'cancelled' ? t('ask.req.cancelled') : t('ask.req.status.sent');
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar onBack={() => router.back()} backLabel={t('common.back')} />
        {r ? (
          <View style={styles.head}>
            <AgentDot name={agent} size={40} />
            <View style={{ flex: 1 }}>
              <T v="h3" accessibilityRole="header">{t('ask.req.withAgent', { agent })}</T>
              <T v="small" accessibilityLiveRegion="polite" testID="request-status">{status}</T>
            </View>
          </View>
        ) : null}
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <SentRequest id={rid} screen />
        </ScrollView>
        {r && r.status !== 'cancelled' ? <View style={[styles.bar, { paddingBottom: 16 + bottom }]}><ReplyBar requestId={rid} agent={agent} /></View> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.line },
  bar: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.sand },
});
