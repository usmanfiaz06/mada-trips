# -*- coding: utf-8 -*-
"""Mada Trips social calendar, November 2026: every planned post.

One row per post. Platforms are native, not cross-posts: the same idea is
shot and written differently for each feed.

Fields
  d       day of November 2026
  t       posting time, Riyadh (AST, UTC+3)
  p       IG | TT | X | LI
  f       format
  pil     pillar code (see strategy.PILLARS)
  sc      scope: Saudi | GCC | Global | Mixed | B2B | All (brand, offers, service)
  series  recurring series name, if any
  title   working title for the team
  hook    first 1-3 seconds (video) or first line (static/text)
  pen     on-poster / on-screen text, English
  par     on-poster / on-screen text, Arabic
  car     caption / post copy as published, Arabic
  cen     caption / post copy, English (publish as-is where the post is English-led,
          otherwise it is the team's translation)
  kw      search keywords to say, show and write
  tags    hashtags, max 5 (IG and TikTok cap)
  cta     call to action
  dir     visual, audio and production direction
  moment  the date or trend it rides
  note    approvals, risks, fallbacks
"""

WA = "واتساب ‎+966 56 668 2662"

POSTS = []


def P(d, t, p, f, pil, title, hook, pen, par, car, cen, kw, tags, cta, dir, moment="", note="", series="", sc=""):
    POSTS.append(dict(d=d, t=t, p=p, f=f, pil=pil, sc=sc, series=series, title=title, hook=hook,
                      pen=pen, par=par, car=car, cen=cen, kw=kw, tags=tags, cta=cta,
                      dir=dir, moment=moment, note=note))


# ───────────────────────── WEEK 1 · 1–7 Nov · LAUNCH ─────────────────────────

P(1, "20:30", "IG", "Reel 30s", "MOM", "Launch film: Every horizon, within reach",
  "Black screen, one word in gold: مدى / Reach",
  "Every horizon, within reach.", "كل أفق، في متناولك.",
  "مادا يعني المدى.\nومن اليوم، رحلتك وفعاليتك وفريقك… كلها بمكالمة وحدة.\nتذاكر، فنادق، تأشيرات، فعاليات، كوادر وتقنية — من الرياض لكل أفق.\nتابعنا، القادم أجمل 🌙",
  "Mada is Arabic for reach.\nFlights, stays, visas, events, crews and tech. From Riyadh to every horizon.\nOne call. Everything moves.",
  "وكالة سفر الرياض, Riyadh travel agency, مادا للسفر",
  "#مادا #MadaTrips #الرياض #سفر #RiyadhTravel",
  "Follow + tap the WhatsApp button in bio",
  "Cinematic 6-scene cut, 4-5s each: dunes at sunrise → boarding gate → hotel door opening to a ready room → stage lights warming up → concierge answering a phone at 03:00 → logo resolve. Calm Najdi VO (male or female). Warm sand/green grade. Ambient oud with a slow rise. Burned-in Arabic subtitles + English.",
  "Brand launch", "PIN to profile. Shoot original footage only (Instagram stops recommending reposted clips since Apr 2026).")

P(1, "21:00", "TT", "Video 20s", "ONE", "POV: you said it once and it just happened",
  "On-screen: لما تقول طلبك مرة وحدة… 👀",
  "You said it once. We did the rest.", "قلتها مرة… والباقي علينا",
  "أول فيديو لنا 👋 احنا مادا من الرياض.\nقل طلبك مرة، والباقي علينا ✈️🏨\nوش أول وجهة نخطط لها لك؟ اكتبها بالتعليقات 👇",
  "Our first video. We're Mada from Riyadh. Say it once and we handle the rest. Where should we plan first? Comment below.",
  "تخطيط رحلة, رحلة العلا, travel planner Riyadh",
  "#مادا #سفر #العلا #السعودية #tiktoksaudi",
  "Comment your dream destination",
  "Open on a real-sounding voice note bubble: 'أبي آخذ أهلي العلا الويكند الجاي'. Jump cuts in sync with a trending beat: laptop, WhatsApp confirmations popping (flight ✓ hotel ✓ transfer ✓), then the family (from behind) walking into Hegra at golden hour. 9:16, captions on.",
  "Brand launch", "Reply to every comment with a video reply over the following days. That reply series feeds week 2.")

P(1, "13:00", "X", "Post (pinned)", "MOM", "Launch post",
  "مادا يعني المدى.",
  "", "",
  "مادا يعني المدى.\nمن اليوم، كل أفق في متناولك: سفر، تذاكر، فنادق، تأشيرات، فعاليات، كوادر وتقنية.\nفريق واحد يرد عليك حتى الساعة ٣ الفجر.\n\nوش الوجهة اللي تحلم فيها هالشتاء؟ 👇",
  "Mada means reach. From today every horizon is within reach: travel, tickets, hotels, visas, events, crews and tech. One team that picks up even at 3 a.m. Where are you dreaming of this winter?",
  "وكالة سفر, سفر الشتاء",
  "#مادا",
  "Reply with a destination",
  "Attach the launch film's 15s cut (native upload, not a link).",
  "Brand launch", "Pin. Reply to every answer within the hour, since replies feed ranking.")

P(1, "09:30", "LI", "Image + post", "BIZ", "Mada Trips opens its doors",
  "One partner for everything that moves.",
  "One partner for everything that moves.", "شريك واحد لكل ما يتحرك",
  "",
  "Today Mada Trips opens its doors in Riyadh.\n\nMost organisations juggle seven vendors to move one delegation: an airline desk, a hotel contact, a visa agent, an event producer, a crew supplier, an IT vendor and someone who chases them all.\n\nWe built Mada so that is one call.\n\n→ Travel, ticketing and hotels\n→ Visa support and business services\n→ Manpower and specialist supply\n→ Events and the IT beneath them\n\nOne team, one point of contact, one report that accounts for every riyal.\n\nIf you are planning a delegation, a conference or a project mobilisation for 2027, we'd like to hear about it.",
  "corporate travel Saudi Arabia, event management Riyadh, manpower supply KSA",
  "#Riyadh #CorporateTravel #EventManagement #Vision2030",
  "Message us / visit the website",
  "Single 1200x1500 image: sand background, green headline, the 9 service names in a quiet grid, symbol in gold. Founder reshares with a personal line within 2 hours.",
  "Brand launch", "Ask the founder and every team member to comment with substance (not 'congrats') in the first hour.")

P(2, "20:30", "IG", "Carousel 10", "ONE", "9 services. 1 call.",
  "Slide 1: Say it once. We'll take it from there.",
  "Say it once. We'll take it from there.", "قلها مرة… ونكمّل عنك",
  "تسع خدمات، ورقم واحد.\n١ السفر ٢ التذاكر ٣ الفنادق ٤ التأشيرات ٥ خدمات الأعمال ٦ الكوادر ٧ المختصين ٨ الفعاليات ٩ الحلول التقنية\nاحفظ المنشور لين تحتاجنا 📌",
  "Nine services, one number. Travel, ticketing, hotels, visas, business services, manpower, specialists, events, IT. Save this for when you need us.",
  "خدمات سفر, حجز فنادق, تأشيرات, تنظيم فعاليات",
  "#مادا #MadaTrips #خدمات_سفر #تنظيم_فعاليات #الرياض",
  "Save + share with the person who always plans",
  "4:5 (1080x1350). One service per slide: a single real photo, a 3-word promise, the Arabic word large in Reem Kufi. Slide 10: WhatsApp number + 'One call. Everything moves.' Keep text off the bottom 300px.",
  "Launch week")

P(2, "21:00", "TT", "Video 50s", "KNOW", "Schengen 5-year visa for Saudis",
  "Spoken + on-screen in the first 2s: فيزا شنغن ٥ سنوات؟ حتى من أول مرة!",
  "5-year Schengen. Even on your first application.", "شنغن ٥ سنوات… حتى من أول مرة",
  "فيزا شنغن متعددة لين ٥ سنوات للسعوديين المقيمين في المملكة — حتى لو أول مرة تقدم ✅\nبس فيه ٣ أشياء لازم تعرفها قبل الموعد 👇\nاحفظ الفيديو وأرسله لرفيق السفر.",
  "Saudi nationals living in the Kingdom can get a multiple-entry Schengen visa of up to 5 years, even on a first application. Here are 3 things to know before your appointment.",
  "تأشيرة شنغن, فيزا شنغن للسعوديين, شنغن ٥ سنوات, Schengen visa Saudi",
  "#تأشيرة_شنغن #فيزا #سفر #السعودية #مادا",
  "Save + 'send to your travel buddy'",
  "Concierge on camera, green-screen behind with the EU visa page. 3 numbered points as text pops: (1) validity is at the embassy's discretion, (2) apply 3-6 weeks before travel, (3) bring bank statement + employment letter + insurance. End card: 'Want us to prepare your file? Link in bio'.",
  "Evergreen visa (rule since Apr 2024)", "Legal check: say 'up to' and 'at the embassy's discretion'. Never promise approval.",
  series="Visa in 60")

P(2, "12:30", "X", "Thread 5", "KNOW", "Schengen 5-year visa thread",
  "فيزا شنغن ٥ سنوات للسعوديين: الدليل المختصر 🧵",
  "", "",
  "١/ فيزا شنغن متعددة لين ٥ سنوات للسعوديين المقيمين بالمملكة، حتى في أول طلب. الدليل المختصر 🧵\n٢/ المدة تقررها السفارة حسب ملفك. السفر السابق والملف المرتب يفرقون.\n٣/ قدّم قبل سفرك بـ٣ إلى ٦ أسابيع، ولا تقدم قبل أكثر من ٦ شهور.\n٤/ الأساسيات: جواز ساري، كشف حساب، خطاب جهة العمل، تأمين سفر، حجوزات.\n٥/ تبي نجهز ملفك ونحجز موعدك؟ نسويها لك من البداية للنهاية.",
  "1/ Saudis living in KSA can get a multiple-entry Schengen visa of up to 5 years, even on a first application. 2/ The embassy decides the validity. 3/ Apply 3-6 weeks before travel, never more than 6 months. 4/ Basics: passport, bank statement, employer letter, insurance, bookings. 5/ Want us to prepare your file?",
  "تأشيرة شنغن, Schengen visa",
  "#تأشيرة_شنغن",
  "DM / WhatsApp",
  "Text-only thread (text posts carry the highest median engagement on X per Buffer 2026). One image on tweet 1: a branded checklist card.",
  "Evergreen visa", "Space threads at least 3 hours from other posts. X downranks bursts from the same author.",
  series="Visa in 60")

P(3, "20:30", "IG", "Static 4:5", "MOM", "A note from our founder",
  "In Arabia, no guest walks alone.",
  "“In Arabia, no guest walks alone.” Bader Al Sulaiman", "«في جزيرة العرب، ما يمشي ضيف وحده.» بدر السليمان",
  "في جزيرة العرب، ما يمشي ضيف وحده.\nهذا الوعد اللي بنينا عليه مادا: كل مسافر، كل فريق، وكل فكرة تجي للمملكة… معها أحد.\n— بدر السليمان، المؤسس والرئيس التنفيذي",
  "In Arabia, no guest walks alone. That promise is what Mada is built on: every traveller, every team and every idea that comes to the Kingdom has someone with them. Bader Al Sulaiman, Founder & CEO.",
  "مادا, بدر السليمان",
  "#مادا #MadaTrips #ضيافة #الرياض",
  "Follow for the journey",
  "Founder portrait (assets/img/founder.jpg) in green duotone, quote in Instrument Serif italic EN + Aref Ruqaa AR, signature at bottom.",
  "Launch week", "APPROVAL: the quote is still draft copy (see README). Get Bader's sign-off before scheduling.")

P(3, "21:00", "TT", "Video 45s", "HOR", "5 things nobody tells you about Riyadh Season",
  "On-screen: ٥ أشياء محد يقولها لك عن موسم الرياض 🤫",
  "5 things nobody tells you about Riyadh Season", "٥ أشياء محد يقولها لك عن موسم الرياض",
  "موسم الرياض ٢٠٢٦ بدأ ✨ بس قبل تروح… هذي ٥ أشياء محد يقولها لك 👇\nأي وحدة كنت تعرفها؟",
  "Riyadh Season 2026 is on. Before you go, here are 5 things nobody tells you. Which one did you already know?",
  "موسم الرياض, موسم الرياض ٢٠٢٦, Riyadh Season 2026, بوليفارد وورلد",
  "#موسم_الرياض #بوليفارد_وورلد #الرياض #RiyadhSeason #مادا",
  "Comment which tip you didn't know",
  "Fast list format, one tip per 7-8s, real footage from Boulevard World and Boulevard City: (1) book tickets ahead on the official app (2) weekdays after 9pm are calmer (3) comfortable shoes, it's a lot of walking (4) agree a meeting point, signal drops in crowds (5) check each zone's opening days. Text + VO.",
  "Riyadh Season 2026 (from 21 Oct)", "Verify zone hours on the official channels the morning of posting.")

P(3, "12:00", "X", "Post", "ONE", "Disruption help line",
  "رحلتك تأثرت بتعديلات الطيران الأخيرة؟",
  "", "",
  "رحلتك تأثرت بتعديلات الطيران الأخيرة؟\nأرسل لنا رقم الحجز على الواتساب، ونتابع لك خيارات التعديل أو الاسترداد مع شركة الطيران، بدون ما تنتظر على الخط.\nحتى لو ما حجزت معنا.",
  "Was your flight affected by recent schedule changes? Send us your booking reference on WhatsApp and we'll chase change or refund options with the airline. Even if you didn't book with us.",
  "تعديل رحلة, استرداد تذكرة",
  "",
  "WhatsApp",
  "Text only, calm tone. No airport imagery, no mention of attacks.",
  "Airline schedule changes after the October RUH closures",
  "SENSITIVITY: post only if foreign carriers' suspensions are still affecting travellers that week (check Monday). Never joke about airports or safety.")

P(3, "09:30", "LI", "Document 8 pages", "BIZ", "Hosting international delegates in Riyadh: the checklist",
  "Page 1: 200 delegates land in Riyadh in 12 weeks. What has to be true?",
  "Hosting delegates in Riyadh: the 2027 checklist", "",
  "",
  "FII10 just wrapped, and 2027's calendar is already filling. If you are hosting international delegates in Riyadh, this is the checklist we run:\n\n1. Visas: business eVisa vs visit visa, lead times per nationality\n2. Arrivals: meet-and-assist, fast-track, VIP lanes\n3. Rooms: blocks near the venue, release dates, rooming lists\n4. Ground: transfer waves timed to sessions, not flights\n5. Badging and registration\n6. Cultural briefing: dress, prayer times, Friday schedules\n7. A single live status board for the host team\n8. The after-report: every booking, every riyal\n\nSwipe for the full version. Save it for your next event.",
  "delegation management Riyadh, MICE Saudi Arabia, business eVisa Saudi",
  "#MICE #Riyadh #EventManagement #CorporateTravel",
  "Save + DM 'CHECKLIST' for the editable version",
  "PDF carousel, 1080x1350 pages, sand background, one point per page with a small icon. Documents lead LinkedIn engagement (Buffer 2026, Socialinsider 2026).",
  "Post-FII10 (26-29 Oct)")

P(4, "20:30", "IG", "Reel 35s", "ONE", "One Call #1: three rooms for AlUla Skies",
  "Voice note plays: 'نبي ٣ غرف بالعلا ويكند مهرجان السماء…'",
  "One call. 3 rooms. 4 minutes.", "مكالمة وحدة. ٣ غرف. ٤ دقائق.",
  "مكالمة وحدة… والويكند جاهز 🎈\nسلسلة «مكالمة وحدة»: طلبات حقيقية، وكيف نحلها.\nوش الطلب اللي تبينا نحله في الحلقة الجاية؟",
  "One call and the weekend is ready. 'One Call' is our series of real requests and how we solve them. What should we solve next?",
  "مهرجان سماء العلا, فنادق العلا, AlUla Skies Festival",
  "#مكالمة_وحدة #العلا #سماء_العلا #مادا #AlUla",
  "Comment your request for the next episode",
  "Split screen. Left: the client's voice note waveform + subtitles. Right: the concierge working (calls, screens blurred, confirmations). A running timer top-right. Ends on the client's reply: '😍 تم'. Natural office sound, no music under the voice.",
  "AlUla Skies Festival 6-15 Nov", "Re-enact with consent and anonymise. Label it 'based on a real request' if re-enacted.",
  series="One Call")

