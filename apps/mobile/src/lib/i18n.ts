import { I18nManager } from 'react-native';
import { t as tShared, tn as tnShared, type CopyKey, type CopyLocale, type Vars } from '@mada/shared';

/*
 * Every user-facing word comes from the shared catalogue (packages/shared/src/copy). Layouts use start/end, never
 * left/right, so Arabic flips cleanly once its catalogue lands (COPY.md §7.4).
 */
let locale: CopyLocale = 'en';
export const setLocale = (l: CopyLocale) => { locale = l; I18nManager.allowRTL(true); };
export const getLocale = () => locale;
export const isRTL = () => I18nManager.isRTL;

export const t = (key: CopyKey, vars?: Vars) => tShared(key, vars, locale);
export const tn = (base: string, count: number, vars?: Vars) => tnShared(base, count, vars, locale);
