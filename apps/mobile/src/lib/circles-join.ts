import { router } from 'expo-router';
import { request } from './api';
import { useSession } from './session';
import { deleteSecret, getSecret, setSecret } from './storage';

/*
 * Joining from a link before having an account (madatrips.sa/join/<code>): the code waits here while the person
 * signs up, then they land in the circle (or on the friend who invited them). Registered once at launch (queries.ts).
 */

const KEY = 'mada.pendingJoin.v1';

export async function holdJoin(code: string) { await setSecret(KEY, code); }
export async function dropJoin() { await deleteSecret(KEY); }

let busy = false;
async function resume() {
  const s = useSession.getState();
  if (busy || s.status !== 'signedIn' || !s.user?.onboardedAt) return;
  const code = await getSecret(KEY);
  if (!code) return;
  busy = true;
  try {
    await deleteSecret(KEY);
    // The schema comes with the join itself: this file is registered at launch, before the first screen.
    const { AcceptInviteResponse } = await import('@mada/shared/schemas/circles');
    const r = await request({ method: 'POST', path: `/invites/${encodeURIComponent(code)}/accept` }, AcceptInviteResponse);
    // Onboarding finishes by opening Today; arrive in the circle on top of it.
    setTimeout(() => {
      if (r.circleId) router.push(`/circle/${r.circleId}`);
      else if (r.friendId) router.push(`/friend/${r.friendId}`);
    }, 700);
  } catch {
    setTimeout(() => router.push(`/join/${encodeURIComponent(code)}`), 700);
  } finally {
    busy = false;
  }
}

useSession.subscribe((s, prev) => {
  if (s.status === 'signedIn' && s.user?.onboardedAt && (prev.status !== 'signedIn' || !prev.user?.onboardedAt)) void resume();
});

/* A first launch after installing from an invite page: pick the invite up (Install Referrer on Android; lib/invite-pickup.ts). */
let picked = false;
const pickup = () => {
  if (picked) return;
  picked = true;
  setTimeout(() => { void import('./invite-pickup').then((m) => m.pickupInvite()).catch(() => {}); }, 1200);
};
if (useSession.getState().status === 'signedOut') pickup();
useSession.subscribe((s) => { if (s.status === 'signedOut') pickup(); });