P(4, "21:00", "TT", "Video 40s", "HOR", "AlUla Skies Festival: what to do",
  "On-screen + VO: العلا تفتح سماها ٦ نوفمبر 🎈",
  "AlUla Skies · 6-15 Nov", "سماء العلا · ٦–١٥ نوفمبر",
  "مهرجان سماء العلا من ٦ لين ١٥ نوفمبر 🎈🔭\nمناطيد الشروق، عروض المناطيد المضيئة بالليل، ورصد النجوم بأظلم ليالي الشهر.\nمين بتاخذ معك؟ منشنه 👇",
  "AlUla Skies Festival, 6-15 November: sunrise balloon flights, balloon glow at night and stargazing on the darkest nights of the month. Tag who you're taking.",
  "مهرجان سماء العلا, العلا نوفمبر, منطاد العلا, AlUla Skies",
  "#العلا #سماء_العلا #منطاد #السعودية #مادا",
  "Tag a friend",
  "Countdown style: 3 beats (balloons at sunrise → balloon glow → stars over the rocks). Use our own AlUla stills/footage. 'Moonless 7-12 Nov' as a pop-up fact.",
  "AlUla Skies Festival 6-15 Nov", "Confirm the programme (incl. any concert) on Experience AlUla's channels before posting.")

P(5, "19:30", "IG", "Carousel 7", "HOR", "Weekend Radar #1",
  "Slide 1: This weekend in Riyadh & beyond · 5-7 Nov",
  "Weekend Radar · 5-7 Nov", "رادار الويكند · ٥–٧ نوفمبر",
  "رادار الويكند 📡\n• موسم الرياض: الأجنحة الجديدة في بوليفارد وورلد (هولندا، البرتغال، اليمن)\n• العلا: افتتاح مهرجان سماء العلا الجمعة\n• السبت: ليلة WWE Crown Jewel في الرياض\n• موسم سباقات الرياض مستمر\nاحفظه وشاركه مع شلتك 📌",
  "Weekend Radar. Riyadh Season's new Boulevard World pavilions, AlUla Skies opens Friday, WWE Crown Jewel on Saturday, and Riyadh racing season continues. Save and share.",
  "فعاليات الرياض هالويكند, وش اسوي بالرياض, Riyadh this weekend",
  "#رادار_الويكند #موسم_الرياض #فعاليات_الرياض #الرياض #مادا",
  "Save + share to your group",
  "Recurring template every Thursday: green cover with a radar-sweep graphic, one event per slide with date, place and a one-line tip. Last slide: 'Need tickets, a table or a ride? WhatsApp'.",
  "Riyadh Season, AlUla Skies, WWE Crown Jewel (7 Nov)", "",
  series="Weekend Radar")

P(5, "20:00", "TT", "Video 55s", "HOR", "Riyadh Season zones in 60 seconds",
  "VO: موسم الرياض بدقيقة. يلا 🏃",
  "Riyadh Season in 60s", "موسم الرياض بدقيقة",
  "موسم الرياض ٢٠٢٦ بدقيقة ⏱️ وش المنطقة اللي بتبدأ فيها؟\nبوليفارد وورلد، بوليفارد سيتي، ونستر غاردن، ذا قروفز، سوق المزارعين، وأنا عربية في ڤيا رياض.",
  "Riyadh Season 2026 in a minute: Boulevard World, Boulevard City, Wonder Garden, The Groves, the Farmers' Market and Ana Arabia at VIA Riyadh. Where do you start?",
  "مناطق موسم الرياض, موسم الرياض ٢٠٢٦, Riyadh Season zones",
  "#موسم_الرياض #RiyadhSeason #الرياض #فعاليات #مادا",
  "Comment your first zone",
  "Walk-and-talk, one zone per 8s, a location pin pops for each. Keep the zone names on screen for search.",
  "Riyadh Season 2026")

P(5, "13:00", "X", "Thread 4", "HOR", "Weekend Radar on X",
  "وش نسوي هالويكند؟ 📡",
  "", "",
  "وش نسوي هالويكند؟ 📡 رادار مادا:\n١/ موسم الرياض: أجنحة جديدة ببوليفارد وورلد (هولندا، البرتغال، اليمن)\n٢/ العلا: مهرجان سماء العلا يبدأ الجمعة ٦ نوفمبر\n٣/ السبت ٧ نوفمبر: WWE Crown Jewel\nتبي تذاكر أو حجز أو توصيل؟ كلمنا.",
  "What's on this weekend: Riyadh Season's new pavilions, AlUla Skies opens Friday, WWE Crown Jewel on Saturday. Need tickets, a booking or a ride? Talk to us.",
  "فعاليات الويكند",
  "#موسم_الرياض",
  "Reply / DM",
  "Image on tweet 1 = cover slide of the IG Weekend Radar.",
  "Weekend", "", series="Weekend Radar")

P(6, "20:30", "IG", "Reel 20s", "HOR", "06:00 in AlUla (balloon ASMR)",
  "Sound of the burner first, then black → sunrise",
  "06:00 · AlUla", "٦ الفجر · العلا",
  "٦ الفجر في العلا 🎈\nبدون كلام. ارفع الصوت.",
  "6 a.m. in AlUla. No words. Sound on.",
  "منطاد العلا, AlUla hot air balloon, سماء العلا",
  "#العلا #سماء_العلا #منطاد #AlUla #مادا",
  "Share to someone who'd love this",
  "Pure ASMR: burner roar, wind, quiet gasps. Wide sunrise over the sandstone, then a detail of hands on the basket. No music. No text except the time stamp.",
  "AlUla Skies opening day", "Needs our own crew/creator in AlUla 6-8 Nov. Fallback: swap with the 'One Call #1' cut-down. Do not repost festival footage.")

P(6, "18:30", "X", "Post + image", "HOR", "AlUla Skies opens today",
  "اليوم يبدأ مهرجان سماء العلا 🎈",
  "", "",
  "اليوم يبدأ مهرجان سماء العلا 🎈\nنصيحة من فريقنا: أظلم الليالي من ٧ لين ١٢ نوفمبر. إذا جيت عشان النجوم، هذي ليالينا.",
  "AlUla Skies Festival starts today. Tip from our team: the darkest nights are 7-12 November. If you're coming for the stars, these are the nights.",
  "سماء العلا",
  "#سماء_العلا",
  "Bookmark",
  "One original night-sky photo.",
  "AlUla Skies", "Post after Maghrib. Avoid the Friday prayer window.")

P(7, "20:00", "IG", "Carousel 6", "KNOW", "Big night in Riyadh: the stress-free plan",
  "Slide 1: Event night in Riyadh? Here's the plan that never fails",
  "Event night in Riyadh: the no-stress plan", "ليلة فعالية بالرياض؟ الخطة اللي ما تخذلك",
  "عندك فعالية الليلة؟ 🎟️\nالخطة اللي نعطيها عملاءنا: وصول بدري، نقطة التقاء واضحة، عشاء محجوز قبل، وتوصيل جاهز بعد.\nاحفظها لأي ليلة كبيرة.",
  "Got an event tonight? The plan we give our clients: arrive early, agree a meeting point, book dinner before, have your ride ready after. Save it for any big night.",
  "فعاليات الرياض, Crown Jewel Riyadh, حفلات الرياض",
  "#فعاليات_الرياض #موسم_الرياض #الرياض #مادا #RiyadhSeason",
  "Save",
  "Checklist design, 5 slides with icons + 1 CTA slide. Timeline graphic 18:00 → 00:30.",
  "WWE Crown Jewel (7 Nov)")

P(7, "21:30", "TT", "Video 20s", "MOM", "Riyadh tonight",
  "On-screen: الرياض الليلة 🔥",
  "Riyadh tonight", "الرياض الليلة",
  "الرياض الليلة غير 🔥 وين كنتم؟",
  "Riyadh tonight hits different. Where were you?",
  "الرياض الليلة, موسم الرياض",
  "#الرياض #موسم_الرياض #CrownJewel #RiyadhSeason #مادا",
  "Comment where you were",
  "Atmosphere-only edit: crowds, lights, food stalls, the boulevard skyline. No match or arena footage (rights). Trending sound.",
  "WWE Crown Jewel night", "No WWE logos or broadcast footage.")

P(7, "19:00", "X", "Post", "MOM", "Crown Jewel night tip",
  "رايح #CrownJewel الليلة؟",
  "", "",
  "رايح #CrownJewel الليلة؟ 🎟️\nثلاث نصايح: ١) وصل قبل البداية بساعة ٢) اتفق مع ربعك على نقطة التقاء ٣) حدد مكان الركوب للرجعة من الحين.\nاستمتعوا!",
  "Going to Crown Jewel tonight? Arrive an hour early, agree a meeting point, pick your ride-home spot now. Enjoy!",
  "Crown Jewel الرياض",
  "#CrownJewel",
  "Reply",
  "Text only.",
  "WWE Crown Jewel")

# ───────────────────────── WEEK 2 · 8–14 Nov · SKIES, VISAS, WINTER ─────────────────────────

P(8, "20:30", "IG", "Reel 40s", "ONE", "Concierge Confessions #1: the 3am call",
  "Phone lights up at 03:12. 'Hello… Mada?'",
  "03:12 · a call we'll never forget", "٣:١٢ الفجر · مكالمة ما ننساها",
  "الساعة ٣:١٢ الفجر… واحد من عملاءنا في مطار بعيد، والرحلة ألغيت.\nهذي القصة كاملة 👇\n«من دفتر الكونسيرج»: قصص حقيقية من شغلنا اليومي.",
  "03:12. A client at a faraway airport, flight cancelled. Here's the whole story. 'Concierge Confessions': real stories from our day-to-day.",
  "كونسيرج سفر, إلغاء رحلة, travel concierge",
  "#من_دفتر_الكونسيرج #مادا #سفر #MadaTrips #قصص_سفر",
  "Save + follow the series",
  "Storytime, concierge to camera in a dim office, cutaways to a phone screen and a departure board. Calm, human, slightly funny ending. 40s max.",
  "Evergreen", "Real story, anonymised, with the client's OK.",
  series="Concierge Confessions")

P(8, "21:00", "TT", "Video 50s", "KNOW", "UK ETA for Saudis",
  "On-screen + VO: بريطانيا بدون فيزا؟ إيه، بس لازم هذا 👇",
  "UK: no visa, but you need an ETA", "بريطانيا بدون فيزا… بس لازم ETA",
  "السعوديين يدخلون بريطانيا بالـETA بدل الفيزا 🇬🇧\nكيف تطلعها، كم صلاحيتها، ووش الغلط اللي يأخر الموافقة 👇",
  "Saudis enter the UK with an ETA instead of a visa. How to get it, how long it lasts and the mistake that delays approval.",
  "تأشيرة بريطانيا, ETA بريطانيا للسعوديين, UK ETA Saudi",
  "#بريطانيا #تأشيرة #لندن #سفر #مادا",
  "Save + send to your London crew",
  "Phone screen-record of the official UK ETA app (no personal data), concierge voice-over. Facts on screen: apply via the official app or gov.uk, multiple entries, valid 2 years or until the passport expires, stays up to 6 months. Fee: show the current gov.uk figure.",
  "Winter in London (Winter Wonderland from 19 Nov)", "Verify the fee on gov.uk/eta the day before. Third-party sources say £20 from Feb 2026.",
  series="Visa in 60")

P(8, "12:30", "X", "Thread 4", "KNOW", "UK ETA thread",
  "مسافر لندن هالشتاء؟ لا تنسى الـETA 🇬🇧🧵",
  "", "",
  "١/ مسافر لندن هالشتاء؟ السعوديين يحتاجون ETA مو فيزا 🧵\n٢/ تطلعها من التطبيق الرسمي أو gov.uk، والموافقة عادة سريعة.\n٣/ صالحة سنتين أو لين ينتهي الجواز، دخول متعدد، لين ٦ شهور لكل زيارة.\n٤/ تأكد إن رقم الجواز نفسه اللي بتسافر فيه، هذا أكثر غلط نشوفه.",
  "1/ Flying to London this winter? Saudis need an ETA, not a visa. 2/ Apply in the official app or on gov.uk. 3/ Valid 2 years or until the passport expires, multiple entries, up to 6 months per visit. 4/ Make sure it's the passport you'll travel on. That's the most common mistake we see.",
  "ETA بريطانيا",
  "#بريطانيا",
  "Bookmark",
  "Text thread.",
  "Evergreen visa", "Verify on gov.uk.", series="Visa in 60")

P(8, "09:30", "LI", "Document 10 pages", "BIZ", "Field Notes #1: a 200-person delegation, the 12-week timeline",
  "Page 1: Week -12 to Day 0",
  "200 delegates. 12 weeks. One plan.", "",
  "",
  "Field Notes #1. What it takes to bring 200 people to Riyadh for a three-day summit.\n\nWeek -12: brief, budget, dates, room block\nWeek -10: visa matrix by nationality\nWeek -8: flights in waves, transfer plan\nWeek -6: run of show v1, suppliers locked\nWeek -4: rooming list, badges, dietary needs\nWeek -2: rehearsal, transport dry-run\nDay 0: arrivals desk live, status board open\n\nThe keynote gets the applause. The timeline gets everyone into the room.\n\nWhat would you add?",
  "delegation management, conference planning Saudi Arabia, MICE Riyadh",
  "#FieldNotes #MICE #EventPlanning #Riyadh",
  "Comment what you'd add",
  "PDF document, a Gantt-style timeline across pages in brand green and gold.",
  "Evergreen B2B", "", series="Field Notes")

P(9, "21:30", "X", "Post", "HOR", "Stargazing nudge",
  "الليلة بدون قمر 🌑",
  "", "",
  "الليلة بدون قمر 🌑\nلو تقدر تطلع ساعة برا الرياض بعيد عن الأنوار، ارفع راسك. وصورنا اللي تشوفه وحطه بالرد ✨",
  "No moon tonight. If you can get an hour outside Riyadh away from the lights, look up. Reply with what you see.",
  "رصد النجوم",
  "#رصد_النجوم",
  "Reply with a photo (UGC)",
  "Text + one star photo.",
  "New moon")

P(10, "20:30", "IG", "Reel 30s", "BIZ", "Behind the Curtain #1: an event build in 30 seconds",
  "Empty hall → full stage in 3 seconds (timelapse hook)",
  "36 hours in 30 seconds", "٣٦ ساعة في ٣٠ ثانية",
  "قاعة فاضية… وبعد ٣٦ ساعة صارت ليلة ما تنسى ✨\n«خلف الستارة»: كيف تنبني فعالياتنا.",
  "An empty hall, and 36 hours later a night nobody forgets. 'Behind the Curtain': how our events get built.",
  "تنظيم فعاليات الرياض, event management Riyadh, تنظيم حفلات",
  "#خلف_الستارة #تنظيم_فعاليات #فعاليات_الرياض #مادا #MadaEvents",
  "DM 'EVENT' to plan yours",
  "Locked-off timelapse of a real build (stage, truss, lights, tables), then a 3-second real-time payoff of lights on. Crew in branded tees. A sound design build-up.",
  "Evergreen events", "Needs our own event footage. If no build this month, shoot a small activation or rehearsal.",
  series="Behind the Curtain")

