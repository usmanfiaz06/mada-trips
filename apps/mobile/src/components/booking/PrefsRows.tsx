import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import {
  ASSISTANCE, BED_TYPES, FLOOR_PREFS, ROOM_TYPES, formatSar, loyaltyValid, maskLoyalty, normLoyalty, personName, programmeHint, programmeName, type AppliedPrefs, type BookingLoyalty, type BookingPrefs, type LoyaltyProgramId, type Person,
} from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ChipWrap, Toggle } from '@/components/booking/parts';
import { useCircle, useCircles, useMeId } from '@/lib/circles';
import { useOnOpen } from '@/lib/wallet-model';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { colors, ff, radii } from '@/theme';

/*
 * The order sheet's quiet rows for what Mada applies from the saved preferences (owner audit items 5, 6), each with a
 * tap to change it for this booking only; the paid extra a fare prices, which is only ever added by hand; and the
 * "someone else pays" picker (item 31). The server applies and prices; these rows show what came back and send the
 * traveller's changes with the next preview.
 */

const MEALS = ['halal', 'veg', 'vegan', 'child', 'diabetic', 'gluten', 'lowsalt'] as const;

/** "Your preferences · Window · Seats together · Halal" with Change. */
export function PrefsRow({ applied, changed, onChange }: { applied: AppliedPrefs; changed: boolean; onChange: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('bp.row.title')}: ${applied.summary.join(', ')}`} accessibilityHint={t('bp.row.change')} onPress={() => { buzz('tap'); onChange(); }} style={styles.well} testID="pay-prefs">
      <Icon name="star" size={18} color={colors.ink3} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="eyebrow">{t('bp.row.title')}{changed ? ` · ${t('bp.sheet.title')}` : ''}</T>
        <T v="small" color={colors.green}>{applied.summary.length ? applied.summary.join(' · ') : t('bp.row.none')}</T>
      </View>
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

/** Change the preferences for this booking only. The saved ones stay as they are. */
export function PrefsSheet({ visible, value, scope, saved, onClose, onSave }: { visible: boolean; value: BookingPrefs; scope: AppliedPrefs['scope']; saved: BookingPrefs; onClose: () => void; onSave: (p: BookingPrefs | null) => void }) {
  const { height } = useWindowDimensions();
  const [p, setP] = useState<BookingPrefs>(value);
  useOnOpen(visible, () => setP(value));
  const set = (patch: Partial<BookingPrefs>) => { buzz('select'); setP((x) => ({ ...x, ...patch })); };
  const toggleAssist = (id: (typeof ASSISTANCE)[number]) => {
    const on = !p.assist.includes(id);
    let next = on ? [...p.assist, id] : p.assist.filter((x) => x !== id);
    if (id === 'wchr' && on) next = next.filter((x) => x !== 'wchc');
    if (id === 'wchc' && on) next = next.filter((x) => x !== 'wchr');
    if (id === 'infant' && !on) next = next.filter((x) => x !== 'bassinet');
    if (id === 'bassinet' && on && !next.includes('infant')) next.push('infant');
    set({ assist: next });
  };
  const flight = scope !== 'stay';
  const stay = scope !== 'flight';
  return (
    <Sheet visible={visible} onClose={onClose} label={t('bp.sheet.title')}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        <T v="h2">{t('bp.sheet.title')}</T>
        <T v="small">{t('bp.sheet.body')}</T>
        {flight ? (
          <>
            <T v="eyebrow">{t('bp.sheet.seat')}</T>
            <ChipWrap>{(['window', 'aisle', 'any'] as const).map((id) => <Chip key={id} on={p.seat === id} label={t(`prefs.seat.${id}`)} onPress={() => set({ seat: id })} />)}</ChipWrap>
            <Toggle label={t('bp.sheet.together')} on={p.together} onPress={() => set({ together: !p.together })} />
            <T v="eyebrow">{t('bp.sheet.meal')}</T>
            <ChipWrap>{MEALS.map((id) => <Chip key={id} on={p.meal === id} label={t(`prefs.meal.${id}`)} onPress={() => set({ meal: id })} />)}</ChipWrap>
            <T v="eyebrow">{t('bp.sheet.help')}</T>
            <ChipWrap>{ASSISTANCE.map((id) => <Chip key={id} on={p.assist.includes(id)} label={t(`bp.assist.${id}`)} onPress={() => toggleAssist(id)} />)}</ChipWrap>
          </>
        ) : null}
        {stay ? (
          <>
            <T v="eyebrow">{t('bp.sheet.room')}</T>
            <ChipWrap>{ROOM_TYPES.map((id) => <Chip key={id} on={p.room === id} label={t(`bp.room.${id}`)} onPress={() => set({ room: id })} />)}</ChipWrap>
            <T v="eyebrow">{t('bp.sheet.bed')}</T>
            <ChipWrap>{BED_TYPES.map((id) => <Chip key={id} on={p.bed === id} label={t(`bp.bed.${id}`)} onPress={() => set({ bed: id })} />)}</ChipWrap>
            <T v="eyebrow">{t('bp.sheet.floor')}</T>
            <ChipWrap>{FLOOR_PREFS.map((id) => <Chip key={id} on={p.floor === id} label={t(`bp.floor.${id}`)} onPress={() => set({ floor: id })} />)}</ChipWrap>
            <Toggle label={t('bp.sheet.quiet')} on={p.quiet} onPress={() => set({ quiet: !p.quiet })} />
            {!flight ? <ChipWrap>{(['wchr'] as const).map((id) => <Chip key={id} on={p.assist.includes(id)} label={t('bp.accessible')} onPress={() => toggleAssist(id)} />)}</ChipWrap> : null}
          </>
        ) : null}
        <T v="eyebrow">{t('bp.sheet.notes')}</T>
        <TextInput accessibilityLabel={t('bp.sheet.notes')} multiline maxLength={280} value={p.notes} onChangeText={(v) => setP((x) => ({ ...x, notes: v }))} testID="prefs-booking-notes"
          style={styles.notes} />
        <Button label={t('bp.sheet.done')} onPress={() => { buzz('success'); onSave(p); }} testID="prefs-booking-done" />
        <Button variant="ghost" label={t('bp.sheet.reset')} onPress={() => { setP(saved); onSave(null); }} />
      </ScrollView>
    </Sheet>
  );
}

/** "Saudia Alfursan ••••1234 added" (or "No Alfursan number on this booking") with Edit. Only when the booking earns. */
export function LoyaltyRow({ applied, onEdit }: { applied: AppliedPrefs; onEdit: () => void }) {
  if (!applied.programmes.length) return null;
  const first = applied.loyalty[0];
  const name = programmeName(applied.programmes[0] as LoyaltyProgramId);
  const text = first ? t('bp.loyalty.added', { name: first.programName, masked: isRTL() ? `\u2066${first.masked}\u2069` : first.masked }) + (applied.loyalty.length > 1 ? ` +${applied.loyalty.length - 1}` : '') : t('bp.loyalty.none', { name });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityHint={t('bp.loyalty.edit')} onPress={() => { buzz('tap'); onEdit(); }} style={styles.well} testID="pay-loyalty">
      <Icon name="star" size={18} color={first ? colors.ok : colors.ink3} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="eyebrow">{t('bp.loyalty.earns', { name })}</T>
        <T v="small" color={colors.green}>{text}</T>
      </View>
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

/** Loyalty numbers per traveller for this booking: one field per traveller per programme, validated the programme's way. */
export function LoyaltySheet({ visible, applied, people, travellerIds, selfName, onClose, onSave }: {
  visible: boolean; applied: AppliedPrefs; people: Person[]; travellerIds: string[]; selfName: string; onClose: () => void; onSave: (l: BookingLoyalty[]) => void;
}) {
  const { height } = useWindowDimensions();
  const programmes = applied.programmes as LoyaltyProgramId[];
  const key = (pid: string, prog: string) => `${pid}|${prog}`;
  const [nums, setNums] = useState<Record<string, string>>({});
  useOnOpen(visible, () => setNums(Object.fromEntries(applied.loyalty.map((l) => [key(l.personId, l.program), l.number]))));
  const rows = useMemo(() => travellerIds.flatMap((pid) => programmes.map((prog) => ({ pid, prog, k: key(pid, prog) }))), [travellerIds, programmes]);
  const problems = rows.filter((r) => (nums[r.k] ?? '').trim() && !loyaltyValid(r.prog, nums[r.k]!));
  const save = () => {
    if (problems.length) { buzz('warn'); return; }
    const out: BookingLoyalty[] = rows.filter((r) => (nums[r.k] ?? '').trim()).map((r) => ({ personId: r.pid, program: r.prog, number: normLoyalty(nums[r.k]!) }));
    buzz('success'); onSave(out);
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('bp.loyalty.title')}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        <T v="h2">{t('bp.loyalty.title')}</T>
        <T v="small">{t('bp.loyalty.body')}</T>
        {rows.map((r) => {
          const who = personName(people.find((p) => p.id === r.pid), selfName);
          const bad = problems.some((x) => x.k === r.k);
          return (
            <View key={r.k} style={{ gap: 6 }}>
              <T v="eyebrow">{t('bp.loyalty.for', { name: who })}</T>
              <TextInput accessibilityLabel={`${who} · ${t('bp.loyalty.number', { name: programmeName(r.prog) })}`} placeholder={`${programmeName(r.prog)} · ${programmeHint(r.prog)}`} placeholderTextColor={colors.muted}
                value={nums[r.k] ?? ''} autoCapitalize="characters" autoCorrect={false} onChangeText={(v) => setNums((x) => ({ ...x, [r.k]: v }))} style={[styles.input, bad ? { borderColor: colors.bad } : null]} testID={`loyalty-${r.prog}-${r.pid}`} />
              {bad ? <T v="small" color={colors.badInk} accessibilityRole="alert">{t('bp.loyalty.bad', { name: programmeName(r.prog), hint: programmeHint(r.prog) })}</T>
                : (nums[r.k] ?? '').trim() ? <T v="tiny">{maskLoyalty(nums[r.k]!)}</T> : null}
            </View>
          );
        })}
        <Button label={t('bp.loyalty.save')} onPress={save} testID="loyalty-booking-save" disabled={!!problems.length} />
      </ScrollView>
    </Sheet>
  );
}

/** A paid extra the fare prices (seats together on flynas): offered with its price, added only by a tap, every time. */
export function ExtrasCard({ offer, airline, onToggle }: { offer: NonNullable<AppliedPrefs['extrasOffer']>; airline: string; onToggle: (on: boolean) => void }) {
  return (
    <View style={[styles.card, offer.added ? { borderColor: colors.ok } : null]} testID="pay-extra-seats">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="flight" size={18} color={offer.added ? colors.ok : colors.goldInk} />
        <T v="h3" style={{ fontSize: 15, flex: 1 }}>{t('bp.extra.seats', { airline })}</T>
        <T v="small" color={colors.green} style={{ fontVariant: ['tabular-nums'] }}>{formatSar(offer.total.amount)}</T>
      </View>
      <T v="small">{offer.added ? t('bp.extra.added', { total: formatSar(offer.total.amount) }) : t('bp.extra.seatsBody', { airline, price: formatSar(offer.perPerson.amount), legs: offer.legs, total: formatSar(offer.total.amount) })}</T>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button size="small" block={false} variant={offer.added ? 'secondary' : 'primary'} label={offer.added ? t('bp.extra.remove') : t('bp.extra.add', { total: formatSar(offer.total.amount) })} onPress={() => { buzz(offer.added ? 'soft' : 'success'); onToggle(!offer.added); }} testID="pay-extra-seats-toggle" />
      </View>
    </View>
  );
}

/** "Who pays?": someone from your circles. They get the pay link in the circle; nothing is charged to you. */
export function AskSomeoneSheet({ visible, price, onClose, onPick }: { visible: boolean; price: number; onClose: () => void; onPick: (who: { userId: string; circleId: string; name: string }) => void }) {
  const { height } = useWindowDimensions();
  const me = useMeId();
  const circles = useCircles();
  const list = circles.data?.circles ?? [];
  const [circleId, setCircleId] = useState<string | null>(null);
  const chosenCircle = circleId ?? list[0]?.id ?? '';
  const detail = useCircle(chosenCircle);
  const members = (detail.data?.members ?? []).filter((m) => m.id !== me);
  const [who, setWho] = useState<string | null>(null);
  const pick = members.find((m) => m.id === who) ?? null;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('mp.title')}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
        <T v="h2">{t('mp.title')}</T>
        <T v="small">{t('mp.body')}</T>
        {!list.length && circles.data ? <T v="small" color={colors.goldInk}>{t('mp.noCircles')}</T> : null}
        {list.length > 1 ? <ChipWrap>{list.map((c) => <Chip key={c.id} on={chosenCircle === c.id} label={c.name} onPress={() => { buzz('select'); setCircleId(c.id); setWho(null); }} />)}</ChipWrap> : null}
        {members.map((m) => (
          <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: who === m.id }} onPress={() => { buzz('select'); setWho(m.id); }} style={[styles.person, who === m.id ? { borderColor: colors.green } : null]} testID={`payer-${m.short}`}>
            <View style={styles.avatar}><T style={{ fontFamily: ff.ui600, color: colors.sand, fontSize: 13 }}>{m.initial}</T></View>
            <T v="h3" style={{ fontSize: 15, flex: 1 }}>{m.name}</T>
            {who === m.id ? <Icon name="check" color={colors.ok} width={2.4} /> : null}
          </Pressable>
        ))}
        <Button label={pick ? t('mp.send', { name: pick.short, price: formatSar(price) }) : t('mp.title')} disabled={!pick} onPress={() => { if (pick) onPick({ userId: pick.id, circleId: chosenCircle, name: pick.short }); }} testID="payer-send" />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  well: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.mist },
  card: { gap: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.gold, backgroundColor: 'rgba(201,162,77,0.08)' },
  notes: { height: 80, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, padding: 12, fontSize: 15, fontFamily: ff.ui400, color: colors.green, textAlignVertical: 'top' },
  input: { height: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, fontFamily: ff.ui400, fontSize: 15, color: colors.green, textAlign: 'left', writingDirection: 'ltr' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
