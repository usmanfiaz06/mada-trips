import type { authCopy } from './auth';

/*
 * Arabic for the sign-in section (same keys as auth.ts). A first draft for the native Saudi writer to transcreate
 * (COPY.md §7.4). The brand is written مادا. Codes, numbers and addresses stay left-to-right inside the sentence.
 */
export const authCopyAr: Record<keyof typeof authCopy, string> = {
  'auth.signin.email': 'المتابعة بالبريد الإلكتروني',
  'auth.signin.phone': 'المتابعة برقم الجوال',
  'auth.signin.busy': 'نسجّل دخولك',
  'auth.signin.cancelled': 'ألغيت تسجيل الدخول. لم نأخذ أي معلومة.',
  'auth.signin.unavailable': 'هذه الطريقة غير جاهزة على هذا الجوال. استخدم بريدك أو رقم جوالك.',

  'auth.email.title': 'بريدك الإلكتروني',
  'auth.email.body': 'نرسل لك رمزًا من 6 أرقام. بدون كلمة مرور.',
  'auth.email.label': 'البريد الإلكتروني',
  'auth.email.placeholder': 'you@example.com',
  'auth.email.problem': 'العنوان ناقص. يحتاج إلى @ واسم النطاق.',
  'auth.email.send': 'أرسلوا لي الرمز',
  'auth.email.codeTitle': 'افتح بريدك',
  'auth.email.sentTo': 'أرسلناه إلى {email}.',
  'auth.email.change': 'غيّر البريد',
  'auth.email.demo': 'رمز التجربة: 123456',

  'auth.code.wrong': 'الرمز غير مطابق. تأكد من آخر رمز أرسلناه.',
  'auth.code.expired': 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا لتكمل.',
  'auth.code.wait': 'تقدر تطلب رمزًا جديدًا بعد {seconds} ثانية.',
  'auth.code.tooMany': 'طلبت رموزًا كثيرة. حاول بعد ساعة، أو تواصل مع مادا.',
  'auth.code.resendIn': 'رمز جديد بعد 0:{seconds}',

  'auth.verifyPhone.title': 'وثّق رقم جوالك',
  'auth.verifyPhone.body': 'دخلت بحساب {provider}. قبل أول حجز نحتاج رقم جوال معك، لتغييرات البوابة ورسائل فيصل.',
  'auth.verifyPhone.bodyPlain': 'قبل أول حجز نحتاج رقم جوال معك، لتغييرات البوابة ورسائل فيصل.',
  'auth.verifyPhone.later': 'لاحقًا',
  'auth.verifyPhone.done': 'تم توثيق رقمك.',
  'auth.verifyPhone.needed': 'وثّق رقم جوالك لتحجز.',
  'auth.verifyPhone.neededBody': 'الخطوط السعودية وفريقنا يحتاجون رقمًا يوصل لك. تأخذ دقيقة.',
  'auth.verifyPhone.go': 'وثّق رقمي',
  'auth.verifyPhone.row': 'وثّق رقم جوالك',
  'auth.verifyPhone.rowSub': 'مطلوب قبل أول حجز',
  'auth.provider.apple': 'Apple',
  'auth.provider.google': 'Google',
  'auth.provider.email': 'بريدك الإلكتروني',

  'auth.methods.email': 'البريد الإلكتروني',
  'auth.methods.emailSub': 'رمز بالبريد',
  'auth.methods.addEmail': 'تضيف بريدك كطريقة دخول؟',
  'auth.methods.addEmailBody': 'نرسل رمزًا لنتأكد أنه بريدك.',
  'auth.methods.addPhoneBody': 'نرسل رمزًا لنتأكد أنه رقمك.',
  'auth.methods.addEmailGo': 'أضف بريدي',
  'auth.methods.addPhoneGo': 'أضف رقمي',
  'auth.methods.emailManage': 'تقدر تدخل برمز يصل إلى {email}.',
  'auth.methods.phoneKept': 'رقمك يبقى. به يتواصل معك فيصل أثناء الرحلة.',
  'auth.methods.changePhone': 'استخدم رقمًا آخر',
  'auth.methods.changeEmail': 'استخدم بريدًا آخر',
  'auth.methods.confirmFirst': 'سجّل دخولك من جديد لتغيير هذا.',
  'auth.methods.confirmFirstBody': 'لحمايتك، نتأكد أنك أنت قبل إضافة طريقة دخول. سجّل خروجك ثم ادخل كالمعتاد.',
  'auth.methods.taken': 'حساب {name} هذا مرتبط بحساب آخر في مادا.',
  'auth.methods.emailAdded': 'أضفنا بريدك. تقدر تدخل به الآن.',

  'auth.error.phoneRequired': 'وثّق رقم جوالك لتحجز. تأخذ دقيقة.',
  'auth.error.identityTaken': 'طريقة الدخول هذه مرتبطة بحساب آخر.',
  'auth.error.signInAgain': 'سجّل دخولك من جديد لتكمل.',
};