P(10, "13:00", "X", "Post", "MOM", "11.11 teaser",
  "بكرة ١١.١١ 👀",
  "", "",
  "بكرة ١١.١١ 👀\nعندنا شي صغير لأول ١١ حجز. فعّل التنبيه.",
  "Tomorrow is 11.11. Something small for the first 11 bookings. Turn on notifications.",
  "عروض ١١.١١",
  "#١١_١١",
  "Turn on notifications",
  "Text only.",
  "11.11 Singles Day", "OFFER needs management approval (see 11 Nov).")

P(10, "09:30", "LI", "Post + image", "BIZ", "Hiring skilled crews in KSA: what actually takes time",
  "The welders were ready in 10 days. The paperwork took the rest.",
  "Mobilising skilled crews in KSA: where time goes", "",
  "",
  "Clients often ask why mobilising a skilled crew takes weeks when the people are ready in days.\n\nWhere the time goes:\n• Work visas and permits through Qiwa\n• Medical checks and certification checks\n• Iqama issuance and site access\n• Housing, transport and safety induction\n\nWhat shortens it: a clear scope early, documents checked before submission, and one partner who owns every step.\n\nTimelines vary by role and nationality. If you are planning a 2027 mobilisation, start the conversation now.",
  "manpower supply Saudi Arabia, skilled workers KSA, Qiwa work visa",
  "#Manpower #SaudiArabia #Workforce #Qiwa",
  "Message us",
  "One image: an infographic bar showing days per stage (illustrative, labelled as such).",
  "Evergreen B2B", "Ops to confirm the process steps match our actual workflow.")

P(11, "20:30", "IG", "Static 4:5", "MOM", "11.11: 11 bookings, 11 upgrades",
  "11.11 · 11 bookings · 11 upgrades",
  "11.11 · The first 11 bookings get an upgrade on us", "١١.١١ · أول ١١ حجز… الترقية علينا",
  "١١.١١ ✨\nأول ١١ حجز اليوم: ترقية علينا (غرفة أعلى، توصيل خاص، أو تشيك آوت متأخر).\nبدون أكواد. بس قل «١١» على الواتساب.",
  "11.11. The first 11 bookings today get an upgrade on us: a better room, a private transfer or late checkout. No codes. Just say '11' on WhatsApp.",
  "عروض ١١.١١, عروض سفر",
  "#عروض_سفر #١١_١١ #مادا #MadaTrips #الرياض",
  "WhatsApp '11'",
  "Typographic poster: huge '11.11' in gold on green, a short line, symbol. Story version with a countdown sticker.",
  "11.11 Singles Day / ~1 Jumada II", "OFFER: management approval + terms (valid today only, subject to availability).")

P(11, "21:00", "TT", "Video 20s", "MOM", "11.11: what an 'upgrade' means",
  "On-screen: وش يعني «ترقية» عندنا؟ 👇",
  "What 'upgrade' means at Mada", "وش يعني «ترقية» عندنا",
  "اليوم بس: أول ١١ حجز ياخذون ترقية ✨ قل «١١» على الواتساب.",
  "Today only: the first 11 bookings get an upgrade. Say '11' on WhatsApp.",
  "عروض ١١.١١",
  "#١١_١١ #عروض_سفر #سفر #السعودية #مادا",
  "WhatsApp '11'",
  "Three quick reveals: the room view, the private car door, the 'late checkout' sign. Fun, fast.",
  "11.11", "OFFER approval.")

P(11, "12:00", "X", "Post", "MOM", "11.11 live",
  "١١.١١ بدأ ✨",
  "", "",
  "١١.١١ بدأ ✨ أول ١١ حجز اليوم ياخذون ترقية علينا.\nقل «١١» على الواتساب ‎+966 56 668 2662",
  "11.11 is live. The first 11 bookings today get an upgrade. Say '11' on WhatsApp.",
  "عروض ١١.١١",
  "#١١_١١",
  "WhatsApp",
  "Poster image.",
  "11.11", "Post 'all 11 gone' update once claimed (scarcity proof).")

P(12, "19:30", "IG", "Carousel 7", "HOR", "Weekend Radar #2",
  "Slide 1: Weekend Radar · 12-14 Nov",
  "Weekend Radar · 12-14 Nov", "رادار الويكند · ١٢–١٤ نوفمبر",
  "رادار الويكند 📡\n• آخر ويكند لمهرجان سماء العلا (لين ١٥ نوفمبر)\n• موسم الرياض: سهرة بوليفارد سيتي\n• سباقات الخيل بميدان الملك عبدالعزيز\n• الأحد ١٥: ذروة شهب الأسد 🌠",
  "Weekend Radar: the last weekend of AlUla Skies, a night at Boulevard City, racing at King Abdulaziz Racecourse, and the Leonids peak on Sunday 15.",
  "فعاليات الرياض هالويكند, Riyadh this weekend",
  "#رادار_الويكند #موسم_الرياض #فعاليات_الرياض #الرياض #مادا",
  "Save + share",
  "Weekend Radar template.",
  "Weekend", "", series="Weekend Radar")

P(12, "21:30", "IG", "Reel 35s", "HOR", "Vienna in winter: 3 days",
  "Snow falling on a Vienna market + text: 'Europe's winter markets open this week'",
  "Vienna in winter · 3 days", "فيينا في الشتاء · ٣ أيام",
  "أسواق الشتاء في أوروبا بدأت تفتح ❄️ أولها فيينا.\n٣ أيام: القصور، المقاهي القديمة، والأسواق المضيئة بالليل.\nسلسلة «شتاء أوروبا» تبدأ اليوم.",
  "Europe's winter markets are opening, starting with Vienna. 3 days: palaces, old cafés and lit-up markets at night. Our 'Europe in Winter' series starts today.",
  "فيينا في الشتاء, سفر أوروبا شتاء, Vienna winter trip",
  "#فيينا #شتاء_أوروبا #سفر #النمسا #مادا",
  "Save for your winter trip",
  "Itinerary reel: Day 1/2/3 chapters with on-screen times. Halal food tip + a prayer-friendly note (useful for the audience). Licensed or original footage only.",
  "Vienna Schönbrunn market from 6 Nov · Rathausplatz ~13 Nov", "Use licensed stock or creator footage under a Collab post, never reposts.",
  series="Europe in Winter")

P(12, "20:00", "TT", "Video 50s", "HOR", "Europe this winter: 5 cities ranked for families",
  "On-screen: رتبنا ٥ مدن أوروبية للشتاء مع العائلة 👨‍👩‍👧",
  "5 European winter cities, ranked for families", "٥ مدن أوروبية للشتاء مع العائلة",
  "رتبنا لك ٥ مدن أوروبية للشتاء مع العائلة 🇪🇺❄️\nتوافقنا ولا لا؟ 👇",
  "We ranked 5 European cities for a family winter trip. Agree or not?",
  "سفر اوروبا شتاء, افضل مدن اوروبا للعائلات, Europe winter family",
  "#شتاء_أوروبا #سفر_عائلي #أوروبا #سفر #مادا",
  "Comment your ranking",
  "Tier-list format (a trending structure): Vienna, Prague, Strasbourg, London, Salzburg, with criteria: walkability, halal food, flight time from Riyadh, kid-friendliness. Green-screen.",
  "Europe winter markets")

P(12, "22:00", "TT", "Video reply 30s", "KNOW", "Reply: how long does a Schengen visa take?",
  "Reply-to-comment sticker on screen",
  "How long does Schengen take?", "كم ياخذ فيزا شنغن؟",
  "رد على سؤالكم: كم ياخذ فيزا شنغن؟ ⏳",
  "Answering your question: how long does a Schengen visa take?",
  "كم ياخذ فيزا شنغن, مدة تأشيرة شنغن",
  "#تأشيرة_شنغن #فيزا #سفر #مادا #السعودية",
  "Ask your next question",
  "Use TikTok's 'reply with video' on a real comment from the 2 Nov post. Concierge answers in 30s: up to 15 days standard after the appointment, longer in peak season. Book appointments early.",
  "Week 1 comments", "Pick a real question. If none, use one from DMs (anonymised).",
  series="Visa in 60")

P(12, "13:00", "X", "Thread 6", "HOR", "Europe's winter markets 2026: opening dates",
  "أسواق الشتاء في أوروبا ٢٠٢٦: متى تفتح؟ 🧵❄️",
  "", "",
  "١/ أسواق الشتاء في أوروبا ٢٠٢٦: متى تفتح؟ 🧵\n٢/ فيينا (قصر شونبرون): من ٦ نوفمبر\n٣/ لندن (Winter Wonderland هايد بارك): من ١٩ نوفمبر\n٤/ ستراسبورغ: من ٢٦ نوفمبر\n٥/ براغ: من آخر نوفمبر\n٦/ تبي برنامج كامل مع الفيزا والفنادق؟ كلمنا.",
  "1/ Europe's winter markets 2026, opening dates. 2/ Vienna (Schönbrunn): from 6 Nov. 3/ London (Hyde Park Winter Wonderland): from 19 Nov. 4/ Strasbourg: from 26 Nov. 5/ Prague: from late Nov. 6/ Want a full plan with visa and hotels? Talk to us.",
  "اسواق اوروبا الشتوية",
  "#شتاء_أوروبا",
  "Bookmark / DM",
  "Image on tweet 1.",
  "Europe winter", "Double-check dates against official market sites.", series="Europe in Winter")

P(12, "09:30", "LI", "Post (founder voice)", "ONE", "Why we answer at 3 a.m.",
  "The most important call we took last month came at 3:12 a.m.",
  "", "",
  "",
  "The most important call we took last month came at 3:12 a.m.\n\nA client's connection was cancelled at an airport six time zones away. The airline desk was closed. He had a meeting in Riyadh at 10.\n\nBy 3:40 he had a new route, a lounge and a car waiting at the other end.\n\nWe don't think of that as heroics. In travel, the moments that matter rarely happen during office hours. So we built a team that doesn't keep office hours.\n\nThat's the whole idea behind Mada: one call, at any hour, and everything moves.",
  "corporate travel management, travel concierge Riyadh",
  "#CorporateTravel #CustomerExperience #Riyadh",
  "Follow the page",
  "Post from the founder's profile; the company page reshares. A plain-text post with one candid team photo.",
  "Evergreen", "Use a real (anonymised) case.")

P(13, "20:30", "IG", "Reel 30s", "ONE", "Small things we do that nobody asks for",
  "On-screen: Things we do that nobody asks for 🤍",
  "Small things nobody asks for", "أشياء صغيرة محد يطلبها",
  "اليوم العالمي للطف 🤍\nأشياء صغيرة نسويها بدون ما أحد يطلبها:\nكرسي متحرك جاهز لأمك عند البوابة، كرت بأوقات الصلاة في غرفتك، شاحن بالسيارة، وكلمة ترحيب بخط اليد.",
  "World Kindness Day. Small things we do without being asked: a wheelchair waiting for your mother at the gate, a prayer-times card in your room, a charger in the car, a handwritten welcome note.",
  "خدمة عملاء, ضيافة, travel concierge",
  "#اليوم_العالمي_للطف #مادا #ضيافة #MadaTrips #سفر",
  "Share with someone who deserves this treatment",
  "Soft, slow close-ups of each gesture with handwritten-style labels. Piano or oud, gentle. Ends on the 'Horizon Card': a calligraphy welcome card that becomes our signature.",
  "World Kindness Day (13 Nov)", "Launches the 'Horizon Card' signature gesture. Ops must actually do it from now on.")

P(13, "21:00", "TT", "Video 25s", "ONE", "Things we do without being asked",
  "On-screen: أشياء نسويها لعملاءنا… بدون ما يطلبونها 🤍",
  "Things we do without being asked", "نسويها بدون ما تطلبها",
  "أشياء صغيرة… بس تفرق 🤍 وش أكثر شي لطيف صار لك بسفرة؟",
  "Small things that make a difference. What's the kindest thing that happened to you on a trip?",
  "خدمة عملاء سفر",
  "#اليوم_العالمي_للطف #سفر #مادا #السعودية #لطف",
  "Comment your story",
  "List format with a trending soft sound, one gesture per 4s.",
  "World Kindness Day")

P(13, "17:30", "X", "Post", "MOM", "World Kindness Day question",
  "أحلى موقف لطيف صار لك من غريب وأنت مسافر؟",
  "", "",
  "اليوم العالمي للطف 🤍\nوش أحلى موقف لطيف صار لك من شخص غريب وأنت مسافر؟",
  "World Kindness Day. What's the kindest thing a stranger did for you while travelling?",
  "",
  "#اليوم_العالمي_للطف",
  "Reply",
  "Text only. Quote-post the best replies through the day.",
  "World Kindness Day", "Post after Asr, not during Friday prayer.")

P(14, "20:00", "IG", "Carousel 8", "HOR", "Autumn break: 6 trips without a long flight",
  "Slide 1: Autumn break starts 20 Nov. 6 trips that don't need a long flight.",
  "Autumn break · 6 short trips", "إجازة الخريف · ٦ رحلات قريبة",
  "إجازة الخريف تبدأ ٢٠ نوفمبر 🍂\n٦ رحلات ما تحتاج طيران طويل:\nالعلا · دبي (القرية العالمية) · القاهرة · إسطنبول · باكو (بدون فيزا) · تبليسي\nاحفظ وأرسله لأهلك 📌",
  "The autumn break starts 20 November. 6 trips without a long flight: AlUla, Dubai (Global Village), Cairo, Istanbul, Baku (visa-free), Tbilisi. Save and send to your family.",
  "اجازة الخريف, وين نسافر في الاجازة, رحلات قريبة من الرياض",
  "#إجازة_الخريف #سفر_عائلي #إسطنبول #باكو #مادا",
  "Save + send to the family group",
  "One destination per slide: real photo, flight/drive time from Riyadh, 'best for' tag (families, couples, nature). Last slide: 'We still have dates. WhatsApp'.",
  "School autumn break 20-28 Nov", "Ops to confirm availability before posting.")

P(14, "21:00", "TT", "Video 35s", "HOR", "Autumn break in 6 days: 5 nearby escapes",
  "On-screen: باقي ٦ أيام على الإجازة ومافي خطة؟ 😅",
  "6 days to the break. No plan?", "باقي ٦ أيام ومافي خطة؟",
  "باقي ٦ أيام على إجازة الخريف ومافي خطة؟ 😅 هذي ٥ أماكن قريبة تلحق تحجزها 👇",
  "6 days to the autumn break and no plan? Here are 5 nearby places you can still book.",
  "اجازة الخريف ١٤٤٨, وين اسافر في الاجازة القصيرة",
  "#إجازة_الخريف #سفر #السعودية #وين_نسافر #مادا",
  "Comment 'خطة' for a plan in DM",
  "Relatable opener (a panicked family group chat), then a fast 5-destination list with flight times.",
  "Autumn break countdown")

P(14, "13:00", "X", "Post", "HOR", "Autumn break countdown",
  "باقي ٦ أيام على إجازة الخريف 🍂",
  "", "",
  "باقي ٦ أيام على إجازة الخريف 🍂\nوين ناوين؟",
  "6 days to the autumn break. Where are you heading?",
  "اجازة الخريف",
  "#إجازة_الخريف",
  "Reply",
  "Text only.",
  "Autumn break")

# ───────────────────────── WEEK 3 · 15–21 Nov · CITYSCAPE + BREAK BEGINS ─────────────────────────

P(15, "21:00", "TT", "Video 20s", "HOR", "Where to see the meteors near Riyadh",
  "On-screen: الليلة الشهب 🌠 وين تشوفها قرب الرياض؟",
  "Meteors tonight. Where near Riyadh?", "الشهب الليلة… وين قرب الرياض؟",
  "الليلة ذروة شهب الأسد 🌠 وين تشوفها قرب الرياض؟ 👇",
  "The Leonids peak tonight. Where to see them near Riyadh.",
  "وين اشوف الشهب الرياض, شهب الاسد",
  "#شهب_الأسد #الرياض #رصد_النجوم #كشتة #مادا",
  "Comment if you're going out",
  "Map pop-ups: Edge of the World direction, the desert north of the city, the Thumamah area. Note: go with a group and tell someone your route.",
  "Leonids 15 Nov", "Safety line on screen.")

