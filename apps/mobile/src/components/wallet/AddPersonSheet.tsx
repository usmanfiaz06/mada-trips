import { useState } from 'react';
import { useOnOpen } from '@/lib/wallet-model';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useRefreshHousehold, walletApi } from '@/lib/wallet';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { Field } from '../Field';
import { Sheet } from '../Sheet';
import { T } from '../Text';

const RELS = [['Family', 'family'], ['Friend', 'friend'], ['Helper', 'helper'], ['Colleague', 'colleague']] as const;

/** Add someone (prototype AddPersonSheet): names exactly as on the passport; the passport can be scanned later. */
export function AddPersonSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded?: (id: string) => void }) {
  const refresh = useRefreshHousehold();
  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [rel, setRel] = useState<(typeof RELS)[number]>(RELS[0]);
  const [busy, setBusy] = useState(false);
  useOnOpen(visible, () => { setGiven(''); setSurname(''); setRel(RELS[0]); });
  const ok = given.trim().length > 1 && surname.trim().length > 1;
  const first = given.trim().split(/\s+/)[0] ?? '';
  const add = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const { person } = await walletApi.addPerson({ givenNames: given.trim(), surname: surname.trim(), relation: rel[1] });
      if (rel[0] !== 'Family') await walletApi.updatePerson(person.id, { relationLabel: rel[0] });
      await refresh();
      buzz('success');
      toast(t('household.added', { name: person.firstName }));
      onAdded?.(person.id);
      onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('household.addTitle')}>
      <T v="h2">{t('household.addTitle')}</T>
      <T v="small">{t('household.addBody')}</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Field label={t('household.addGiven')} value={given} onChangeText={setGiven} autoCapitalize="words" testID="add-given" /></View>
        <View style={{ flex: 1 }}><Field label={t('household.addSurname')} value={surname} onChangeText={setSurname} autoCapitalize="words" testID="add-surname" /></View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{RELS.map((r) => <Chip key={r[0]} on={rel[0] === r[0]} label={t(`household.relation.${r[0]}`)} onPress={() => setRel(r)} />)}</View>
      {rel[0] === 'Helper' ? <T v="small">{t('household.addHelperNote')}</T> : null}
      <Button label={first ? t('household.addButton', { name: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() }) : t('household.addThem')} disabled={!ok} busy={busy} onPress={add} testID="add-person" />
    </Sheet>
  );
}
