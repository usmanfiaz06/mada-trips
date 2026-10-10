import { ApiError } from '@/lib/api';
import { AuthError } from '@/lib/auth/types';
import { t } from '@/lib/i18n';

/** Any sign-in failure, in words a person can act on. A phone already on another account says so plainly. */
export function sayAuthError(e: unknown, about: 'phone' | 'email' | 'other' = 'other'): string {
  if (e instanceof AuthError) {
    if (e.code === 'taken' && about === 'phone') return t('error.phoneTaken');
    return e.message;
  }
  if (e instanceof ApiError) return e.code === 'OFFLINE' ? t('error.offline') : e.message;
  return t('error.internal');
}

/** Enough of an address to send a code to; Supabase has the final say. */
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
