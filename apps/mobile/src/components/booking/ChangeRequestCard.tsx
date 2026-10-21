import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { dayLabel, timeLabel, type ChangeLine, type ChangeRequestView, type ChatCard } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Pill } from '@/components/Pill';
import { T } from '@/components/Text';
import { sendAskChat } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { peopleApi, pk, useChange } from '@/lib/trip-people';
import { colors } from '@/theme';
import { Frame, Line, s } from './PeopleFrame';

/*
 * A change a companion asked for (ASK-INTEGRATED.md §5.5): the same card in his chat ("Waiting for Omar") and in the
 * owner's chat for the trip (Approve · Decline · Change it), read again from the server so both show where it stands.
 * Approve applies it to the plan; Decline can carry a one-line reason; Change it asks Mada in this chat to adjust it.
 * A change that needs booking says it goes to the owner's pay sheet; the companion never pays from here.
 */

type ChangeChatCard = Extract<ChatCard, { type: 'change' }>;

/** One line of the change in the reader's language ("Stay in Melaka: 1 → 2 nights"). */
export function lineText(l: ChangeLine): string {
  if (l.op === 'update' && l.field === 'nights') return t('people.line.op.nights', { title: l.title, from: l.from ?? '', to: l.to ?? '' });
  if (l.op === 'update' && l.field === 'title') return t('people.line.op.rename', { from: l.from ?? l.title, to: l.to ?? '' });
  if (l.op === 'move' && l.from && l.to) return t('people.line.op.move', { title: l.title, from: l.from, to: l.to });
  const key = ({ add: 'people.line.op.add', remove: 'people.line.op.remove', skip: 'people.line.op.skip', unskip: 'people.line.op.unskip', update: 'people.line.op.update', move: 'people.line.op.update' } as const)[l.op];
  return t(key, { title: l.title });
}

function statusLine(c: ChangeRequestView): { text: string; variant: 'gold' | 'ok' | 'default' } {
  const locale = getLocale();
  if (c.status === 'approved') return { text: t('people.change.approved', { name: c.ownerName }), variant: 'ok' };
  if (c.status === 'declined') return { text: t('people.change.declined', { name: c.ownerName }), variant: 'default' };
  if (c.status === 'expired') return { text: t('people.change.expired'), variant: 'default' };
  if (c.status === 'cancelled') return { text: t('people.change.cancelled'), variant: 'default' };
  if (c.mine) return { text: t('people.change.until', { time: `${dayLabel(c.expiresAt.slice(0, 10), { locale })} ${timeLabel(c.expiresAt, { locale })}` }), variant: 'gold' };
  return { text: t('people.change.waiting', { name: c.ownerName }), variant: 'gold' };
}

export function ChangeRequestCard({ card }: { card: ChangeChatCard }) {
  const router = useRouter();
  const qc = useQueryClient();
  const live = useChange(card.change.tripId, card.change.id, card.change.status === 'pending');
  const c = live.data ?? card.change;
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'decline') => {
    buzz(decision === 'approve' ? 'success' : 'tap');
    setBusy(decision);
    setProblem(null);
    try {
      const r = await peopleApi.decide(c.tripId, c.id, { decision, reason: decision === 'decline' && reason.trim() ? reason.trim() : null });
      qc.setQueryData(pk.change(c.tripId, c.id), r.change);
      void qc.invalidateQueries({ queryKey: ['trips'] });
      setDeclining(false);
    } catch (e) {
      setProblem((e as { message?: string })?.message || t('people.change.stale'));
    } finally {
      setBusy(null);
    }
  };
  const st = statusLine(c);
  const open = c.status === 'pending';
  return (
    <Frame icon="edit" title={c.mine ? t('people.change.title', { name: c.byName }) : t('people.change.titleMine', { trip: c.tripTitle })} sub={c.summary}
      pill={<View testID="chat-change-status"><Pill label={st.text} variant={st.variant} style={{ marginTop: 2, alignSelf: 'flex-start' }} /></View>} testID="chat-change-card">
      <View style={{ gap: 8 }} testID="chat-change-lines">
        {c.lines.map((l, i) => (
          <View key={i} style={s.line}>
            <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: colors.gold }} />
            <T v="small" color={colors.green} style={{ flex: 1 }}>{lineText(l)}</T>
          </View>
        ))}
      </View>
      {c.costs ? <Line icon="card" text={c.mine ? t('people.change.costs') : t('people.change.costsTheirs', { name: c.ownerName })} testID="chat-change-costs" /> : null}
      {c.status === 'declined' && c.reason ? <Line icon="doc" text={t('people.change.why', { reason: c.reason })} /> : null}
      {c.status === 'approved' && c.mine && c.costs ? (
        <Button size="small" variant="secondary" label={t('people.change.openPlan')} onPress={() => router.push(`/trip/${c.tripId}` as Href)} style={{ height: 44, alignSelf: 'stretch', backgroundColor: colors.mist }} testID="chat-change-open" />
      ) : null}
      {problem ? <T v="small" color={colors.badInk} accessibilityLiveRegion="polite">{problem}</T> : null}
      {open && c.mine && declining ? (
        <View style={{ gap: 8 }}>
          <Field label={t('people.change.reason')} value={reason} onChangeText={setReason} maxLength={140} testID="chat-change-reason" />
          <View style={s.buttons}>
            <Button size="small" block={false} label={t('people.change.sendDecline')} onPress={() => void decide('decline')} busy={busy === 'decline'} style={{ height: 44 }} testID="chat-change-decline-send" />
            <Button size="small" block={false} variant="secondary" label={t('people.change.keep')} onPress={() => setDeclining(false)} style={{ height: 44, backgroundColor: colors.mist }} testID="chat-change-keep" />
          </View>
        </View>
      ) : null}
      {open && c.mine && !declining ? (
        <View style={s.buttons}>
          <Button size="small" block={false} label={t('people.change.approve')} onPress={() => void decide('approve')} busy={busy === 'approve'} disabled={!!busy} style={{ height: 44, flexGrow: 1 }} testID="chat-change-approve" />
          <Button size="small" block={false} variant="secondary" label={t('people.change.decline')} onPress={() => { buzz('tap'); setDeclining(true); }} disabled={!!busy} style={{ height: 44, flexGrow: 1, backgroundColor: colors.mist }} testID="chat-change-decline" />
          <Button size="small" block={false} variant="ghost" label={t('people.change.changeIt')} disabled={!!busy}
            onPress={() => { buzz('tap'); void sendAskChat(t('people.change.changeItSay', { name: c.byName, trip: c.tripTitle }), { tripId: c.tripId }); }} style={{ height: 44, flexGrow: 1 }} testID="chat-change-edit" />
        </View>
      ) : null}
    </Frame>
  );
}
