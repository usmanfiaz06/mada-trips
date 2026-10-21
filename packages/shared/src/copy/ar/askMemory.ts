/**
 * Arabic: What Mada remembers (ask-memory.ts). Spoken Riyadh (docs/app/ARABIC.md); مادا is feminine. A first draft
 * for the native Saudi writer.
 */
import type { askMemoryCopy } from '../ask-memory';
import type { ArSection } from './types';

export const arAskMemory: ArSection<typeof askMemoryCopy> = {
  'memory.title': 'وش تتذكر مادا',
  'memory.intro': 'أشياء بسيطة قلتها لمادا، عشان رحلتك الجاية تبدأ صح. محد يشوفها غيرك، وتقدر تشيل أي وحدة منها.',
  'memory.empty': 'للحين ما فيه شي. قل لمادا شي ثابت، مثل مقعد على الممر أو إنك تسافر من جدة، ويطلع هنا.',
  'memory.group': 'من محادثاتك',
  'memory.kind.home_airport': 'مطارك',
  'memory.kind.airline': 'شركة الطيران',
  'memory.kind.cabin': 'الدرجة',
  'memory.kind.seat': 'المقعد',
  'memory.kind.budget': 'الميزانية',
  'memory.kind.food': 'الأكل',
  'memory.kind.mobility': 'التنقّل',
  'memory.kind.health': 'الصحة',
  'memory.kind.family': 'العائلة',
  'memory.kind.contact': 'كيف نوصل لك',
  'memory.kind.other': 'زين نعرفه',
  'memory.source.chat': 'قلته في المحادثة · {date}',
  'memory.source.booking': 'من حجز · {date}',
  'memory.remove': 'شيل',
  'memory.remove.a11y': 'شيل «{text}»',
  'memory.removed': 'انشال. مادا ما راح تستخدمه مرة ثانية.',
  'memory.forgetAll': 'انسوا كل شي',
  'memory.forgetAll.title': 'تبي مادا تنسى كل شي تتذكره؟',
  'memory.forgetAll.body': 'مادا تبدأ معك من جديد المرة الجاية. رحلاتك وحجوزاتك وعائلتك تبقى زي ما هي.',
  'memory.forgetAll.keep': 'خلّها',
  'memory.forgetAll.done': 'تم. مادا تبدأ معك من جديد.',
  'memory.footer': 'مادا تشوف بعد آخر عمليات البحث والأماكن المحفوظة ورحلاتك لما ترد عليك. وهذي باقية في شاشاتها.',
  'profile.memory': 'وش تتذكر مادا',
  'profile.memorySub': 'المقاعد والمطارات والاحتياجات من محادثاتك',
  'privacy.keep.memory': 'وش تتذكر مادا',
  'privacy.keep.memoryWhy': 'أشياء قلتها لمادا، مثل المقعد أو مطارك، عشان ما تعيدها. الاحتياجات الصحية أو التنقّل بس بعد ما توافق. تشوفها وتشيلها متى ما بغيت.',
  'chat.remembered': 'بنتذكر هذا للمرة الجاية.',
  'chat.newChat': 'محادثة جديدة',
  'chat.newChat.a11y': 'ابدأ محادثة جديدة',
};
