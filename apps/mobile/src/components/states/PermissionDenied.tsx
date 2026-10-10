import { Linking } from 'react-native';
import { t } from '@/lib/i18n';
import { Button } from '../Button';
import { ArtSwitch } from './art';
import { StateView } from './StateView';

export type PermissionKind = 'camera' | 'contacts' | 'location' | 'notifications' | 'photos';

/**
 * A permission the traveller turned off: say what it's for, offer Settings, and always a way on without it
 * (`onSkip`, labelled with the way round: upload a photo, share your invite link, choose your city, alerts by SMS).
 * (Asking again is the system's job; once refused, only Settings can turn it back on.)
 */
export function PermissionDenied({ kind, onSkip, skipLabel, variant = 'card' }: { kind: PermissionKind; onSkip?: () => void; skipLabel?: string; variant?: 'full' | 'card' }) {
  return (
    <StateView variant={variant} art={<ArtSwitch glyph={kind} />} title={t(`perm.${kind}.title`)} body={t(`perm.${kind}.body`)}
      primary={<Button label={t('perm.settings')} onPress={() => { void Linking.openSettings().catch(() => {}); }} testID="perm-settings" />}
      secondary={onSkip ? <Button variant="ghost" label={skipLabel ?? t(`perm.${kind}.manual`)} onPress={onSkip} testID="perm-skip" /> : null}
      testID={`perm-${kind}`} />
  );
}
