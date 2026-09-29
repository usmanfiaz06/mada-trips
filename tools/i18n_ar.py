# -*- coding: utf-8 -*-
"""Arabic copy for the Mada Trips website.

HEADLINES: whole elements, matched by their English text, replaced with Arabic HTML
           (keeps the gold accent words and line breaks where they read best in Arabic).
TEXT:      every other piece of visible text, attribute and meta tag, matched exactly.
Edit either table, then run:  python3 tools/build_ar.py
"""

HEADLINES = {
    # ---------- home ----------
    'Every horizon, within reach.': '<span class="line"><span>كل أفق،</span></span><span class="line"><span>في <em>المتناول.</em></span></span>',
    'Mada is Arabic for reach. We carry travellers, talent and ideas across the Kingdom and far beyond it.':
        'مادا تعني <em>المدى</em>. ننقل المسافرين والكفاءات والأفكار عبر المملكة وإلى ما هو أبعد منها.',
    'Go further than the itinerary.': 'اذهب أبعد<br><span class="muted">من مجرد برنامج رحلة.</span>',
    "Arrive to a room that's ready.": 'تصل<br><span class="muted">إلى غرفة جاهزة.</span>',
    'Build with people who deliver.': 'ابنِ<br><span class="muted">مع من يُنجز.</span>',
    'Celebrate at the scale of a kingdom.': 'احتفل<br><span class="muted">بحجم مملكة.</span>',
    'One call. Everything moves.': 'اتصال واحد.<br>وكل شيء يتحرك.',
    'Every seat. Every sky.': 'كل مقعد.<br>كل سماء.',
    'From NEOM to Dammam. One partner, every city.': 'من نيوم إلى الدمام.<br><span class="muted">شريك واحد في كل مدينة.</span>',
    'Visas, without the waiting room.': 'تأشيرات<br>بلا طوابير انتظار.',
    'Stays that already know your name.': 'إقامة<br>تعرف اسمك مسبقاً.',
    'Whatever you need, it’s already moving.': 'مهما كان ما تحتاجه،<br><span class="accent">فهو يتحرك الآن.</span>',
    "Need something that isn't listed?": 'تحتاج شيئاً<br>غير مذكور هنا؟',
    'Where the Kingdom gathers.': 'حيث تجتمع<br><em>المملكة.</em>',
    'You set the destination. We handle the distance.': 'أنت تحدد الوجهة.<br>ونحن نختصر المسافة.',
    'A date on a calendar to some. A direction to us.': 'عند البعض تاريخ في التقويم.<br>وعندنا اتجاه.',
    'The doors are opening. We make sure the world walks through them.': 'الأبواب تُفتح.<br><em>ونحن نضمن أن يعبرها العالم.</em>',
    'Where will you reach next?': 'إلى أين<br>ستصل <em>بعدها؟</em>',
    # ---------- events ----------
    'We build the night everyone remembers.': 'نصنع الليلة<br>التي <em>لا تُنسى.</em>',
    'Six stages. One crew.': 'ستة مسارح.<br><em>وطاقم واحد.</em>',
    'Everything it takes, under one roof.': 'كل ما يلزم،<br><span class="accent">تحت سقف واحد.</span>',
    'Six steps from idea to encore.': 'ست خطوات<br><span class="accent">من الفكرة إلى التصفيق.</span>',
    'Have a date in mind?': 'هل لديك<br><em>موعد محدد؟</em>',
    # ---------- services ----------
    'Not sure where it fits?': 'لست متأكداً<br><em>أين يندرج طلبك؟</em>',
    # ---------- about ----------
    'We turned a word into a promise.': 'حوّلنا كلمة<br>إلى <em>وعد.</em>',
    'Three promises. Kept daily.': 'ثلاثة وعود.<br><em>نفي بها كل يوم.</em>',
    'Moving with the Kingdom.': 'نمضي مع<br><span class="accent">المملكة.</span>',
    'Let’s go further.': 'لنذهب<br><em>أبعد.</em>',
    # ---------- contact ----------
    'Let’s plan the next horizon.': 'لنخطط<br>للأفق <em>القادم.</em>',
}

