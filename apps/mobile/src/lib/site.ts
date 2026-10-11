import { getLocale } from './i18n';

/** madatrips.sa, where the stores' privacy, support and account-deletion links point (docs/app/LAUNCH.md). */
export const SITE = 'https://madatrips.sa';
export type SitePage = 'privacy' | 'terms' | 'support' | 'delete-account';
/** A page on the public site in the app's language (the Arabic pages live under /ar). */
export const sitePage = (page: SitePage) => `${SITE}${getLocale() === 'ar' ? '/ar' : ''}/${page}`;
