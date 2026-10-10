/**
 * Arabic: What the agent desk sends to travellers (desk.ts).
 * A first draft in warm, plain Modern Standard Arabic for the native Saudi writer to transcreate (COPY.md §7.4).
 * Same keys as the English; Arabic's extra plural forms are `.two`, `.few` and `.zero`. The brand is مادا.
 * Generated once from the translation sheet; edit here from now on.
 */
import type { deskCopy } from '../desk';
import type { ArSection } from './types';

export const arDesk: ArSection<typeof deskCopy> = {
  'desk.order.held': 'حجزت مقاعدكم. التذاكر هي الخطوة التالية.',
  'desk.order.issued': 'تم حجزكم. رمز الحجز {ref}. تذاكركم في المحفظة.',
  'desk.order.priceChanged': 'تغيّر السعر إلى {amount} قبل أن أحجز. لم يُخصم شيء. خذ السعر الجديد، أو اختر من جديد.',
  'desk.order.priceChanged.reason': 'غيّرت شركة الطيران السعر عند الحجز.',
  'desk.order.notIssued': 'لم نتمكن من حجز هذه التذاكر. لم يُخصم شيء، وأُفرج عن التعليق على بطاقتك.',
  'desk.order.notIssued.next': 'اسأل مادا ونجد لك أفضل بديل.',
  'desk.order.question.waiting': 'يحتاج {agent} إجابتك قبل الحجز.',
  'desk.quote.sent': 'هذا سعر كل واحد منكم.',
  'desk.request.done': 'انتهينا. كل شيء في رحلتك.',
  'desk.checklist.title': 'ما نحتاجه منك',
  'desk.refund.approved.card': 'تمت الموافقة على استرداد {amount}. يعود إلى {card}، عادةً خلال 5 إلى 10 أيام.',
  'desk.refund.approved.credit': 'تمت الموافقة على استرداد {amount}، وهو في رصيد مادا الآن.',
  'desk.refund.rejected': 'لا نستطيع استرداد هذا المبلغ. {reason}',
  'desk.refund.instalments': 'دُفع عبر {provider}: أُلغيت الدفعات المتبقية، وما دفعته يعود إلى بطاقتك.',
  'desk.disruption.voucher': '{amount} رصيد مادا تعويضًا عن التعب. في حسابك الآن.',
  'notify.desk.question.title': 'مادا تحتاج إجابتك',
  'notify.desk.question.body': '{agent}: {question}',
  'notify.desk.price.title': 'تغيّر السعر',
  'notify.desk.price.body': 'لم يُخصم شيء. خذ السعر الجديد، أو اختر من جديد.',
  'notify.desk.notIssued.title': 'لم نتمكن من الحجز',
  'notify.desk.notIssued.body': 'لم يُخصم شيء. اسأل مادا ونجد طريقة أخرى.',
  'notify.desk.quote.title': 'سعرك جاهز',
  'notify.desk.quote.body': 'أرسل {agent} سعر {summary}.',
  'notify.desk.reply.title': 'مادا',
  'notify.desk.reply.body': '{agent}: {text}',
  'notify.desk.refund.title': 'تمت الموافقة على الاسترداد',
  'notify.desk.refund.body': '{amount} في طريقه إليك.',
  'notify.desk.refundNo.title': 'بخصوص استردادك',
  'notify.desk.refundNo.body': 'لا نستطيع استرداد هذا المبلغ. افتحه لتعرف السبب.',
  'notify.desk.plan.title': 'خطة جديدة لرحلة {flight}',
  'notify.desk.plan.body': '{agent}: {plan}',
};
