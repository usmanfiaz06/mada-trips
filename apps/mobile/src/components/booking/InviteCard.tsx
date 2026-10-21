import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ChatCard } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { peopleApi } from '@/lib/trip-people';
import { colors, ff } from '@/theme';
import { Frame, Line, s } from './PeopleFrame';

/*
 * "Abdullah isn't in your circle yet. Invite him?" (ASK-INTEGRATED.md §5.1, §9.6). The invite shares the trip's name
 * and dates with someone outside the household, so it only goes out on Send invite: by WhatsApp or SMS, or in his app
 * when the number is already on Mada. Just add the name puts him on the plan (counted, priced for) with nothing sent.
 */

type InviteChatCard = Extract<ChatCard, { type: 'invite' }>;
type Done = { kind: 'sent' | 'in_app' | 'already' | 'named' };

/** "+966 5x xxx xxxx" from what was typed: a Saudi mobile without its country code gets +966. */
export function e164Of(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const local = digits.replace(/^00/, '+');
  const full = local.startsWith('+') ? local : /^0?5\d{8}$/.test(local) ? `+966${local.replace(/^0/, '')}` : '';
  return /^\+[1-9]\d{7,14}$/.test(full) ? full : null;
}

export function InviteCard({ card }: { card: InviteChatCard }) {
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [busy, setBusy] = useState<'send' | 'name' | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    const e164 = e164Of(phone);
    if (!e164) { setProblem(t('people.invite.badNumber')); return; }
    buzz('tap');
    setBusy('send');
    setProblem(null);
    try {
      const r = await peopleApi.invite(card.tripId, { name: card.name, phone: e164, channel });
      setDone({ kind: r.result });
    } catch {
      setProblem(t('people.invite.notSent'));
    } finally {
      setBusy(null);
    }
  };
  const nameOnly = async () => {
    buzz('tap');
    setBusy('name');
    setProblem(null);
    try {
      await peopleApi.add(card.tripId, { name: card.name });
      setDone({ kind: 'named' });
    } catch {
      setProblem(t('people.invite.notSent'));
    } finally {
      setBusy(null);
    }
  };
  if (done) {
    const text = done.kind === 'sent' ? t('people.invite.sent', { name: card.name }) : done.kind === 'in_app' ? t('people.invite.inApp', { name: card.name })
      : done.kind === 'already' ? t('people.invite.already', { name: card.name }) : t('people.invite.nameAdded', { name: card.name });
    return <Frame icon="user" title={text} testID="chat-invite-done" />;
  }
  const trip = [card.tripTitle, card.when].filter(Boolean).join(' · ');
  return (
    <Frame icon="user" title={t('people.invite.title', { name: card.name })} sub={trip || null} testID="chat-invite-card">
      <Field label={t('people.invite.number')} value={phone} onChangeText={(v) => { setPhone(v); setProblem(null); }} keyboardType="phone-pad" autoComplete="tel" placeholder="+966 5" testID="chat-invite-phone" error={problem} />
      <View style={{ gap: 8 }}>
        <T v="small" style={{ fontFamily: ff.ui600 }}>{t('people.invite.by')}</T>
        <View style={s.buttons} accessibilityRole="radiogroup">
          {(['whatsapp', 'sms'] as const).map((c) => (
            <Pressable key={c} testID={`chat-invite-${c}`} accessibilityRole="radio" accessibilityState={{ checked: channel === c }} onPress={() => { buzz('select'); setChannel(c); }}
              style={[s.pick, { minHeight: 40, paddingHorizontal: 14, borderWidth: 1, borderColor: channel === c ? colors.green : colors.line, backgroundColor: channel === c ? colors.mist : 'transparent' }]}>
              <T v="small" color={colors.green} style={{ fontFamily: channel === c ? ff.ui600 : undefined }}>{t(`people.invite.${c}`)}</T>
            </Pressable>
          ))}
        </View>
      </View>
      <Line icon="lock" text={t('people.invite.sees')} />
      <View style={{ gap: 8 }}>
        <Button size="small" label={t('people.invite.send')} onPress={() => void send()} busy={busy === 'send'} disabled={!!busy} style={{ height: 44, alignSelf: 'stretch' }} testID="chat-invite-send" />
        <Button size="small" variant="secondary" label={t('people.invite.justName')} onPress={() => void nameOnly()} busy={busy === 'name'} disabled={!!busy} style={{ height: 44, alignSelf: 'stretch', backgroundColor: colors.mist }} testID="chat-invite-name" />
      </View>
    </Frame>
  );
}
