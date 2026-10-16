/**
 * Arabic: What the agent desk sends to travellers (desk.ts).
 * Written the way Riyadh speaks (docs/app/ARABIC.md): the agent talks like a person, not a letter.
 * Same keys as the English; Arabic's extra plural forms are `.two`, `.few` and `.zero`. The brand is مادا.
 */
import type { deskCopy } from '../desk';
import type { ArSection } from './types';

export const arDesk: ArSection<typeof deskCopy> = {
  'desk.order.held': 'حجزت مقاعدكم. الخطوة الجاية التذاكر.',
  'desk.order.issued': 'تم حجزكم. رمز الحجز {ref}. تذاكركم في المحفظة.',
  'desk.order.priceChanged': 'تغيّر السعر إلى {amount} قبل ما أحجز. ما انخصم شي. خذ السعر الجديد، أو اختر من جديد.',
  'desk.order.priceChanged.reason': 'شركة الطيران غيّرت السعر وقت الحجز.',
  'desk.order.notIssued': 'ما قدرنا نحجز هذي التذاكر. ما انخصم شي، وانفكّ التعليق على بطاقتك.',
  'desk.order.notIssued.next': 'اسأل مادا ونلقى لك أفضل بديل.',
  'desk.order.question.waiting': '{agent} يحتاج جوابك قبل الحجز.',
  'desk.quote.sent': 'هذا سعر كل واحد منكم.',
  'desk.request.done': 'خلصنا. كل شي في رحلتك.',
  'desk.checklist.title': 'وش نحتاج منك',
  'desk.refund.approved.card': 'وافقنا على استرداد {amount}. يرجع إلى {card}، غالبًا خلال 5 إلى 10 أيام.',
  'desk.refund.approved.credit': 'وافقنا على استرداد {amount}، وهو في رصيد مادا الحين.',
  'desk.refund.rejected': 'ما نقدر نرجّع هذا المبلغ. {reason}',
  'desk.refund.instalments': 'مدفوع عبر {provider}: ألغينا الدفعات الباقية، واللي دفعته يرجع لبطاقتك.',
  'desk.disruption.voucher': '{amount} رصيد مادا تعويض عن التعب. في حسابك الحين.',
  'notify.desk.question.title': 'مادا تحتاج جوابك',
  'notify.desk.question.body': '{agent}: {question}',
  'notify.desk.price.title': 'تغيّر السعر',
  'notify.desk.price.body': 'ما انخصم شي. خذ السعر الجديد، أو اختر من جديد.',
  'notify.desk.notIssued.title': 'ما قدرنا نحجز',
  'notify.desk.notIssued.body': 'ما انخصم شي. اسأل مادا ونلقى طريقة ثانية.',
  'notify.desk.quote.title': 'سعرك جاهز',
  'notify.desk.quote.body': '{agent} أرسل سعر {summary}.',
  'notify.desk.reply.title': 'مادا',
  'notify.desk.reply.body': '{agent}: {text}',
  'notify.desk.refund.title': 'وافقنا على الاسترداد',
  'notify.desk.refund.body': '{amount} راجع لك.',
  'notify.desk.refundNo.title': 'بخصوص استردادك',
  'notify.desk.refundNo.body': 'ما نقدر نرجّع هذا المبلغ. افتحه عشان تعرف السبب.',
  'notify.desk.plan.title': 'خطة جديدة لرحلة {flight}',
  'notify.desk.plan.body': '{agent}: {plan}',
};
