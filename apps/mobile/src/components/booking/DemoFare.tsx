import { View } from 'react-native';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { T } from '../Text';

/**
 * "Demo fare · not bookable": on every flight card and pay sheet whose fare is a sample from the mock catalogue
 * (FlightOption.demo, OrderPreview.demoFare). The server sets it; the app never decides a fare is real.
 */
export function DemoFare({ testID = 'demo-fare' }: { testID?: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: colors.warnWash, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }} accessibilityRole="text" testID={testID}>
      <T v="tiny" color={colors.goldInk} style={{ fontFamily: ff.ui600 }}>{t('search.demoFare')}</T>
    </View>
  );
}