P(15, "12:00", "X", "Post", "HOR", "Leonids alert",
  "الليلة ذروة شهب الأسد 🌠",
  "", "",
  "الليلة ذروة شهب الأسد 🌠\nأفضل وقت بعد منتصف الليل، بعيد عن أنوار المدينة. شاركونا صوركم بالرد.",
  "The Leonids peak tonight. Best after midnight, away from city lights. Share your photos in the replies.",
  "شهب الاسد",
  "#شهب_الأسد",
  "Reply with photos",
  "Text + one photo.",
  "Leonids")

P(15, "09:30", "LI", "Document 6 pages", "BIZ", "Cityscape Global week: visitor logistics",
  "Page 1: Flying in for Cityscape Global (16-19 Nov)? Read this first.",
  "Cityscape Global 2026: the visitor's brief", "",
  "",
  "Cityscape Global opens tomorrow at the Riyadh Exhibition & Convention Centre, Malham (16-19 Nov, 12:00-22:00).\n\nIf your team is flying in, our brief:\n• Malham is a drive from central Riyadh, so plan transfers by session, not by hotel\n• Stay where your evening meetings are\n• Doors open at noon, so use mornings for meetings\n• Visitors must be 18+\n• Book return transfers for 22:00, when everyone leaves at once\n\nNeed rooms, cars or a meeting space during the show? We still have capacity.",
  "Cityscape Global 2026, Riyadh exhibition travel, corporate transfers Riyadh",
  "#CityscapeGlobal #Riyadh #RealEstate #BusinessTravel",
  "DM for rooms or transfers",
  "Short document: map graphic, timeline, tips. Brand colours.",
  "Cityscape Global 16-19 Nov", "Ops to confirm capacity before 'we still have capacity'.")

P(16, "20:30", "IG", "Carousel 8", "KNOW", "Hosting guests from abroad: a Saudi hospitality guide",
  "Slide 1: Guests coming to Saudi? 7 things they'll love to know.",
  "Hosting guests in Saudi: 7 things to tell them", "ضيوفك جايين السعودية؟ ٧ أشياء قلها لهم",
  "اليوم الدولي للتسامح 🤝\nجايك ضيوف من برا؟ أرسل لهم هذا الدليل: القهوة السعودية، اللبس، أوقات الصلاة، الجمعة، البقشيش، الترحيب، والأكل.\n(The guide is in English for your guests 👇)",
  "International Day for Tolerance. Guests coming from abroad? Send them this: Saudi coffee, what to wear, prayer times, Fridays, tipping, greetings and food.",
  "Saudi etiquette for visitors, Saudi Arabia travel tips, ضيافة سعودية",
  "#SaudiArabia #VisitSaudi #ضيافة #مادا #Riyadh",
  "Send to your guests",
  "Bilingual, English-led slides, so Saudi followers can forward them to foreign guests. Warm illustration style: a dallah, a finjan, a prayer-time clock.",
  "International Day for Tolerance (16 Nov) · Cityscape visitors")

P(16, "21:00", "TT", "Video 30s (English)", "KNOW", "Saudi coffee etiquette in 30 seconds",
  "On-screen: Never do THIS with Saudi coffee ☕ (shake gesture)",
  "Saudi coffee: the shake rule", "القهوة السعودية: سالفة الهز",
  "Saudi coffee etiquette in 30 seconds ☕ Did you know the shake? / تعرف سالفة هز الفنجال؟",
  "Saudi coffee etiquette in 30 seconds. Did you know about the shake?",
  "Saudi coffee etiquette, Saudi culture, القهوة السعودية",
  "#SaudiCoffee #SaudiArabia #Riyadh #القهوة_السعودية #مادا",
  "Follow for more Saudi tips",
  "English-led TikTok for expats and visitors (one a week). The host pours: right hand, small amounts, shake the cup when you're done. A playful tone.",
  "Tolerance Day · inbound visitors")

P(16, "13:00", "X", "Thread 4", "BIZ", "Cityscape Global: visitor tips",
  "رايح سيتي سكيب جلوبال؟ ٤ نصايح 🧵",
  "", "",
  "١/ رايح سيتي سكيب جلوبال (١٦–١٩ نوفمبر، ملهم)؟ ٤ نصايح 🧵\n٢/ الأبواب تفتح ١٢ الظهر، فخل الصباح لاجتماعاتك.\n٣/ المعرض بعيد عن وسط الرياض، فاحسب وقت الطريق.\n٤/ الكل يطلع ١٠ بالليل، فاحجز رجعتك من بدري. نقدر نرتب لك السيارة.",
  "1/ Going to Cityscape Global (16-19 Nov, Malham)? 4 tips. 2/ Doors open at noon, so keep mornings for meetings. 3/ It's a drive from central Riyadh. 4/ Everyone leaves at 10pm, so book your ride home early. We can arrange the car.",
  "سيتي سكيب ٢٠٢٦",
  "#سيتي_سكيب",
  "DM",
  "Text thread.",
  "Cityscape Global")

P(17, "20:30", "IG", "Reel 40s", "ONE", "One Call #2: a family of 7, 48 hours to plan",
  "Voice note: 'نبي نسافر الإجازة… سبعة أشخاص… وما حجزنا شي' 😅",
  "7 people. 48 hours. Done.", "٧ أشخاص. ٤٨ ساعة. تم.",
  "عائلة من ٧ أشخاص، باقي ٤٨ ساعة على الإجازة، وما حجزوا شي 😅\nهذي كيف خلصناها 👇 «مكالمة وحدة» الحلقة ٢",
  "A family of 7, 48 hours to the break, nothing booked. Here's how we did it. 'One Call', episode 2.",
  "حجز رحلة عائلية, باقات عائلية, family trip planning",
  "#مكالمة_وحدة #إجازة_الخريف #سفر_عائلي #مادا #MadaTrips",
  "Comment your request for episode 3",
  "Same split-screen format as #1, with a checklist ticking on screen: 2 rooms connecting, child seats in the car, aisle seats together, halal-friendly restaurants. No children's faces.",
  "Autumn break", "No children on camera (GAMR guidance). Show hands, luggage, backs.",
  series="One Call")

P(17, "18:00", "X", "Poll", "HOR", "Autumn break: where?",
  "إجازة الخريف وين؟",
  "", "",
  "إجازة الخريف وين؟ 🍂",
  "Autumn break: where?",
  "اجازة الخريف",
  "#إجازة_الخريف",
  "Vote",
  "Poll: 🇸🇦 داخل المملكة / 🌴 خليجي / ✈️ أبعد / 🏠 البيت وموسم الرياض",
  "Autumn break")

P(17, "09:30", "LI", "Document 8 pages", "BIZ", "Field Notes #2: why delegates remember logistics, not keynotes",
  "Page 1: Ask a delegate about your summit a month later. They'll describe the airport.",
  "Delegates remember the airport", "",
  "",
  "Field Notes #2.\n\nAsk a delegate about your summit a month later. They rarely quote the keynote. They describe the airport, the car, the room and whether anyone knew their name.\n\nThat's why we plan events and travel as one plan:\n• Arrival waves timed to the agenda\n• Hotel check-in waiting at registration\n• One WhatsApp line for every guest\n• A host team that sees every status live\n\nThe event starts at the gate.",
  "event and travel management, delegate experience, MICE Saudi",
  "#FieldNotes #EventProfs #MICE #Riyadh",
  "Comment / share with your events lead",
  "PDF: a guest journey map across pages (gate → car → hotel → venue → home).",
  "Evergreen B2B", "", series="Field Notes")

P(18, "20:30", "IG", "Static 4:5", "KNOW", "Schengen document checklist (save-worthy)",
  "Save this before your appointment.",
  "Schengen checklist: 9 documents", "شنغن: ٩ أوراق لا تنساها",
  "قبل موعد الفيزا: ٩ أوراق لا تنساها 📌\nاحفظ المنشور وارجع له يوم الموعد.",
  "Before your visa appointment: 9 documents not to forget. Save this and come back to it on the day.",
  "اوراق فيزا شنغن, متطلبات تأشيرة شنغن, Schengen documents",
  "#تأشيرة_شنغن #فيزا #أوروبا #سفر #مادا",
  "Save",
  "Clean checklist poster, 9 lines with tick boxes, AR main + small EN. Designed to be screenshotted.",
  "Evergreen visa", "Requirements vary by embassy, so keep it general and say 'check your embassy's list'.",
  series="Visa in 60")

P(18, "21:00", "TT", "Video 45s", "KNOW", "US visa: book your interview early",
  "On-screen + VO: مسافر أمريكا ٢٠٢٧؟ احجز موعدك الحين ⏳",
  "US visa: book the interview now", "فيزا أمريكا: احجز المقابلة الحين",
  "مسافر أمريكا السنة الجاية؟ ليش لازم تحجز موعد المقابلة من الحين ⏳👇",
  "Travelling to the US next year? Why you should book your interview now.",
  "فيزا امريكا, موعد السفارة الامريكية, US visa Saudi",
  "#فيزا_أمريكا #أمريكا #تأشيرة #سفر #مادا",
  "Save",
  "Concierge explains: most interview waivers ended in Sep 2025, so more people need an in-person interview and wait times vary. A visa integrity fee has applied since Oct 2025 (amount on screen as announced). Book early.",
  "Evergreen visa", "Verify on the US Embassy Riyadh site; describe the fee as 'announced', with the amount as published.",
  series="Visa in 60")

P(18, "12:30", "X", "Post", "ONE", "Routes update (conditional)",
  "تحديث الرحلات الدولية من الرياض ✈️",
  "", "",
  "تحديث: شركات طيران أوروبية تعيد جدولة رحلاتها للرياض هالشهر.\nإذا عندك حجز تأثر أو تبي بدائل، فريقنا يتابع التحديثات أول بأول. كلمنا.",
  "Update: European airlines are rescheduling their Riyadh services this month. If your booking was affected or you need alternatives, our team tracks updates daily.",
  "تحديثات الطيران",
  "",
  "DM",
  "Text only, factual.",
  "Lufthansa's planned return (18 Nov)", "SENSITIVITY: only post confirmed facts from the airline itself. Skip if nothing is confirmed.")

P(19, "19:30", "IG", "Carousel 7", "HOR", "Weekend Radar #3: break edition",
  "Slide 1: Weekend Radar · Break edition",
  "Weekend Radar · Break edition", "رادار الويكند · نسخة الإجازة",
  "رادار الويكند: نسخة الإجازة 🍂\n• موسم الرياض للعائلة: ونستر غاردن وبوليفارد وورلد\n• الكشتة: الجو صار مناسب\n• مسقط: اليوم الوطني العماني ٢٠ نوفمبر\n• لندن: Winter Wonderland يفتح اليوم",
  "Weekend Radar, break edition: Riyadh Season for families, desert camping weather is here, Oman National Day in Muscat, and London's Winter Wonderland opens today.",
  "فعاليات الاجازة, وش نسوي في الاجازة",
  "#رادار_الويكند #إجازة_الخريف #موسم_الرياض #الرياض #مادا",
  "Save + share",
  "Weekend Radar template, autumn tint.",
  "School break starts 20 Nov", "", series="Weekend Radar")

P(19, "21:30", "IG", "Reel 35s", "HOR", "London in winter: ETA + Winter Wonderland + 4 more",
  "Text over a London skyline: 'London in winter, done right'",
  "London in winter · done right", "لندن في الشتاء · صح",
  "لندن في الشتاء ❄️ Winter Wonderland فتح اليوم.\n٦ أشياء نسويها لعملاءنا هناك، وأولها: الـETA قبل الحجز.",
  "London in winter. Winter Wonderland opens today. 6 things we arrange for our clients there, starting with the ETA before booking.",
  "لندن في الشتاء, Winter Wonderland London, سفر لندن",
  "#لندن #شتاء_أوروبا #بريطانيا #سفر #مادا",
  "Save",
  "List reel: ETA, Hyde Park Winter Wonderland, a West End matinee, a halal afternoon tea, a Harrods window walk, day trip to the Cotswolds. Collab with a London-based Saudi creator if possible.",
  "Winter Wonderland opens 19 Nov", "Collab creator must hold a Mawthooq licence if paid.",
  series="Europe in Winter")

P(19, "20:00", "TT", "Video 15s", "MOM", "Last workday before the break",
  "On-screen: آخر يوم دوام قبل الإجازة 😮‍💨",
  "Last day before the break", "آخر يوم قبل الإجازة",
  "آخر يوم دوام قبل الإجازة… الكل كذا؟ 😂",
  "Last workday before the break. Is everyone like this?",
  "اجازة الخريف",
  "#إجازة_الخريف #دوام #السعودية #ترند #مادا",
  "Tag a colleague",
  "Team meme on a trending sound: the clock at 13:59, then the whole team 'teleporting' out with suitcases. Relatable and real (TikTok Next 2026: 'Reali-TEA').",
  "Last school/work day before the break", "Keep it light. No mocking anyone (GAMR rules).")

P(19, "22:00", "TT", "Photo carousel 7", "KNOW", "Airport-day checklist",
  "Slide 1: مسافر بكرة؟ سوّ هذا الليلة ✅",
  "Flying tomorrow? Do this tonight", "مسافر بكرة؟ سوّ هذا الليلة",
  "مسافر بكرة؟ ٧ أشياء سوّها الليلة ✅",
  "Flying tomorrow? 7 things to do tonight.",
  "قائمة السفر, نصائح المطار",
  "#نصائح_سفر #إجازة_الخريف #سفر #مطار #مادا",
  "Save",
  "Checklist: online check-in, passport validity (6 months), ETA/visa copies, chargers, a pen for forms, arrival transfer confirmed, airline app notifications on.",
  "Break departures")

P(19, "13:00", "X", "Post", "ONE", "Last-minute break trips",
  "ما حجزت للإجازة؟ لسه فيه وقت.",
  "", "",
  "ما حجزت للإجازة؟ لسه فيه وقت ⏳\nعندنا خيارات داخلية وقريبة للويكند هذا. أرسل «إجازة» على الواتساب ونرد عليك خلال ساعة.",
  "Haven't booked for the break? There's still time. We have domestic and nearby options for this weekend. Send 'break' on WhatsApp and we'll reply within the hour.",
  "رحلات اللحظة الاخيرة",
  "#إجازة_الخريف",
  "WhatsApp",
  "Text only.",
  "Break", "Ops must confirm real availability before posting.")

P(19, "09:30", "LI", "Image + post", "ONE", "Horizon Keepers #1: meet our visa desk",
  "She has read more embassy checklists than anyone we know.",
  "Horizon Keepers · The visa desk", "",
  "",
  "Horizon Keepers #1: the visa desk.\n\nShe has read more embassy checklists than anyone we know. Her rule: 'Nobody should find out at the counter that a document is missing.'\n\nWhat the visa desk handles each week:\n• Schengen, UK ETA, US and Asia applications\n• Business visit visas for inbound delegates\n• Appointment hunting during peak season\n\nThe people behind the plan are the plan.",
  "visa services Riyadh, business visa Saudi",
  "#HorizonKeepers #TeamMada #Riyadh",
  "Follow",
  "A natural portrait at her desk (with consent), a quote overlay.",
  "Employer brand", "Consent from the team member. Use her first name if she's happy to.",
  series="Horizon Keepers")

P(20, "20:30", "IG", "Reel 25s", "MOM", "Break mode: ON",
  "A suitcase zips shut on the beat",
  "Break mode: ON", "وضع الإجازة: تشغيل",
  "وضع الإجازة: تشغيل 🍂✈️\nوين أول محطة لكم؟ شاركونا بقصصكم ومنشنوا @madatrips",
  "Break mode on. Where's your first stop? Share your stories and tag @madatrips.",
  "اجازة الخريف, سفر",
  "#إجازة_الخريف #سفر #مادا #MadaTrips #السعودية",
  "Tag us in your stories (UGC)",
  "Fast montage, beat-synced: zips, passports, car doors, boarding, a hotel door, the first view. Clients' footage only with written consent. No kids' faces.",
  "Autumn break starts 20 Nov")

