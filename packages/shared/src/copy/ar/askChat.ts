/**
 * Arabic: Ask as a conversation (ask-chat.ts). Spoken Riyadh (docs/app/ARABIC.md); مادا is feminine. A first draft for
 * the native Saudi writer.
 */
import type { askChatCopy } from '../ask-chat';
import type { ArSection } from './types';

export const arAskChat: ArSection<typeof askChatCopy> = {
  'chat.disclosure': 'ردود فورية من مادا. والفريق يأكّد أي شي تحجزه.',
  'chat.found': 'هذا اللي لقيناه.',
  'chat.cant': 'ما نقدر نجاوب على هذي هنا. فريق مادا يقدر، بأي وقت.',
  'chat.abuse': 'حنا هنا نساعدك في سفرك. قل لنا وين تبي تروح.',
  'chat.refusal': 'ما نقدر نساعد في هذي. قل لنا عن رحلتك ونكمّل معك.',
  'chat.handoff': '{agent} من مادا معك من هنا.',
  'chat.handoffTeam': 'فريق مادا يكمّل معك من هنا.',
  'chat.openThread': 'افتح المحادثة',
  'chat.seeAll': 'شوف الكل',
  'chat.choose': 'اختر',
  'chat.pay': 'راجع وادفع',
  'chat.carGo': 'جهّز السيارة',
  'chat.request': 'شوف الطلب',
  'chat.entryGo': 'شوف وش المطلوب',
  'chat.stopped': 'انقطع علينا الكلام. هذا هو بالطريقة المعتادة.',
  'chat.working': 'مادا تكتب',
  /** Next-step chips the server adds when Mada's reply left none (docs/app/ASSISTANT.md §3). */
  'chat.next.bookFlight': 'احجز {airline} {time}',
  'chat.next.bookStay': 'احجز {hotel}',
  'chat.next.bookFirst': 'احجز الأول',
  'chat.next.staysIn': 'فنادق في {city}',
  'chat.next.flightsTo': 'طيران لـ{city}',
  'chat.next.otherDates': 'تواريخ ثانية',
  'chat.next.esimGb': 'خذ باقة {gb} جيجا',
  'chat.next.moreData': 'باقة أكبر',
  'chat.next.arrange': 'خلّصوها لنا',
  'chat.next.carPickup': 'أكّد مكان الركوب',
  'chat.next.carLater': 'بعد ربع ساعة',
  'chat.next.carWhere': 'غيّر الوجهة',
  'chat.next.nextTrip': 'رحلتي الجاية',
  'chat.next.tripHotel': 'أضف فندق',
  'chat.next.tripEsim': 'شريحة نت للرحلة',
  'chat.next.request': 'شوف الطلب',
  'chat.next.pay': 'راجع وادفع',
  'chat.next.otherOptions': 'خيارات ثانية',
  'chat.next.openChat': 'افتح المحادثة',
  'chat.next.team': 'كلّم الفريق',
  'chat.next.flights': 'دوّر طيران',
  'chat.next.stays': 'دوّر فندق',
  'chat.next.esim': 'شريحة نت',
  'chat.next.myTrips': 'رحلاتي',
};
