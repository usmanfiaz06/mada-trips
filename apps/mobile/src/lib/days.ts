import { t } from './i18n';

/** "Eid is 21 weeks away." From the Umm al-Qura calendar where the runtime has it (prototype eidLine). */
export function eidLine(now = new Date()): string {
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric' });
    for (let i = 1; i < 400; i += 1) {
      const parts = f.formatToParts(new Date(now.getTime() + i * 86_400_000));
      const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
      if (get('month') === 10 && get('day') === 1) return i <= 13 ? t('today.eid.days', { count: i }) : t('today.eid.weeks', { count: Math.round(i / 7) });
    }
  } catch { /* calendar unsupported */ }
  return t('today.eid.soon');
}
