import { View } from 'react-native';
import { fareAirline, outSegment, zonedToInstant, type TripDetail } from '@mada/shared';
import { T } from '@/components/Text';
import { Box, H3, Small, Tiny } from '@/components/trips/ui';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';

/*
 * What the rules give you (CRITIQUE-2 #19), on a refund or a change: the GACA rights when the airline cancels or moves
 * the flight, care and compensation, the 24-hour window some airlines give right after booking (said only while it
 * could apply), and what applies when it's the traveller's own choice. Plain words; Mada claims for them.
 */

const H24 = 24 * 3600_000;
const WEEK = 7 * 24 * 3600_000;

export function RulesCard({ trip, mode, testID = 'rules-card' }: { trip: TripDetail; mode: 'refund' | 'change'; testID?: string }) {
  const out = outSegment(trip);
  if (!out) return null;
  const airline = fareAirline(trip);
  const now = Date.parse(trip.clock.now);
  const since = now - Date.parse(trip.bookedAt);
  const departs = zonedToInstant(out.departLocal, out.departTz).getTime() - now;
  // Inside 24 hours of booking, with the flight a week or more away: where an airline's free window applies.
  const fresh = since >= 0 && since < H24 && departs >= WEEK;
  const line = (head: string, body: string, id: string) => (
    <T v="small" testID={`${testID}-${id}`}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{head} </T>{body}</T>
  );
  return (
    <Box tone="well" gap={8} testID={testID}>
      <View style={{ gap: 2 }}>
        <H3 size={16}>{t('dz.rights.title')}</H3>
        <Tiny>{t('dz.rights.sub')}</Tiny>
      </View>
      {fresh ? line(t('gr.within24', { hours: Math.max(1, Math.floor(since / 3600_000)) }), t('gr.within24Body', { airline }), 'within24') : null}
      {line(t('gr.ifAirline', { airline }), t('gr.ifAirlineBody'), 'airline')}
      <Small><Small color={colors.green}>{t('dz.rights.care')} </Small>{t('dz.rights.careBody')}</Small>
      <Small><Small color={colors.green}>{t('dz.rights.comp')} </Small>{t('dz.rights.compBody')}</Small>
      {mode === 'refund' ? line(t('gr.yours'), t('gr.yoursBody', { airline }), 'yours') : line(t('gr.yoursChange'), t('gr.yoursChangeBody', { airline }), 'yours')}
    </Box>
  );
}
