import { Linking } from 'react-native';
import { t } from '@/lib/i18n';
import { Button } from '../Button';
import { ArtSwitch } from './art';
import { StateView } from './StateView';

export type PermissionKind = 'camera' | 'contacts' | 'location' | 'notifications' | 'photos';

/**
 * A permission the traveller turned off: say what it's for, offer Settings, and always a way on without it.
 * (Asking again is the system's job; once refused, only Settings can turn it back on.)
 */
export function PermissionDenied({ kind, onSkip, skipLabel, variant = 'card' }: { kind: PermissionKind; onSkip?: () => void; skipLabel?: string; variant?: 'full' | 'card' }) {
  return (
    <StateView variant={variant} art={<ArtSwitch glyph={kind} />} title={t(`perm.${kind}.title`)} body={t(`perm.${kind}.body`)}
      primary={<Button label={t('perm.settings')} onPress={() => { void Linking.openSettings().catch(() => {}); }} testID="perm-settings" />}
      secondary={onSkip ? <Button variant="ghost" label={skipLabel ?? t('common.notNow')} onPress={onSkip} testID="perm-skip" /> : null}
      testID={`perm-${kind}`} />
  );
}
