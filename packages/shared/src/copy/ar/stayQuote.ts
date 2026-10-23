/**
 * Arabic: rooms the team priced by hand, the card in Ask, the push and the pay sheet's rule (../stay-quote.ts).
 * Spoken Riyadh (docs/app/ARABIC.md); مادا is feminine. A first draft for the native Saudi writer.
 */
import type { stayQuoteCopy } from '../stay-quote';
import type { ArSection } from './types';

export const arStayQuote: ArSection<typeof stayQuoteCopy> = {
  'chat.stayQuote.lead.one': '{agent} من مادا لقى لك غرفتك. احجزها متى ما كنت جاهز.',
  'chat.stayQuote.lead.two': '{agent} من مادا لقى لك غرفتين. اختر اللي تعجبك.',
  'chat.stayQuote.lead.other': '{agent} من مادا لقى لك {count} غرف. اختر اللي تعجبك.',
  'chat.stayQuote.option': 'الخيار {n}',
  'chat.stayQuote.nights.one': 'ليلة وحدة',
  'chat.stayQuote.nights.two': 'ليلتين',
  'chat.stayQuote.nights.few': '{count} ليالٍ',
  'chat.stayQuote.nights.other': '{count} ليلة',
  'chat.stayQuote.guests.one': 'ضيف واحد',
  'chat.stayQuote.guests.two': 'ضيفين',
  'chat.stayQuote.guests.few': '{count} ضيوف',
  'chat.stayQuote.guests.other': '{count} ضيف',
  'chat.stayQuote.freeUntil': 'إلغاء مجاني حتى {date}، الساعة {time} بتوقيت الفندق',
  'chat.stayQuote.book': 'احجز',
  'chat.stayQuote.later': 'مو الحين',
  'chat.stayQuote.parked': 'موجودة في طلباتك متى ما كنت جاهز.',
  'chat.stayQuote.ended': 'انتهى هذا السعر. اطلب من مادا تتحقق منه من جديد.',
  'notify.stayQuote.title': 'سعر غرفتك جاهز',
  'notify.stayQuote.body': '{hotel} · {amount}. احجزها من المحادثة.',
  'notify.stayQuotes.title': 'غرف جاهزة للحجز',
  'notify.stayQuotes.body': '{count} غرف في {city}، تبدأ من {amount}.',
  'pay.rule.stayQuote': 'إلغاء مجاني حتى {date}، الساعة {time} بتوقيت الفندق. بعدها يحاسب الفندق على الإقامة.',
};
