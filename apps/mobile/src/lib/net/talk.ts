import { Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { DESK_PHONE } from '@mada/shared';

/** "Talk to Mada": the support thread (Wallet → Help), or the 24/7 desk by phone when the app can't get there. */
export function talkToMada(about?: string) {
  try {
    router.push((about ? `/support?about=${encodeURIComponent(about)}` : '/support') as Href);
  } catch {
    callDesk();
  }
}

export function callDesk() {
  void Linking.openURL(`tel:${DESK_PHONE.replace(/\s/g, '')}`).catch(() => {});
}
