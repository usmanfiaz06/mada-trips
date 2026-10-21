import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ChatCard, PeopleMatch } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { peopleApi } from '@/lib/trip-people';
import { colors, ff } from '@/theme';
import { Frame, Initial, Line, s } from './PeopleFrame';
import { InviteCard } from './InviteCard';

/*
 * "Which Abdullah?" (ASK-INTEGRATED.md §5.1, §9.2): the people a name matched, up to four, each with how they're known
 * ("Your household · Family", "Friend · Riyadh Hiking"), and Someone else. Mada never picks: the tap adds the one
 * chosen (a friend on Mada is told in his app, which is why it waits for this tap). Someone else opens the invite.
 */

type PeopleCard = Extract<ChatCard, { type: 'people' }>;

export function ChoiceCard({ card }: { card: PeopleCard }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<PeopleMatch | null>(null);
  const [other, setOther] = useState(false);
  const [problem, setProblem] = useState(false);
  const pick = async (m: PeopleMatch) => {
    buzz('select');
    setBusy(m.ref.id);
    setProblem(false);
    try {
      await peopleApi.add(card.tripId, m.ref.kind === 'person' ? { personId: m.ref.id } : { userId: m.ref.id });
      setAdded(m);
    } catch {
      setProblem(true);
    } finally {
      setBusy(null);
    }
  };
  if (other) return <InviteCard card={{ type: 'invite', tripId: card.tripId, name: card.name, tripTitle: '', when: null }} />;
  if (added) {
    return (
      <Frame icon="user" title={t('people.added', { name: added.name })} testID="chat-people-added">
        <Line icon="check" text={added.how} />
      </Frame>
    );
  }
  return (
    <Frame icon="user" title={t('people.which', { name: card.name })} testID="chat-people-card">
      <View style={{ gap: 8 }}>
        {card.options.map((m) => (
          <Pressable key={`${m.ref.kind}-${m.ref.id}`} testID={`chat-people-${m.ref.kind}`} accessibilityRole="button" accessibilityLabel={t('people.a11y.pick', { name: m.name, how: m.how })}
            disabled={!!busy} onPress={() => void pick(m)} style={({ pressed }) => [s.pick, pressed ? { opacity: 0.8 } : null, busy && busy !== m.ref.id ? { opacity: 0.55 } : null]}>
            <Initial letter={m.initial} gold={m.ref.kind === 'user'} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="small" style={{ fontFamily: ff.ui600 }} color={colors.green}>{m.name}</T>
              <T v="tiny" color={colors.ink2} numberOfLines={1}>{m.how}</T>
            </View>
            <Icon name="plus" size={18} color={colors.green} />
          </Pressable>
        ))}
        <Pressable testID="chat-people-other" accessibilityRole="button" onPress={() => { buzz('tap'); setOther(true); }} style={({ pressed }) => [s.pick, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line }, pressed ? { opacity: 0.8 } : null]}>
          <Initial letter="+" />
          <T v="small" style={{ fontFamily: ff.ui600, flex: 1 }} color={colors.green}>{t('people.someoneElse')}</T>
        </Pressable>
      </View>
      {problem ? <T v="small" color={colors.badInk} accessibilityLiveRegion="polite">{t('people.invite.notSent')}</T> : null}
    </Frame>
  );
}