P(20, "21:00", "TT", "Video 45s", "HOR", "Muscat in 48 hours",
  "On-screen: ساعتين طيران من الرياض… وهذا اللي ينتظرك 🇴🇲",
  "Muscat in 48 hours", "مسقط في ٤٨ ساعة",
  "اليوم الوطني العماني 🇴🇲 ومسقط قريبة… هذا برنامج ٤٨ ساعة 👇",
  "Oman National Day, and Muscat is close. Here's a 48-hour plan.",
  "مسقط سياحة, برنامج مسقط يومين, Muscat 48 hours",
  "#مسقط #عمان #إجازة_الخريف #سفر #مادا",
  "Comment 'مسقط' for the plan",
  "Itinerary chapters: Muttrah Corniche at sunset, the Grand Mosque in the morning, a boat trip, the souq. Respectful, warm wishes to Oman.",
  "Oman National Day (20 Nov) · break", "Check the National Day holiday date with Omani sources. Use respectful wording.")

P(20, "17:00", "X", "Post", "ONE", "Safe travels + 24/7 line",
  "مسافر اليوم؟ الله يحفظك.",
  "", "",
  "مسافر اليوم؟ الله يحفظك وترجع بالسلامة 🤍\nأي طارئ بالطريق، واتساب مادا شغال ٢٤/٧: ‎+966 56 668 2662",
  "Travelling today? Safe travels. For anything on the way, Mada's WhatsApp is open 24/7.",
  "",
  "#إجازة_الخريف",
  "Save the number",
  "Text only.",
  "Break departures", "After Friday prayer.")

P(21, "20:00", "IG", "Carousel 8", "HOR", "Kashta season: the desert camp checklist",
  "Slide 1: Kashta season is open. Here's the checklist we swear by.",
  "Kashta season · the checklist", "موسم الكشتة · القائمة الكاملة",
  "موسم الكشتة فتح 🔥🏜️\nالقائمة اللي نمشي عليها: من الحطب لين الكشاف، ونصايح الأمان اللي محد يقولها.\nاحفظها لأول كشتة.",
  "Kashta (desert camping) season is open. Our checklist from firewood to headlamps, plus the safety tips nobody tells you. Save it for your first camp.",
  "كشتة, قائمة الكشتة, مخيمات الرياض, desert camping Riyadh",
  "#كشتة #موسم_الكشتة #الرياض #البر #مادا",
  "Save + tag your kashta crew",
  "Photo-led slides: the setup, gear flat-lay, coffee corner, fire. Safety slide: tell someone your location, carry water and a spare tyre, check the weather, take your rubbish home.",
  "Desert camping season · break weekend")

# ───────────────────────── WEEK 4 · 22–30 Nov · BREAK, WHITE FRIDAY, DECEMBER ─────────────────────────

P(22, "20:30", "IG", "Reel 40s", "ONE", "Concierge Confessions #2: the 2am rebooking",
  "On-screen: 'The flight's cancelled.' 'OK. Give me 20 minutes.'",
  "02:00 · 20 minutes · new route", "٢ الفجر · ٢٠ دقيقة · مسار جديد",
  "رحلة ألغيت الساعة ٢ الفجر… و٢٠ دقيقة بعدها كان فيه مسار جديد، فندق، وسيارة تنتظر.\n«من دفتر الكونسيرج» الحلقة ٢",
  "A flight cancelled at 2 a.m., and 20 minutes later a new route, a hotel and a car waiting. 'Concierge Confessions', episode 2.",
  "الغاء رحلة وش اسوي, travel concierge",
  "#من_دفتر_الكونسيرج #مادا #سفر #MadaTrips #قصص_سفر",
  "Save + follow",
  "Same storytime format. Calm, reassuring tone. Focus on the fix, not the problem.",
  "Evergreen", "SENSITIVITY: no reference to the October attacks. Keep the story generic (weather, technical).",
  series="Concierge Confessions")

P(22, "09:30", "LI", "Document 7 pages", "BIZ", "Field Notes #3: 5 travel-policy clauses that save money in 2027",
  "Page 1: Most travel policies were written for 2019.",
  "5 travel-policy clauses for 2027", "",
  "",
  "Field Notes #3. Most corporate travel policies were written for a world that no longer exists.\n\n5 clauses we recommend for 2027:\n1. Book by default 21+ days ahead, with exceptions approved in one tap\n2. Flexible fares for any trip with a fixed meeting\n3. Preferred hotels near the work, not near the airport\n4. A single 24/7 line for disruptions\n5. Monthly reporting by project and cost centre\n\nWhich one would your finance team push back on?",
  "corporate travel policy, travel management company Saudi Arabia",
  "#FieldNotes #CorporateTravel #Procurement #Finance",
  "Comment",
  "PDF document, a policy-document look (numbered clauses, margins).",
  "Q4 budgeting season", "", series="Field Notes")

P(23, "20:30", "IG", "Carousel 8", "HOR", "Destination dupes: love X? try Y",
  "Slide 1: Love Switzerland? You might love this more (and it's closer).",
  "Destination dupes", "بدائل الوجهات",
  "تحب سويسرا؟ جرب جورجيا 🏔️\nتحب المالديف؟ جرب البحر الأحمر 🌊\nتحب الأندلس؟ جرب الدرعية 🏛️\nبدائل أقرب، وأحياناً أحلى. وش البديل اللي تقترحه؟",
  "Love Switzerland? Try Georgia. Love the Maldives? Try the Red Sea. Love Andalusia? Try Diriyah. Closer alternatives, sometimes better. What dupe would you suggest?",
  "بدائل سويسرا, البحر الاحمر بديل المالديف, destination dupes",
  "#سفر #البحر_الأحمر #جورجيا #الدرعية #مادا",
  "Comment your dupe",
  "Side-by-side split slides 'Love → Try'. Real photos. The 'dupe' structure is a strong save/share trigger.",
  "Trend: destination dupes")

P(23, "21:00", "TT", "Video 40s", "HOR", "Dupes: Switzerland? Try this",
  "On-screen: سويسرا غالية؟ 👀 جرب هذي",
  "Switzerland? Try this.", "سويسرا؟ جرب هذي",
  "بدائل الوجهات المشهورة… أقرب وأوفر 👀 أي واحد يستاهل؟",
  "Alternatives to famous destinations, closer and better value. Which one is worth it?",
  "بديل سويسرا, جورجيا في الشتاء, Gudauri",
  "#جورجيا #سفر #بدائل_سياحية #شتاء #مادا",
  "Comment 'worth it?'",
  "Green-screen 'this or that' with Gudauri snow (Georgia ski season opens around December), Red Sea, Diriyah.",
  "Trend: dupes")

P(23, "12:30", "X", "Thread 4", "KNOW", "Visa-free reminders: China & Russia",
  "دولتين تقدر تسافر لها بدون فيزا هالسنة 🧵",
  "", "",
  "١/ دولتين تقدر تسافر لها بجوازك السعودي بدون فيزا هالسنة 🧵\n٢/ الصين: دخول بدون تأشيرة ممدد لين ٣١ ديسمبر ٢٠٢٦\n٣/ روسيا: بدون تأشيرة من مايو ٢٠٢٦، لين ٩٠ يوم بالسنة\n٤/ تحقق من الشروط قبل الحجز، وتبي برنامج؟ كلمنا.",
  "1/ Two countries you can visit visa-free on a Saudi passport this year. 2/ China: visa-free entry extended to 31 Dec 2026. 3/ Russia: visa-free since May 2026, up to 90 days a year. 4/ Check the conditions before booking.",
  "بدون فيزا للسعوديين, الصين بدون تأشيرة",
  "#بدون_فيزا",
  "Bookmark",
  "Text thread.",
  "China visa-free window ends 31 Dec", "Verify both rules with the official embassy pages the week of posting.")

P(24, "20:30", "IG", "Reel 35s", "BIZ", "Behind the Curtain #2: a gala run to the second",
  "A show caller's voice: 'Standby cue 14… go.'",
  "Cue 14 · go", "الإشارة ١٤ · انطلق",
  "«استعداد… الإشارة ١٤… انطلق»\nكل حفل ناجح وراه شخص يمشي الفعالية بالثانية. «خلف الستارة» الحلقة ٢.",
  "'Standby… cue 14… go.' Behind every great gala is someone running it to the second. 'Behind the Curtain', episode 2.",
  "تنظيم حفلات الرياض, تنظيم حفل جوائز, gala event Riyadh",
  "#خلف_الستارة #تنظيم_فعاليات #حفلات #مادا #MadaEvents",
  "DM 'EVENT'",
  "Show-caller POV from the control desk: headset audio, a run-of-show sheet, cues hitting on stage. Real event footage.",
  "Evergreen events", "Needs our own event footage.", series="Behind the Curtain")

P(24, "21:00", "TT", "Video 45s", "ONE", "Day in the life of a Mada concierge",
  "On-screen: يوم كامل مع كونسيرج سفر بالرياض ☕📞",
  "A day with a Riyadh travel concierge", "يوم مع كونسيرج سفر بالرياض",
  "يوم كامل مع كونسيرج سفر بالرياض ☕📞 وش تتوقع أغرب طلب جانا؟",
  "A full day with a travel concierge in Riyadh. Guess the strangest request we've had?",
  "يومي في العمل, وظيفة كونسيرج, day in the life travel agent",
  "#يوم_في_حياتي #مادا #سفر #الرياض #DayInTheLife",
  "Guess in comments",
  "Vlog style, 8 time-stamped beats from 08:00 coffee to 23:00 'one more call'. Natural, lightly funny, real.",
  "Trend: day in the life / Reali-TEA")

P(24, "13:00", "X", "Post", "MOM", "White Friday teaser",
  "الجمعة البيضاء جاية… 👀",
  "", "",
  "الجمعة البيضاء جاية ٢٧ نوفمبر 👀\nردّ بـ«🤍» ونرسل لك العرض قبل الكل.",
  "White Friday is coming on 27 November. Reply with 🤍 and we'll send you the offer first.",
  "الجمعة البيضاء عروض سفر",
  "#الجمعة_البيضاء",
  "Reply 🤍",
  "Text only.",
  "White Friday 27 Nov", "Build an early-access list from the replies (DM each one on the day).")

P(24, "09:30", "LI", "Image + post", "BIZ", "Specialist supply: the expert you couldn't find",
  "The project needed one person. There were four in the region.",
  "The expert you couldn't find. Found.", "",
  "",
  "A client needed one specialist for a commissioning phase. There were maybe four people in the region with that exact certification, and all were booked.\n\nWe found the fifth, cleared the visa and had them on site in 11 days.\n\nSpecialist supply is about the network and the paperwork. One without the other doesn't work.\n\nIf your 2027 projects have roles you're already worried about, talk to us early.",
  "specialist recruitment Saudi Arabia, technical specialists KSA",
  "#SpecialistSupply #Engineering #SaudiArabia #Projects",
  "Message us",
  "One image: a minimalist search graphic (5 dots, one lit).",
  "Evergreen B2B", "Use a real case with numbers confirmed by ops.")

P(25, "20:30", "IG", "Static 4:5", "MOM", "White Friday: 2 days",
  "2 days.",
  "White Friday · 2 days", "الجمعة البيضاء · باقي يومين",
  "باقي يومين 🤍\nفعّل التنبيهات عشان ما يفوتك.",
  "Two days. Turn on notifications so you don't miss it.",
  "الجمعة البيضاء",
  "#الجمعة_البيضاء #عروض_سفر #مادا #MadaTrips #الرياض",
  "Turn on notifications",
  "Minimal: a big '2' in white on green, a soft sand texture. Story version with a countdown sticker (people can tap 'remind me').",
  "White Friday countdown")

P(25, "21:00", "TT", "Video 40s", "KNOW", "Travel myths: real or fake?",
  "On-screen: الحجز يوم الثلاثاء أرخص؟ 🤔 حقيقة ولا خرافة",
  "Travel myths: real or fake?", "خرافات السفر: حقيقة ولا لا؟",
  "٥ خرافات عن حجز السفر… كم وحدة كنت مصدقها؟ 😅",
  "5 myths about booking travel. How many did you believe?",
  "نصائح حجز طيران, ارخص وقت للحجز",
  "#نصائح_سفر #سفر #حجز_طيران #السعودية #مادا",
  "Comment your score /5",
  "Green-screen myth-busting with a ✅/❌ stamp: Tuesday booking, incognito mode, 'last minute is always cheaper', 'refundable is never worth it', 'one-way is always pricier'. Give the honest nuance.",
  "Evergreen")

P(25, "13:00", "X", "Thread 5", "KNOW", "Booking myths thread",
  "٥ خرافات عن حجز الطيران 🧵",
  "", "",
  "١/ ٥ خرافات عن حجز الطيران 🧵\n٢/ «الثلاثاء أرخص»: الأسعار تتغير حسب الطلب، مو حسب اليوم.\n٣/ «التصفح الخفي يرخص السعر»: ما فيه دليل قوي.\n٤/ «آخر لحظة دايم أرخص»: بمواسم الإجازات العكس غالباً.\n٥/ «المرن ما يستاهل»: إذا عندك اجتماع ثابت، يستاهل.",
  "1/ 5 myths about booking flights. 2/ 'Tuesday is cheaper': prices move with demand, not the day. 3/ 'Incognito lowers prices': no solid evidence. 4/ 'Last minute is always cheaper': in holiday peaks it's usually the opposite. 5/ 'Flexible isn't worth it': with a fixed meeting, it is.",
  "نصائح حجز طيران",
  "#نصائح_سفر",
  "Bookmark",
  "Text thread.",
  "Evergreen")

P(26, "19:30", "IG", "Carousel 7", "HOR", "Weekend Radar #4",
  "Slide 1: Weekend Radar · 26-28 Nov",
  "Weekend Radar · 26-28 Nov", "رادار الويكند · ٢٦–٢٨ نوفمبر",
  "رادار الويكند 📡\n• الجمعة: الجمعة البيضاء 🤍\n• الدوحة: جائزة قطر للفورمولا ١ (٢٧–٢٩)\n• ستراسبورغ: سوق الشتاء يفتح اليوم\n• آخر ويكند بالإجازة: موسم الرياض والكشتة",
  "Weekend Radar: White Friday, the F1 Qatar Grand Prix (27-29), Strasbourg's winter market opens today, and the last weekend of the break.",
  "فعاليات الويكند, F1 Qatar 2026",
  "#رادار_الويكند #موسم_الرياض #فورمولا1 #الرياض #مادا",
  "Save + share",
  "Weekend Radar template.",
  "F1 Qatar 27-29 Nov · White Friday", "Check F1 Qatar is going ahead (regional uncertainty reported).",
  series="Weekend Radar")

P(26, "21:30", "IG", "Reel 20s", "MOM", "White Friday tomorrow: how it works",
  "On-screen: Tomorrow. Here's how it works.",
  "White Friday · tomorrow", "الجمعة البيضاء · بكرة",
  "بكرة الجمعة البيضاء 🤍 كيف تستفيد:\n١ فعّل التنبيه ٢ جهز وجهتك وتواريخك ٣ أرسل «🤍» على الواتساب أول ما يبدأ.",
  "White Friday is tomorrow. Turn on notifications, have your destination and dates ready, and send 🤍 on WhatsApp when it starts.",
  "عروض الجمعة البيضاء سفر",
  "#الجمعة_البيضاء #عروض_سفر #مادا #سفر #الرياض",
  "Turn on notifications",
  "Three-step explainer with a phone-screen mockup. A simple loop.",
  "White Friday eve")

