/**
 * Arabic: waiting on a search, said as it happens, and the Ask chat's richer cards (waiting.ts). Spoken Riyadh
 * (docs/app/ARABIC.md). A first draft for the native Saudi writer.
 */
import type { waitingCopy } from '../waiting';
import type { ArSection } from './types';

export const arWaiting: ArSection<typeof waitingCopy> = {
  'waiting.stays.0': 'نسأل فنادق {city} عن {dates}',
  'waiting.stays.1': 'نقارن الغرف والأسعار',
  'waiting.stays.2': 'نشوف أي منها إلغاؤه مجاني',
  'waiting.stays.3': 'لسّا نشتغل، بعض الفنادق ردّها بطيء',
  'waiting.flights.0': 'نشوف الرحلات إلى {city} في {dates}',
  'waiting.flights.1': 'نقارن الأوقات والأسعار',
  'waiting.flights.2': 'نحط الأريح أول',
  'waiting.flights.3': 'لسّا نشتغل، بعض الطيران ردّه بطيء',
  'waiting.esim.0': 'ندوّر باقات نت لـ{where}',
  'waiting.esim.1': 'نختار أوفر باقة لمدة {days}',
  'waiting.esim.2': 'لسّا نشتغل، بعض الباقات ردّها بطيء',
  'waiting.pickup.0': 'نطلب سيارات تستقبلك في {city}',
  'waiting.pickup.1': 'نقارن السيارات والأسعار',
  'waiting.pickup.2': 'لسّا نشتغل، بعض الشركات ردّها بطيء',
  'waiting.things.0': 'ندوّر أماكن تزورها في {city}',
  'waiting.things.1': 'نختار اللي يناسب أيامك',
  'waiting.things.2': 'لسّا نشتغل، بعض الأماكن ردّها بطيء',
  'waiting.chat.1': 'نقارن اللي وصلنا',
  'waiting.chat.2': 'لسّا عليها',
  'waiting.chat.3': 'لسّا نشتغل، بعض الردود بطيئة',
  'waiting.fact.time': 'الساعة الحين {time} في {city}',
  'waiting.a11y': 'لسّا ندوّر. {line}',
  'waiting.gaveUp.stays.title': 'الفنادق ردّها بطيء الحين',
  'waiting.gaveUp.stays.body': 'ما ضاع شي. جرّب مرة ثانية، أو مادا تدوّر لك الغرف وترجع لك.',
  'waiting.gaveUp.flights.title': 'الطيران ردّه بطيء الحين',
  'waiting.gaveUp.flights.body': 'ما ضاع شي. جرّب مرة ثانية، أو مادا تدوّر لك الرحلات وترجع لك.',
  'waiting.gaveUp.find': 'خلّ مادا تدوّرها لك',

  'chat.request.status': 'عند الفريق · يردون قبل {time}',
  'chat.request.statusOpen': 'عند الفريق',
  'chat.request.what': 'وش',
  'chat.request.where': 'وين',
  'chat.request.when': 'متى',
  'chat.request.who': 'مين',
  'chat.who.justYou': 'أنت بس',
  'chat.who.youAnd': 'أنت و{names}',
  'chat.trip.open': 'افتح الرحلة',
  'chat.handoff.card': 'واحد من فريق مادا معك من هنا',
  'chat.handoff.cardNamed': '{agent} من مادا معك من هنا',
  'chat.pay.line': 'ما ينخصم شي لين تأكّد',
  'chat.car.line': 'تأكّد مكان اللقاء قبل ما نحجز السيارة',
};
