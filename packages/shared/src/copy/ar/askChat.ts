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
};
