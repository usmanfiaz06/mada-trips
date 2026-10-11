import { ROUTES, RecoveryResponse, type RecoveryRequest } from '@mada/shared';
import { request } from '../api';

/**
 * "I can't use this number or email any more": signed out, to the Mada desk. The key is kept for the screen's life,
 * so a retry after a dropped connection never sends a second request.
 */
export const sendRecovery = (body: RecoveryRequest, idempotencyKey: string) =>
  request({ method: 'POST', path: ROUTES.recovery, body, auth: false, idempotencyKey }, RecoveryResponse);

/** "o•••@gmail.com" / "+966 5• ••• 4567": enough to recognise, never the whole thing (sign-in screen, help sheet). */
export function maskContact(kind: 'phone' | 'email', value: string): string {
  if (kind === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  const d = value.replace(/\D/g, '').replace(/^966/, '');
  return d.length === 9 ? `+966 ${d[0]}• ••• ${d.slice(5)}` : value;
}
