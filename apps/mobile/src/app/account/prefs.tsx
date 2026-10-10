import { useState } from 'react';
import { useOnChange, useOnOpen } from '@/lib/wallet-model';
import { TextInput, View } from 'react-native';
import { LOYALTY_PROGRAMS, normLoyalty, type TravelPrefs } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { ArtSuitcase } from '@/components/wallet/Arts';
import { Group, Row, Toggle } from '@/components/wallet/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useAccount, useUpdateAccount } from '@/lib/wallet';
import { colors, ff, radii } from '@/theme';

const MEALS = ['halal', 'veg', 'vegan', 'child', 'diabetic', 'gluten', 'lowsalt'] as const;
const ASSIST = ['wchr', 'wchc', 'infant', 'bassinet'] as const;
type Loyalty = TravelPrefs['loyalty'][number];

/** Travel preferences (Account.jsx Prefs): seats, meal, help at the airport, loyalty numbers, notes for Faisal. */
export default function Prefs() {
  const account = useAccount();
  const update = useUpdateAccount();
  const p = account.data?.prefs;
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [edit, setEdit] = useState<{ item: Loyalty | null } | null>(null);
  useOnChange(p?.notes ?? '', setNotes);
  if (!p) return <AccountScreen title={t('prefs.title')} query={account}><View /></AccountScreen>;
  const setP = (patch: Partial<TravelPrefs>, done?: string) => update.mutate({ prefs: { ...p, ...patch } }, { onSuccess: () => { if (done) toast(done); }, onError: () => toast(t('error.internal')) });
  const toggleAssist = (id: (typeof ASSIST)[number], on: boolean) => {
    let next = on ? [...p.assist, id] : p.assist.filter((x) => x !== id);
    if (id === 'wchr' && on) next = next.filter((x) => x !== 'wchc');
    if (id === 'wchc' && on) next = next.filter((x) => x !== 'wchr');
    if (id === 'infant' && !on) next = next.filter((x) => x !== 'bassinet');
    setP({ assist: next });
  };
  const hasInfant = p.assist.includes('infant');

  return (
    <AccountScreen title={t('prefs.title')} testID="prefs">
      <T v="body">{t('prefs.body')}</T>
      <Group label={t('prefs.seats')}>
        <View style={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel={t('prefs.seats')}>
          {(['window', 'aisle', 'any'] as const).map((id) => <Chip key={id} on={p.seat === id} label={t(`prefs.seat.${id}`)} onPress={() => setP({ seat: id })} />)}
        </View>
        <Row value={t('prefs.together')} sub={t('prefs.togetherSub')} right={<Toggle label={t('prefs.together')} value={p.together} onChange={(v) => setP({ together: v })} />} />
      </Group>
      <Group label={t('prefs.meal')}>
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{MEALS.map((id) => <Chip key={id} on={p.meal === id} label={t(`prefs.meal.${id}`)} onPress={() => setP({ meal: id })} />)}</View>
          <T v="tiny">{p.meal === 'halal' ? t('prefs.meal.halalNote') : p.meal === 'child' ? t('prefs.meal.childNote') : t('prefs.meal.otherNote')}</T>
        </View>
      </Group>
      <Group label={t('prefs.assist')}>
        {ASSIST.map((id) => {
          const off = id === 'bassinet' && !hasInfant;
          return <Row key={id} value={t(`prefs.assist.${id}`)} sub={off ? t('prefs.assist.bassinetOff') : t(`prefs.assist.${id}Sub`)} right={<Toggle label={t(`prefs.assist.${id}`)} value={p.assist.includes(id)} disabled={off} onChange={(v) => toggleAssist(id, v)} testID={`assist-${id}`} />} />;
        })}
      </Group>
      <Group label={t('prefs.loyalty')}>
        {p.loyalty.map((l) => {
          const prog = LOYALTY_PROGRAMS.find((x) => x.id === l.program);
          return <Row key={l.id} lead={<View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' }}><Icon name={prog?.kind === 'hotel' ? 'stay' : 'flight'} size={18} /></View>}
            value={prog?.name ?? l.program} sub={<T v="tiny" style={{ fontVariant: ['tabular-nums'] }}>{l.number}</T>} onPress={() => setEdit({ item: l })} accessibilityLabel={t('prefs.loyalty.edit', { name: prog?.name ?? '' })} />;
        })}
        {!p.loyalty.length ? <View style={{ padding: 8 }}><EmptyState compact art={<ArtSuitcase width={100} height={75} />} title={t('prefs.loyalty.emptyTitle')} body={t('prefs.loyalty.emptyBody')} /></View> : null}
        <Row lead={<View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={18} /></View>} value={t('prefs.loyalty.add')} onPress={() => setEdit({ item: null })} testID="loyalty-add" />
      </Group>
      <Group label={t('prefs.notes')}>
        <View style={{ padding: 16, gap: 8 }}>
          <T v="tiny">{t('prefs.notesHint')}</T>
          <TextInput accessibilityLabel={t('prefs.notes')} multiline maxLength={280} value={notes} onChangeText={setNotes} testID="prefs-notes"
            onBlur={() => { if (notes.trim() !== p.notes) setP({ notes: notes.trim() }, t('prefs.notesSaved')); }}
            style={{ height: 96, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, padding: 12, fontSize: 15, fontFamily: ff.ui400, color: colors.green, textAlignVertical: 'top' }} />
          <T v="tiny" style={{ alignSelf: 'flex-end', fontVariant: ['tabular-nums'] }}>{`${notes.length}/280`}</T>
        </View>
      </Group>
      <LoyaltySheet edit={edit} list={p.loyalty} onClose={() => setEdit(null)} onSave={(loyalty, done) => setP({ loyalty }, done)} />
    </AccountScreen>
  );
}

function LoyaltySheet({ edit, list, onClose, onSave }: { edit: { item: Loyalty | null } | null; list: Loyalty[]; onClose: () => void; onSave: (l: Loyalty[], done: string) => void }) {
  const item = edit?.item ?? null;
  const [prog, setProg] = useState<string | null>(null);
  const [num, setNum] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(!!edit, () => { setProg(item?.program ?? null); setNum(item?.number ?? ''); setTouched(false); });
  const P = LOYALTY_PROGRAMS.find((x) => x.id === prog);
  const n = normLoyalty(num);
  const dup = !item && !!prog && list.some((l) => l.program === prog);
  const err = !P ? null : dup ? t('prefs.loyalty.dup', { name: P.name }) : !n ? null : !P.re.test(n) ? t('prefs.loyalty.bad', { name: P.name, hint: P.hint }) : null;
  const save = () => {
    setTouched(true);
    if (!P || err || !n) return;
    const next = item ? list.map((l) => (l.id === item.id ? { ...l, number: n } : l)) : [...list, { id: `l${Date.now()}`, program: P.id, number: n }];
    buzz('success');
    onSave(next as Loyalty[], t('prefs.loyalty.saved', { name: P.name }));
    onClose();
  };
  return (
    <Sheet visible={!!edit} onClose={onClose} label={t('prefs.loyalty')}>
      <T v="h2">{item ? P?.name ?? '' : t('prefs.loyalty.add')}</T>
      {!item ? (['airline', 'hotel'] as const).map((k) => (
        <View key={k} style={{ gap: 6 }}>
          <T v="eyebrow">{k === 'airline' ? t('prefs.loyalty.airlines') : t('prefs.loyalty.hotels')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{LOYALTY_PROGRAMS.filter((x) => x.kind === k).map((x) => <Chip key={x.id} on={prog === x.id} label={x.name} onPress={() => setProg(x.id)} />)}</View>
        </View>
      )) : null}
      {P ? (
        <>
          <Field label={t('prefs.loyalty.number')} value={num} onChangeText={setNum} onBlur={() => setTouched(true)} autoCapitalize="characters" placeholder={P.hint} editable={!dup}
            error={(touched || dup) && err ? err : null} testID="loyalty-number" />
          <Button label={t('prefs.loyalty.save')} disabled={!n || !!err} onPress={save} testID="loyalty-save" />
          {item ? <Button variant="ghost" color={colors.badInk} label={t('prefs.loyalty.remove')} onPress={() => { onSave(list.filter((l) => l.id !== item.id), P.kind === 'hotel' ? t('prefs.loyalty.removedHotel', { name: P.name }) : t('prefs.loyalty.removedAirline', { name: P.name })); onClose(); }} /> : null}
        </>
      ) : null}
    </Sheet>
  );
}