P(26, "20:00", "TT", "Video 30s", "HOR", "F1 Qatar weekend: Riyadh to Doha",
  "On-screen: أقل من ساعتين من الرياض… وأنت بالفورمولا ١ 🏎️",
  "Under 2 hours to F1", "أقل من ساعتين… وأنت بالفورمولا ١",
  "جائزة قطر الكبرى للفورمولا ١ هالويكند 🏎️ أقل من ساعتين طيران من الرياض. تلحق؟",
  "The F1 Qatar Grand Prix is this weekend, under 2 hours' flight from Riyadh. Can you make it?",
  "فورمولا ١ قطر, F1 Qatar 2026 tickets, لوسيل",
  "#فورمولا1 #قطر #F1 #سفر #مادا",
  "Comment 'ألحق'",
  "Countdown energy, a flight-path animation RUH → DOH, a quick package outline (flight, hotel, grandstand, transfers). No F1 broadcast footage.",
  "F1 Qatar GP 27-29 Nov", "Confirm the race status and ticket availability before posting. No F1 logos.")

P(26, "22:00", "TT", "Video 20s", "MOM", "White Friday preview",
  "On-screen: عرض بكرة… تلميح 👀",
  "A hint for tomorrow", "تلميح لعرض بكرة",
  "تلميح لعرض بكرة 👀 خمّن الوجهة.",
  "A hint for tomorrow's offer. Guess the destination.",
  "عروض الجمعة البيضاء",
  "#الجمعة_البيضاء #عروض_سفر #سفر #السعودية #مادا",
  "Guess in comments",
  "Blurred destination reveal with sound cues (waves? snow?). The comment guessing game boosts reach.",
  "White Friday eve")

P(26, "13:00", "X", "Post", "MOM", "White Friday rules",
  "بكرة الجمعة البيضاء 🤍 القوانين بسيطة:",
  "", "",
  "بكرة الجمعة البيضاء 🤍 القوانين بسيطة:\n• العرض يبدأ ٨ الصباح\n• محدود بعدد حجوزات\n• بدون أكواد، بس أرسل «🤍» على الواتساب\nاللي ردوا بـ🤍 أمس، يوصلكم قبل الكل.",
  "White Friday tomorrow. The offer starts at 8 a.m., limited bookings, no codes: just send 🤍 on WhatsApp. Those who replied yesterday get it first.",
  "الجمعة البيضاء",
  "#الجمعة_البيضاء",
  "Turn on notifications",
  "Text only.",
  "White Friday eve", "Final terms from management.")

P(26, "09:30", "LI", "Post", "BIZ", "Plan Q1 2027 events at 2026 rates",
  "Your Q1 2027 events will be planned in December. Here's an offer for doing it now.",
  "Q1 2027 events · 2026 rates", "",
  "",
  "Q1 2027 is going to be busy: the Saudi Cup in early February, then Ramadan from around 8 February.\n\nIf you're planning Q1 delegations, offsites or launches, confirm by 10 December and we'll hold 2026 service rates across travel, hotels and event production.\n\nOne brief, one plan, one invoice.",
  "event planning Q1 2027 Riyadh, corporate offsite Saudi Arabia",
  "#EventPlanning #Riyadh #CorporateEvents #MICE",
  "DM / email",
  "Text post + a simple Q1 timeline image (Saudi Cup 5-6 Feb, Ramadan ~8 Feb).",
  "B2B White Friday equivalent", "OFFER needs management approval.")

P(27, "08:00", "IG", "Carousel 5", "MOM", "White Friday: the offer",
  "Slide 1: White Friday is on.",
  "White Friday · Today only", "الجمعة البيضاء · اليوم فقط",
  "الجمعة البيضاء بدأت 🤍\n[تفاصيل العرض]\nاليوم فقط، والعدد محدود. أرسل «🤍» على الواتساب ‎+966 56 668 2662",
  "White Friday is on. [Offer details]. Today only, limited numbers. Send 🤍 on WhatsApp.",
  "عروض الجمعة البيضاء, عروض سفر, باقات سياحية",
  "#الجمعة_البيضاء #عروض_سفر #مادا #MadaTrips #باقات_سياحية",
  "WhatsApp 🤍",
  "Hero design: white-on-green, gold accent. Slide 1 offer, slides 2-4 three destination options with what's included (no strike-through 'was/now' unless legally verified), slide 5 terms + CTA.",
  "White Friday 27 Nov", "MANAGEMENT: final offer, terms and real prices. Lead with a global trip (e.g. Istanbul or Baku for the 8 Jan break), then a GCC hop (Dubai Shopping Festival) and one domestic option. Follow Saudi consumer-protection rules on discount claims (Ministry of Commerce).")

P(27, "21:00", "IG", "Reel 15s", "MOM", "White Friday: final hours",
  "On-screen: Final hours 🤍",
  "Final hours", "الساعات الأخيرة",
  "الساعات الأخيرة 🤍 أرسل «🤍» على الواتساب قبل منتصف الليل.",
  "Final hours. Send 🤍 on WhatsApp before midnight.",
  "عروض الجمعة البيضاء",
  "#الجمعة_البيضاء #عروض_سفر #مادا #سفر #الرياض",
  "WhatsApp",
  "A clock-hand loop over destination shots. Short and urgent, still calm.",
  "White Friday")

P(27, "21:30", "TT", "LIVE 30-45 min", "ONE", "White Friday LIVE: Ask the concierge",
  "LIVE title: اسأل الكونسيرج + عرض الجمعة البيضاء 🤍",
  "LIVE · Ask the concierge", "بث مباشر · اسأل الكونسيرج",
  "بث مباشر: اسألنا أي شي عن السفر، والفيز، والإجازات 🤍",
  "LIVE: ask us anything about travel, visas and breaks.",
  "عروض الجمعة البيضاء, نصائح سفر",
  "#الجمعة_البيضاء #بث_مباشر #سفر #مادا #السعودية",
  "Join the LIVE",
  "Two concierges, a ring light, questions answered live. Pin the WhatsApp number in a comment. Clip the best answers into next week's videos.",
  "White Friday", "TikTok LIVE needs at least 1,000 followers. If we're below that, post a 45s 'offer explained' video instead.")

P(27, "08:05", "X", "Post (pinned)", "MOM", "White Friday is live",
  "الجمعة البيضاء بدأت 🤍",
  "", "",
  "الجمعة البيضاء بدأت 🤍\n[تفاصيل العرض]\nاليوم فقط. أرسل «🤍» على الواتساب ‎+966 56 668 2662",
  "White Friday is live. [Offer details]. Today only. Send 🤍 on WhatsApp.",
  "الجمعة البيضاء عروض سفر",
  "#الجمعة_البيضاء",
  "WhatsApp",
  "Poster image. Pin for the day. DM everyone who replied 🤍 on 24 Nov.",
  "White Friday", "Management approval.")

P(28, "20:30", "IG", "Reel 30s", "MOM", "Break recap: where our clients went",
  "A map of Saudi lights up with dots",
  "Where you went this break", "وين رحتوا هالإجازة",
  "وين رحتوا هالإجازة؟ 🗺️ هذي الخريطة من رحلات عملاءنا (بإذنهم 🤍)\nشكراً إنكم سافرتوا معنا.",
  "Where you went this break: a map of our clients' trips (shared with permission). Thank you for travelling with us.",
  "اجازة الخريف, رحلات",
  "#إجازة_الخريف #مادا #سفر #MadaTrips #السعودية",
  "Share your trip in our DMs",
  "An animated map with dots popping (AlUla, Abha, Jeddah, Muscat, Baku, Tbilisi, London…) intercut with consented client clips. Warm thank-you ending.",
  "End of autumn break", "Written consent for every client clip. Aggregated data only.")

P(28, "21:00", "TT", "Video 15s", "MOM", "Last day of the break mood",
  "On-screen: آخر يوم إجازة 🥲",
  "Last day of the break", "آخر يوم إجازة",
  "آخر يوم إجازة… من معي؟ 🥲",
  "Last day of the break. Who's with me?",
  "اجازة الخريف",
  "#إجازة_الخريف #آخر_يوم_إجازة #السعودية #ترند #مادا",
  "Tag someone",
  "A relatable trend audio: the team unpacking slowly, alarm-clock dread. Light.",
  "Last day of break")

P(28, "18:00", "X", "Post", "ONE", "How was your trip?",
  "رجعت من الإجازة؟",
  "", "",
  "رجعت من الإجازة؟ 🍂\nقيّم رحلتك من ١٠ بالرد، ووش الشي اللي كان ودك يكون أسهل؟ نقرأ كل رد.",
  "Back from the break? Rate your trip out of 10 in the replies. What do you wish had been easier? We read every reply.",
  "",
  "#إجازة_الخريف",
  "Reply",
  "Text only.",
  "End of break", "Collect insights for December content.")

P(29, "20:30", "IG", "Carousel 8", "KNOW", "Rajab starts 10 Dec: plan your Umrah calmly",
  "Slide 1: Rajab begins in 11 days. A calm way to plan your Umrah.",
  "Rajab · plan your Umrah calmly", "رجب · خطط لعمرتك بهدوء",
  "يبدأ شهر رجب ١٠ ديسمبر بإذن الله 🤍\nإذا ناوي عمرة رجب أو رمضان، هذي خطوات التخطيط بهدوء: التصريح عبر نسك، الفندق القريب، التنقل، ورعاية كبار السن.",
  "Rajab is expected to begin on 10 December. If you're planning Umrah in Rajab or Ramadan, here are the calm planning steps: the Nusuk permit, a nearby hotel, getting around, and care for elderly parents.",
  "عمرة رجب, باقات عمرة, تصريح عمرة نسك, Umrah package Riyadh",
  "#عمرة #عمرة_رجب #نسك #مكة #مادا",
  "Save + DM 'عمرة'",
  "Calm, respectful design: soft sand tones, no music on story versions, no salesy badges. One step per slide.",
  "1 Rajab 1448 ≈ 10 Dec 2026", "Religious accuracy check by a knowledgeable team member. Say 'expected' for Hijri dates.",
  series="Umrah, Step by Step")

P(29, "21:00", "TT", "Video 45s", "KNOW", "Umrah, step by step #1: before you go",
  "VO calm: ناوي عمرة؟ أول خطوة قبل أي حجز 👇",
  "Umrah: the first step before booking", "العمرة: أول خطوة قبل أي حجز",
  "ناوي عمرة؟ 🤍 أول خطوة قبل أي حجز: تصريح العمرة من تطبيق نسك. هذي الطريقة 👇",
  "Planning Umrah? The first step before any booking is the Umrah permit in the Nusuk app. Here's how.",
  "تصريح عمرة نسك, طريقة حجز عمرة, Umrah permit Nusuk",
  "#عمرة #نسك #تصريح_عمرة #مكة #مادا",
  "Save + follow the series",
  "A calm screen-record of the Nusuk app (no personal data) with VO. No music. A respectful, clear series opener.",
  "Rajab teaser", "Accuracy check against the current Nusuk flow. Series continues through December.",
  series="Umrah, Step by Step")

P(29, "13:00", "X", "Post", "KNOW", "Ramadan Umrah: book early",
  "رمضان ١٤٤٨ يبدأ تقريباً ٨ فبراير.",
  "", "",
  "رمضان ١٤٤٨ يبدأ تقريباً ٨ فبراير ٢٠٢٧ بإذن الله 🌙\nإذا ناوي عمرة رمضان، الفنادق القريبة من الحرم تمتلي بدري. ابدأ التخطيط من رجب.",
  "Ramadan 1448 is expected around 8 February 2027. If you plan Umrah in Ramadan, hotels near the Haram fill early. Start planning in Rajab.",
  "عمرة رمضان, فنادق قريبة من الحرم",
  "#عمرة_رمضان",
  "DM",
  "Text only.",
  "Ramadan 2027 ≈ 8 Feb", "Say 'expected', since it depends on moon sighting.")

P(29, "09:30", "LI", "Post", "ONE", "Our first month, in numbers",
  "30 days ago we opened our doors. Here's what we learned.",
  "Month one", "",
  "",
  "30 days ago Mada Trips opened its doors. What we learned:\n\n• The most common request wasn't a trip. It was 'Can you just handle it?'\n• Visa questions outnumbered every other topic\n• The best feedback was about a car that was waiting\n\n[Add real numbers: requests handled, trips, events, crews mobilised]\n\nThank you to every client and partner who trusted a new name. December is already moving.",
  "travel company Riyadh, startup Saudi Arabia",
  "#Riyadh #Startup #Travel #Events",
  "Follow",
  "One team photo.",
  "Month-end", "Fill in real numbers. Don't publish placeholders.")

P(30, "13:00", "X", "Post", "MOM", "Cyber Monday + December",
  "آخر عروض نوفمبر اليوم 🤍",
  "", "",
  "آخر يوم لعروض نوفمبر 🤍\nوخطط ديسمبر من الحين: رجب، فورمولا إي جدة، وإجازة منتصف العام ٨ يناير.\nكلمنا على الواتساب.",
  "Last day of November offers. And plan December now: Rajab, Formula E Jeddah and the mid-year break on 8 January.",
  "عروض سفر",
  "#عروض_سفر",
  "WhatsApp",
  "Text only.",
  "Cyber Monday / schools back", "Only if a Cyber Monday offer is approved; otherwise post the December line only.")


# ───────────────────────── WORLD HORIZONS · global trips and events (all month) ─────────────────────────

P(4, "18:00", "X", "Post", "WORLD", "Liverpool in Istanbul tonight",
  "ليفربول الليلة في إسطنبول… ٤ ساعات من الرياض ⚽",
  "", "",
  "ليفربول الليلة في إسطنبول ضد فنربخشة ⚽ (٨:٤٥ بتوقيت الرياض)\nإسطنبول على بعد ٤ ساعات بس. المرة الجاية تبيها من المدرجات؟ نرتبها لك: تذكرة، طيران، فندق.",
  "Liverpool play Fenerbahçe in Istanbul tonight (20:45 Riyadh time). Istanbul is only 4 hours away. Next time, want it from the stands? We arrange the ticket, flight and hotel.",
  "دوري أبطال أوروبا, ليفربول, إسطنبول, Champions League travel",
  "#دوري_أبطال_أوروبا",
  "Reply / DM",
  "Text + a clean graphic: RUH → IST, 4h. No UEFA or club logos.",
  "UCL MD4 (4 Nov)", "Confirm the kick-off time on uefa.com the day of posting. No UEFA/club logos.",
  series="Fly For It", sc="Global")

P(5, "21:30", "IG", "Reel 35s", "WORLD", "Fly For It: Arsenal v Real Madrid, London, 9 Dec",
  "Stadium roar in the first second, then text: 'Arsenal v Real Madrid. 9 December. You in?'",
  "Arsenal v Real Madrid · London · 9 Dec", "أرسنال × ريال مدريد · لندن · ٩ ديسمبر",
  "أكبر مباراة بدوري الأبطال قبل الكريسماس: أرسنال × ريال مدريد في لندن، ٩ ديسمبر ⚽\nخلّها أسبوع كرة: ديربي شمال لندن ٥ ديسمبر + المباراة + Winter Wonderland.\nنرتبها لك من الـETA للمدرج. أرسل «لندن» على الواتساب.",
  "The biggest Champions League game before Christmas: Arsenal v Real Madrid in London, 9 December. Make it a week of football: the North London derby on 5 Dec + the match + Winter Wonderland. We arrange it from the ETA to your seat. Send 'London' on WhatsApp.",
  "تذاكر ريال مدريد, رحلة مباراة لندن, دوري أبطال أوروبا تذاكر, Arsenal Real Madrid tickets",
  "#ريال_مدريد #دوري_أبطال_أوروبا #لندن #سفر #مادا",
  "WhatsApp 'لندن'",
  "Fan-voyage edit: crowd sound, London streets at night, a ticket mock-up 'Gate · Row · Seat', Winter Wonderland lights. Fast cuts on the beat. No match broadcast footage or club crests.",
  "UCL MD6 Arsenal v Real Madrid (9 Dec) · North London derby (5 Dec)", "Ticket availability through official/resale partners must be confirmed by ops before posting. No club logos or broadcast footage.",
  series="Fly For It", sc="Global")

