/* =========================================================
   MADA CONCIERGE: knowledge base
   Edit answers here. No code changes needed.
   - keys:  words or phrases that trigger the topic (English, Arabic, common typos)
   - en/ar: the reply. [text](url) becomes a link.
   - chips: follow-up buttons. Use a flow id (Travel, Events, Manpower, Visa,
            Hotels, IT, Other) to start a request, or "human" to hand over.
   ========================================================= */
window.MADA_KB = {
  company: {
    name: 'Mada Trips',
    phone: '966566682662',
    phoneDisplay: '+966 56 668 2662',
    city: 'Riyadh'
  },

  intents: [
    /* ---------- small talk ---------- */
    { id: 'greeting', keys: ['hi', 'hello', 'hey', 'hiya', 'salam', 'salaam', 'assalamu alaikum', 'marhaba', 'good morning', 'good evening', 'مرحبا', 'اهلا', 'السلام عليكم', 'هلا', 'صباح الخير', 'مساء الخير'],
      en: 'Marhaba, welcome to Mada. What are you planning?', ar: 'أهلاً وسهلاً بك في مادا. كيف نقدر نخدمك؟', chips: ['menu'], weak: true },
    { id: 'howareyou', keys: ['how are you', 'how r u', 'hows it going', 'كيف حالك', 'شلونك', 'كيفك'],
      en: 'All good here, thank you for asking. How can we help today?', ar: 'بخير الحمد لله، شكراً لسؤالك. كيف نقدر نساعدك اليوم؟', chips: ['menu'] },
    { id: 'thanks', keys: ['thanks', 'thank you', 'thx', 'ty', 'appreciate', 'great', 'perfect', 'شكرا', 'مشكور', 'يعطيك العافيه', 'جزاك الله خير'],
      en: 'Our pleasure. Anything else I can help with?', ar: 'العفو، في خدمتك دائماً. هل تحتاج أي شيء آخر؟', chips: ['menu'], weak: true },
    { id: 'bye', keys: ['bye', 'goodbye', 'see you', 'thats all', 'that is all', 'no thanks', 'مع السلامه', 'في امان الله', 'باي'],
      en: 'Thank you for visiting Mada. We’re a message away on WhatsApp whenever you need us.', ar: 'شكراً لزيارتك مادا. نحن على بعد رسالة واتساب متى ما احتجتنا.', chips: ['human'] },
    { id: 'bot', keys: ['are you a bot', 'are you human', 'are you real', 'robot', 'ai', 'chatbot', 'انت بوت', 'انت روبوت', 'انت انسان'],
      en: 'I’m Mada’s virtual concierge. I gather the details, then a real person from our Riyadh team takes over on WhatsApp.', ar: 'أنا المساعد الافتراضي لمادا. أجمع التفاصيل ثم يتواصل معك شخص من فريقنا في الرياض عبر واتساب.', chips: ['human', 'menu'] },
    { id: 'human', keys: ['human', 'agent', 'real person', 'representative', 'speak to someone', 'talk to someone', 'speak to a person', 'talk to a person', 'talk to a human', 'call me', 'customer service', 'live agent', 'موظف', 'شخص حقيقي', 'خدمة العملاء', 'اكلم احد', 'ابي اكلم', 'اتصلوا علي'],
      action: 'human' },
    { id: 'abuse', keys: ['stupid', 'idiot', 'useless', 'shut up', 'damn', 'wtf', 'غبي', 'تافه', 'اسكت'],
      en: 'Sorry this hasn’t been helpful. Let me put you straight through to the team.', ar: 'نعتذر إن لم نكن عند حسن ظنك. دعني أوصلك بالفريق مباشرة.', action: 'human' },

    /* ---------- company ---------- */
    { id: 'about', keys: ['who are you', 'what is mada', 'about mada', 'about you', 'your company', 'what do you do', 'meaning of mada', 'من انتم', 'وش مادا', 'ما هي مادا', 'معنى مادا'],
      en: 'Mada means “reach”. We’re a Riyadh team for travel, ticketing, hotels, visas, business services, manpower, specialists, events and IT. One partner, one point of contact. [About us](/about)', ar: 'مادا تعني "المدى". نحن فريق في الرياض للسفر والتذاكر والفنادق والتأشيرات وخدمات الأعمال والعمالة والكفاءات والفعاليات وتقنية المعلومات. شريك واحد ونقطة تواصل واحدة. [من نحن](/about)', chips: ['menu'] },
    { id: 'services', keys: ['services', 'what services', 'what can you do', 'offerings', 'خدمات', 'خدماتكم', 'وش تقدمون'],
      en: 'We cover nine areas: travel, ticketing, hotels, visa support, business services, manpower, specialist supply, events and IT. [See all services](/services)', ar: 'نغطي تسعة مجالات: السفر، التذاكر، الفنادق، التأشيرات، خدمات الأعمال، العمالة، الكفاءات المتخصصة، الفعاليات، وتقنية المعلومات. [كل الخدمات](/services)', chips: ['menu'] },
    { id: 'founder', keys: ['founder', 'ceo', 'owner', 'bader', 'who owns', 'المؤسس', 'الرئيس التنفيذي', 'بدر', 'المالك'],
      en: 'Mada was founded by Bader Al Sulaiman, our Founder and CEO. [Read more](/about)', ar: 'أسس مادا بدر السليمان، المؤسس والرئيس التنفيذي. [اقرأ المزيد](/about)', chips: ['menu'] },
    { id: 'location', keys: ['where are you', 'location', 'address', 'office', 'based', 'visit you', 'map', 'وين مكانكم', 'الموقع', 'العنوان', 'مكتب', 'وينكم'],
      en: 'We’re based in Riyadh and work across every region of the Kingdom, and abroad for travel. Message us to arrange a meeting.', ar: 'مقرنا في الرياض ونعمل في جميع مناطق المملكة، وخارجها للسفر. راسلنا لترتيب موعد.', chips: ['human', 'menu'] },
    { id: 'coverage', keys: ['which cities', 'do you cover', 'work in', 'jeddah', 'dammam', 'khobar', 'abha', 'neom', 'alula', 'tabuk', 'outside riyadh', 'جده', 'الدمام', 'الخبر', 'ابها', 'نيوم', 'العلا', 'تبوك'],
      en: 'Yes, we work across the whole Kingdom: Riyadh, Jeddah, the Eastern Province, AlUla, NEOM, Abha and beyond.', ar: 'نعم، نعمل في جميع أنحاء المملكة: الرياض وجدة والمنطقة الشرقية والعلا ونيوم وأبها وغيرها.', chips: ['menu'], weak: true },
    { id: 'hours', keys: ['hours', 'opening hours', 'are you open', 'working hours', 'what time', 'weekend', 'friday', 'ساعات العمل', 'متى تفتحون', 'الدوام', 'الجمعة'],
      en: 'Message us any time. We reply within one working day, usually much sooner. For anything urgent, call [+966 56 668 2662](tel:+966566682662).', ar: 'راسلنا في أي وقت. نرد خلال يوم عمل واحد وغالباً أسرع. للأمور العاجلة اتصل على [+966 56 668 2662](tel:+966566682662).', chips: ['human'] },
    { id: 'contact', keys: ['contact', 'phone number', 'your number', 'contact number', 'whatsapp', 'email', 'reach you', 'call you', 'رقم', 'جوال', 'واتساب', 'تواصل', 'ايميل'],
      en: 'Call or WhatsApp us on [+966 56 668 2662](tel:+966566682662), or use the [contact form](/contact).', ar: 'اتصل أو راسلنا واتساب على [+966 56 668 2662](tel:+966566682662)، أو استخدم [نموذج التواصل](/contact).', chips: ['human'] },
    { id: 'languages', keys: ['language', 'english', 'arabic', 'speak', 'urdu', 'اللغه', 'تتكلمون'],
      en: 'Our team works in Arabic and English. Tap ع at the top to chat in Arabic.', ar: 'فريقنا يتحدث العربية والإنجليزية. اضغط EN في الأعلى للمحادثة بالإنجليزية.', chips: ['menu'], weak: true },
    { id: 'response', keys: ['how long to reply', 'how fast', 'response time', 'when will you reply', 'متى تردون', 'كم ياخذ الرد'],
      en: 'Within one working day, usually the same day. WhatsApp is the quickest way to reach us.', ar: 'خلال يوم عمل واحد، وغالباً في نفس اليوم. الواتساب هو أسرع طريقة.', chips: ['human'] },
    { id: 'vision', keys: ['vision 2030', '2030', 'vision', 'رؤيه 2030', 'الرؤيه'],
      en: 'Vision 2030 is opening the Kingdom to the world. We build around it: tourism, talent, events and digital services.', ar: 'رؤية 2030 تفتح المملكة للعالم، ونحن نعمل معها: السياحة والكفاءات والفعاليات والخدمات الرقمية.', chips: ['menu'] },

    { id: 'experience', keys: ['experience', 'past experience', 'previous work', 'past work', 'portfolio', 'track record', 'references', 'reference', 'case study', 'case studies', 'previous events', 'past events', 'clients', 'who have you worked with', 'examples', 'how long have you', 'years in business', 'خبره', 'خبرتكم', 'اعمال سابقه', 'مشاريع سابقه', 'عملاء', 'سابقه اعمال', 'امثله'],
      en: 'Yes. Our team brings hands-on experience across travel, events and manpower in the Kingdom. We’re happy to share examples and references that match your request. Ask the team on WhatsApp.', ar: 'نعم، لدى فريقنا خبرة عملية في السفر والفعاليات والعمالة داخل المملكة، ويسعدنا مشاركة أمثلة ومراجع تناسب طلبك. اطلبها من الفريق عبر واتساب.', chips: ['human', 'menu'] },
    { id: 'licensed', keys: ['licensed', 'license number', 'registered', 'legit', 'legitimate', 'trusted', 'certified', 'commercial registration', 'مرخص', 'مرخصين', 'سجلكم', 'موثوق'],
      en: 'The team can share our company registration and licence details on request, before you commit to anything.', ar: 'يمكن للفريق مشاركة بيانات السجل التجاري والتراخيص عند الطلب وقبل أي التزام.', chips: ['human'] },
    { id: 'venue', then: 'Events', keys: ['venue', 'venues', 'hall', 'ballroom', 'location for event', 'find a venue', 'قاعه', 'قاعات', 'مكان الحفل', 'موقع الفعاليه'],
      en: 'Yes, we find and book venues: hotels, halls, outdoor and desert sites, matched to your guest count and style.', ar: 'نعم، نبحث ونحجز القاعات: الفنادق والقاعات والمواقع الخارجية والصحراوية بما يناسب عدد الضيوف وطابع الفعالية.', chips: ['Events'] },
    { id: 'leadtime', keys: ['how far in advance', 'how early', 'lead time', 'short notice', 'last minute', 'how long does it take', 'how much time', 'in time', 'كم تحتاجون وقت', 'قبل كم', 'وقت قصير', 'اخر لحظه'],
      en: 'The earlier the better, especially for large events and peak seasons, but we regularly work to short deadlines. Share your date and we’ll tell you honestly what’s possible.', ar: 'كلما كان أبكر كان أفضل، خصوصاً للفعاليات الكبيرة والمواسم، لكننا نعمل كثيراً بمواعيد قصيرة. شاركنا الموعد وسنخبرك بصراحة بما هو ممكن.', chips: ['menu'] },
    { id: 'production', then: 'Events', keys: ['catering', 'food', 'stage', 'sound', 'lighting', 'screens', 'decor', 'decoration', 'photography', 'videography', 'live stream', 'ضيافه', 'بوفيه', 'مسرح', 'صوتيات', 'اضاءه', 'شاشات', 'ديكور', 'تصوير', 'بث مباشر'],
      en: 'We handle the full production: stage, light, sound, screens, décor, catering, photography and live streams, with one team running it all.', ar: 'نتولى الإنتاج بالكامل: المسرح والإضاءة والصوت والشاشات والديكور والضيافة والتصوير والبث المباشر، بفريق واحد.', chips: ['Events'] },
    { id: 'custom', keys: ['customise', 'customize', 'custom', 'tailor', 'tailored', 'flexible', 'my own plan', 'تفصيل', 'حسب الطلب', 'مخصص'],
      en: 'Everything is tailored. Tell us what matters to you and we build the plan around it.', ar: 'كل شيء مصمم حسب طلبك. أخبرنا بما يهمك ونبني الخطة حوله.', chips: ['menu'] },
    { id: 'government', keys: ['government', 'ministry', 'semi government', 'public sector', 'tender', 'حكومي', 'حكوميه', 'وزاره', 'مناقصه'],
      en: 'We work with private and public sector clients. For tenders or formal proposals, send the details to the team.', ar: 'نعمل مع عملاء القطاعين الخاص والعام. للمناقصات أو العروض الرسمية أرسل التفاصيل للفريق.', chips: ['human'] },

    /* ---------- commercial ---------- */
    { id: 'price', keys: ['price', 'prices', 'pricing', 'cost', 'costs', 'how much', 'quote', 'quotation', 'budget', 'rate', 'rates', 'fees', 'expensive', 'cheap', 'السعر', 'الاسعار', 'كم التكلفه', 'كم سعر', 'كم تكلفه', 'بكم', 'كم يكلف', 'عرض سعر', 'تكلفه', 'الميزانيه'],
      en: 'Every plan is tailored, so we quote once we know the details. It takes a minute: tell me what you need and the team sends a proposal.', ar: 'كل خطة مصممة حسب طلبك، لذلك نرسل عرض السعر بعد معرفة التفاصيل. أخبرني ماذا تحتاج وسيرسل لك الفريق عرضاً.', chips: ['menu'] },
    { id: 'discount', keys: ['discount', 'offer', 'deal', 'promo', 'group rate', 'corporate rate', 'خصم', 'عروض', 'تخفيض'],
      en: 'We secure corporate and group rates wherever possible. Share your plans and we’ll find the best value.', ar: 'نوفر أسعار الشركات والمجموعات متى ما أمكن. شاركنا خطتك وسنجد لك أفضل قيمة.', chips: ['menu'] },
    { id: 'payment', keys: ['pay', 'payment', 'card', 'bank transfer', 'mada card', 'installments', 'tabby', 'tamara', 'cash', 'الدفع', 'تحويل', 'بطاقه', 'تقسيط', 'كاش'],
      en: 'Payment options are confirmed with your proposal. The team will walk you through them.', ar: 'تُؤكد طرق الدفع مع عرض السعر، وسيشرحها لك الفريق.', chips: ['human'] },
    { id: 'invoice', keys: ['invoice', 'vat', 'tax invoice', 'receipt', 'فاتوره', 'ضريبه', 'ايصال'],
      en: 'Yes, we issue invoices. Share your company details with the team when you book.', ar: 'نعم، نصدر فواتير. شارك بيانات شركتك مع الفريق عند الحجز.', chips: ['human'] },
    { id: 'refund', keys: ['refund', 'cancel booking', 'cancellation', 'change booking', 'reschedule', 'money back', 'استرجاع', 'الغاء الحجز', 'تعديل الحجز', 'استرداد'],
      en: 'Changes and refunds depend on the airline, hotel or supplier terms. Send your booking details and we’ll handle it for you.', ar: 'التعديل والاسترداد يعتمدان على شروط الطيران أو الفندق أو المورد. أرسل تفاصيل حجزك وسنتولى الأمر.', chips: ['human'] },
    { id: 'corporate', keys: ['corporate account', 'company account', 'business account', 'contract', 'long term', 'partnership', 'حساب شركه', 'عقد', 'شراكه'],
      en: 'We set up corporate accounts with one contact, consolidated invoicing and priority handling.', ar: 'نفتح حسابات للشركات مع نقطة تواصل واحدة وفوترة موحدة وأولوية في الخدمة.', chips: ['human', 'menu'] },
    { id: 'supplier', keys: ['supplier', 'vendor', 'become a partner', 'work with you', 'subcontract', 'مورد', 'اصير مورد', 'نتعاون'],
      en: 'We’re always glad to meet good partners. Send a short intro and your company profile on WhatsApp.', ar: 'يسعدنا التعرف على شركاء مميزين. أرسل نبذة وملف شركتك عبر واتساب.', chips: ['human'] },
    { id: 'jobs', keys: ['job', 'jobs', 'career', 'careers', 'vacancy', 'hiring', 'cv', 'resume', 'apply', 'work for you', 'employment', 'وظيفه', 'وظائف', 'توظيف', 'سيره ذاتيه', 'ابي اشتغل'],
      en: 'Thank you for your interest in joining Mada. Send your CV and the role you’re looking for on WhatsApp and the team will review it.', ar: 'شكراً لاهتمامك بالانضمام إلى مادا. أرسل سيرتك الذاتية والوظيفة التي تبحث عنها عبر واتساب وسيراجعها الفريق.', chips: ['human'] },
    { id: 'complaint', keys: ['complaint', 'complain', 'have a problem', 'a problem with', 'an issue with', 'have an issue', 'not happy', 'bad service', 'disappointed', 'شكوى', 'مشكله', 'غير راضي', 'سيئه'],
      en: 'We’re sorry to hear that. Please share what happened and your booking reference, and a senior team member will follow up personally.', ar: 'نأسف لسماع ذلك. شاركنا ما حدث ورقم الحجز وسيتابع معك أحد كبار الفريق شخصياً.', chips: ['human'] },
    { id: 'urgent', keys: ['urgent', 'emergency', 'asap', 'right now', 'immediately', 'stuck', 'stranded', 'missed flight', 'عاجل', 'ضروري', 'طوارئ', 'فاتتني الرحله'],
      en: 'For anything urgent, please call us now on [+966 56 668 2662](tel:+966566682662) so we can act straight away.', ar: 'للأمور العاجلة اتصل بنا الآن على [+966 56 668 2662](tel:+966566682662) لنتصرف فوراً.', chips: ['human'] },
    { id: 'privacy', keys: ['privacy', 'my data', 'personal information', 'personal data', 'الخصوصيه', 'بياناتي'],
      en: 'We only use your details to handle your request. Nothing is shared outside the team working on it.', ar: 'نستخدم بياناتك فقط لخدمة طلبك، ولا نشاركها خارج الفريق المعني.', chips: ['menu'] },

    /* ---------- services (start a request) ---------- */
    { id: 'travel', keys: ['travel', 'trip', 'holiday', 'vacation', 'tour', 'tourism', 'travel package', 'holiday package', 'honeymoon', 'itinerary', 'go to', 'going to', 'visit', 'visiting', 'getaway', 'weekend away', 'ابي اروح', 'نبي نروح', 'اجازه', 'سفر', 'رحله', 'سياحه', 'باكج', 'شهر عسل'], flow: 'Travel',
      en: 'Happy to plan it. A few quick questions.', ar: 'بكل سرور نخطط لها. بعض الأسئلة السريعة.' },
    { id: 'flights', keys: ['flight', 'flights', 'ticket', 'tickets', 'airline', 'fly', 'booking flight', 'charter', 'saudia', 'flynas', 'طيران', 'تذكره', 'تذاكر', 'حجز طيران', 'رحله طيران'], flow: 'Travel', preset: { Service: 'Flights' },
      en: 'We book local and international flights, groups and charters, and handle any changes.', ar: 'نحجز الرحلات الداخلية والدولية والمجموعات والطيران الخاص، ونتولى أي تعديلات.' },
    { id: 'hotels', keys: ['hotel', 'hotels', 'stay', 'room', 'rooms', 'resort', 'accommodation', 'apartment', 'desert camp', 'فندق', 'فنادق', 'غرفه', 'سكن', 'منتجع', 'شقه', 'مخيم'], flow: 'Hotels',
      en: 'We’ll find the right stay. Just two questions.', ar: 'سنجد لك الإقامة المناسبة. سؤالان فقط.' },
    { id: 'visa', keys: ['visa', 'visas', 'evisa', 'e visa', 'visit visa', 'tourist visa', 'business visa', 'work visa', 'iqama', 'entry permit', 'تاشيره', 'تأشيرة', 'فيزا', 'زياره', 'اقامه', 'تاشيرة عمل'], flow: 'Visa',
      en: 'We handle tourist, business, Umrah and work visas end to end.', ar: 'نتولى تأشيرات السياحة والأعمال والعمرة والعمل بالكامل.' },
    { id: 'visa_docs', keys: ['documents', 'requirements', 'what do i need', 'papers', 'passport validity', 'المستندات', 'المتطلبات', 'الاوراق', 'وش احتاج'],
      en: 'It depends on the visa and nationality. Typically a valid passport, a photo and supporting documents. We confirm the exact list for your case before you apply.', ar: 'يعتمد ذلك على نوع التأشيرة والجنسية. عادةً جواز ساري وصورة ومستندات داعمة. نؤكد لك القائمة الدقيقة قبل التقديم.', chips: ['Visa'] },
    { id: 'visa_time', keys: ['how long visa', 'visa processing', 'processing time', 'how many days', 'كم ياخذ', 'مده التاشيره', 'متى تطلع'],
      en: 'Processing times depend on the visa type and the authority. We give you a realistic timeline up front and track it for you.', ar: 'تعتمد المدة على نوع التأشيرة والجهة المختصة. نعطيك جدولاً زمنياً واقعياً ونتابعه لك.', chips: ['Visa'] },
    { id: 'umrah', keys: ['umrah', 'omra', 'umra', 'makkah', 'mecca', 'madinah', 'medina', 'haram', 'عمره', 'العمره', 'مكه', 'المدينه', 'الحرم'], flow: 'Travel', preset: { Destination: 'Umrah' },
      en: 'We arrange Umrah journeys: visas, flights, hotels near the Haram and transfers.', ar: 'ننظم رحلات العمرة: التأشيرات والطيران والفنادق القريبة من الحرم والتنقلات.' },
    { id: 'hajj', keys: ['hajj', 'haj', 'حج', 'الحج'],
      en: 'Hajj travel depends on official allocations each season. Message the team and they’ll advise on what’s possible.', ar: 'يعتمد الحج على التصاريح الرسمية لكل موسم. راسل الفريق وسيوضح لك المتاح.', chips: ['human'] },
    { id: 'events', keys: ['event', 'events', 'conference', 'summit', 'gala', 'dinner', 'concert', 'festival', 'exhibition', 'expo', 'launch', 'wedding', 'party', 'celebration', 'national day', 'founding day', 'awards', 'فعاليه', 'فعاليات', 'مؤتمر', 'حفل', 'حفله', 'زواج', 'عرس', 'معرض', 'اليوم الوطني', 'يوم التاسيس', 'تدشين'], flow: 'Events',
      en: 'Events are one of our specialities. Let’s shape yours.', ar: 'الفعاليات من أهم تخصصاتنا. لنرسم فعاليتك معاً.' },
    { id: 'manpower', keys: ['manpower', 'worker', 'workers', 'عامل', 'نظافه', 'labour', 'labor', 'laborers', 'labourers', 'staff', 'staffing', 'crew', 'recruitment', 'outsourcing', 'technicians', 'drivers', 'welders', 'electricians', 'plumbers', 'carpenters', 'helpers', 'cleaners', 'security guards', 'on site', 'لحامين', 'كهربائيين', 'سباكين', 'عمال نظافه', 'حراس امن', 'عماله', 'عمال', 'موظفين', 'توريد عماله', 'فنيين', 'سواقين'], flow: 'Manpower',
      en: 'We supply skilled crews at any scale. Three quick questions.', ar: 'نوفر طواقم ماهرة بأي حجم. ثلاثة أسئلة سريعة.' },
    { id: 'specialists', keys: ['specialist', 'specialists', 'engineer', 'engineers', 'consultant', 'expert', 'doctor', 'nurse', 'مهندس', 'مهندسين', 'استشاري', 'خبير', 'متخصص'], flow: 'Manpower', preset: { Need: 'Specialists or engineers' },
      en: 'We source hard-to-find specialists, often at short notice.', ar: 'نوفر الكفاءات النادرة، وغالباً في وقت قصير.' },
    { id: 'business', keys: ['company setup', 'business setup', 'open a company', 'license', 'licence', 'permit', 'permits', 'cr', 'misa', 'pro services', 'government relations', 'logistics', 'تاسيس شركه', 'سجل تجاري', 'ترخيص', 'تصاريح', 'معقب', 'تخليص'], flow: 'IT', preset: { Need: 'Company setup or permits' },
      en: 'We help with company setup, permits, licences and logistics.', ar: 'نساعد في تأسيس الشركات والتصاريح والتراخيص والخدمات اللوجستية.' },
    { id: 'it', keys: ['it services', 'it support', 'it company', 'it solutions', 'software', 'website', 'web development', 'mobile app', 'app development', 'network', 'networks', 'server', 'cloud', 'cyber', 'cybersecurity', 'security cameras', 'tech support', 'تقنيه', 'برمجه', 'موقع', 'تطبيق', 'شبكات', 'سيرفر', 'امن سيبراني', 'دعم فني'], flow: 'IT',
      en: 'Our IT team covers networks, software and web, cloud and cybersecurity.', ar: 'فريق التقنية لدينا يغطي الشبكات والبرمجيات والمواقع والسحابة والأمن السيبراني.' },

    /* ---------- polite out of scope ---------- */
    { id: 'offtopic', keys: ['weather', 'joke', 'football', 'news', 'recipe', 'bitcoin', 'crypto', 'الطقس', 'نكته', 'كوره'],
      en: 'That’s outside what I can help with. I’m best at travel, events, talent and tech. What are you planning?', ar: 'هذا خارج نطاق ما أستطيع المساعدة فيه. أنا مختص بالسفر والفعاليات والكفاءات والتقنية. ماذا تخطط؟', chips: ['menu'] }
  ],

  /* ---------- guided requests ---------- */
  flows: {
    Travel: {
      en: 'Plan a trip', ar: 'خطط لرحلة',
      steps: [
        { key: 'Destination', en: 'Where are you heading?', ar: 'إلى أين وجهتك؟', entity: 'city',
          opts: [['AlUla', 'العلا'], ['Riyadh', 'الرياض'], ['Jeddah & the Red Sea', 'جدة والبحر الأحمر'], ['Umrah', 'عمرة'], ['Abroad', 'خارج المملكة'], ['Not sure yet', 'لم أحدد بعد']] },
        { key: 'Travellers', en: 'How many travellers?', ar: 'كم عدد المسافرين؟', entity: 'people',
          opts: [['Just me', 'شخص واحد'], ['2 to 4', '2 إلى 4'], ['5 to 20', '5 إلى 20'], ['A large group', 'مجموعة كبيرة']] },
        { key: 'When', en: 'When would you like to travel?', ar: 'متى تود السفر؟', entity: 'date',
          opts: [['This month', 'هذا الشهر'], ['In 1 to 3 months', 'خلال 1 إلى 3 أشهر'], ['Later this year', 'لاحقاً هذا العام'], ['Flexible', 'مرن']] }
      ]
    },
    Events: {
      en: 'Plan an event', ar: 'خطط لفعالية',
      steps: [
        { key: 'Event type', en: 'What kind of event?', ar: 'ما نوع الفعالية؟', entity: 'eventType',
          opts: [['Conference or summit', 'مؤتمر أو قمة'], ['Gala or awards', 'حفل عشاء أو جوائز'], ['Concert or festival', 'حفل موسيقي أو مهرجان'], ['Exhibition or launch', 'معرض أو تدشين'], ['Wedding or private', 'زواج أو مناسبة خاصة'], ['National or cultural day', 'يوم وطني أو ثقافي']] },
        { key: 'Guests', en: 'Roughly how many guests?', ar: 'كم عدد الضيوف تقريباً؟', entity: 'people',
          opts: [['Under 50', 'أقل من 50'], ['50 to 250', '50 إلى 250'], ['250 to 1,000', '250 إلى 1,000'], ['1,000+', 'أكثر من 1,000']] },
        { key: 'City', en: 'Which city?', ar: 'في أي مدينة؟', entity: 'city',
          opts: [['Riyadh', 'الرياض'], ['Jeddah', 'جدة'], ['AlUla', 'العلا'], ['Eastern Province', 'المنطقة الشرقية'], ['Other', 'أخرى']] },
        { key: 'When', en: 'When is the date?', ar: 'متى الموعد؟', entity: 'date',
          opts: [['Within a month', 'خلال شهر'], ['In 1 to 3 months', 'خلال 1 إلى 3 أشهر'], ['Later', 'لاحقاً'], ['Date not set', 'لم يُحدد']] }
      ]
    },
    Manpower: {
      en: 'Hire talent', ar: 'توظيف كفاءات',
      steps: [
        { key: 'Need', en: 'Who do you need?', ar: 'من تحتاج؟', entity: 'staffType',
          opts: [['Skilled crew', 'طاقم فني'], ['Specialists or engineers', 'متخصصون أو مهندسون'], ['Event staff', 'طاقم فعاليات'], ['Mixed team', 'فريق متنوع']] },
        { key: 'Team size', en: 'How many people?', ar: 'كم عدد الأشخاص؟', entity: 'people',
          opts: [['1 to 10', '1 إلى 10'], ['11 to 50', '11 إلى 50'], ['51 to 200', '51 إلى 200'], ['200+', 'أكثر من 200']] },
        { key: 'Start', en: 'When should they start?', ar: 'متى يبدأون؟', entity: 'date',
          opts: [['Immediately', 'فوراً'], ['Within a month', 'خلال شهر'], ['Later', 'لاحقاً'], ['Flexible', 'مرن']] }
      ]
    },
    Visa: {
      en: 'Visa help', ar: 'خدمات التأشيرات',
      steps: [
        { key: 'Visa type', en: 'Which visa?', ar: 'أي نوع من التأشيرات؟', entity: 'visaType',
          opts: [['Tourist', 'سياحية'], ['Business', 'أعمال'], ['Umrah', 'عمرة'], ['Work visa', 'تأشيرة عمل'], ['Not sure', 'لست متأكداً']] },
        { key: 'Applicants', en: 'For how many people?', ar: 'لكم شخص؟', entity: 'people',
          opts: [['1', '1'], ['2 to 5', '2 إلى 5'], ['6 or more', '6 أو أكثر']] }
      ]
    },
    Hotels: {
      en: 'Hotels & stays', ar: 'الفنادق والإقامة',
      steps: [
        { key: 'City', en: 'Which city?', ar: 'في أي مدينة؟', entity: 'city',
          opts: [['Riyadh', 'الرياض'], ['Jeddah', 'جدة'], ['AlUla', 'العلا'], ['Makkah or Madinah', 'مكة أو المدينة'], ['Other', 'أخرى']] },
        { key: 'Rooms', en: 'How many rooms?', ar: 'كم غرفة؟', entity: 'rooms',
          opts: [['1', '1'], ['2 to 5', '2 إلى 5'], ['6 to 20', '6 إلى 20'], ['Group block', 'حجز مجموعة']] },
        { key: 'When', en: 'Check-in date?', ar: 'موعد الوصول؟', entity: 'date',
          opts: [['This week', 'هذا الأسبوع'], ['This month', 'هذا الشهر'], ['Later', 'لاحقاً'], ['Flexible', 'مرن']] }
      ]
    },
    IT: {
      en: 'IT & business', ar: 'التقنية والأعمال',
      steps: [
        { key: 'Need', en: 'What can we help with?', ar: 'بماذا نساعدك؟', entity: 'itType',
          opts: [['Networks & infrastructure', 'الشبكات والبنية التحتية'], ['Software or website', 'برمجيات أو موقع'], ['Cloud & security', 'السحابة والأمن'], ['Company setup or permits', 'تأسيس شركة أو تصاريح']] }
      ]
    },
    Other: { en: 'Something else', ar: 'شيء آخر', steps: [] }
  },

  /* ---------- things the bot can pick out of a sentence ---------- */
  entities: {
    city: [
      ['Riyadh', ['riyadh', 'riyad', 'ryadh', 'الرياض', 'رياض']],
      ['Jeddah', ['jeddah', 'jedda', 'jiddah', 'jidda', 'جده', 'جدة']],
      ['Jeddah & the Red Sea', ['red sea', 'البحر الاحمر']],
      ['AlUla', ['alula', 'al ula', 'al-ula', 'ula', 'hegra', 'العلا']],
      ['Umrah', ['umrah', 'umra', 'omra', 'omrah', 'عمره']],
      ['Makkah or Madinah', ['makkah', 'mecca', 'madinah', 'medina', 'مكه', 'المدينه']],
      ['Eastern Province', ['dammam', 'khobar', 'dhahran', 'eastern province', 'الدمام', 'الخبر', 'الشرقيه']],
      ['NEOM', ['neom', 'نيوم']],
      ['Abha', ['abha', 'ابها']],
      ['Taif', ['taif', 'الطائف', 'الطايف']],
      ['Abroad', ['abroad', 'dubai', 'london', 'paris', 'istanbul', 'cairo', 'europe', 'turkey', 'egypt', 'malaysia', 'maldives', 'bali', 'japan', 'usa', 'america', 'خارج', 'دبي', 'لندن', 'باريس', 'تركيا', 'اسطنبول', 'مصر', 'ماليزيا', 'المالديف', 'اوروبا']]
    ],
    eventType: [
      ['Conference or summit', ['conference', 'summit', 'forum', 'seminar', 'workshop', 'مؤتمر', 'قمه', 'منتدى', 'ندوه', 'ورشه']],
      ['Gala or awards', ['gala', 'awards', 'award', 'dinner', 'banquet', 'عشاء', 'جوائز', 'حفل عشاء']],
      ['Concert or festival', ['concert', 'festival', 'music', 'show', 'حفل موسيقي', 'مهرجان']],
      ['Exhibition or launch', ['exhibition', 'expo', 'launch', 'activation', 'booth', 'معرض', 'تدشين', 'اطلاق']],
      ['Wedding or private', ['wedding', 'engagement', 'birthday', 'private', 'party', 'زواج', 'عرس', 'ملكه', 'خطوبه', 'عيد ميلاد']],
      ['National or cultural day', ['national day', 'founding day', 'heritage', 'cultural', 'اليوم الوطني', 'يوم التاسيس', 'تراث']]
    ],
    visaType: [
      ['Tourist', ['tourist', 'tourism', 'visit visa', 'سياحيه', 'سياحه', 'زياره']],
      ['Business', ['business', 'اعمال']],
      ['Umrah', ['umrah', 'عمره']],
      ['Work visa', ['work', 'employment', 'iqama', 'عمل', 'اقامه']]
    ],
    staffType: [
      ['Specialists or engineers', ['engineer', 'engineers', 'specialist', 'specialists', 'consultant', 'مهندس', 'متخصص']],
      ['Event staff', ['event staff', 'hosts', 'ushers', 'hostesses', 'منظمين', 'مضيفين']],
      ['Skilled crew', ['عامل', 'عامل نظافه', 'عمال نظافه', 'cleaner', 'cleaners', 'welder', 'welders', 'electrician', 'electricians', 'plumber', 'labour', 'labor', 'workers', 'crew', 'technician', 'technicians', 'drivers', 'عمال', 'فنيين', 'كهربائي', 'لحام', 'سواق']]
    ],
    itType: [
      ['Networks & infrastructure', ['network', 'networks', 'infrastructure', 'server', 'wifi', 'cabling', 'شبكات', 'سيرفر']],
      ['Software or website', ['software', 'website', 'web', 'app', 'application', 'system', 'برمجه', 'موقع', 'تطبيق', 'نظام']],
      ['Cloud & security', ['cloud', 'security', 'cyber', 'backup', 'سحابه', 'امن']],
      ['Company setup or permits', ['company setup', 'license', 'licence', 'permit', 'cr', 'تاسيس', 'ترخيص', 'سجل']]
    ]
  }
};
