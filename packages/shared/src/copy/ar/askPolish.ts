/**
 * Arabic: Today from the plan, the payer's card for a companion's change, and the plan pushes (../ask-polish.ts).
 * Spoken Riyadh (docs/app/ARABIC.md); مادا is feminine. A first draft for the native Saudi writer.
 */
import type { askPolishCopy } from '../ask-polish';
import type { ArSection } from './types';

export const arAskPolish: ArSection<typeof askPolishCopy> = {
  'tp.when.today': 'اليوم',
  'tp.when.tomorrow': 'بكرة',
  'tp.when.inDays': 'بعد {n} أيام',
  'tp.pickup': 'السيارة الساعة {time}، {place}',
  'tp.pickupTime': 'السيارة الساعة {time}',
  'tp.pickupPlace': 'سيارتك، {place}',
  'tp.carCollect': 'استلم السيارة الساعة {time}، {place}',
  'tp.carCollectPlace': 'استلم السيارة، {place}',
  'tp.carCollectAny': 'استلم السيارة',
  'tp.checkin': 'دخولك في {hotel}',
  'tp.drive': '{duration} لين {place}، اطلع قبل {time}',
  'tp.driveNoTime': '{duration} لين {place}',
  'tp.todo.title': 'قبل لا تسافر',
  'tp.todo.passportsWarn': 'جواز يبي تجديد: {names}',
  'tp.todo.passportsMissing': 'جواز ناقص: {names}',
  'tp.open': 'افتح الخطة',
  'chat.payChange.title': 'تغيير {name} يبي حجز',
  'chat.payChange.pricing': 'نجيب لك السعر، ونرد عليك قبل {time}.',
  'chat.payChange.book': 'احجز',
  'chat.payChange.later': 'مو الحين',
  'chat.payChange.parked': 'موجود في الخطة متى ما كنت جاهز.',
  'people.line.needsBooking': 'تغيير {name} يبي حجز. نجيب لك السعر.',
  'people.line.priced': 'سعر تغيير {name} جاهز.',
  'plan.line.desk': 'فريق مادا حدّث خطتك: {title}.',
  'notify.planQuote.title': 'السعر جاهز',
  'notify.planQuote.body': '{what} لرحلة {trip}: {amount}',
  'notify.planPayChange.title': 'تغيير {name} يبي حجز',
  'notify.planPayChange.body': '{trip} · {amount}. احجزه متى ما كنت جاهز.',
  'notify.planCheck.title': 'قبل رحلتك',
  'notify.planCheck.passports.body': '{names}: الجواز يبي تجديد قبل {trip}.',
  'notify.planCheck.body': '{trip}: فيه شي يبي له نظرة.',
};
