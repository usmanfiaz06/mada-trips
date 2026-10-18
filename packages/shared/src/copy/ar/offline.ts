/**
 * Arabic: the app with no signal, and with almost no battery (offline.ts).
 * Written the way Riyadh speaks (docs/app/ARABIC.md): spoken Saudi, imperatives on buttons, no case endings.
 */
import type { offlineCopy } from '../offline';
import type { ArSection } from './types';

export const arOffline: ArSection<typeof offlineCopy> = {
  'off.had': 'ما عندك نت. هذا اللي كان عندنا الساعة {time}.',
  'off.saved': 'محفوظ الساعة {time}',
  'off.willSend': 'ينرسل أول ما يرجع النت',

  'off.newVersion': 'فيه نسخة جديدة جاهزة',
  'off.refresh': 'حدّث',

  'wait.signin.title': 'سجّل دخولك عشان تشوفه',
  'wait.signin.body': 'انتهت جلستك. سجّل دخولك وترجع لنفس الشاشة.',

  'lp.entry': 'البطارية قليلة؟ المهم بس',
  'lp.suggest': 'البطارية {percent}٪. تبي شاشة البطارية القليلة؟',
  'lp.suggestOpen': 'افتحها',
  'lp.title': 'المهم بس',
  'lp.sub': 'شاشة غامقة وبسيطة، عشان توفّر البطارية.',
  'lp.flight': 'رحلتك الجاية',
  'lp.flightLine': '{from} → {to} · {time}',
  'lp.ref': 'رقم الحجز {ref}',
  'lp.seat': 'المقعد {seat}',
  'lp.gate': 'البوابة {gate}',
  'lp.terminal': 'الصالة {terminal}',
  'lp.driver': 'السوّاق',
  'lp.driverAt': 'الساعة {time} · {place}',
  'lp.callDriver': 'اتصل على {driver}',
  'lp.hotel': 'فندقك · ورّه السوّاق',
  'lp.mada': 'مادا، أي ساعة',
  'lp.callMada': 'اتصل على مادا',
  'lp.callback': 'خلّ مادا تتصل فيني',
  'lp.callbackBody': 'اتصلوا فيني لو سمحتوا. البطارية قليلة.',
  'lp.callbackBy': 'مادا تتصل فيك قبل {time}.',
  'lp.callbackSent': 'أرسلناها. مادا تتصل فيك خلال 10 دقايق.',
  'lp.callbackNoNet': 'ما عندك نت. الاتصال يشتغل: اتصل على مادا.',
  'lp.nothing': 'ما فيه رحلة ولا سيارة ولا فندق قريب.',
  'lp.back': 'ارجع للتطبيق كامل',
};
