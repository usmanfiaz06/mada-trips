/**
 * Arabic: cancel and refund in Ask (ask-refund.ts). Spoken Riyadh (docs/app/ARABIC.md); the stored balance is «محفظة مادا».
 */
import type { askRefundCopy } from '../ask-refund';
import type { ArSection } from './types';

export const arAskRefund: ArSection<typeof askRefundCopy> = {
  'chat.refund.cancelling': 'نلغي · {city}',
  'chat.refund.allBack': 'المبلغ كله يرجع لك حسب القواعد.',
  'chat.refund.kept.hotel': 'الفندق ياخذ {amount} حسب شروط الإلغاء حقته.',
  'chat.refund.kept.airline': 'شركة الطيران تاخذ {amount} حسب شروط التذكرة.',
  'chat.refund.kept.driver': 'السواق ياخذ {amount} لأنها خلال 24 ساعة.',
  'chat.refund.kept.supplier': '{amount} ما يرجع حسب القواعد.',
  'chat.refund.slide': 'ألغِ ورجّع {amount}',
  'chat.refund.nothingCancelled': 'ما ينلغي شي لين تسحب.',
  'chat.refund.failed': 'ما مشت، وما انلغى شي. اسحب مرة ثانية.',
  'chat.refund.state.wallet': 'في محفظة مادا',
  'chat.refund.state.approved': 'انقبل',
  'chat.refund.state.sent': 'انرسل لبطاقتك',
  'chat.refund.state.waiting': 'ينتظر الفريق',
  'chat.refund.state.declined': 'ما انسترد',
  'chat.refund.status': 'نشوف كم يرجع لك',
};
