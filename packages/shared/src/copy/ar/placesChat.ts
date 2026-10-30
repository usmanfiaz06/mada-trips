/**
 * Arabic: places in Ask (places-chat.ts). Spoken Riyadh (docs/app/ARABIC.md). "Google Maps" stays in Latin letters:
 * it is the credit Google's terms ask for, written as the brand writes it.
 */
import type { placesChatCopy } from '../places-chat';
import type { ArSection } from './types';

export const arPlacesChat: ArSection<typeof placesChatCopy> = {
  'chat.places.google': 'Google Maps',
  'chat.places.photoBy': 'تصوير: {name}',
  'chat.places.openNow': 'مفتوح الحين',
  'chat.places.closesAt': 'مفتوح · يسكّر {time}',
  'chat.places.closed': 'مسكّر',
  'chat.places.opensAt': 'مسكّر · يفتح {time}',
  'chat.places.fromHotel': '{distance} من فندقك',
  'chat.places.away': 'يبعد {distance}',
  'chat.places.m': '{m} م',
  'chat.places.km': '{km} كم',
  'chat.places.price.1': 'أسعاره رخيصة',
  'chat.places.price.2': 'أسعاره متوسطة',
  'chat.places.price.3': 'أسعاره غالية',
  'chat.places.price.4': 'غالي مرّة',
  'chat.places.today': 'اليوم: {hours}',
  'chat.places.week': 'أوقات الدوام',
  'chat.places.noHours': 'ما عند Google أوقاته',
  'chat.places.directions': 'الاتجاهات',
  'chat.places.call': 'اتصل',
  'chat.places.website': 'الموقع',
  'chat.places.addToPlan': 'أضفه للخطة',
  'chat.places.pickDay': 'أي يوم؟',
  'chat.places.day': 'اليوم {n} · {date}',
  'chat.places.added': 'انضاف لليوم {n}',
  'chat.places.addSay': 'أضف {name} لخطتي',
  'chat.places.more': 'تفاصيل {name}',
  'chat.places.a11y.rating': '{rating} نجوم من {count} تقييم',
};
