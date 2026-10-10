import { View } from 'react-native';
import type { DemoFlag } from '@mada/shared';
import { useDemo } from '@/lib/booking';
import { t } from '@/lib/i18n';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ChipWrap, Toggle } from './parts';

/* The prototype's "Make it go wrong" switches, for the mock suppliers only (development and demo builds). */

const SWITCHES: [DemoFlag, string][] = [
  ['offline', 'Offline'], ['decline', 'Card declines'], ['priceUp', 'Price rises at payment'], ['noResults', 'No flights found'], ['supplierDown', 'Airline not answering'],
  ['agentQuestion', 'Mada asks a question'], ['passportProblem', 'Passport problem'], ['needs3ds', 'Bank asks for a code'], ['fareGone', 'Fare sold out while booking'],
  ['ticketingFails', 'Tickets fail to issue'], ['slowAgent', 'Airline is slow'], ['faceIdFails', 'Face ID fails'],
];

export function DemoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const on = useDemo((s) => s.on);
  const toggle = useDemo((s) => s.toggle);
  return (
    <Sheet visible={visible} onClose={onClose} label={t('ask.demo.title')}>
      <T v="h2">{t('ask.demo.title')}</T>
      <T v="small">{t('ask.demo.body')}</T>
      <View><ChipWrap>{SWITCHES.map(([f, label]) => <Toggle key={f} small label={label} on={on.has(f)} onPress={() => toggle(f)} />)}</ChipWrap></View>
    </Sheet>
  );
}
