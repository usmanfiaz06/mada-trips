/**
 * Arabic: language and display settings (language.ts). A first draft for the native Saudi writer (COPY.md §7.4).
 */
import type { languageCopy } from '../language';
import type { ArSection } from './types';

export const arLanguage: ArSection<typeof languageCopy> = {
  'lang.title': 'اللغة',
  'lang.english': 'English',
  'lang.arabic': 'العربية',
  'lang.followsPhone': 'مادا تمشي على لغة جوالك لين تختار لغة من هنا.',
  'lang.current': 'العربية',
  'lang.restart.toArabic': 'نعيد تشغيل مادا بالعربية؟',
  'lang.restart.toEnglish': 'نعيد تشغيل مادا بالإنجليزية؟',
  'lang.restart.body': 'التطبيق يسكّر ويفتح من جديد بالاتجاه الثاني. رحلاتك ومحفظتك ورسائلك تبقى مثل ما هي بالضبط.',
  'lang.restart.go': 'أعد التشغيل وبدّل',
  'lang.restart.keep': 'مو الحين',
  'lang.restart.manual': 'سكّر مادا وافتحها من جديد عشان يكمل التبديل.',
  'lang.display': 'الأرقام والتواريخ',
  'lang.digits': 'أرقام عربية مشرقية',
  'lang.digitsSub': '١٢٣ بدال 123. شركات الطيران والبنوك تستخدم 123، عشان كذا هي الأساس.',
  'lang.hijri': 'التاريخ الهجري بجانبه',
  'lang.hijriSub': 'تاريخ أم القرى جنب كل يوم.',
  'lang.saved': 'انحفظ.',
  'lang.done': 'تم',
};
