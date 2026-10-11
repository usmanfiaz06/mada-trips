import { REVIEW_LOGIN_PATH, ReviewLoginResponse } from '@mada/shared';
import { request } from '../api';
import { AuthError, type Identity } from './types';

/*
 * The App Review sign-in (docs/app/store/REVIEW.md). Store reviewers can't receive our codes, so the platform may
 * name one review contact with a fixed code (APP_REVIEW_LOGIN, APP_REVIEW_CODE). Only after Supabase says a code is
 * wrong, the app asks the Core API once; it answers 404 when no review login is set, "wrong code" for anyone else,
 * and for the review contact a Supabase access token, so sign-in goes on exactly as after a real code.
 * Real Supabase only: the mock (mock.ts) never comes here.
 */
export async function orReviewLogin(verify: Promise<Identity>, contact: { kind: 'phone' | 'email'; value: string }, code: string): Promise<Identity> {
  try {
    return await verify;
  } catch (e) {
    if (!(e instanceof AuthError) || e.code !== 'wrong') throw e;
    try {
      const r = await request({ method: 'POST', path: REVIEW_LOGIN_PATH, body: { contact, code }, auth: false }, ReviewLoginResponse);
      return { accessToken: r.accessToken };
    } catch {
      throw e; // whatever the review path said, the traveller sees Supabase's own answer
    }
  }
}
