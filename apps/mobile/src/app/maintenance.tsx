import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { DESK_PHONE } from '@mada/shared';
import { Button } from '@/components/Button';
import { Screen, useTopInset } from '@/components/Layout';
import { ArtSign } from '@/components/states/art';
import { StateView } from '@/components/states/StateView';
import { t } from '@/lib/i18n';
import { dismissMaintenance, useGates } from '@/lib/net/gates';
import { callDesk } from '@/lib/net/talk';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Planned maintenance (a 503 MAINTENANCE, or GET /config), prototype MaintenanceScreen: when it ends, what still
 * works, and a person on the phone. "Open my trips" sets it aside; a small pill stays at the top until /config says
 * it's over.
 */
export default function MaintenanceScreen() {
  const top = useTopInset();
  const m = useGates((s) => s.maintenance);
  const until = m?.until ? new Date(m.until) : null;
  const time = until && Number.isFinite(until.getTime()) ? `${pad(until.getHours())}:${pad(until.getMinutes())}` : null;
  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top }}>
        <StateView art={<ArtSign />} testID="maintenance-screen"
          title={time ? t('maintenance.titleUntil', { time }) : t('maintenance.title')}
          body={m?.message ?? (time ? t('maintenance.bodyUntil', { time }) : t('maintenance.body'))}
          works={t('maintenance.works')}
          primary={<Button label={t('maintenance.trips')} onPress={() => { dismissMaintenance(); router.replace('/trips' as Href); }} testID="maintenance-trips" />}
          secondary={<Button variant="ghost" label={t('maintenance.call')} onPress={callDesk} testID="maintenance-call" />}
          note={t('maintenance.note', { phone: DESK_PHONE })} />
      </View>
    </Screen>
  );
}
