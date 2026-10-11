import { RECOVERY_LIMITS, ROUTES, RecoveryRequest, checkSaudiMobile, t } from '@mada/shared';
import type { AreaMock } from '../mock-api';

/*
 * Mock mode for the signed-out account recovery request (POST /auth/recovery), with the Core API's rules: the same
 * { received: true } whether or not an account uses the old contact, 3 a day per old contact, 5 an hour from here.
 */
const sent: { old: string; at: number }[] = [];

export const authMock: AreaMock = async (w) => {
  if (w.method !== 'POST' || w.path !== ROUTES.recovery) return null;
  const r = RecoveryRequest.safeParse(w.body ?? {});
  if (!r.success) return { status: 400, json: { error: { code: 'VALIDATION', message: t('error.validation') } } };
  const norm = (c: typeof r.data.oldContact) => {
    if (c.kind === 'email') return c.value;
    const p = checkSaudiMobile(c.value);
    return p.ok ? p.e164 : null;
  };
  const old = norm(r.data.oldContact);
  const next = norm(r.data.newContact);
  if (!old || !next) return { status: 400, json: { error: { code: 'VALIDATION', message: t('error.validation'), fields: { [old ? 'newContact.value' : 'oldContact.value']: 'invalid' } } } };
  if (old === next) return { status: 400, json: { error: { code: 'VALIDATION', message: t('recover.same'), fields: { 'newContact.value': 'same' } } } };
  const now = Date.now();
  const tooMany = sent.filter((s) => s.at > now - 3_600_000).length >= RECOVERY_LIMITS.perIpPerHour
    || sent.filter((s) => s.old === old && s.at > now - 86_400_000).length >= RECOVERY_LIMITS.perContactPerDay;
  if (tooMany) return { status: 429, json: { error: { code: 'RATE_LIMITED', message: t('recover.tooMany'), retryAfter: 3600 } } };
  sent.push({ old, at: now });
  console.info('[mock desk] recovery request received');
  return { status: 200, json: { received: true } };
};

/** Tests: forget what was sent. */
export const resetAuthMock = () => { sent.length = 0; };
