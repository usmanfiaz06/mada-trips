import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { personName, type Person } from '@mada/shared';
import { api, ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { keys } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { colors, font } from '@/theme';
import { Button } from '../Button';
import { Field } from '../Field';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ChipWrap, Toggle } from './parts';

/* Who's going: the household as chips, plus "Add someone" (names exactly as on the passport). */

export const nameOf = (p: Person | undefined, selfName = '') => personName(p, selfName);

export function TravellerChips({ people, value, onChange, selfName = '' }: { people: Person[]; value: string[]; onChange: (ids: string[]) => void; selfName?: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <ChipWrap>
        {people.map((p) => {
          const on = value.includes(p.id);
          const label = p.relation === 'helper' ? t('ask.q.helper', { name: nameOf(p, selfName) }) : nameOf(p, selfName);
          return <Toggle key={p.id} label={label} on={on} onPress={() => { if (on && value.length === 1) return; onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id]); }} />;
        })}
        <Pressable accessibilityRole="button" accessibilityLabel={t('ask.q.addSomeone')} onPress={() => { buzz('tap'); setAdding(true); }}
          style={{ height: 40, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: 'rgba(30,53,45,0.25)' }}>
          <Icon name="plus" size={16} />
          <T style={[font('h3'), { fontSize: 15 }]}>{t('ask.q.addSomeone')}</T>
        </Pressable>
      </ChipWrap>
      <AddPersonSheet visible={adding} onClose={() => setAdding(false)} onAdded={(p) => { onChange([...value, p.id]); setAdding(false); }} />
    </>
  );
}

const RELATIONS = [['family', 'person.rel.family'], ['friend', 'person.rel.friend'], ['helper', 'person.rel.helper'], ['colleague', 'person.rel.colleague']] as const;

export function AddPersonSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: (p: Person) => void }) {
  const qc = useQueryClient();
  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [rel, setRel] = useState<(typeof RELATIONS)[number][0]>('family');
  const [busy, setBusy] = useState(false);
  const ok = given.trim().length > 1 && surname.trim().length > 1;
  const first = given.trim().split(/\s+/)[0] ?? '';
  const add = async () => {
    setBusy(true);
    try {
      const { person } = await api.addPerson({ givenNames: given.trim(), surname: surname.trim(), relation: rel });
      await qc.invalidateQueries({ queryKey: keys.people });
      buzz('success');
      toast(t('person.added', { name: person.firstName }));
      setGiven(''); setSurname('');
      onAdded(person);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('ask.q.addSomeone')}>
      <T v="h2">{t('ask.q.addSomeone')}</T>
      <T v="small">{t('person.add.body')}</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Field label={t('person.add.given')} value={given} onChangeText={setGiven} autoCapitalize="words" testID="add-given" /></View>
        <View style={{ flex: 1 }}><Field label={t('person.add.surname')} value={surname} onChangeText={setSurname} autoCapitalize="words" testID="add-surname" /></View>
      </View>
      <ChipWrap>{RELATIONS.map(([v, l]) => <Toggle key={v} label={t(l)} on={rel === v} onPress={() => setRel(v)} />)}</ChipWrap>
      {rel === 'helper' ? <T v="small" color={colors.green}>{t('person.add.helperNote')}</T> : null}
      <Button label={t('person.add.button', { name: first || t('person.add.them') })} disabled={!ok} busy={busy} onPress={add} />
    </Sheet>
  );
}
