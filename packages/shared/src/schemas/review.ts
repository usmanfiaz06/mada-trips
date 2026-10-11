import { z } from 'zod';
import { RecoveryContact } from './auth';

/*
 * The App Review sign-in (docs/app/store/REVIEW.md, docs/app/LAUNCH.md). Apple and Google reviewers can't receive our
 * codes, so the platform may name one review contact (APP_REVIEW_LOGIN) and a fixed code (APP_REVIEW_CODE). After
 * Supabase refuses a code, the app asks POST /auth/review; it answers 404 unless both are set on the server, and
 * only ever signs in that one contact. The answer is a Supabase access token, so the rest of sign-in is unchanged.
 */
export const REVIEW_LOGIN_PATH = '/auth/review';

export const ReviewLoginRequest = z.object({
  contact: RecoveryContact,
  code: z.string().trim().regex(/^\d{6}$/),
});
export type ReviewLoginRequest = z.infer<typeof ReviewLoginRequest>;

export const ReviewLoginResponse = z.object({ accessToken: z.string().min(10) });
export type ReviewLoginResponse = z.infer<typeof ReviewLoginResponse>;