P(5, "22:00", "TT", "Photo carousel 8", "WORLD", "Rate my itinerary: 7 days in Japan",
  "Slide 1: قيّم برنامجنا: ٧ أيام في اليابان 🇯🇵 (طيران مباشر من الرياض قريب!)",
  "Rate my itinerary: 7 days in Japan", "قيّم برنامجي: ٧ أيام في اليابان",
  "قيّم برنامجنا من ١٠ 🇯🇵 وش تضيف؟\nطوكيو ٣ أيام · كيوتو ٢ (موسم أوراق الخريف) · أوساكا ١ · جبل فوجي ١\nومن ١٧ نوفمبر فيه طيران مباشر من الرياض لطوكيو ✈️",
  "Rate our 7-day Japan itinerary: Tokyo 3, Kyoto 2 (autumn leaves season), Osaka 1, Mt Fuji 1. And from 17 November there's a nonstop from Riyadh to Tokyo.",
  "برنامج اليابان ٧ ايام, السفر لليابان من السعودية, Japan itinerary 7 days",
  "#اليابان #طوكيو #كيوتو #برنامج_سياحي #مادا",
  "Rate it in comments",
  "Photo Mode, one day per slide with big Arabic text, halal food tip on the Tokyo slide, prayer-room tip on the Kyoto slide.",
  "Saudia RUH-NRT nonstop from 17 Nov · Kyoto foliage", "", sc="Global")

P(6, "21:00", "TT", "Video 40s", "HOR", "Global Village: the 1h50 weekend",
  "On-screen: ويكند كامل برا السعودية… وأنت راجع السبت 👀",
  "Dubai weekend: Global Village", "ويكند دبي: القرية العالمية",
  "ساعة و٥٠ دقيقة من الرياض… والقرية العالمية فتحت موسمها الجديد 🎡\nخطة ويكند كامل بدبي، وترجع السبت.",
  "1h50 from Riyadh, and Global Village has opened its new season. A full Dubai weekend plan, home by Saturday.",
  "القرية العالمية دبي, ويكند دبي, Global Village Dubai 2026",
  "#القرية_العالمية #دبي #ويكند #سفر #مادا",
  "Comment 'دبي' for the plan",
  "Timeline: Thu night flight → Fri brunch → Global Village after Maghrib → Sat morning beach → home. Use our own or creator footage (Collab).",
  "Global Village season 31 (from 14 Oct)", "Check the airline is operating that week (some carriers were suspended in October).", sc="GCC")

P(8, "21:30", "IG", "Carousel 10", "WORLD", "World Radar #1: worth flying for, Nov-Dec",
  "Slide 1: The world's calendar, from Riyadh. 9 events worth flying for before New Year.",
  "World Radar · Nov-Dec", "رادار العالم · نوفمبر–ديسمبر",
  "رادار العالم 🌍 ٩ أحداث تستاهل السفرة قبل نهاية السنة:\n• ٢١ نوفمبر: افتتاح موسم التزلج في الألب\n• أواخر نوفمبر: ذروة أوراق الخريف في كيوتو\n• ٢٧–٢٩: فورمولا ١ قطر (ساعة و٢٠ من الرياض)\n• ٢٨: شاكيرا عند الأهرامات\n• ٣–٦ ديسمبر: ختام الفورمولا ١ في أبوظبي\n• من ٤ ديسمبر: مهرجان دبي للتسوق\n• ٨ ديسمبر: برشلونة × مانشستر سيتي\n• ٩ ديسمبر: أرسنال × ريال مدريد\n• ٣١ ديسمبر: ليلة رأس السنة بدبي أو لندن\nاحفظه، وقلنا وين تبي تكون 👇",
  "World Radar: 9 events worth flying for before New Year. Alps ski opening (21 Nov), Kyoto foliage peak (late Nov), F1 Qatar (27-29 Nov, 1h20 away), Shakira at the Pyramids (28 Nov), F1 Abu Dhabi finale (3-6 Dec), Dubai Shopping Festival (from 4 Dec), Barcelona v Man City (8 Dec), Arsenal v Real Madrid (9 Dec), New Year's Eve in Dubai or London. Save it and tell us where you want to be.",
  "فعاليات عالمية ديسمبر, وين اسافر ديسمبر, events worth travelling for",
  "#رادار_العالم #سفر #فعاليات_عالمية #دوري_أبطال_أوروبا #مادا",
  "Save + comment where you want to be",
  "Recurring template (every other Sunday): sand cover with a globe-sweep graphic. One event per slide: date, city, flight time from Riyadh, visa need (✓ / ETA / Schengen) and one tip. Last slide: 'One call. We'll get you there.'",
  "Global events Nov-Dec", "Re-check each date the day before posting (several Gulf events moved this season).",
  series="World Radar", sc="Global")

P(8, "19:00", "X", "Thread 6", "WORLD", "World Radar #1 on X",
  "رادار العالم 🌍 أحداث تستاهل السفرة قبل نهاية السنة 🧵",
  "", "",
  "١/ رادار العالم 🌍 أحداث تستاهل السفرة قبل نهاية السنة 🧵\n٢/ ٢٧–٢٩ نوفمبر: فورمولا ١ قطر. ساعة و٢٠ دقيقة من الرياض\n٣/ ٢٨ نوفمبر: شاكيرا عند أهرامات الجيزة. ساعتين ونص\n٤/ ٣–٦ ديسمبر: ختام الفورمولا ١ في أبوظبي + حفلات Yasalam\n٥/ ٨ و٩ ديسمبر: برشلونة × سيتي، وأرسنال × ريال مدريد\n٦/ من ٤ ديسمبر: مهرجان دبي للتسوق. أي وحدة تبي؟ نرتبها لك.",
  "1/ World Radar: events worth flying for before year end. 2/ F1 Qatar 27-29 Nov, 1h20 from Riyadh. 3/ Shakira at the Pyramids 28 Nov, 2h30. 4/ F1 Abu Dhabi finale 3-6 Dec + Yasalam concerts. 5/ 8 & 9 Dec: Barcelona v City, Arsenal v Real Madrid. 6/ Dubai Shopping Festival from 4 Dec. Which one? We'll arrange it.",
  "فعاليات عالمية",
  "#رادار_العالم",
  "Reply / DM",
  "Text thread, World Radar cover image on tweet 1.",
  "Global events", "", series="World Radar", sc="Global")

P(9, "20:30", "IG", "Carousel 10", "KNOW", "No visa (or almost) for Saudi passports this winter",
  "Slide 1: Your Saudi passport opens these doors this winter. No embassy visit needed.",
  "No visa needed this winter", "بدون فيزا هالشتاء",
  "جوازك السعودي يفتح لك هالدول هالشتاء بدون موعد سفارة 🇸🇦✈️\nتركيا · جورجيا · أذربيجان (لين ١٥ فبراير ٢٠٢٧) · روسيا · الصين (لين ٣١ ديسمبر) · ماليزيا · تايلند · المغرب · كازاخستان · المالديف (عند الوصول)\nاحفظها، وأرسلها لرفيق السفر 📌",
  "Your Saudi passport opens these doors this winter with no embassy visit: Türkiye, Georgia, Azerbaijan (until 15 Feb 2027), Russia, China (until 31 Dec), Malaysia, Thailand, Morocco, Kazakhstan, Maldives (on arrival). Save it and send it to your travel buddy.",
  "دول بدون فيزا للسعوديين, دول بدون تأشيرة للسعوديين ٢٠٢٦, visa free countries Saudi passport",
  "#بدون_فيزا #جواز_سعودي #سفر #السفر_مع_العائلة #مادا",
  "Save + share",
  "One country per slide: a real photo, flight time from Riyadh, stay allowed (e.g. 30 / 60 / 90 days), best month. Small footer on every slide: 'Rules change. Check before you book.'",
  "Evergreen + Azerbaijan (to 15 Feb 2027) and China (to 31 Dec) windows", "Ops to verify each country's rule the week of posting (sources: official MFA/embassy pages). High-share format ('دول بدون فيزا للسعوديين').",
  series="Visa in 60", sc="Global")

P(9, "21:00", "TT", "Video 45s", "WORLD", "Northern lights this winter: Lapland",
  "On-screen + VO: الشفق القطبي… مو حلم، هذا موعده 🌌",
  "Northern lights: when and where", "الشفق القطبي: متى ووين",
  "تبي تشوف الشفق القطبي هالشتاء؟ 🌌 وين، ومتى، وكم ليلة تحتاج عشان تزيد فرصتك 👇",
  "Want to see the northern lights this winter? Where, when, and how many nights you need to raise your chances.",
  "الشفق القطبي, لابلاند, روفانيمي, northern lights Lapland",
  "#الشفق_القطبي #لابلاند #فنلندا #شتاء #مادا",
  "Save + tag who you'd take",
  "Talking-head + aurora footage (licensed). Facts: season roughly Sep-Mar, best on clear dark nights, plan 3-4 nights, Rovaniemi has Santa Claus Village for kids. Schengen visa needed.",
  "Lapland / aurora season", "Licensed footage only. Say 'chances', never 'guaranteed'.",
  series="Winter Escapes", sc="Global")

P(10, "21:00", "TT", "Photo carousel 8", "WORLD", "What 5 days in Baku & Shahdag actually cost",
  "Slide 1: كم تكلف ٥ أيام في أذربيجان مع الثلج؟ 💸❄️",
  "Baku + snow: the real cost", "باكو والثلج: التكلفة الحقيقية",
  "كم تكلف ٥ أيام في أذربيجان مع الثلج؟ فصلناها لك 👇\nوأذربيجان بدون فيزا للسعوديين لين ١٥ فبراير ٢٠٢٧ ❄️\nالأسعار تقريبية لشخصين.",
  "What do 5 days in Azerbaijan with snow cost? Broken down for you. Azerbaijan is visa-free for Saudis until 15 Feb 2027. Approximate prices for two.",
  "تكلفة رحلة اذربيجان, باكو شاهداغ, اذربيجان بدون فيزا, Baku trip cost",
  "#أذربيجان #باكو #ثلوج #ميزانية_السفر #مادا",
  "Comment 'تفاصيل' for the plan in DM",
  "Photo Mode, one cost line per slide: flights, hotel (3 nights Baku + 1 Shahdag), transfers, ski pass/lessons, food. Total on the last slide. Transparent, no flexing.",
  "Azerbaijan visa-free window (to 15 Feb 2027)", "SALES must fill in real SAR ranges before posting.",
  sc="Global")

P(13, "13:00", "X", "Post", "WORLD", "Vienna's main winter market opens today",
  "سوق الشتاء في ساحة بلدية فيينا يفتح اليوم ❄️",
  "", "",
  "سوق الشتاء في ساحة بلدية فيينا يفتح اليوم ❄️ وموسم أسواق أوروبا رسمياً بدأ.\nلو تفكر بإجازة منتصف العام (٨ يناير)، هذا وقت حجز الشنغن.",
  "Vienna's Rathausplatz winter market opens today, and Europe's market season has officially begun. If you're thinking of the mid-year break (8 Jan), now is the time to book your Schengen appointment.",
  "فيينا في الشتاء, اسواق الشتاء اوروبا",
  "#شتاء_أوروبا",
  "DM",
  "One photo.",
  "Vienna Rathausplatz market (~13 Nov)", "Some sources say 15 Nov. Confirm before posting.",
  series="Europe in Winter", sc="Global")

P(15, "20:30", "IG", "Reel 30s", "WORLD", "Japan is now 10 hours away",
  "Text over a Kyoto maple-red frame: 'Riyadh → Tokyo. Nonstop. From 17 Nov.'",
  "Riyadh → Tokyo · nonstop · from 17 Nov", "الرياض ← طوكيو · مباشر · من ١٧ نوفمبر",
  "اليابان صارت على بعد ١٠ ساعات 🇯🇵\nمن ١٧ نوفمبر فيه طيران مباشر من الرياض لطوكيو، والموسم موسم أوراق الخريف في كيوتو 🍁\nأول برنامج لنا لليابان جاهز. أرسل «اليابان» على الواتساب.",
  "Japan is now 10 hours away. From 17 November there's a nonstop from Riyadh to Tokyo, right in Kyoto's autumn-leaves season. Our first Japan itinerary is ready. Send 'Japan' on WhatsApp.",
  "السفر لليابان من الرياض, طيران مباشر الرياض طوكيو, Japan from Riyadh",
  "#اليابان #طوكيو #كيوتو #سفر #مادا",
  "WhatsApp 'اليابان'",
  "Cinematic: a boarding-pass close-up 'RUH → NRT', then Tokyo crossing at night, Kyoto temple in red leaves, a bullet train, ramen (halal sign), Fuji. Soft Japanese-inspired instrumental. Licensed or Collab footage only.",
  "Saudia RUH-NRT nonstop from 17 Nov · Kyoto foliage peak late Nov", "Mention the route generically ('nonstop from Riyadh'). Confirm Saudia's schedule the week of posting.",
  series="Winter Escapes", sc="Global")

P(17, "21:00", "TT", "Video 50s", "KNOW", "Japan nonstop starts today: 5 things to know",
  "VO + on-screen: من اليوم: الرياض لطوكيو مباشر ✈️ ٥ أشياء لازم تعرفها",
  "Riyadh → Tokyo nonstop: 5 things to know", "الرياض لطوكيو مباشر: ٥ أشياء",
  "من اليوم فيه طيران مباشر من الرياض لطوكيو 🇯🇵 ٥ أشياء لازم تعرفها قبل تحجز 👇",
  "From today there's a nonstop from Riyadh to Tokyo. 5 things to know before you book.",
  "فيزا اليابان للسعوديين, السفر لليابان, طيران الرياض طوكيو",
  "#اليابان #فيزا_اليابان #طوكيو #سفر #مادا",
  "Save + follow",
  "Concierge explains: (1) the eVisa (apply online, before booking hotels) (2) 3 flights a week, so dates matter (3) Kyoto leaves peak late Nov-early Dec (4) halal food apps & prayer rooms (5) Sapporo Snow Festival 4-11 Feb for families.",
  "Saudia RUH-NRT launch (17 Nov)", "Verify the Japan eVISA eligibility wording for Saudi nationals on the Japanese MOFA site.",
  series="Visa in 60", sc="Global")

P(17, "13:00", "X", "Post", "WORLD", "Japan route news",
  "من اليوم: الرياض ← طوكيو مباشر 🇯🇵",
  "", "",
  "من اليوم: طيران مباشر من الرياض لطوكيو ٣ مرات بالأسبوع 🇯🇵\nأول مرة اليابان تصير بهالقرب. تبي برنامج؟ نرتبه لك من الفيزا للفندق.",
  "From today: a nonstop from Riyadh to Tokyo, 3 times a week. Japan has never been this close. Want a plan? We'll arrange it from the visa to the hotel.",
  "طيران مباشر الرياض طوكيو",
  "#اليابان",
  "DM",
  "One photo of Kyoto in autumn.",
  "Saudia RUH-NRT launch", "Confirm the first flight operated before posting.", sc="Global")

P(21, "21:00", "TT", "Video 45s", "WORLD", "Ski season opens: Alps vs Gudauri vs Uludağ",
  "On-screen: موسم التزلج فتح اليوم ⛷️ وين تروح؟",
  "Ski season: 3 options from Riyadh", "موسم التزلج: ٣ خيارات من الرياض",
  "موسم التزلج فتح اليوم في الألب ⛷️ بس عندك ٣ خيارات من الرياض حسب ميزانيتك 👇 أي واحد يناسبك؟",
  "Ski season opened today in the Alps. You have 3 options from Riyadh depending on your budget. Which suits you?",
  "التزلج في سويسرا, جورجيا ثلج, اولوداغ تركيا, ski holiday from Saudi",
  "#تزلج #ثلوج #جورجيا #سويسرا #مادا",
  "Comment your pick",
  "Tier format: (1) The Alps: Val Thorens open now, Courchevel/Zell am See from early Dec (Schengen) (2) Gudauri, Georgia: ~3.5h, visa-free, opens ~late Dec (3) Uludağ, Türkiye: ~4h, visa-free, near Bursa. Beginner tips on screen.",
  "Val Thorens opens 21 Nov", "Gudauri opening date is approximate. Say 'usually late December'.",
  series="Winter Escapes", sc="Global")

