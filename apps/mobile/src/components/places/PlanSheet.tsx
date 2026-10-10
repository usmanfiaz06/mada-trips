import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { monthName, planMessage, type CityGuide } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { colors, ff, font } from '@/theme';


/** The next eight months as "2027-05", starting next month. */
function nextMonths(now = new Date()) {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export type PlanChoice = { travellers: number; month: string | null; message: string };

/**
 * "Plan it with Mada" for a city we don't sell in the app: how many, roughly when, and their words (prefilled, theirs
 * to change). Sends one request to the desk; the chat opens with this message in it.
 */
export function PlanSheet({ place, visible, onClose, onSend, busy, error, note }: {
  place: CityGuide; note: string; visible: boolean; onClose: () => void; onSend: (c: PlanChoice) => void; busy?: boolean; error?: unknown;
}) {
  const people = usePeople();
  const household = (people.data ?? []).filter((p) => p.relation !== 'helper').length || 1;
  const [n, setN] = useState<number | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const count = n ?? Math.min(household, 6);
  const generated = planMessage({ city: place.name, travellers: count, month });
  const message = text ?? generated;
  const offline = error instanceof ApiError && error.code === 'OFFLINE';
  return (
    <Sheet visible={visible} onClose={onClose} label={t('places.plan.title', { city: place.name })}>
      <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
        <T v="h2">{t('places.plan.title', { city: place.name })}</T>
        <T v="eyebrow">{t('places.plan.who')}</T>
        <View style={s.chips}>
          {[1, 2, 3, 4, 5, 6].map((k) => <Chip key={k} label={k === 6 ? '6+' : String(k)} on={count === k} onPress={() => { setN(k); setText(null); }} />)}
        </View>
        <T v="eyebrow">{t('places.plan.when')}</T>
        <View style={s.chips}>
          {nextMonths().map((m) => <Chip key={m} label={monthName(Number(m.slice(5)) - 1)} on={month === m} onPress={() => { setMonth(m); setText(null); }} />)}
          <Chip label={t('places.plan.undecided')} on={month === null} onPress={() => { setMonth(null); setText(null); }} />
        </View>
        <View style={{ gap: 6 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('places.plan.message')}</T>
          <TextInput value={message} onChangeText={setText} multiline accessibilityLabel={t('places.plan.message')} testID="plan-message"
            style={[s.input, font('body', colors.green)]} maxLength={600} />
        </View>
        <T v="tiny">{note}</T>
        {offline ? <T v="small" color={colors.badInk}>{t('places.plan.offline')}</T> : null}
        <Button label={busy ? t('places.plan.sending') : t('places.plan.send')} busy={busy} disabled={!message.trim()} haptic="success" testID="plan-send"
          onPress={() => onSend({ travellers: count, month, message: message.trim() })} />
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 84, borderRadius: 16, padding: 14, fontSize: 17, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, textAlignVertical: 'top' },
});
