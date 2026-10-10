/**
 * Arabic: language and display settings (language.ts). A first draft for the native Saudi writer (COPY.md §7.4).
 */
import type { languageCopy } from '../language';
import type { ArSection } from './types';

export const arLanguage: ArSection<typeof languageCopy> = {
  'lang.title': 'اللغة',
  'lang.english': 'English',
  'lang.arabic': 'العربية',
  'lang.followsPhone': 'تتبع مادا لغة جوالك حتى تختار لغة من هنا.',
  'lang.current': 'العربية',
  'lang.restart.toArabic': 'نعيد تشغيل مادا بالعربية؟',
  'lang.restart.toEnglish': 'نعيد تشغيل مادا بالإنجليزية؟',
  'lang.restart.body': 'يُغلق التطبيق ويُفتح من جديد بالاتجاه الآخر. رحلاتك ومحفظتك ورسائلك تبقى كما هي تمامًا.',
  'lang.restart.go': 'أعد التشغيل للتبديل',
  'lang.restart.keep': 'ليس الآن',
  'lang.restart.manual': 'أغلق مادا وافتحه من جديد لإكمال التبديل.',
  'lang.display': 'الأرقام والتواريخ',
  'lang.digits': 'أرقام عربية مشرقية',
  'lang.digitsSub': '١٢٣ بدلًا من 123. شركات الطيران والبنوك تستخدم 123، لذلك هي الافتراضية.',
  'lang.hijri': 'التاريخ الهجري بجانبه',
  'lang.hijriSub': 'تاريخ أم القرى بجانب كل يوم.',
  'lang.saved': 'حُفظ.',
  'lang.done': 'تم',
};
