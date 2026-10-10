import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { t } from '@/lib/i18n';
import { talkToMada } from '@/lib/net/talk';
import { colors, ff } from '@/theme';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { ArtRouteGap } from './art';
import { T } from '../Text';

/**
 * COPY.md §5.6 "Supplier not answering": "Saudia's system isn't answering." Two forms:
 *   - booking: a person has it ("Faisal is booking this by hand. You don't need to do anything.") with their face;
 *   - otherwise: we keep trying, and Mada can book it by hand (Talk to Mada).
 * Use it inside a screen where the results would be; the rest of the screen stays usable. A screen with its own way
 * forward (booking search: "Show the others", "Ask Mada") passes `body` and `actions` in place of Talk to Mada.
 */
export function SupplierDown({ supplier, booking, agent, initial, body, actions, testID }: { supplier?: string; booking?: boolean; agent?: string; initial?: string; body?: string; actions?: ReactNode; testID?: string }) {
  const name = supplier ?? t('supplierDown.generic');
  const person = agent ?? t('common.agentName');
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.card} accessibilityRole="alert" testID={testID ?? 'supplier-down'}>
      <View style={styles.row}>
        <View style={styles.art}><ArtRouteGap width={88} height={66} /></View>
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3" style={{ fontSize: 17, lineHeight: 22 }}>{t('supplierDown.title', { supplier: name })}</T>
          <T v="small">{body ?? (booking ? t('supplierDown.bodyBooking', { agent: person }) : t('supplierDown.body'))}</T>
        </View>
      </View>
      {actions ? (
        <View style={styles.actions}>{actions}</View>
      ) : booking ? (
        <View style={styles.who}>
          <Avatar initial={initial ?? person.charAt(0)} tone="green" size={28} />
          <T v="caption" style={{ fontFamily: ff.ui500, color: colors.ink2 }}>{t('actor.intro', { agent: person })}</T>
        </View>
      ) : (
        <Button size="small" variant="secondary" block={false} label={t('action.talk')} onPress={() => talkToMada()} style={{ alignSelf: 'flex-start', backgroundColor: colors.mist }} testID="supplier-talk" />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.paper, borderRadius: 22, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(125,93,39,0.14)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  art: { width: 88, height: 66, borderRadius: 14, overflow: 'hidden', backgroundColor: '#f6efe2', alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