TEXT = {
    # ---------- nav, menu, footer ----------
    'Services': 'الخدمات', 'Events': 'الفعاليات', 'How it works': 'كيف نعمل', 'Vision 2030': 'رؤية 2030', 'About': 'من نحن',
    'Contact': 'تواصل معنا', 'Plan with us': 'خطط معنا', 'Live': 'مباشر', 'Why Mada': 'لماذا مادا',
    'Moving with the Kingdom toward Vision 2030': 'نمضي مع المملكة نحو رؤية 2030',
    'Every horizon, within reach.': 'كل أفق، في المتناول.',
    'Call or WhatsApp': 'اتصال أو واتساب', 'For business': 'للأعمال', 'Company': 'الشركة', 'Mada Events': 'مادا للفعاليات',
    'Travel & Ticketing': 'السفر والتذاكر', 'Mada Trips. Riyadh, Kingdom of Saudi Arabia.': 'مادا تربس. الرياض، المملكة العربية السعودية.',
    'EVERY HORIZON ✦ WITHIN REACH ✦ MADA TRIPS ✦ RIYADH ✦': 'كل أفق ✦ في المتناول ✦ مادا تربس ✦ الرياض ✦',

    # ---------- home: hero ----------
    'Travel': 'سفر', 'Stay': 'إقامة', 'Work': 'أعمال', 'Celebrate': 'احتفال',
    'Begin the journey': 'ابدأ الرحلة', 'Boarding': 'الصعود', 'Riyadh': 'الرياض', 'AlUla': 'العلا',
    'Gate': 'البوابة', 'Seat': 'المقعد', 'Scroll to explore': 'مرّر للاستكشاف', 'Arabian Dunes · 24°N': 'كثبان الجزيرة · 24° شمالاً',
    'Mada': 'مادا', 'The distance a glance can travel.': 'المسافة التي تبلغها نظرة.', 'We turned it into a promise.': 'وحوّلناها إلى وعد.',
    'Mada Trips': 'مادا تربس',
    'Flights, visas and routes, planned around you. Never a template.': 'رحلات وتأشيرات ومسارات مصممة حولك. لا قوالب جاهزة.',
    'Hotels, resorts and desert camps. Hand-picked, confirmed, waiting.': 'فنادق ومنتجعات ومخيمات صحراوية. مختارة بعناية، مؤكدة، وبانتظارك.',
    'Skilled crews and rare specialists. Sourced, vetted, deployed.': 'طواقم ماهرة وكفاءات نادرة. نختارها ونتحقق منها ونرسلها.',
    'Events and the technology beneath them, flawless from the front row.': 'فعاليات والتقنية التي تديرها، بلا خطأ من الصف الأول.',

    # ---------- home: marquee ----------
    'Jeddah': 'جدة', 'The Red Sea': 'البحر الأحمر', 'Diriyah': 'الدرعية', 'Abha': 'أبها', 'Hegra': 'الحِجر', 'Dammam': 'الدمام',
    'London': 'لندن', 'Paris': 'باريس', 'Dubai': 'دبي', 'Istanbul': 'إسطنبول', 'Tokyo': 'طوكيو', 'Cairo': 'القاهرة', 'Kuala Lumpur': 'كوالالمبور',
    'NEOM': 'نيوم',

    # ---------- home: why ----------
    'Flights, visas, stays, crews, stages, servers. Orchestrated by one team that still picks up at 3 a.m.':
        'رحلات وتأشيرات وإقامات وطواقم ومسارح وخوادم. يديرها فريق واحد يرد حتى في الثالثة فجراً.',
    'Issued 2m ago': 'صدرت قبل دقيقتين', '✦ Priority': '✦ أولوية', 'Business · 2 guests': 'درجة الأعمال · شخصان', 'Confirmed ✓': 'مؤكدة ✓',
    '✈ Ticketing': '✈ التذاكر', '▣ Visas': '▣ التأشيرات', '⌂ Hotels': '⌂ الفنادق', '✦ Events': '✦ الفعاليات', '⚙ IT': '⚙ التقنية',
    'Explore services': 'استكشف الخدمات', 'Approved': 'موافقة',
    'Schengen · 12 days': 'شنغن · 12 يوماً', 'UK Standard · 3 wks': 'بريطانيا · 3 أسابيع', 'Umrah · 48 hrs': 'عمرة · 48 ساعة', 'Business eVisa · 24 hrs': 'تأشيرة أعمال · 24 ساعة',
    'Talent that shows up.': 'كفاءات تحضر في موعدها.',
    'We need 40 certified welders on site by Sunday.': 'نحتاج 40 لحّاماً معتمداً في الموقع قبل الأحد.',
    'Mobilised. Arriving Friday, 6 a.m.': 'تم التجهيز. يصلون الجمعة الساعة 6 صباحاً.',
    'Confirm stay': 'تأكيد الإقامة', 'Zero hidden fees': 'بلا رسوم خفية', 'Property': 'المكان', 'Desert Suite · AlUla': 'جناح صحراوي · العلا',
    'Nights': 'الليالي', 'Arrival': 'الوصول', 'Private transfer': 'توصيل خاص', 'met at the gate': 'استقبال عند البوابة', 'Status': 'الحالة',
    'Room ready': 'الغرفة جاهزة', '+ Late checkout': '+ مغادرة متأخرة', 'added': 'أُضيفت',
    'Hand-picked hotels, resorts and desert camps, arranged down to the pickup.': 'فنادق ومنتجعات ومخيمات صحراوية مختارة بعناية، مرتبة حتى لحظة الاستقبال.',
    'Disciplines under one roof': 'تخصصات تحت سقف واحد', 'Point of contact. Always.': 'نقطة تواصل. دائماً.',
    'On the ground, every day': 'على الأرض، كل يوم', 'The horizon we build toward': 'الأفق الذي نبني نحوه',

    # ---------- home: services ----------
    'What we do': 'ماذا نقدم',
    'Travel, talent, events and technology under one roof. Say it once. We’ll take it from there.': 'السفر والكفاءات والفعاليات والتقنية تحت سقف واحد. قلها مرة واحدة، ونتولى الباقي.',
    'Journeys designed, not booked.': 'رحلات تُصمَّم، لا تُحجَز فقط.', 'Ticketing': 'التذاكر', 'Any airline. Any hour. Any change.': 'أي طيران. أي ساعة. أي تعديل.',
    'Hotels': 'الفنادق', 'The right room, already waiting.': 'الغرفة المناسبة، بانتظارك.', 'Visa Support': 'خدمات التأشيرات',
    'Paperwork, handled end to end.': 'كل الأوراق، من البداية إلى النهاية.', 'Business Services': 'خدمات الأعمال',
    'Setup, permits, logistics. Cleared.': 'تأسيس وتصاريح ولوجستيات. منجزة.', 'Manpower': 'توريد العمالة', 'Skilled hands, at any scale.': 'أيادٍ ماهرة، بأي حجم.',
    'Specialist Supply': 'توريد الكفاءات', "The expert you couldn't find. Found.": 'الخبير الذي لم تجده. وجدناه.',
    'Moments the Kingdom remembers.': 'لحظات تتذكرها المملكة.', 'IT Solutions': 'حلول تقنية المعلومات', 'Systems that never sleep.': 'أنظمة لا تنام.',
    'Ask us': 'اسألنا',

    # ---------- home: events ----------
    'Summits, galas, concerts and national celebrations. We build the stage, fill the seats and fly in the guests.':
        'قمم وحفلات ومهرجانات واحتفالات وطنية. نبني المسرح ونملأ المقاعد ونُحضر الضيوف.',
    'Explore Mada Events': 'اكتشف مادا للفعاليات', 'Conferences & Summits': 'المؤتمرات والقمم', 'Keynotes · Delegates': 'كلمات رئيسية · وفود',
    'Concerts & Festivals': 'الحفلات والمهرجانات', 'Stage · Light · Sound': 'مسرح · إضاءة · صوت', 'Galas & Award Nights': 'حفلات العشاء والجوائز',
    'Hospitality · Ceremony': 'ضيافة · مراسم', 'Exhibitions & Launches': 'المعارض والتدشينات', 'Booths · Activations': 'أجنحة · تفعيل',
    'National & Cultural Days': 'الأيام الوطنية والثقافية', 'Founding Day · National Day': 'يوم التأسيس · اليوم الوطني',
    'Stage': 'المسرح', 'Light': 'الإضاءة', 'Sound': 'الصوت', 'Screens': 'الشاشات', 'Guests': 'الضيوف', 'Flights': 'الرحلات', 'Crew': 'الطاقم',
    'Security': 'الأمن', 'Live streams': 'البث المباشر',

    # ---------- home: process ----------
    'Step 1': 'الخطوة 1', 'Step 2': 'الخطوة 2', 'Step 3': 'الخطوة 3', 'Step 4': 'الخطوة 4',
    'Tell us the goal.': 'أخبرنا بالهدف.', 'One conversation. A trip, a team, a launch, or all three.': 'محادثة واحدة. رحلة، أو فريق، أو تدشين، أو كلها معاً.',
    'Start here': 'ابدأ هنا', 'We design the plan.': 'نصمم الخطة.', 'Routes, rooms, people and timing, shaped into one clear plan.': 'المسارات والغرف والأشخاص والتوقيت في خطة واحدة واضحة.',
    'We deliver on the ground.': 'ننفّذ على الأرض.', 'Our people are there before you are. Every detail, confirmed live.': 'فريقنا يسبقك إلى هناك. كل تفصيل مؤكد لحظة بلحظة.',
    'You see everything.': 'ترى كل شيء.', 'One report. Every booking, every hire, every riyal. Accounted for.': 'تقرير واحد. كل حجز، كل توظيف، كل ريال. محسوب.',
    'Send': 'إرسال', 'Event': 'فعالية', 'Talent': 'كفاءات', 'Suggested destination': 'وجهة مقترحة',
    'Day 1': 'اليوم 1', 'Day 2': 'اليوم 2', 'Day 3': 'اليوم 3', 'Day 4': 'اليوم 4',
    'Arrival · RUH → ULH': 'الوصول · RUH → ULH', 'Charter, 06:40 · transfers on standby': 'طيران خاص، 06:40 · التنقلات جاهزة',
    'Hegra at sunrise': 'الحِجر عند الشروق', 'Private access · guided': 'دخول خاص · مع مرشد', 'Gala under the stars': 'حفل تحت النجوم',
    'Stage, light, sound · 60 guests': 'مسرح وإضاءة وصوت · 60 ضيفاً', 'Home': 'العودة', 'Door to door': 'من الباب إلى الباب',
    'Live status': 'الحالة المباشرة', 'On track': 'في المسار', 'Confirmed': 'مؤكدة', 'Visas': 'التأشيرات', 'Issued': 'صادرة', 'Suites': 'الأجنحة',
    'Ready': 'جاهزة', 'Stage build': 'بناء المسرح', 'In progress': 'قيد التنفيذ', 'On site': 'في الموقع', 'Network': 'الشبكة', 'Online': 'متصلة',
    'Delivered': 'تم التسليم', 'Travel & ticketing': 'السفر والتذاكر', 'Closed': 'مكتمل', 'Hospitality': 'الضيافة', 'Event production': 'إنتاج الفعالية',

    # ---------- home: vision ----------
    "visits a year: the Kingdom's 2030 ambition.": 'زيارة سنوياً: طموح المملكة لعام 2030.',
    'Tourism': 'السياحة', 'Digital': 'الرقمية',

    # ---------- founder ----------
    'A word from the founder': 'كلمة المؤسس', 'About Mada': 'عن مادا', 'Founder & CEO': 'المؤسس والرئيس التنفيذي',
    '“In Arabia, no guest walks alone. Mada carries that promise to every traveller, every team and every idea that comes to the Kingdom.”':
        '«في جزيرة العرب، لا يسير الضيف وحده. ومادا تحمل هذا الوعد لكل مسافر، وكل فريق، وكل فكرة تأتي إلى المملكة.»',
    'Founder & CEO, Mada Trips · Riyadh': 'المؤسس والرئيس التنفيذي، مادا تربس · الرياض',

    # ---------- home: cta ----------
    'Your move': 'دورك الآن', 'IT': 'التقنية', '/ma·da/': '/مَدى/',
    "Received. We'll be in touch within the day. ✦": 'وصلنا طلبك. سنتواصل معك خلال اليوم. ✦', 'Prefer to talk?': 'تفضّل الاتصال؟', 'WhatsApp': 'واتساب',

    # ---------- events page ----------
    'Riyadh · Across the Kingdom': 'الرياض · في أنحاء المملكة',
    'Conferences to concerts, galas to national celebrations. Designed, produced and hosted end to end.': 'من المؤتمرات إلى الحفلات، ومن حفلات العشاء إلى الاحتفالات الوطنية. تصميم وإنتاج واستضافة من البداية إلى النهاية.',
    'Plan your event': 'خطط لفعاليتك', 'What we host': 'ماذا نستضيف', 'One team. One standard.': 'فريق واحد. معيار واحد.',
    'From a boardroom of twelve to a stadium of thousands. Same team, same standard, nothing left to chance.': 'من قاعة اجتماعات لاثني عشر شخصاً إلى ملعب يتسع للآلاف. الفريق نفسه، والمعيار نفسه، ولا شيء يُترك للصدفة.',
    'Keynotes, panels and delegate journeys, from registration to the final applause.': 'كلمات رئيسية وجلسات حوار ورحلات الوفود، من التسجيل حتى التصفيق الأخير.',
    'Stages that carry a crowd. Rigging, light, sound and every artist rider.': 'مسارح تحمل الجمهور. تجهيزات وإضاءة وصوت وكل متطلبات الفنانين.',
    'Candlelit tables, flawless service, a ceremony that runs to the second.': 'موائد على ضوء الشموع، وخدمة بلا خطأ، ومراسم دقيقة بالثانية.',
    'Booths, activations and reveals that make people stop and look.': 'أجنحة وتفعيلات ولحظات كشف تجعل الناس يتوقفون وينظرون.',
    'Weddings & Private Celebrations': 'الأعراس والمناسبات الخاصة',
    'Intimate or grand. Every family detail honoured, every guest cared for.': 'صغيرة أو كبيرة. كل تفصيل عائلي مُراعى، وكل ضيف محل عناية.',
    'Founding Day, National Day and heritage nights that feel like home.': 'يوم التأسيس واليوم الوطني وليالي التراث بروح البيت.',
    'Behind the curtain': 'خلف الستار', 'Production': 'الإنتاج', 'Stage, light, sound and screens. Built, rigged and run by our own crew.': 'مسرح وإضاءة وصوت وشاشات. يبنيها ويجهزها ويديرها طاقمنا.',
    'Staging': 'المسارح', 'Lighting': 'الإضاءة', 'Audio': 'الصوتيات', 'LED screens': 'شاشات LED', 'Rigging': 'التعليق والتجهيز',
    'Run of show': 'جدول الحفل', '● Live': '● مباشر', 'Doors open': 'فتح الأبواب', 'Hosts ready': 'المضيفون جاهزون', 'Welcome address': 'كلمة الترحيب',
    'On stage': 'على المسرح', 'Keynote': 'الكلمة الرئيسية', 'Streaming': 'بث مباشر', 'Awards': 'الجوائز', 'Cue 14': 'الإشارة 14', 'Gala dinner': 'عشاء الحفل',
    'Service': 'الخدمة', 'Guests home': 'عودة الضيوف', 'Transfers': 'التنقلات', 'Run to the second': 'بدقة الثانية',
    'A show caller on every cue, a plan B for every scene.': 'مدير عرض لكل إشارة، وخطة بديلة لكل مشهد.',
    'Guest journey': 'رحلة الضيف', 'Invitations, flights, visas, hotels and transfers. VIPs met at the gate.': 'دعوات وطيران وتأشيرات وفنادق وتنقلات. استقبال كبار الضيوف عند البوابة.',
    'RSVP': 'تأكيد الحضور', 'VIP': 'كبار الضيوف', 'People & technology': 'الأشخاص والتقنية',
    'Hosts, crews, security and specialists. Registration, badges, live streams and event apps.': 'مضيفون وطواقم وأمن وكفاءات. تسجيل وبطاقات وبث مباشر وتطبيقات فعاليات.',
    'Hosts': 'المضيفون', 'Registration': 'التسجيل', 'Live stream': 'البث المباشر',
    'How an event comes together': 'كيف تُبنى الفعالية', 'Brief': 'الموجز', 'We listen. Goals, guests, budget, date.': 'نستمع. الأهداف والضيوف والميزانية والموعد.',
    'Concept': 'الفكرة', 'Theme, venue, look and feel, on one page.': 'الطابع والمكان والهوية، في صفحة واحدة.', 'Plan': 'الخطة',
    'Suppliers, permits, run of show, locked.': 'الموردون والتصاريح وجدول الحفل، مؤكدة.', 'Build': 'التجهيز',
    'Stage up, tech checked, rehearsed twice.': 'المسرح قائم، والتقنية مفحوصة، والبروفة مرتين.', 'Show day': 'يوم الحفل',
    'We run it. You host.': 'نحن ندير، وأنت تستضيف.', 'Wrap': 'الختام', 'Teardown, report, and what comes next.': 'الفك والتقرير وما يليه.',
    "Tell us the moment. We'll build everything around it.": 'أخبرنا باللحظة، ونبني كل شيء حولها.', 'See all services': 'كل الخدمات',

    # ---------- services page ----------
    'Tailored itineraries, local and abroad': 'برامج مصممة داخل المملكة وخارجها', 'Corporate and group travel': 'سفر الشركات والمجموعات',
    'Umrah and religious journeys': 'رحلات العمرة والرحلات الدينية', 'Tours across the Kingdom': 'جولات في أنحاء المملكة',
    'Enquire about Travel': 'استفسر عن السفر', 'Local and international flights': 'رحلات داخلية ودولية', 'Group and charter bookings': 'حجوزات المجموعات والطيران الخاص',
    'Changes, reissues and refunds': 'التعديل وإعادة الإصدار والاسترداد', 'Round-the-clock support': 'دعم على مدار الساعة', 'Enquire about Ticketing': 'استفسر عن التذاكر',
    'Hotels, resorts and desert camps': 'فنادق ومنتجعات ومخيمات صحراوية', 'Corporate rates and long stays': 'أسعار الشركات والإقامات الطويلة',
    'Group allocations for events': 'حجوزات جماعية للفعاليات', 'Airport transfers arranged': 'توصيل من المطار وإليه', 'Enquire about Hotels': 'استفسر عن الفنادق',
    'Tourist and business visas': 'تأشيرات السياحة والأعمال', 'Umrah visas': 'تأشيرات العمرة', 'Work visa processing': 'إجراءات تأشيرات العمل',
    'Document checks and live tracking': 'تدقيق المستندات ومتابعة مباشرة', 'Enquire about Visa Support': 'استفسر عن التأشيرات',
    'Company setup support': 'دعم تأسيس الشركات', 'Government relations services': 'خدمات العلاقات الحكومية', 'Permits and licences': 'التصاريح والتراخيص',
    'Logistics and transport': 'اللوجستيات والنقل', 'Enquire about Business Services': 'استفسر عن خدمات الأعمال',
    'Skilled and semi-skilled crews': 'طواقم ماهرة وشبه ماهرة', 'Short and long-term staffing': 'توظيف قصير وطويل المدى', 'Recruitment and mobilisation': 'الاستقدام والتجهيز',
    'Housing and transport for teams': 'السكن والنقل للفرق', 'Enquire about Manpower': 'استفسر عن توريد العمالة',
    'Engineering and technical specialists': 'متخصصون في الهندسة والتقنية', 'Consultants and project leads': 'مستشارون ومديرو مشاريع',
    'Healthcare and hospitality professionals': 'كفاءات الرعاية الصحية والضيافة', 'Short-notice deployment': 'إرسال خلال وقت قصير',
    'Enquire about Specialist Supply': 'استفسر عن توريد الكفاءات',
    'Conferences and summits': 'المؤتمرات والقمم', 'Concerts and festivals': 'الحفلات والمهرجانات', 'Galas, weddings and launches': 'حفلات العشاء والأعراس والتدشينات',
    'National and cultural days': 'الأيام الوطنية والثقافية', 'Visit Mada Events': 'زر مادا للفعاليات', 'Enquire': 'استفسر',
    'Networks and infrastructure': 'الشبكات والبنية التحتية', 'Software, web and apps': 'البرمجيات والمواقع والتطبيقات', 'Cloud and cybersecurity': 'السحابة والأمن السيبراني',
    'Support and maintenance': 'الدعم والصيانة', 'Enquire about IT Solutions': 'استفسر عن حلول التقنية',
    'Describe what you need. We’ll route it to the right people the same day.': 'صف ما تحتاجه، ونوجهه إلى الأشخاص المناسبين في اليوم نفسه.',
    'Talk to us': 'تحدث معنا',

    # ---------- about page ----------
    '/ma·da/ · noun · reach; the distance a glance can travel': '/مَدى/ · اسم · المدى؛ المسافة التي تبلغها نظرة',
    'The Kingdom is opening to the world, and the world deserves to arrive well. So we built one team that can fly you in, house you, staff your project, stage your event and keep your systems running.':
        'المملكة تنفتح على العالم، والعالم يستحق أن يصل على أحسن وجه. لذلك بنينا فريقاً واحداً يُحضرك جواً، ويُسكنك، ويوفر طاقم مشروعك، ويقيم فعاليتك، ويُبقي أنظمتك تعمل.',
    'What we stand for': 'ما نؤمن به', 'Hospitality first': 'الضيافة أولاً', 'Every guest is ours, from the first call to the final goodbye.': 'كل ضيف ضيفنا، من الاتصال الأول حتى الوداع الأخير.',
    'One team, one line': 'فريق واحد، خط واحد', 'No handoffs. No chasing. One point of contact who owns the outcome.': 'لا تحويلات ولا ملاحقة. نقطة تواصل واحدة مسؤولة عن النتيجة.',
    'Kingdom ready': 'جاهزون للمملكة', 'Local knowledge, global standards, and Vision 2030 in every plan.': 'معرفة محلية ومعايير عالمية، ورؤية 2030 في كل خطة.',
    'Built for 2030': 'مصممون لعام 2030', 'Welcoming the world to AlUla, the Red Sea, Riyadh and beyond.': 'نستقبل العالم في العلا والبحر الأحمر والرياض وما بعدها.',
    'Crews and specialists for the projects shaping the country.': 'طواقم وكفاءات للمشاريع التي تصنع مستقبل البلاد.',
    'Stages for the moments the Kingdom celebrates together.': 'مسارح للحظات التي تحتفل بها المملكة معاً.',
    'Systems that keep every operation online and secure.': 'أنظمة تُبقي كل عملية متصلة وآمنة.',
    'Whatever you’re planning, we’re ready when you are.': 'مهما كان ما تخطط له، نحن جاهزون متى كنت جاهزاً.',
    'Start a conversation': 'ابدأ محادثة',

    # ---------- contact page ----------
    'A trip, a team, a launch or all three. Tell us once and the right people take it from there.': 'رحلة، أو فريق، أو تدشين، أو كلها معاً. أخبرنا مرة واحدة ويتولى الأشخاص المناسبون الباقي.',
    'Based in': 'مقرنا', 'Riyadh, Kingdom of Saudi Arabia': 'الرياض، المملكة العربية السعودية', 'We cover': 'نغطي', 'Every region of the Kingdom': 'جميع مناطق المملكة',
    'Call': 'اتصال', 'Reply': 'الرد', 'Within one working day': 'خلال يوم عمل واحد', 'Call us': 'اتصل بنا',
    'No forms within forms. Just the essentials.': 'بلا تعقيد. الأساسيات فقط.', 'Full name': 'الاسم الكامل', 'Email': 'البريد الإلكتروني', 'Phone': 'الجوال',
    'What do you need?': 'ماذا تحتاج؟', 'Business services': 'خدمات الأعمال', 'Specialists': 'الكفاءات', 'Date': 'التاريخ',
    'Guests or team size': 'عدد الضيوف أو حجم الفريق', 'Select': 'اختر', '1 to 10': '1 إلى 10', '11 to 50': '11 إلى 50', '51 to 250': '51 إلى 250',
    '251 to 1,000': '251 إلى 1,000', 'Tell us more': 'أخبرنا أكثر', 'Send enquiry': 'إرسال الطلب', 'Received. Thank you.': 'وصلنا طلبك. شكراً لك.',
    'We’ll be in touch within one working day.': 'سنتواصل معك خلال يوم عمل واحد.',

    # ---------- attributes ----------
    'ALT::Aircraft wing above clouds': 'جناح طائرة فوق السحاب', 'ALT::AlUla rock formations beneath the Milky Way': 'تكوينات العلا الصخرية تحت درب التبانة',
    'ALT::Audience at a large summit': 'جمهور في قمة كبيرة', 'ALT::Ballroom set for a formal dinner': 'قاعة مجهزة لعشاء رسمي',
    'ALT::Clouds seen from an aircraft window at dawn': 'السحاب من نافذة طائرة عند الفجر', 'ALT::Concert crowd under stage lights': 'جمهور حفل تحت أضواء المسرح',
    'ALT::Construction crew on site': 'طاقم عمل في موقع إنشاءات', 'ALT::Engineers on a construction site': 'مهندسون في موقع إنشاءات',
    'ALT::Kingdom Centre tower in Riyadh at dusk': 'برج المملكة في الرياض عند الغروب', 'ALT::Mada Trips': 'مادا تربس',
    'ALT::Modern airport terminal': 'صالة مطار حديثة', 'ALT::Network cables in a server rack': 'كابلات شبكة في خزانة خوادم',
    'ALT::Passport filled with stamps': 'جواز سفر مليء بالأختام',
    'ALT::Portrait of Bader Al Sulaiman, Founder and CEO of Mada Trips, wearing a red shemagh': 'صورة بدر السليمان، المؤسس والرئيس التنفيذي لمادا تربس، بالشماغ الأحمر',
    'ALT::Resort terrace overlooking the sea at sunset': 'شرفة منتجع تطل على البحر عند الغروب', 'ALT::Seaside resort at sunset': 'منتجع ساحلي عند الغروب',
    'ALT::Stage with instruments under blue light': 'مسرح بآلات موسيقية تحت ضوء أزرق',
    'ARIA-LABEL::Destinations': 'الوجهات', 'ARIA-LABEL::Email': 'البريد الإلكتروني', 'ARIA-LABEL::Event gallery': 'معرض الفعاليات',
    'ARIA-LABEL::Mada Trips home': 'الصفحة الرئيسية لمادا تربس', 'ARIA-LABEL::Open menu': 'فتح القائمة', 'ARIA-LABEL::Primary': 'القائمة الرئيسية',
    'ARIA-LABEL::Services': 'الخدمات', 'ARIA-LABEL::What do you need?': 'ماذا تحتاج؟', 'ARIA-LABEL::Where to?': 'إلى أين؟', 'ARIA-LABEL::Your name': 'اسمك',
    'PLACEHOLDER::Email': 'البريد الإلكتروني', 'PLACEHOLDER::Where to?': 'إلى أين؟', 'PLACEHOLDER::Your name': 'اسمك',
    'PLACEHOLDER::Where, when, and what success looks like.': 'أين، ومتى، وكيف يبدو النجاح بالنسبة لك.',

    # ---------- meta ----------
    'TITLE::Mada Trips | Every horizon, within reach': 'مادا تربس | كل أفق، في المتناول', 'META::Mada Trips | Every horizon, within reach': 'مادا تربس | كل أفق، في المتناول',
    'TITLE::Events | Mada Trips': 'الفعاليات | مادا تربس', 'META::Events | Mada Trips': 'الفعاليات | مادا تربس',
    'TITLE::Services | Mada Trips': 'الخدمات | مادا تربس', 'META::Services | Mada Trips': 'الخدمات | مادا تربس',
    'TITLE::About | Mada Trips': 'من نحن | مادا تربس', 'META::About | Mada Trips': 'من نحن | مادا تربس',
    'TITLE::Contact | Mada Trips': 'تواصل معنا | مادا تربس', 'META::Contact | Mada Trips': 'تواصل معنا | مادا تربس',
    'META::Mada Trips': 'مادا تربس',
    'META::Travel, ticketing, hotels, visas, manpower, specialists, events and IT. One Saudi partner for everything that moves, from Riyadh to every horizon.':
        'السفر والتذاكر والفنادق والتأشيرات والعمالة والكفاءات والفعاليات والتقنية. شريك سعودي واحد لكل ما يتحرك، من الرياض إلى كل أفق.',
    'META::Mada Trips. Every horizon, within reach.': 'مادا تربس. كل أفق، في المتناول.',
    'META::Mada Trips. Every horizon, within reach. Golden Arabian dunes at sunset.': 'مادا تربس. كل أفق، في المتناول. كثبان ذهبية عند الغروب.',
    'META::Mada Events: conferences, concerts, galas, exhibitions, weddings and national celebrations across Saudi Arabia. Designed, produced and hosted end to end.':
        'مادا للفعاليات: مؤتمرات وحفلات وحفلات عشاء ومعارض وأعراس واحتفالات وطنية في أنحاء المملكة. تصميم وإنتاج واستضافة من البداية إلى النهاية.',
    'META::Mada Events. We build the night everyone remembers.': 'مادا للفعاليات. نصنع الليلة التي لا تُنسى.',
    'META::Travel, ticketing, hotels, visa support, business services, manpower, specialist supply, events and IT solutions. One Saudi partner for everything that moves.':
        'السفر والتذاكر والفنادق والتأشيرات وخدمات الأعمال وتوريد العمالة والكفاءات والفعاليات وحلول التقنية. شريك سعودي واحد لكل ما يتحرك.',
    'META::Mada Trips services: travel, ticketing, hotels, visas, business, manpower, specialists, events and IT.': 'خدمات مادا تربس: السفر والتذاكر والفنادق والتأشيرات والأعمال والعمالة والكفاءات والفعاليات والتقنية.',
    'META::Mada means reach. Meet the Riyadh team behind travel, talent, events and technology, led by founder and CEO Bader Al Sulaiman.':
        'مادا تعني المدى. تعرّف على فريق الرياض وراء السفر والكفاءات والفعاليات والتقنية، بقيادة المؤسس والرئيس التنفيذي بدر السليمان.',
    'META::About Mada Trips. We turned a word into a promise. Founder and CEO Bader Al Sulaiman.': 'عن مادا تربس. حوّلنا كلمة إلى وعد. المؤسس والرئيس التنفيذي بدر السليمان.',
    'META::Plan travel, events, manpower or IT with Mada Trips. Tell us once and our Riyadh team takes it from there.': 'خطط للسفر أو الفعاليات أو العمالة أو التقنية مع مادا تربس. أخبرنا مرة واحدة ويتولى فريقنا في الرياض الباقي.',
    "META::Contact Mada Trips. Let's plan the next horizon. +966 56 668 2662.": 'تواصل مع مادا تربس. لنخطط للأفق القادم. 2662 668 56 966+',
}

# Brand, codes and names that stay as written
KEEP = {'RUH', 'CDG', 'ULH', 'A7', '2A', 'PM', 'MADA', 'html', 'M', 'A', 'D', 'T', 'R', 'I', 'P', 'S', 'K', 'Bader Al Sulaiman',
        'ARIA-LABEL::X', 'ARIA-LABEL::Instagram', 'ARIA-LABEL::LinkedIn'}
