# Arabic voice: the way Riyadh speaks

For the owner to approve. Applies to every traveller-facing Arabic string in `packages/shared/src/copy/ar/*.ts` and `copy/auth.ar.ts`. COPY.md §7.4 still holds (transcreated, not translated; numbers over adjectives; calm).

## The register

- **Spoken Saudi, white dialect.** Najdi-neutral words that read naturally from Jeddah to Dammam: «وش»، «الحين»، «وين»، «بس»، «لين»، «عشان»، «مو»، «ما فيه»، «شي»، «بكرة»، «بعدين».
- **Buttons are imperatives**, never verbal nouns: «كمّل» not «متابعة»، «جرّب مرة ثانية» not «حاول مرة أخرى»، «صوّره الحين» not «امسحه الآن».
- **Questions sound spoken**: «وش نناديك؟»، «تبي شي؟»، «وين رايح؟».
- **No case endings on everyday words**: «رمز جديد» not «رمزًا جديدًا»، «11 محاولة» not «11 محاولةً»، dual as spoken «محاولتين»، «ليلتين».
- **Everyday nouns**: «نت» not «اتصال»، «شنطة» not «حقيبة»، «الرجعة» not «العودة»، «سكن» not «إقامة» (a booking line may still say «الإقامة»).
- **Warm, never slangy or childish.** No «يا هلا والله»، no «هههه»، no emoji, no exclamation marks.
- **مادا is feminine**: «مادا تدوّر»، «مادا تأكّدها». The agent keeps their own gender: «{agent} يتصل بك».
- **The promise lines stay dignified**: «علينا الباقي.»، «قل لنا وين. نحجزها ونبقى معك لين ترجع.»، «حمدًا لله على السلامة.»

## Where MSA stays

Legal and terms (`legal.*`)، invoices and credit notes (`inv.*`)، fare rules and the card-data note (`pay.rule.*`، `pay.card.note`)، the hotel voucher's payable line، the SMS code (`sms.otp`)، the data-export e-mail. Price breakdowns are spoken-plain («ذهاب بس»، «ليلتين»).

## Rules the build checks (`copy/lint-ar.ts`)

Every `{placeholder}` kept, Arabic punctuation «،» «؟» «؛»، no banned AI or system words («خطأ»، «فشل»، «بنجاح»…)، plural forms `.one/.two/.few/.other` where English counts، left-to-right isolates around codes, brand written مادا.

## 30 before and after (the first ten are the audit's)

| # | Key | Before (MSA) | After (Riyadh) |
|---|---|---|---|
| 1 | common.continue | متابعة | كمّل |
| 2 | common.skip | تخطٍّ | تجاوز |
| 3 | common.tryAgain | حاول مرة أخرى | جرّب مرة ثانية |
| 4 | phone.send | أرسلوا لي رمزًا | أرسلوا لي الرمز |
| 5 | name.title | بماذا نناديك؟ | وش نناديك؟ |
| 6 | alerts.title | لن نزعجك إلا حين يهم الأمر. | ما نزعجك إلا إذا الموضوع يهمّك. |
| 7 | wallet.passport.scan | امسحه الآن | صوّره الحين |
| 8 | rf.sent.card | {amount} في طريقه إليك. | {amount} راجع لك. |
| 9 | sr.anything | تحتاج شيئًا؟ | تبي شي؟ |
| 10 | net.offline.body | هذا يحتاج إلى اتصال. كل ما يخص رحلاتك موجود على هذا الجوال. | هذا يحتاج نت. كل شي عن رحلاتك محفوظ عندك بالجوال. |
| 11 | common.notNow | ليس الآن | مو الحين |
| 12 | otp.wrong.two | الرمز غير مطابق. بقيت محاولتان. | الرمز مو صحيح. باقي محاولتين. |
| 13 | today.composer.title | إلى أين بعدها؟ | وين بعدها؟ |
| 14 | trips.empty.title | اسمك ليس على اللوحة بعد. | اسمك ما طلع على اللوحة بعد. |
| 15 | welcomeBack.title | أهلًا بعودتك. | حيّاك الله. |
| 16 | error.internal | لم ينجح الأمر، والتقصير منا. جرّب مرة أخرى، أو تحدّث مع مادا. | ما ضبطت، والتقصير منا. جرّب مرة ثانية، أو كلّم مادا. |
| 17 | search.ways.three | ثلاث طرق للوصول. | ثلاث طرق توصلك. |
| 18 | pay.allIn | كل شيء مشمول. لا رسوم لاحقة. | كل شي مشمول. ولا رسوم بعدين. |
| 19 | pay.declined.body | لم يُخصم شيء. أحيانًا تمنع البنوك مدفوعات السفر الكبيرة… | ما انخصم شي. أحيانًا البنوك توقّف مدفوعات السفر الكبيرة… |
| 20 | wait.question.names | … هل تُكتب التذكرة هكذا تمامًا؟ | … نكتب التذكرة كذا بالضبط؟ |
| 21 | rf.what | ماذا نسترد؟ | وش نرجّع؟ |
| 22 | cf.whatChange | ماذا تريد أن تغيّر؟ | وش تبي تغيّر؟ |
| 23 | td.pack.done | الشنط جاهزة. نومًا هنيئًا. | الشنط جاهزة. تصبح على خير. |
| 24 | td.arr.welcome | أهلًا بك في {city}. | حيّاك الله في {city}. |
| 25 | things.title | ماذا تفعل | وش تسوّي |
| 26 | support.reply.bag | نأسف على الحقيبة. خلّنا نلقاها… | نأسف على الشنطة. خلّنا نلقاها… |
| 27 | circles.report.title | ما المشكلة؟ | وش المشكلة؟ |
| 28 | circles.around.helloSent | أُرسلت. سيراها {name} حين يفتح مادا. | أرسلناها. {name} يشوفها لما يفتح مادا. |
| 29 | circles.join.theySee | إن انضممت، يرون | إذا انضميت، يشوفون |
| 30 | td.wake.sheetTitle | متى نوقظك؟ | متى نصحّيك؟ |

## Language at read time

Inbox lines are stored with their copy keys and parameters (`platform/src/lib/app/notify-copy.ts`) and rendered in the reader's language when the inbox is read, so an Arabic reader never sees "Mada replied" from an English moment, and the other way round. Request titles from Ask (searches by hand, services, form answers) are worded when read too, and the scripted desk texts (airport pickup, Saudia by hand, the Haram room offer) go through copy keys with Arabic versions.

## Still for the native writer

A Saudi copywriter should read the whole catalogue once on a phone, especially the long help answers (`help.a*`)، the disruption rights (`dz.rights.*`) and the Circles place facts (`circles.place.*`), which were already partly spoken and were only touched up.