P(22, "21:30", "IG", "Carousel 10", "WORLD", "World Radar #2: Dec-Feb",
  "Slide 1: Plan the winter now. 9 dates worth flying for, Dec-Feb.",
  "World Radar · Dec-Feb", "رادار العالم · ديسمبر–فبراير",
  "رادار العالم 🌍 احجز الشتاء من الحين:\n• ٨–٩ ديسمبر: برشلونة × سيتي، أرسنال × ريال مدريد\n• ٤ ديسمبر – ١٧ يناير: مهرجان دبي للتسوق\n• ٣١ ديسمبر: رأس السنة بدبي أو لندن\n• من ٦ يناير: تخفيضات باريس الشتوية\n• ٧ يناير: كأس آسيا عندنا في السعودية 🇸🇦\n• ١٤ يناير: NBA في باريس\n• ٢–٧ فبراير: السوبر الإسباني في إسطنبول (٤ ساعات!)\n• ٤–١١ فبراير: مهرجان الثلج في سابورو\nإجازة منتصف العام تبدأ ٨ يناير. خطط من الحين.",
  "World Radar: book the winter now. Barcelona v City and Arsenal v Real Madrid (8-9 Dec), Dubai Shopping Festival (4 Dec-17 Jan), NYE in Dubai or London, Paris winter sales (from 6 Jan), the Asian Cup at home (from 7 Jan), NBA in Paris (14 Jan), the Spanish Super Cup in Istanbul (2-7 Feb, 4 hours away), Sapporo Snow Festival (4-11 Feb). The mid-year break starts 8 January.",
  "وين اسافر اجازة منتصف العام, فعاليات يناير, السوبر الاسباني اسطنبول",
  "#رادار_العالم #إجازة_منتصف_العام #سفر #السوبر_الإسباني #مادا",
  "Save + comment where you want to be",
  "World Radar template.",
  "Global events Dec-Feb", "Note that the Super Cup is in Istanbul in 2027, not Saudi Arabia.",
  series="World Radar", sc="Global")

P(22, "13:00", "X", "Thread 5", "WORLD", "World Radar #2 on X",
  "إجازة منتصف العام تبدأ ٨ يناير. هذي أحداث العالم اللي تستاهل 🧵",
  "", "",
  "١/ إجازة منتصف العام تبدأ ٨ يناير. هذي أحداث العالم اللي تستاهل السفرة 🧵\n٢/ ديسمبر: مهرجان دبي للتسوق من ٤ ديسمبر، وليلة رأس السنة\n٣/ يناير: تخفيضات باريس من ٦ يناير، وNBA في باريس ١٤ يناير\n٤/ فبراير: السوبر الإسباني في إسطنبول ٢–٧ فبراير، ٤ ساعات من الرياض\n٥/ ولكأس آسيا عندنا من ٧ يناير، خلك قريب 🇸🇦",
  "1/ The mid-year break starts 8 Jan. Global events worth the trip. 2/ December: Dubai Shopping Festival from 4 Dec, New Year's Eve. 3/ January: Paris sales from 6 Jan, NBA in Paris 14 Jan. 4/ February: the Spanish Super Cup in Istanbul 2-7 Feb, 4 hours from Riyadh. 5/ And the Asian Cup is at home from 7 Jan.",
  "اجازة منتصف العام",
  "#إجازة_منتصف_العام",
  "Bookmark",
  "Text thread.",
  "Global events Dec-Feb", "", series="World Radar", sc="Global")

P(24, "19:00", "X", "Post", "WORLD", "UCL tonight, and the big one in 2 weeks",
  "دوري الأبطال الليلة ⚽ والكبيرة بعد أسبوعين",
  "", "",
  "دوري الأبطال الليلة: ريال مدريد × آيندهوفن، أرسنال × دورتموند، سيتي × نابولي ⚽\nوالكبيرة بعد أسبوعين: أرسنال × ريال مدريد في لندن ٩ ديسمبر. باقي وقت تلحق.",
  "Champions League tonight: Real Madrid v PSV, Arsenal v Dortmund, City v Napoli. And the big one in two weeks: Arsenal v Real Madrid in London, 9 December. There's still time.",
  "دوري أبطال أوروبا, ريال مدريد",
  "#دوري_أبطال_أوروبا",
  "DM",
  "Text only.",
  "UCL MD5 (24 Nov)", "Ops to confirm match-trip availability.", series="Fly For It", sc="Global")

P(25, "21:30", "IG", "Reel 30s", "WORLD", "Fly For It: Shakira at the Pyramids + Cairo in 48h",
  "Pyramids at golden hour, a crowd roar, text: 'Saturday. The Pyramids. Shakira.'",
  "Shakira · the Pyramids · 28 Nov", "شاكيرا · الأهرامات · ٢٨ نوفمبر",
  "حفلة عند الأهرامات 🇪🇬 شاكيرا، السبت ٢٨ نوفمبر، والقاهرة على بعد ساعتين ونص.\nخلها ٤٨ ساعة: الحفلة + المتحف المصري الكبير + عشاء على النيل.\nأرسل «القاهرة» على الواتساب.",
  "A concert at the Pyramids: Shakira, Saturday 28 November, and Cairo is 2.5 hours away. Make it 48 hours: the show + the Grand Egyptian Museum + dinner on the Nile. Send 'Cairo' on WhatsApp.",
  "حفلة شاكيرا الاهرامات, القاهرة ويكند, المتحف المصري الكبير",
  "#القاهرة #مصر #الأهرامات #ويكند #مادا",
  "WhatsApp 'القاهرة'",
  "48-hour itinerary reel: arrival, the Grand Egyptian Museum, Nile dinner, the Pyramids at night (stage lights from a distance). No artist imagery or concert footage (rights).",
  "Shakira at the Pyramids (28 Nov)", "Confirm the concert is going ahead and ticket availability. No artist photos.",
  series="Fly For It", sc="Global")

P(25, "09:30", "LI", "Post + image", "BIZ", "GITEX Global at Expo City Dubai: team travel brief",
  "GITEX moves to Expo City Dubai this year. Your team's travel plan should move with it.",
  "GITEX Global 2026 · team brief", "",
  "",
  "GITEX Global runs 8-11 December, for the first time at Expo City Dubai.\n\nIf you're sending a team from Riyadh, our brief:\n• Expo City is far from Downtown and the Marina, so stay close or plan transfers by session\n• Book rooms now. GITEX week fills Dubai\n• Arrive the day before. Registration queues on day 1 are long\n• One WhatsApp line for the whole team, from flights to dinners\n\nWe're arranging delegations for GITEX now. Message us if you want yours handled.",
  "GITEX Global 2026 travel, corporate travel Dubai, business delegation Dubai",
  "#GITEX #Dubai #BusinessTravel #Tech",
  "Message us",
  "One image: a route graphic RUH → DXB → Expo City.",
  "GITEX Global 8-11 Dec", "", sc="GCC")

P(28, "22:00", "TT", "Video 35s", "WORLD", "The Super Cup moves to Istanbul",
  "On-screen: السوبر الإسباني هالسنة… مو عندنا 👀",
  "Spanish Super Cup · Istanbul · 2-7 Feb", "السوبر الإسباني · إسطنبول · ٢–٧ فبراير",
  "السوبر الإسباني ٢٠٢٧ في إسطنبول مو الرياض 👀 (لأن كأس آسيا عندنا)\nريال مدريد، برشلونة، أتلتيكو، وريال سوسيداد. واحتمال كلاسيكو بالنهائي… ٤ ساعات من الرياض ⚽",
  "The 2027 Spanish Super Cup is in Istanbul, not Riyadh (the Asian Cup is here). Real Madrid, Barcelona, Atlético and Real Sociedad, and a possible Clásico final 4 hours from Riyadh.",
  "السوبر الاسباني ٢٠٢٧, السوبر الاسباني اسطنبول, كلاسيكو",
  "#السوبر_الإسباني #ريال_مدريد #برشلونة #إسطنبول #مادا",
  "Comment who wins",
  "News-style green-screen over the RFEF announcement, a map RUH → IST, a bracket graphic. No club crests.",
  "Spanish Super Cup 2-7 Feb 2027 (Istanbul)", "", series="Fly For It", sc="Global")

P(29, "21:30", "IG", "Carousel 9", "WORLD", "Winter Escapes: snow, sun or city for the 8 Jan break",
  "Slide 1: The mid-year break starts 8 Jan. Snow, sun or city?",
  "Snow · Sun · City", "ثلج · شمس · مدينة",
  "إجازة منتصف العام تبدأ ٨ يناير ❄️☀️🏙️ وأنت من أي فريق؟\nثلج: سويسرا · جورجيا · أذربيجان · سابورو\nشمس: المالديف · بوكيت · لنكاوي\nمدينة: لندن · باريس (التخفيضات) · إسطنبول\nالحجوزات تمتلي بدري. أرسل «إجازة» على الواتساب.",
  "The mid-year break starts 8 January. Which team are you? Snow: Switzerland, Georgia, Azerbaijan, Sapporo. Sun: Maldives, Phuket, Langkawi. City: London, Paris (the sales), Istanbul. Bookings fill early. Send 'break' on WhatsApp.",
  "وين نسافر اجازة منتصف العام, سفر الشتاء, ثلوج, المالديف",
  "#إجازة_منتصف_العام #سفر_الشتاء #ثلوج #المالديف #مادا",
  "Comment snow/sun/city",
  "3 colour-coded sections (ice blue, sun gold, city green) on brand sand. Each slide: destination, flight time, visa, family/couple tag, private-pool or connecting-room note.",
  "Mid-year break (8 Jan)", "", series="Winter Escapes", sc="Global")

P(30, "20:30", "IG", "Reel 35s", "WORLD", "December on the horizon",
  "On-screen: Save December 👇 (calendar flips)",
  "December on the horizon", "ديسمبر في الأفق",
  "احفظ ديسمبر 📌\n٣–٦: ختام الفورمولا ١ في أبوظبي\n٤: يبدأ مهرجان دبي للتسوق\n٨–٩: برشلونة × سيتي، وأرسنال × ريال مدريد\n١٠: بداية رجب\n١٨: اليوم الوطني القطري · ١٨–١٩: فورمولا إي جدة\n٢٧–٣٠: Six Kings Slam الرياض\n٣١: ليلة رأس السنة\nو٨ يناير: إجازة منتصف العام 🎒",
  "Save December: F1 Abu Dhabi finale (3-6), Dubai Shopping Festival (from 4), Barcelona v City and Arsenal v Real Madrid (8-9), Rajab begins (10), Qatar National Day (18), Formula E Jeddah (18-19), Six Kings Slam Riyadh (27-30), New Year's Eve, and the mid-year break from 8 January.",
  "فعاليات ديسمبر, اجازة منتصف العام, فعاليات عالمية ديسمبر",
  "#ديسمبر #فعاليات #إجازة_منتصف_العام #سفر #مادا",
  "Save",
  "Calendar pages flipping, one event per beat, a city skyline per page (Abu Dhabi, Dubai, Barcelona, London, Jeddah, Riyadh). Ends with 'Plan it once. We'll handle the rest.'",
  "December preview", "Re-check every date the week of posting.", sc="Global")

P(30, "21:00", "TT", "Video 35s", "WORLD", "5 December dates abroad to save",
  "On-screen: ٥ مواعيد بديسمبر برا السعودية تستاهل السفرة 📅",
  "5 December dates worth flying for", "٥ مواعيد بديسمبر تستاهل السفرة",
  "٥ مواعيد بديسمبر برا السعودية تستاهل السفرة 📅 أي وحدة رايح لها؟",
  "5 December dates abroad worth the trip. Which one are you going to?",
  "فعاليات ديسمبر, فورمولا ١ ابوظبي, مهرجان دبي للتسوق, ريال مدريد لندن",
  "#ديسمبر #فورمولا1 #دبي #دوري_أبطال_أوروبا #مادا",
  "Comment which one",
  "Fast list with a ticking calendar sound: F1 Abu Dhabi, Dubai Shopping Festival, Arsenal v Real Madrid, Qatar National Day, NYE.",
  "December preview", "", sc="Global")


P(21, "16:30", "X", "Poll", "WORLD", "Winter sun: which one?",
  "شمس الشتاء: وين؟",
  "", "",
  "إجازة منتصف العام، وتبي شمس ☀️ وين؟",
  "Mid-year break and you want sun. Where?",
  "المالديف, بوكيت, لنكاوي",
  "#سفر_الشتاء",
  "Vote",
  "Poll: 🏝️ المالديف / 🌴 بوكيت / 🌺 لنكاوي / 🇪🇬 الغردقة",
  "Winter-sun high season (Nov-Apr)", "", series="Winter Escapes", sc="Global")

P(22, "21:00", "TT", "Video 50s", "WORLD", "Istanbul with family: 4 days that work",
  "On-screen: إسطنبول مع العيال… بدون تعب 👨‍👩‍👧 (٤ أيام)",
  "Istanbul with family: 4 days", "إسطنبول مع العائلة: ٤ أيام",
  "إسطنبول مع العائلة ٤ أيام بدون تعب 🇹🇷 احفظ البرنامج، وبدون فيزا للسعوديين.",
  "Istanbul with the family, 4 days without the exhaustion. Save the plan, and no visa needed for Saudis.",
  "برنامج اسطنبول ٤ ايام, اسطنبول مع العائلة, سياحة تركيا",
  "#إسطنبول #تركيا #السفر_مع_العائلة #برنامج_سياحي #مادا",
  "Save",
  "Timeline video: Day 1 Sultanahmet + Bosphorus cruise, Day 2 Princes' Islands, Day 3 Vialand/aquarium, Day 4 shopping + Çamlıca Mosque. Tips: connecting rooms on the Asian or European side, halal is everywhere, avoid bridge traffic at 5pm. No children's faces.",
  "Türkiye: a top-two Saudi destination (Wego, Almosafer 2026)", "", sc="Global")

# ───────────────────────── scope and pillar for posts written before the global pass ─────────────────────────

_GLOBAL = ("Schengen", "UK ETA", "US visa", "Vienna", "Europe", "London", "dupes", "Dupes", "Visa-free", "visa-free",
           "European", "Reply: how long does a Schengen", "Travel myths", "Booking myths")
_GCC = ("Muscat", "F1 Qatar")
_SAUDI = ("AlUla", "Riyadh", "Weekend Radar", "Kashta", "kashta", "Leonids", "meteors", "Stargazing", "Cityscape", "Crown Jewel",
          "Rajab", "Umrah", "Ramadan", "Behind the Curtain", "delegates", "Event night", "Big night", "Autumn break: where",
          "Autumn break countdown", "Hosting guests", "Saudi coffee", "Manpower", "crews", "Specialist", "Q1 2027", "travel-policy",
          "delegation", "Delegates", "Last-minute break", "Break recap", "Saudi hospitality")
_WORLD_PILLAR = ("Vienna", "Europe", "London in winter", "Destination dupes", "Dupes:", "F1 Qatar")

for _p in POSTS:
    if not _p["sc"] and _p["pil"] == "BIZ":
        _p["sc"] = "B2B"
    if not _p["sc"] and _p["title"].startswith(("Autumn break: 6", "Break recap", "Weekend Radar #3", "Weekend Radar #4")):
        _p["sc"] = "Mixed"
    if not _p["sc"]:
        t = _p["title"]
        _p["sc"] = ("Global" if any(k in t for k in _GLOBAL) else
                    "GCC" if any(k in t for k in _GCC) else
                    "Saudi" if any(k in t for k in _SAUDI) else "All")
    if _p["pil"] == "HOR" and any(k in _p["title"] for k in _WORLD_PILLAR):
        _p["pil"] = "WORLD"
