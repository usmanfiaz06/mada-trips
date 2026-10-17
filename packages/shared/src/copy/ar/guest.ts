/**
 * Arabic: looking around without an account, keeping your place, answering in your language, Translate (guest.ts).
 * Written the way Riyadh speaks (docs/app/ARABIC.md). The language chip names the language it switches to.
 */
import type { guestCopy } from '../guest';
import type { ArSection } from './types';

export const arGuest: ArSection<typeof guestCopy> = {
  'welcome.browse': 'تفرّج أول',
  'welcome.signin': 'عندك حساب في مادا؟ سجّل الدخول',

  'signin.ask.book': 'سجّل دخولك عشان تحجزه',
  'signin.ask.save': 'سجّل دخولك عشان تحفظه',
  'signin.ask.chat': 'سجّل دخولك عشان تكلّم مادا',
  'signin.ask.circles': 'سجّل دخولك عشان تخطط مع ربعك',
  'signin.ask.wallet': 'سجّل دخولك عشان نحفظ أوراقك',
  'signin.ask.trips': 'سجّل دخولك عشان تشوف رحلاتك',
  'signin.ask.bodyBook': 'بحثك والخيار اللي اخترته يبقون مثل ما هم.',
  'signin.ask.body': 'ونرجعك لنفس المكان على طول.',
  'signin.ask.go': 'سجّل الدخول',
  'signin.ask.later': 'كمّل تفرّج',

  'resume.back': 'رجعناك لنفس المكان.',
  'resume.pickUp': 'كمّل من حيث وقفت',
  'resume.pickUpA11y': 'كمّل آخر بحث: {what}',

  'ask.lang.toArabic': 'عربي',
  'ask.lang.toEnglish': 'English',
  'ask.lang.a11y': 'حوّل مادا للإنجليزي. البحث يبقى مثل ما هو.',
  'ask.voice.note': 'كتبت بالعربي، فمادا ترد عليك بالعربي.',

  'translate.show': 'ترجم',
  'translate.original': 'اعرض الأصل',
  'translate.wroteIn': 'الفندق كاتب هذا بالإنجليزي.',
  'translate.machine': 'ترجمناه لك. الفندق كاتبه بالإنجليزي.',
  'translate.none': 'ما نقدر نترجمه الحين. هذا مثل ما كتبه الفندق.',
  'translate.desk': 'كتبته مادا بالإنجليزي.',

  'trips.board.ask': 'طيران إلى {city}',
  'map.credits': 'مصادر الخريطة',
  'map.marker': 'على الخريطة',
  'map.zoomIn': 'قرّب',
  'map.zoomOut': 'بعّد',
  'discover.cityFromPhone': 'نعرض لك {city}. تقدر تغيّرها متى ما تبي.',
};
