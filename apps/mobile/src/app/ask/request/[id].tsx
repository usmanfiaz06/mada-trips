import { useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { AgentDot } from '@/components/booking/parts';
import { ReplyBar, SentRequest } from '@/components/booking/Requests';
import { TravellerPassports } from '@/components/passport/TravellerPassports';
import { useBookingRequest, useThread } from '@/lib/booking';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { travelEnds } from '@/lib/travel-ends';
import { colors, font } from '@/theme';

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
  const qc = useQueryClient();
  const people = usePeople();
  const selfName = useSession((s) => s.user?.name ?? '');
  // A visa, Umrah or flight request still being worked on shows each traveller's passport, added right here.
  const passportsOpen = !!r && !['paid', 'done', 'cancelled'].includes(r.status);
  const agent = r?.agent?.name ?? 'Mada';
  const status = !r ? '' : th.data?.agentTyping ? t('presence.typing', { agent }) : r.status === 'quoted' ? t('ask.req.status.answered') : r.status === 'paid' || r.status === 'done' ? t('ask.req.status.paid')
    : r.status === 'reviewing' ? t('ask.req.status.onIt', { agent }) : r.status === 'cancelled' ? t('ask.req.cancelled') : t('ask.req.status.sent');
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar onBack={() => router.back()} backLabel={t('common.back')} />
        {r ? (
          <View style={styles.head}>
            <AgentDot name={agent} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <T style={font('displaySmall')} accessibilityRole="header">{t('ask.req.withAgent', { agent })}</T>
              <T v="small" accessibilityLiveRegion="polite" testID="request-status">{status}</T>
            </View>
          </View>
        ) : null}
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {passportsOpen ? <View style={{ marginBottom: 14 }}><TravellerPassports kind={r!.kind} people={people.data ?? []} travellerIds={r!.travellerIds} selfName={selfName} travelEnds={travelEnds(qc, { kind: 'quote', requestId: rid }, r)} testID="request-passports" /></View> : null}
          <SentRequest id={rid} screen />
        </ScrollView>
        {r && r.status !== 'cancelled' ? <View style={[styles.bar, { paddingBottom: 16 + bottom }]}><ReplyBar requestId={rid} agent={agent} /></View> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.line },
  bar: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.sand },
});
