import { StyleSheet, View } from 'react-native';
import { HOTEL_REQUEST_KINDS, hotelRequestLines, type HotelRequests } from '@mada/shared';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors, radii } from '@/theme';

/*
 * "Requests for the hotel" on the order sheet (owner audit, item 3): chips for the usual asks and a line in your own
 * words. They go with the order to the desk and the hotel, and the trip's stay repeats them.
 */
export const NO_HOTEL_REQUESTS: HotelRequests = { chips: [], note: '' };

export function HotelRequestsField({ value, onChange }: { value: HotelRequests; onChange: (v: HotelRequests) => void }) {
  const toggle = (k: HotelRequests['chips'][number]) => onChange({ ...value, chips: value.chips.includes(k) ? value.chips.filter((x) => x !== k) : [...value.chips, k] });
  return (
    <View style={styles.well} testID="hotel-requests">
      <T v="h3" style={{ fontSize: 15 }}>{t('hr.title')}</T>
      <T v="small">{t('hr.sub')}</T>
      <View style={styles.chips}>
        {HOTEL_REQUEST_KINDS.map((k) => <View key={k} testID={`hr-chip-${k}`}><Chip label={t(`hr.chip.${k}`)} on={value.chips.includes(k)} onPress={() => toggle(k)} background={colors.paper} /></View>)}
      </View>
      <Field label={t('hr.note')} value={value.note} onChangeText={(note) => onChange({ ...value, note: note.slice(0, 300) })} placeholder={t('hr.noteHint')} multiline testID="hr-note" />
    </View>
  );
}

/** The requests as they were asked, on the trip's stay and the hotel page. */
export function HotelRequestsAsked({ requests, testID }: { requests: HotelRequests | null | undefined; testID?: string }) {
  const lines = hotelRequestLines(requests);
  if (!lines.length) return null;
  return (
    <View style={styles.asked} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="stay" size={14} color={colors.goldInk} /><T v="small" color={colors.goldInk}>{t('hr.asked')}</T></View>
      <T v="small" color={colors.green}>{lines.join(' · ')}</T>
      <T v="tiny">{t('hr.promise')}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  well: { gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.mist },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  asked: { gap: 4, padding: 12, borderRadius: 16, backgroundColor: '#fbf5ea', borderWidth: 1, borderColor: 'rgba(185,143,74,0.35)' },
});
