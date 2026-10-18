/**
 * Arabic: booking, pay, hotel, money and family (pay-family.ts). Spoken Riyadh (docs/app/ARABIC.md).
 */
import type { payFamilyCopy } from '../pay-family';
import type { ArSection } from './types';

export const arPayFamily: ArSection<typeof payFamilyCopy> = {
  'rn.eyebrow': 'وش تسوي مادا',
  'rn.step': 'نجدّد جواز {name}',
  'rn.by': 'جاهز قبل {date}',
  'rn.cost': '{price} أتعاب مادا. ورسوم الجواز تندفع في أبشر.',
  'rn.book': 'احجز الحين، ومادا تجدّده قبل {date} · {price}',
  'rn.alongside': 'مقاعدكم محجوزة الحين. والتجديد يمشي معها، ومادا تعلمك يوم يجهز.',
  'rn.late': 'التجديد ياخذ حوالي {days} يوم، يعني يجهز {date}: قريب مرة من الرحلة.',
  'rn.lateNext': 'اختر تواريخ أبعد، أو احجز بدون {name}.',
  'rn.asking': 'نبلّغ مادا…',
  'rn.onIt': 'مادا تجدّده',
  'rn.renewingLine': 'مادا تجدّده. جاهز قبل {date}.',
  'rn.pill': 'يتجدّد',
  'entry.passport.renewing': 'مادا تجدّد جواز {name}. جاهز قبل {date}.',
  'rn.without': 'احجز بدون {name}',
  'rn.payNote': 'مادا تطلب التجديد مع هذا الحجز. والـ {price} تندفع لحالها، بعد ما تاخذ مادا الموعد.',
  'pf.title': 'للعائلة',
  'pf.bags': 'الشنط {bags} لكل واحد',
  'pf.bassinet.one': 'طلبنا سرير طفل',
  'pf.bassinet.two': 'طلبنا سريرين أطفال',
  'pf.bassinet.few': 'طلبنا {count} أسرّة أطفال',
  'pf.bassinet.other': 'طلبنا {count} سرير أطفال',
  'pf.meals': 'وجبات أطفال × {count}',
  'pf.adultFare': '{name}، {age}: الطيران يحسب من 12 سنة وفوق بسعر الكبار.',
  'party.childrenHintFare': 'لين 17 سنة، عمر لكل واحد. الطيران يحسب من 12 وفوق بسعر الكبار.',
  'party.adultAge': 'الطيران يحسب من 12 وفوق بسعر الكبار.',
};
