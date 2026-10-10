import { useState } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Button } from '@/components/Button';
import { Screen, useTopInset } from '@/components/Layout';
import { ArtSign } from '@/components/states/art';
import { StateView } from '@/components/states/StateView';
import { t } from '@/lib/i18n';
import { dismissMaintenance, endMaintenance, useGates } from '@/lib/net/gates';
import { loadConfig } from '@/lib/net/remote';
import { toast } from '@/lib/toast';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Planned maintenance (a 503 MAINTENANCE, or GET /config). Booking and changes pause; everything saved on the phone
 * still opens. "Open my trips" sets this aside (a gold line stays at the top); "Check again" asks the server.
 */
export default function MaintenanceScreen() {
  const top = useTopInset();
  const m = useGates((s) => s.maintenance);
  const [busy, setBusy] = useState(false);
  const until = m?.until ? new Date(m.until) : null;
  const back = until && Number.isFinite(until.getTime()) ? ` ${t('maintenance.until', { time: `${pad(until.getHours())}:${pad(until.getMinutes())}` })}` : '';
  const leave = () => { if (router.canGoBack()) router.back(); else router.replace('/today' as Href); };
  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top }}>
        <StateView art={<ArtSign />} title={t('maintenance.title')} body={`${m?.message ?? t('maintenance.body')}${back}`} testID="maintenance-screen"
          primary={<Button label={t('maintenance.trips')} onPress={() => { dismissMaintenance(); router.replace('/trips' as Href); }} testID="maintenance-trips" />}
          secondary={<Button variant="secondary" label={t('maintenance.retry')} busy={busy} testID="maintenance-retry" onPress={async () => {
            setBusy(true);
            const c = await loadConfig();
            setBusy(false);
            if (c && !c.maintenance.on) { endMaintenance(); toast(t('net.back')); leave(); }
          }} />} />
      </View>
    </Screen>
  );
}
