import { useEffect, useState } from 'react';
import { getLang, onLang } from './i18n.js';

export { initLang, setLang, getLang } from './i18n.js';

/** The current language, re-rendering when it changes. */
export function useLang() {
  const [lang, set] = useState(getLang());
  useEffect(() => onLang(set), []);
  return lang;
}
