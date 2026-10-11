import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { inviteCodeIn } from '@mada/shared';
import { t } from './i18n';
import { useSession } from './session';
import { getSecret, setSecret } from './storage';
import { toast } from './toast';

/*
 * After installing from an invite link (deferred deep link), honestly and simply:
 *  - Android: the Play Store link on madatrips.sa/join/<code> carries referrer=invite=<code>; on first launch we read
 *    the install referrer (expo-application) and open that invite's preview.
 *  - Android, no referrer: once, if the clipboard holds an invite link or code (the page's "Copy invite code"), we
 *    open it. Android shows its own "pasted" notice; we read nothing else.
 *  - iOS: we never read the clipboard on our own (that would raise the paste prompt out of the blue). The welcome
 *    screen offers "Got an invite code?", where the system Paste button (iOS 16+) or the Paste prompt asks first.
 * Runs once per install, only when nobody is signed in.
 */

const DONE = 'mada.invitePickup.v1';

export async function codeFromReferrer(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const Application = await import('expo-application');
    const ref = await Application.getInstallReferrerAsync();
    const m = /(?:^|&)invite=([a-z0-9]{8}-[a-z0-9]{6})(?:&|$)/i.exec(decodeURIComponent(ref ?? ''));
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function codeFromClipboard(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    if (!(await Clipboard.hasStringAsync())) return null;
    return inviteCodeIn(await Clipboard.getStringAsync());
  } catch {
    return null;
  }
}

export async function pickupInvite(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (useSession.getState().status === 'signedIn') return null;
  if (await getSecret(DONE)) return null;
  await setSecret(DONE, new Date().toISOString());
  const code = (await codeFromReferrer()) ?? (await codeFromClipboard());
  if (code) {
    router.push(`/join/${code}`);
    toast(t('circles.code.found'));
  }
  return code;
}
