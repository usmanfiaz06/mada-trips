/* =========================================================
   MADA BOOK: words, English and Arabic
   Gulf-friendly Arabic, short sentences, no jargon. Functions take the parts that change.
   ========================================================= */
(function () {
  const en = {
    // header + global
    trips: "Trips", help: "Help", lang: "العربية", signIn: "Sign in", account: "Account", signOut: "Sign out", newTrip: "New trip", back: "Back",
    preview: "Preview: prices are estimates and no payment is taken.",
    demo: "Preview as", demoNew: "New visitor", demoBack: "Returning traveler",
    footer: "© Mada Trips, Riyadh.", photos: "Photo credits",
    adult: ["adult", "adults"], child: ["child", "children"], infant: ["baby", "babies"],
    soon: "Coming soon.",

    // home
    askLabel: "Tell Mada about your trip",
    titleNew: "Where to?", titleBack: "Where to next?",
    subNew: "Tell Mada about your trip. Flights, stays, visas and eSIMs, planned in one go and priced for everyone.",
    hiBack: (n) => `Welcome back, ${n}.`, subBack: (c, d) => `Your ${c} trip is in ${d} ${d === 1 ? "day" : "days"}. Anything else to plan?`, subBackNone: "Tell Mada where you'd like to go next.",
    ph: ["Dubai this weekend, 2 of us", "Umrah in December with my family", "Somewhere under 2,000 for a long weekend", "Istanbul on 12 Dec for a week, direct"],
    ph2: ["Ask a follow-up: make it cheaper", "Change anything: leave on Wednesday", "Add more: a car for 3 days"],
    tryL: "Try", tools: { flights: "Flights", stays: "Stays", umrah: "Umrah", visa: "Visa", esim: "eSIM", car: "Car" },
    starts: { flights: "Flights to ", stays: "A hotel in ", umrah: "Umrah from Riyadh for ", visa: "I need a visa for ", esim: "An eSIM for ", car: "A car in " },
    contH: "Continue your plan", contGo: "Open plan",
    mineTitle: "Your trips.", upcoming: "Upcoming", held: "Held", inDays: "days to go", today: "Today", checkIn: (n) => `Check-in opens in ${n} ${n === 1 ? "day" : "days"}`, details: "Trip details", heldUntil: (d) => `Seats held until ${d}`,
    flightK: "Flight", departK: "Departs", seatK: "Seat", travK: "Travelers",
    watchH: "Price watch", watch: (c, amt) => `${c} is <b class="good">${amt} lower</b> than when you looked.`, watchGo: "Plan it",
    esimH: "Before you go", esimP: (c, amt) => `Add an eSIM for ${c}: 10 GB for ${amt} per traveler, working when you land.`, esimGo: "Add to my trip",
    advH: "Your advisor is online", advP: "Ask anything about your trip, any time.", advGo: "Open WhatsApp",
    railNew: (c) => `Popular from ${c}. <span class="dim">This weekend, flight and hotel, all in.</span>`,
    railBack: () => `Picked for you. <span class="dim">Based on your trips, flight and hotel, all in.</span>`,
    railFor: (p) => `${p} · 2 nights`,
    whyH: "Booking, without the tricks.", whyH2: "What you can count on, every trip.",
    w1h: "The first price is the final price.", w1: "Taxes, bags and fees are already in. Nothing gets added at checkout.",
    w2h: "No countdowns. No pressure.", w2: "We'll never invent “only two seats left” to rush you.",
    w3h: "A real person owns your trip.", w3: "One Mada advisor on WhatsApp before, during and after you fly.",
    w4h: "Decide together.", w4: "Send the whole trip to family on WhatsApp. When the airline allows it, we hold your seats while you talk and tell you exactly until when.",
    advisor: "Your Mada advisor", advisorMsg: "Your gate moved to B18. Nothing to do, I've updated your trip.",
    only2: "Only 2 seats left!", shareTo: "To: Family", shareLine: "Thu 29 – Sat 31 Oct · 2 adults · SAR 3,960", shareHeld: "Seats held until 9:40 pm tonight, the airline's limit",
    rFare: "Flights", rTax: "Taxes and airport fees", rStay: "Hotel, 2 nights", rFee: "Booking fee", rTotal: "Total",

    // conversation
    working: "Checking flights, hotels and prices",
    askWhere: "Where would you like to go? Pick one or type any city.",
    askWhen: (c) => `${c}, good choice. When are you thinking?`, askWhenUmrah: "Umrah, may Allah accept it from you. When are you planning to go?",
    wkThis: "This weekend", wkNext: "Next weekend", in2: "In two weeks", pickDates: "Pick dates",
    planIntro: (c, d, p) => `Here's a plan for <b>${c}</b>, ${d}, for ${p}. Everything is in the total. Switch off anything you don't need, or tell me what to change.`,
    updated: "Done, I've updated the plan.",
    cheapest: (d) => `That's already the cheapest hotel I'd recommend, so I moved you to ${d}, which is cheaper to fly.`,
    budgetIntro: (amt, p) => `Here's where ${amt} takes ${p} this weekend, flights and hotel included:`,
    budgetNone: "Nothing fits that budget this weekend. Want me to try next weekend?",
    visaAsk: (c) => `I can check and handle the visa for ${c}. Which passport will you travel on?`,
    visaFree: (c) => `Good news: with a Saudi passport you don't need a visa for ${c}. Want me to plan the trip?`,
    visaDo: (c) => `I'll check exactly what ${c} needs for that passport and prepare the application. Your advisor confirms the details with you on WhatsApp.`,
    passports: ["Saudi", "Pakistani", "Indian", "Egyptian", "Other"],
    follow: { cheaper: "Make it cheaper", earlier: "Leave a day earlier", lux: "5★ hotel", flightOnly: "Just the flight", addCar: "Add a car", plus1: "Add a traveler" },
    viewPlan: "View plan", planTab: "Plan", chatTab: "Chat",
    noPlanYet: "Your plan appears here as you talk to Mada.",

    // plan
    flight: "Flight", ret: "back", direct: "direct", stop: (c) => `1 stop in ${c}`, nextDay: "+1",
    stay: (s, area, n) => `${s}★ hotel, ${area} · ${n} ${n === 1 ? "night" : "nights"}`, rooms: (r, p) => `${r} ${r === 1 ? "room" : "rooms"} for ${p}`,
    makkahPick: "Jeddah airport to Makkah, by car",
    esim: (c) => `eSIM for ${c}, 10 GB`, esimSub: "Works the moment you land, one per traveler",
    pickup: "Airport pickup", pickupSub: "Driver waiting at arrivals",
    car: "Rental car", carSub: (n) => `Compact, automatic · ${n} ${n === 1 ? "day" : "days"}`,
    visa: "Visa", visaNo: "Not needed with a Saudi passport", visaYes: "We'll check and apply for you", visaChk: "Checked",
    change: "Change", bagIn: (kg) => `${kg} kg bag included`, bagAdded: "23 kg bag added",
    totalFor: (p) => `Total for ${p}, all in`, cont: "Continue", share: "Send to family",
    shareText: (c, d, p, amt) => `Trip to ${c}, ${d}, for ${p}: ${amt} all in, planned with Mada Trips.`,

    // flights
    flTitle: (c) => `Flights to ${c}`, flTitleBack: (c) => `Flights back to ${c}`, flSub: (d, p) => `${d} · ${p} · prices are the total, bags included`,
    picks: { best: "Best", cheapest: "Cheapest", fastest: "Fastest" }, allFlights: (n) => `All ${n} flights`,
    sortBy: { best: "Best", cheapest: "Cheapest", fastest: "Fastest", earliest: "Earliest" }, directOnly: "Direct only",
    select: "Select", selected: "Selected", changeOk: "Free date change", changeFee: "Changes for a fee", noFlights: "No flights match. Try switching off Direct only.",

    // hotels
    stTitle: (c) => `Where you'll stay in ${c}`, stSub: (n, r) => `${n} ${n === 1 ? "night" : "nights"} · ${r} · total price for the stay`, allStars: "All", noHotel: "I don't need a hotel",
    rating: "Guest rating", sample: "Sample hotels for this preview",

    // checkout
    steps: ["Plan", "Travelers", "Payment"],
    trvTitle: "Who's traveling?", trvSub: "Names exactly as they appear on each passport.",
    trvSignin: "Signed in travelers fill this in with one tap.", trvSigninGo: "Sign in",
    savedPick: "Saved travelers",
    tAdult: "Adult", tChild: "Child", tInfant: "Baby", travelerN: (n, k) => `Traveler ${n} · ${k}`,
    mr: "Mr", ms: "Ms", first: "First and middle names", last: "Last name", dob: "Date of birth", nat: "Nationality", doc: "Passport number", docHint: "Optional now. We'll remind you a week before you fly.",
    contactH: "Where should we send the tickets?", phone: "Mobile number (WhatsApp)", email: "Email (optional)",
    together: "Seat us together", togetherSub: "We'll ask the airline to seat your group side by side.",
    saveTrv: "Save these travelers for next time",
    toPay: "Continue to payment",
    errName: "Use Latin letters, as on the passport", errDob: "Add a date of birth", errChildAge: "Children are 2 to 11 on the travel date", errInfAge: "Babies are under 2 on the travel date", errPhone: "Enter a Saudi mobile number, 05XXXXXXXX", errEmail: "Check the email address",
    preview2: "NAME ON TICKET",

    // pay
    payTitle: "Review and pay", whoGoing: "Travelers", contact: "Contact",
    payHow: "How would you like to pay?",
    applePay: "Apple Pay", mada: "mada card", card: "Visa or Mastercard", tabby: "Tabby", tabbySub: (a) => `4 payments of ${a}, no interest`, tamara: "Tamara", tamaraSub: (a) => `3 payments of ${a}, no interest`,
    holdH: "Hold the seats, pay later", holdSub: (d) => `Free. The airline lets us hold this fare until ${d}. Hotel and extras are booked when you pay.`, holdNo: "This airline doesn't allow holds on this fare.",
    cardNo: "Card number", exp: "Expiry", cvc: "CVC", nameOnCard: "Name on card",
    terms: "By paying you accept the airline fare rules and the hotel's cancellation policy.",
    payBtn: (a) => `Pay ${a}`, holdBtn: (d) => `Hold until ${d}`, processing: "Confirming with the airline and hotel",
    errCard: "Check the card details",

    // trip
    confirmed: "Booked", heldS: "Held", refL: "Booking reference", tripTo: (c) => `Your trip to ${c}`,
    sentTo: (p) => `Tickets and receipts are on their way to ${p}.`, heldNote: (d) => `Nothing has been charged. Pay before ${d} to keep the seats.`,
    next: "What happens next", n1: "Payment received", n1h: "Seats held", n2: "Tickets issued by the airline", n3: "Hotel confirmation sent", n4: "eSIM QR code sent before you fly", n5: "Your advisor checks in 24 hours before departure",
    addCal: "Add to calendar", msgAdv: "Message your advisor", reqChange: "Request a change", reqCancel: "Cancel or refund", payNow: (a) => `Pay ${a} now`,
    advIntro: "Your advisor", advLine: "Reachable on WhatsApp, 8 am to midnight, every day.",
    waChange: (r) => `Hello, I'd like to change booking ${r}.`, waCancel: (r) => `Hello, I'd like to cancel booking ${r}.`, waHi: (r) => `Hello, about booking ${r}.`,
    itemsH: "In this trip",
    st: { flight: "Ticketed", flightH: "Held", stay: "Confirmed", esim: "QR by email", pickup: "Driver details 24h before", car: "Confirmed", visa: "Advisor will contact you" },

    // trips
    tripsTitle: "Your trips", tripsNone: "No trips yet.", tripsPlan: "Plan a trip", tripsSignin: "Sign in to see trips booked on other devices.", past: "Past",

    // sign in
    siTitle: "Sign in or create an account", siSub: "We'll text you a code. No passwords.", siPhone: "Mobile number", siSend: "Send code",
    siCode: (p) => `Enter the code sent to ${p}`, siCodeHint: "Preview: any 4 digits work.", siVerify: "Continue", siResend: "Send again",
    siName: "What should we call you?", siNameL: "Your name", siDone: "Done", orL: "or", apple: "Continue with Apple", google: "Continue with Google",

    // account
    acTitle: "Account", acProfile: "Profile", acTravelers: "Saved travelers", acNone: "None yet. They're saved when you book.", acRemove: "Remove", acLang: "Language", acSave: "Save",

    // calendar + popovers
    calTitle: "When are you going?", calNote: (p) => `Flight prices, total for ${p}, one way.`, oneWay: "One way", returnL: "Return", done: "Done",
    whoTitle: "Who's going?", adultsK: "Adults", adultsS: "12 and over", childrenK: "Children", childrenS: "2 to 11", babiesK: "Babies", babiesS: "Under 2, on a lap",
    fromTitle: "Flying from",
  };

  const ar = {
    trips: "رحلاتي", help: "مساعدة", lang: "English", signIn: "تسجيل الدخول", account: "الحساب", signOut: "تسجيل الخروج", newTrip: "رحلة جديدة", back: "رجوع",
    preview: "نسخة تجريبية: الأسعار تقديرية ولا يتم خصم أي مبلغ.",
    demo: "معاينة كـ", demoNew: "زائر جديد", demoBack: "مسافر عائد",
    footer: "© مادا للسفر، الرياض.", photos: "حقوق الصور",
    adult: ["بالغ", "بالغين"], child: ["طفل", "أطفال"], infant: ["رضيع", "رضّع"],
    soon: "قريبًا.",

    askLabel: "أخبر مادا عن رحلتك",
    titleNew: "إلى أين؟", titleBack: "وين وجهتك الجاية؟",
    subNew: "أخبر مادا عن رحلتك. طيران وفنادق وتأشيرات وشرائح eSIM، نخطط لها مرة وحدة وبسعر شامل للجميع.",
    hiBack: (n) => `أهلًا بعودتك يا ${n}.`, subBack: (c, d) => `رحلتك إلى ${c} بعد ${d} ${d === 1 ? "يوم" : "أيام"}. تبي نخطط لشيء ثاني؟`, subBackNone: "قل لمادا وين حاب تروح المرة الجاية.",
    ph: ["دبي الويكند شخصين", "عمرة في ديسمبر مع العائلة", "أي مكان بأقل من ٢٠٠٠ لعطلة طويلة", "إسطنبول ١٢ ديسمبر لمدة أسبوع مباشر"],
    ph2: ["اسأل: خلّها أرخص", "غيّر أي شيء: السفر يوم الأربعاء", "أضف: سيارة لثلاثة أيام"],
    tryL: "جرّب", tools: { flights: "طيران", stays: "فنادق", umrah: "عمرة", visa: "تأشيرة", esim: "eSIM", car: "سيارة" },
    starts: { flights: "طيران إلى ", stays: "فندق في ", umrah: "عمرة من الرياض لـ ", visa: "أحتاج تأشيرة إلى ", esim: "شريحة eSIM لـ ", car: "سيارة في " },
    contH: "كمّل خطتك", contGo: "افتح الخطة",
    mineTitle: "رحلاتك.", upcoming: "قادمة", held: "محجوزة مؤقتًا", inDays: "أيام متبقية", today: "اليوم", checkIn: (n) => `يفتح إصدار بطاقة الصعود بعد ${n} ${n === 1 ? "يوم" : "أيام"}`, details: "تفاصيل الرحلة", heldUntil: (d) => `المقاعد محجوزة حتى ${d}`,
    flightK: "الرحلة", departK: "الإقلاع", seatK: "المقعد", travK: "المسافرون",
    watchH: "متابعة السعر", watch: (c, amt) => `${c} صارت <b class="good">أرخص بـ ${amt}</b> من آخر مرة شفتها.`, watchGo: "خطط لها",
    esimH: "قبل السفر", esimP: (c, amt) => `أضف شريحة eSIM لـ ${c}: ١٠ جيجا بـ ${amt} للمسافر، تشتغل أول ما توصل.`, esimGo: "أضفها لرحلتي",
    advH: "مستشارك متصل الآن", advP: "اسأل أي شيء عن رحلتك، في أي وقت.", advGo: "افتح واتساب",
    railNew: (c) => `الأكثر طلبًا من ${c}. <span class="dim">هذا الويكند، طيران وفندق، شامل كل شيء.</span>`,
    railBack: () => `مختارة لك. <span class="dim">حسب رحلاتك، طيران وفندق، شامل كل شيء.</span>`,
    railFor: (p) => `${p} · ليلتين`,
    whyH: "حجز بدون حيل.", whyH2: "وعودنا في كل رحلة.",
    w1h: "أول سعر هو السعر النهائي.", w1: "الضرائب والشنط والرسوم داخلة. ما يُضاف شيء عند الدفع.",
    w2h: "بدون عدّاد. بدون ضغط.", w2: "ما راح نخترع «باقي مقعدين» عشان نستعجلك.",
    w3h: "شخص حقيقي مسؤول عن رحلتك.", w3: "مستشار من مادا على واتساب قبل السفر وأثناءه وبعده.",
    w4h: "قرّروا مع بعض.", w4: "أرسل الرحلة كاملة للعائلة على واتساب. إذا سمحت شركة الطيران، نحجز المقاعد وأنتم تتشاورون ونقول لك بالضبط لين متى.",
    advisor: "مستشارك في مادا", advisorMsg: "بوابتك تغيّرت إلى B18. ما عليك شيء، حدّثت رحلتك.",
    only2: "باقي مقعدين فقط!", shareTo: "إلى: العائلة", shareLine: "الخميس ٢٩ – السبت ٣١ أكتوبر · بالغين · 3,960 ر.س", shareHeld: "المقاعد محجوزة حتى ٩:٤٠ مساءً، حسب شركة الطيران",
    rFare: "الطيران", rTax: "الضرائب ورسوم المطار", rStay: "الفندق، ليلتين", rFee: "رسوم الحجز", rTotal: "الإجمالي",

    working: "أشيّك على الرحلات والفنادق والأسعار",
    askWhere: "وين حاب تسافر؟ اختر أو اكتب أي مدينة.",
    askWhen: (c) => `${c}، اختيار حلو. متى ناوي؟`, askWhenUmrah: "عمرة مقبولة بإذن الله. متى ناوي تروح؟",
    wkThis: "هذا الويكند", wkNext: "الويكند الجاي", in2: "بعد أسبوعين", pickDates: "اختر التاريخ",
    planIntro: (c, d, p) => `هذه خطة لرحلة <b>${c}</b>، ${d}، لـ ${p}. كل شيء داخل في الإجمالي. أوقف أي شيء ما تحتاجه، أو قل لي وش أغيّر.`,
    updated: "تم، حدّثت الخطة.",
    cheapest: (d) => `هذا أرخص فندق أنصح فيه، فنقلتك إلى ${d} لأن الطيران فيه أرخص.`,
    budgetIntro: (amt, p) => `هذي الأماكن اللي توصلها ${amt} لـ ${p} هذا الويكند، شامل الطيران والفندق:`,
    budgetNone: "ما فيه شيء ضمن هذه الميزانية هذا الويكند. أجرب الويكند الجاي؟",
    visaAsk: (c) => `أقدر أتحقق من تأشيرة ${c} وأخلصها لك. بأي جواز بتسافر؟`,
    visaFree: (c) => `خبر حلو: بالجواز السعودي ما تحتاج تأشيرة لـ ${c}. تبي أخطط لك الرحلة؟`,
    visaDo: (c) => `بتحقق بالضبط من متطلبات ${c} لهذا الجواز وأجهز الطلب. مستشارك يأكد معك التفاصيل على واتساب.`,
    passports: ["سعودي", "باكستاني", "هندي", "مصري", "غير ذلك"],
    follow: { cheaper: "خلّها أرخص", earlier: "سافر قبلها بيوم", lux: "فندق ٥ نجوم", flightOnly: "الطيران بس", addCar: "أضف سيارة", plus1: "أضف مسافر" },
    viewPlan: "اعرض الخطة", planTab: "الخطة", chatTab: "المحادثة",
    noPlanYet: "خطتك تظهر هنا وأنت تتكلم مع مادا.",

    flight: "الطيران", ret: "العودة", direct: "مباشر", stop: (c) => `توقف في ${c}`, nextDay: "+1",
    stay: (s, area, n) => `فندق ${s} نجوم، ${area} · ${n} ${n === 1 ? "ليلة" : "ليالٍ"}`, rooms: (r, p) => `${r} غرفة لـ ${p}`,
    makkahPick: "من مطار جدة إلى مكة، بالسيارة",
    esim: (c) => `شريحة eSIM لـ ${c}، ١٠ جيجا`, esimSub: "تشتغل أول ما توصل، واحدة لكل مسافر",
    pickup: "استقبال من المطار", pickupSub: "سائق بانتظارك عند الوصول",
    car: "سيارة إيجار", carSub: (n) => `صغيرة، أوتوماتيك · ${n} ${n === 1 ? "يوم" : "أيام"}`,
    visa: "التأشيرة", visaNo: "ما تحتاجها بالجواز السعودي", visaYes: "نتحقق ونقدّم عنك", visaChk: "تم التحقق",
    change: "تغيير", bagIn: (kg) => `شنطة ${kg} كجم مشمولة`, bagAdded: "أضفنا شنطة ٢٣ كجم",
    totalFor: (p) => `الإجمالي لـ ${p}، شامل كل شيء`, cont: "متابعة", share: "أرسلها للعائلة",
    shareText: (c, d, p, amt) => `رحلة إلى ${c}، ${d}، لـ ${p}: ${amt} شامل كل شيء، خططناها مع مادا للسفر.`,

    flTitle: (c) => `رحلات إلى ${c}`, flTitleBack: (c) => `رحلات العودة إلى ${c}`, flSub: (d, p) => `${d} · ${p} · الأسعار إجمالية وتشمل الشنط`,
    picks: { best: "الأفضل", cheapest: "الأرخص", fastest: "الأسرع" }, allFlights: (n) => `كل الرحلات (${n})`,
    sortBy: { best: "الأفضل", cheapest: "الأرخص", fastest: "الأسرع", earliest: "الأبكر" }, directOnly: "مباشر فقط",
    select: "اختر", selected: "مختارة", changeOk: "تغيير التاريخ مجانًا", changeFee: "التغيير برسوم", noFlights: "ما فيه رحلات مطابقة. جرّب إلغاء «مباشر فقط».",

    stTitle: (c) => `وين بتسكن في ${c}`, stSub: (n, r) => `${n} ${n === 1 ? "ليلة" : "ليالٍ"} · ${r} · السعر إجمالي الإقامة`, allStars: "الكل", noHotel: "ما أحتاج فندق",
    rating: "تقييم النزلاء", sample: "فنادق تجريبية لهذه النسخة",

    steps: ["الخطة", "المسافرون", "الدفع"],
    trvTitle: "مين المسافرين؟", trvSub: "الأسماء بالضبط مثل ما هي في الجواز.",
    trvSignin: "المسجلين يعبّون هذي البيانات بضغطة.", trvSigninGo: "تسجيل الدخول",
    savedPick: "المسافرون المحفوظون",
    tAdult: "بالغ", tChild: "طفل", tInfant: "رضيع", travelerN: (n, k) => `المسافر ${n} · ${k}`,
    mr: "السيد", ms: "السيدة", first: "الاسم الأول والأوسط", last: "اسم العائلة", dob: "تاريخ الميلاد", nat: "الجنسية", doc: "رقم الجواز", docHint: "اختياري الآن. بنذكّرك قبل السفر بأسبوع.",
    contactH: "وين نرسل التذاكر؟", phone: "رقم الجوال (واتساب)", email: "البريد الإلكتروني (اختياري)",
    together: "اجلسونا مع بعض", togetherSub: "بنطلب من شركة الطيران تجلّس مجموعتك جنب بعض.",
    saveTrv: "احفظ المسافرين للمرة الجاية",
    toPay: "متابعة للدفع",
    errName: "استخدم حروف إنجليزية مثل الجواز", errDob: "أضف تاريخ الميلاد", errChildAge: "الطفل من ٢ إلى ١١ سنة في تاريخ السفر", errInfAge: "الرضيع أقل من سنتين في تاريخ السفر", errPhone: "أدخل رقم جوال سعودي 05XXXXXXXX", errEmail: "تأكد من البريد الإلكتروني",
    preview2: "الاسم على التذكرة",

    payTitle: "المراجعة والدفع", whoGoing: "المسافرون", contact: "التواصل",
    payHow: "كيف حاب تدفع؟",
    applePay: "Apple Pay", mada: "بطاقة مدى", card: "فيزا أو ماستركارد", tabby: "تابي", tabbySub: (a) => `٤ دفعات بقيمة ${a}، بدون فوائد`, tamara: "تمارا", tamaraSub: (a) => `٣ دفعات بقيمة ${a}، بدون فوائد`,
    holdH: "احجز المقاعد وادفع بعدين", holdSub: (d) => `مجانًا. شركة الطيران تسمح نحجز هذا السعر حتى ${d}. الفندق والإضافات تنحجز عند الدفع.`, holdNo: "شركة الطيران ما تسمح بالحجز المؤقت لهذا السعر.",
    cardNo: "رقم البطاقة", exp: "تاريخ الانتهاء", cvc: "الرمز", nameOnCard: "الاسم على البطاقة",
    terms: "بالدفع توافق على شروط تذكرة الطيران وسياسة الإلغاء في الفندق.",
    payBtn: (a) => `ادفع ${a}`, holdBtn: (d) => `احجز حتى ${d}`, processing: "نأكد مع شركة الطيران والفندق",
    errCard: "تأكد من بيانات البطاقة",

    confirmed: "تم الحجز", heldS: "محجوزة مؤقتًا", refL: "رقم الحجز", tripTo: (c) => `رحلتك إلى ${c}`,
    sentTo: (p) => `التذاكر والفواتير في طريقها إلى ${p}.`, heldNote: (d) => `ما خصمنا شيء. ادفع قبل ${d} عشان تحتفظ بالمقاعد.`,
    next: "وش اللي بيصير بعدين", n1: "تم استلام الدفع", n1h: "تم حجز المقاعد", n2: "إصدار التذاكر من شركة الطيران", n3: "إرسال تأكيد الفندق", n4: "إرسال رمز eSIM قبل السفر", n5: "مستشارك يتواصل معك قبل الإقلاع بـ ٢٤ ساعة",
    addCal: "أضف للتقويم", msgAdv: "راسل مستشارك", reqChange: "طلب تعديل", reqCancel: "إلغاء أو استرداد", payNow: (a) => `ادفع ${a} الآن`,
    advIntro: "مستشارك", advLine: "متاح على واتساب من ٨ الصبح إلى ١٢ الليل، كل يوم.",
    waChange: (r) => `السلام عليكم، أبي أعدّل الحجز ${r}.`, waCancel: (r) => `السلام عليكم، أبي ألغي الحجز ${r}.`, waHi: (r) => `السلام عليكم، بخصوص الحجز ${r}.`,
    itemsH: "في هذه الرحلة",
    st: { flight: "تم الإصدار", flightH: "محجوز مؤقتًا", stay: "مؤكد", esim: "الرمز بالبريد", pickup: "بيانات السائق قبل ٢٤ ساعة", car: "مؤكد", visa: "المستشار بيتواصل معك" },

    tripsTitle: "رحلاتك", tripsNone: "ما عندك رحلات للحين.", tripsPlan: "خطط لرحلة", tripsSignin: "سجّل دخولك عشان تشوف الرحلات من أجهزة ثانية.", past: "سابقة",

    siTitle: "سجّل دخولك أو أنشئ حساب", siSub: "بنرسل لك رمز برسالة. بدون كلمات مرور.", siPhone: "رقم الجوال", siSend: "أرسل الرمز",
    siCode: (p) => `أدخل الرمز المرسل إلى ${p}`, siCodeHint: "نسخة تجريبية: أي ٤ أرقام تشتغل.", siVerify: "متابعة", siResend: "أرسل مرة ثانية",
    siName: "وش نناديك؟", siNameL: "اسمك", siDone: "تم", orL: "أو", apple: "المتابعة عبر Apple", google: "المتابعة عبر Google",

    acTitle: "الحساب", acProfile: "الملف الشخصي", acTravelers: "المسافرون المحفوظون", acNone: "ما فيه للحين. ينحفظون لما تحجز.", acRemove: "حذف", acLang: "اللغة", acSave: "حفظ",

    calTitle: "متى مسافر؟", calNote: (p) => `أسعار الطيران، إجمالي لـ ${p}، ذهاب فقط.`, oneWay: "ذهاب فقط", returnL: "ذهاب وعودة", done: "تم",
    whoTitle: "مين مسافر؟", adultsK: "البالغون", adultsS: "١٢ سنة فأكثر", childrenK: "الأطفال", childrenS: "من ٢ إلى ١١", babiesK: "الرضّع", babiesS: "أقل من سنتين، في الحضن",
    fromTitle: "السفر من",
  };

  window.MadaWords = { en, ar };
})();
