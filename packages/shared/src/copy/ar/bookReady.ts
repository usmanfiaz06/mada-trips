/**
 * Arabic: booking from the plan (book-ready.ts). Spoken Riyadh (docs/app/ARABIC.md); مادا is feminine. A first draft
 * for the native Saudi writer.
 */
import type { bookReadyCopy } from '../book-ready';
import type { ArSection } from './types';

export const arBookReady: ArSection<typeof bookReadyCopy> = {
  'ready.title': 'احجز الجاهز',
  'ready.pick': 'اختر وش تحجز الحين. الباقي يظل في الخطة مثل ما هو.',
  'ready.day': 'اليوم {n}',
  'ready.whole': 'كل الرحلة',
  'ready.quote': 'عرض من الفريق',
  'ready.total': 'المجموع',
  'ready.chosen': 'اخترت {n} من {all}',
  'ready.payWith': 'ادفع بـ{method}',
  'ready.noCard': 'أضف بطاقة في المحفظة عشان تحجز من هنا.',
  'ready.slide': 'اسحب واحجز',
  'ready.nothing': 'اختر شي واحد على الأقل.',
  'ready.expired.title': 'انتهى السعر',
  'ready.expired.body': 'هذي تسعّرت قبل. نشوف سعرها من جديد قبل الحجز.',
  'ready.priceAgain': 'شوف السعر من جديد',
  'ready.priceAgainSay': 'شوفي سعر {title} من جديد',
  'ready.none.title': 'ما فيه شي مسعّر',
  'ready.none.body': 'دوّر طيران أو سكن أو شريحة للخطة أول. كل وحدة تطلع هنا أول ما يتأكد سعرها.',
  'ready.done.title': 'انحجزت',
  'ready.done.body': 'كل وحدة صارت محجوزة في الخطة. والباقي مثل ما هو.',
  'ready.done.plan': 'ارجع للرحلة',
  'ready.partial': '{title} ما انحجز: {why}. والباقي انحجز.',
  'ready.why.price': 'السعر تغيّر، شوفه من جديد',
  'ready.why.declined': 'البطاقة انرفضت',
  'ready.why.other': 'يحتاج نظرة ثانية',
  'plan.line.withTeam': 'عند الفريق · يردون قبل {time}',
  'plan.line.withTeamNow': 'عند الفريق',
  'plan.line.quoteReady': 'العرض جاهز · {amount}',
  'plan.line.priceExpired': 'السعر انتهى، شوفه من جديد',
  'chat.plan.ready': 'جاهز للحجز · {amount}',
  'chat.plan.bookedTotal': 'محجوز · {amount}',
  'chat.plan.bookReady': 'احجز الجاهز',
  'request.title.carRental': 'سيارة إيجار في {where}',
  'request.title.carRentalAny': 'سيارة إيجار',
  'request.title.driver': 'سواق في {where}',
  'request.title.driverAny': 'سواق',
};
