import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MessageTranslationResponse, languageOfText, messageTranslationPath } from '@mada/shared';
import { request } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';

/**
 * Words someone wrote in English (the hotel, the desk) on an Arabic page: shown as written, left to right, with a small
 * "Translate" under them. A version the writer gave in Arabic shows at once; otherwise the first tap asks the server
 * (translated once and kept). Never a made-up translation: when there isn't one, the original stays and says so.
 */
export function useTranslated<T>(key: readonly unknown[], fetch: () => Promise<T>) {
  const [on, setOn] = useState(false);
  const q = useQuery({ queryKey: key, queryFn: fetch, enabled: on, staleTime: Infinity, retry: false });
  return { on, toggle: () => { buzz('select'); setOn((x) => !x); }, data: on ? q.data ?? null : null, loading: on && q.isFetching, failed: on && q.isError };
}

/** The toggle line: "Translate" / "Show the original", with the note that says who wrote it and how. */
export function TranslateToggle({ on, loading, failed, translated, toggle, testID = 'translate', note = true }: { on: boolean; loading: boolean; failed: boolean; translated: boolean; toggle: () => void; testID?: string; note?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 }} testID={testID}>
        <Icon name="globe" size={14} color={colors.green} />
        <T v="small" style={{ fontFamily: ff.ui600, color: colors.green }}>{on ? t('translate.original') : t('translate.show')}</T>
        {loading ? <ActivityIndicator size="small" color={colors.green} /> : null}
      </Pressable>
      {note || failed ? <T v="tiny" testID={`${testID}-note`}>{failed ? t('translate.none') : on && translated ? t('translate.machine') : t('translate.wroteIn')}</T> : null}
    </View>
  );
}

/** Text written in English, kept left to right inside an Arabic page so its punctuation and numbers read right. */
export function WrittenInEnglish({ children }: { children: ReactNode }) {
  return getLocale() === 'ar' ? <View style={{ direction: 'ltr' }} {...({ dir: 'ltr', lang: 'en' } as object)}>{children}</View> : <>{children}</>;
}

/**
 * Props for a Text showing words someone else wrote (a supplier's title, a person's message): `lang` says which
 * language they are in when it isn't the page's, so a screen reader reads them right and they read as theirs.
 */
export function writtenIn(text: string | null | undefined): object {
  const l = text ? languageOfText(text) : null;
  return l && l !== getLocale() ? { lang: l } : {};
}

/**
 * A message the desk or Mada wrote in the other language: the words as written (marked with their language), and
 * "Translate" under them; the first tap asks the server for this message (translated once, kept). Ids that aren't the
 * server's (a message still on the phone) show as written.
 */
export function DeskWords({ id, text, style }: { id: string; text: string; style?: object }) {
  const other = languageOfText(text);
  const lang = getLocale();
  const can = !!other && other !== lang && /^[0-9a-f-]{36}$/i.test(id);
  const tr = useTranslated(['messages', id, 'translation', lang], async () => (await request({ method: 'GET', path: messageTranslationPath(id, lang) }, MessageTranslationResponse)).text);
  return (
    <>
      <T style={style} {...(tr.data ? {} : writtenIn(text))}>{tr.data ?? text}</T>
      {can ? <TranslateToggle on={tr.on} loading={tr.loading} failed={tr.failed} translated={!!tr.data} toggle={tr.toggle} testID={`translate-${id}`} note={false} /> : null}
    </>
  );
}
