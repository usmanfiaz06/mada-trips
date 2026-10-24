/* =========================================================
   MADA BOOK: plan a trip by talking to Mada
   The front door is one box. People say the trip the way they'd say it to a friend; Mada asks only for what's
   missing (one question at a time) and answers with a plan: flight, stay, eSIM, pickup and visa, each one
   switchable, with one all-in total for everyone. Follow-ups ("make it cheaper", "leave a day earlier")
   change the plan in place. The service shortcuts under the box just start the sentence.

   Preview: answers are composed here from js/book-data.js. In production the same plan comes from the
   assistant service (an LLM with tools for fares, hotels, eSIMs and visas) and this file only renders it.
   ========================================================= */
(function () {
  const D = window.MadaData, P = window.MadaParse;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("mada." + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("mada." + k, JSON.stringify(v)); } catch {} },
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);

  // ---------- words ----------
  const T = {
    en: {
      trips: "Trips", help: "Help", lang: "العربية", signIn: "Sign in", askLabel: "Tell Mada about your trip",
      titleNew: "Where to?", titleBack: "Where to next?",
      subNew: "Tell Mada about your trip. Flights, stays, visas and eSIMs, planned in one go and priced for everyone.",
      hiBack: (n) => `Welcome back, ${n}.`, subBack: (c, d) => `Your ${c} trip is in ${d} days. Anything else to plan?`,
      ph: ["Dubai this weekend, 2 of us", "Umrah in December with my family", "Somewhere under 2,000 for a long weekend", "Istanbul on 12 Dec for a week, direct"],
      ph2: ["Ask a follow-up: make it cheaper", "Change anything: leave on Wednesday", "Add more: a car for 3 days"],
      tryL: "Try", tools: { flights: "Flights", stays: "Stays", umrah: "Umrah", visa: "Visa", esim: "eSIM", car: "Car" },
      starts: { stays: "A hotel in ", umrah: "Umrah from Riyadh for ", visa: "I need a visa for ", esim: "An eSIM for ", car: "A car in " },
      adult: ["adult", "adults"], child: ["child", "children"], infant: ["baby", "babies"],
      working: "Checking flights, hotels and prices",
      askWhere: "Where would you like to go? Pick one or type any city.",
      askWhen: (c) => `${c}, good choice. When are you thinking?`, askWhenUmrah: "Umrah, may Allah accept it from you. When are you planning to go?",
      wkThis: "This weekend", wkNext: "Next weekend", in2: "In two weeks", pickDates: "Pick dates",
      planIntro: (c, d, p) => `Here's a plan for <b>${c}</b>, ${d}, for ${p}. Everything below is included in the total. Switch off anything you don't need.`,
      updated: "Done. I've updated the plan.",
      cheapest: (d) => `That's already the cheapest hotel I'd recommend, so I moved you to ${d}, which is cheaper to fly.`,
      budgetIntro: (amt, p) => `Here's where ${amt} takes ${p}, flights and hotel included:`,
      budgetNone: "Nothing fits that budget this weekend. Want me to try other dates?",
      visaAsk: (c) => `I can check and handle the visa for ${c}. Which passport will you travel on?`,
      visaFree: (c) => `Good news: with a Saudi passport you don't need a visa for ${c}. Want me to plan the trip?`,
      visaDo: (c) => `I'll check exactly what ${c} needs for that passport and prepare the application. Your advisor confirms the details with you on WhatsApp.`,
      passports: ["Saudi", "Pakistani", "Indian", "Egyptian", "Other"],
      follow: { cheaper: "Make it cheaper", earlier: "Leave a day earlier", lux: "5★ hotel", flightOnly: "Just the flight", addCar: "Add a car", plus1: "Add a traveler" },
      flight: "Flight", ret: "return", direct: "direct", stop: (c) => `1 stop in ${c}`,
      stay: (s, area, n) => `${s}★ hotel, ${area} · ${n} ${n === 1 ? "night" : "nights"}`, rooms: (r, p) => `${r} ${r === 1 ? "room" : "rooms"} for ${p}`,
      makkahStay: (n) => `Hotel near the Haram, Makkah · ${n} nights`, makkahPick: "Jeddah airport to Makkah, by car",
      esim: (c) => `eSIM for ${c}, 10 GB`, esimSub: "Works the moment you land, one per traveler",
      pickup: "Airport pickup", pickupSub: "Driver waiting at arrivals",
      car: "Rental car", carSub: (n) => `Compact, automatic · ${n} days`,
      visa: "Visa", visaNo: "Not needed with a Saudi passport", visaYes: "We'll check and apply for you", visaChk: "Checked",
      totalFor: (p) => `Total for ${p}, all in`, book: "Book this trip", share: "Send to family",
      shareText: (c, d, p, amt) => `Trip to ${c}, ${d}, for ${p}: ${amt} all in, planned with Mada Trips.`,
      soon: "Checkout is the next screen we're building.",
      mineTitle: "Your trips.", upcoming: "Upcoming", inDays: "days to go", checkIn: (n) => `Check-in opens in ${n} days`, details: "Trip details",
      flightK: "Flight", departK: "Departs", seatK: "Seat", travK: "Travelers",
      watchH: "Price watch", watch: (c, amt) => `${c} is <span class="note__down">${amt} lower</span> than when you looked on Monday.`, watchGo: "Plan it",
      esimH: "Before you go", esimP: (c, amt) => `Add an eSIM for ${c}: 10 GB for ${amt} per traveler, working when you land.`, esimGo: "Add to my trip",
      advH: "Your advisor is online", advP: "Ask anything about your trip, any time.", advGo: "Open WhatsApp",
      railNew: (c) => `Popular from ${c}. <span class="dim">This weekend, flight and hotel, all in.</span>`,
      railBack: () => `Picked for you. <span class="dim">Based on your trips, flight and hotel, all in.</span>`,
      railFor: (p, rt) => `${p} · ${rt}`, nightsL: (n) => `${n} nights`,
      whyH: "Booking, without the tricks.", whyH2: "What you can count on, every trip.",
      w1h: "The first price is the final price.", w1: "Taxes, bags and fees are already in. Nothing gets added at checkout.",
      w2h: "No countdowns. No pressure.", w2: "We'll never invent “only two seats left” to rush you.",
      w3h: "A real person owns your trip.", w3: "One Mada advisor on WhatsApp before, during and after you fly.",
      w4h: "Decide together.", w4: "Send the whole trip to family on WhatsApp. When the airline allows it, we hold your seats while you talk and tell you exactly until when.",
      advisor: "Your Mada advisor", advisorMsg: "Your gate moved to B18. Nothing to do, I've updated your trip.",
      only2: "Only 2 seats left!", shareTo: "To: Family", shareLine: "Thu 29 – Sat 31 Oct · 2 adults · SAR 3,960", shareHeld: "Seats held until 9:40 pm tonight, the airline's limit",
      rFare: "Flights", rTax: "Taxes and airport fees", rStay: "Hotel, 2 nights", rFee: "Booking fee", rTotal: "Total",
      calTitle: "When are you going?", calNote: (p) => `Flight prices, total for ${p}, one way.`, oneWay: "One way", returnL: "Return", done: "Done",
      whoTitle: "Who's going?", adultsK: "Adults", adultsS: "12 and over", childrenK: "Children", childrenS: "2 to 11", babiesK: "Babies", babiesS: "Under 2, on a lap",
      fromTitle: "Flying from", fFrom: "From", fTo: "To", fToPh: "City or airport", fWhen: "When", fWho: "Travelers", fGo: "Search", addDates: "Add dates",
      footer: "© Mada Trips, Riyadh. Prices in this preview are estimates.", photos: "Photo credits",
      demo: "Preview as", demoNew: "New visitor", demoBack: "Returning",
    },
    ar: {
      trips: "رحلاتي", help: "مساعدة", lang: "English", signIn: "تسجيل الدخول", askLabel: "أخبر مادا عن رحلتك",
      titleNew: "إلى أين؟", titleBack: "وين وجهتك الجاية؟",
      subNew: "أخبر مادا عن رحلتك. طيران وفنادق وتأشيرات وشرائح eSIM، نخطط لها مرة وحدة وبسعر شامل للجميع.",
      hiBack: (n) => `أهلًا بعودتك يا ${n}.`, subBack: (c, d) => `رحلتك إلى ${c} بعد ${d} أيام. تبي نخطط لشيء ثاني؟`,
      ph: ["دبي الويكند شخصين", "عمرة في ديسمبر مع العائلة", "أي مكان بأقل من ٢٠٠٠ لعطلة طويلة", "إسطنبول ١٢ ديسمبر لمدة أسبوع مباشر"],
      ph2: ["اسأل: خلّها أرخص", "غيّر أي شيء: السفر يوم الأربعاء", "أضف: سيارة لثلاثة أيام"],
      tryL: "جرّب", tools: { flights: "طيران", stays: "فنادق", umrah: "عمرة", visa: "تأشيرة", esim: "eSIM", car: "سيارة" },
      starts: { stays: "فندق في ", umrah: "عمرة من الرياض لـ ", visa: "أحتاج تأشيرة إلى ", esim: "شريحة eSIM لـ ", car: "سيارة في " },
      adult: ["بالغ", "بالغين"], child: ["طفل", "أطفال"], infant: ["رضيع", "رضّع"],
      working: "أشيّك على الرحلات والفنادق والأسعار",
      askWhere: "وين حاب تسافر؟ اختر أو اكتب أي مدينة.",
      askWhen: (c) => `${c}، اختيار حلو. متى ناوي؟`, askWhenUmrah: "عمرة مقبولة بإذن الله. متى ناوي تروح؟",
      wkThis: "هذا الويكند", wkNext: "الويكند الجاي", in2: "بعد أسبوعين", pickDates: "اختر التاريخ",
      planIntro: (c, d, p) => `هذه خطة لرحلة <b>${c}</b>، ${d}، لـ ${p}. كل شيء تحت داخل في الإجمالي. أوقف أي شيء ما تحتاجه.`,
      updated: "تم. حدّثت الخطة.",
      cheapest: (d) => `هذا أرخص فندق أنصح فيه، فنقلتك إلى ${d} لأن الطيران فيه أرخص.`,
      budgetIntro: (amt, p) => `هذي الأماكن اللي توصلها ${amt} لـ ${p}، شامل الطيران والفندق:`,
      budgetNone: "ما فيه شيء ضمن هذه الميزانية هذا الويكند. أجرب تواريخ ثانية؟",
      visaAsk: (c) => `أقدر أتحقق من تأشيرة ${c} وأخلصها لك. بأي جواز بتسافر؟`,
      visaFree: (c) => `خبر حلو: بالجواز السعودي ما تحتاج تأشيرة لـ ${c}. تبي أخطط لك الرحلة؟`,
      visaDo: (c) => `بتحقق بالضبط من متطلبات ${c} لهذا الجواز وأجهز الطلب. مستشارك يأكد معك التفاصيل على واتساب.`,
      passports: ["سعودي", "باكستاني", "هندي", "مصري", "غير ذلك"],
      follow: { cheaper: "خلّها أرخص", earlier: "سافر قبلها بيوم", lux: "فندق ٥ نجوم", flightOnly: "الطيران بس", addCar: "أضف سيارة", plus1: "أضف مسافر" },
      flight: "الطيران", ret: "العودة", direct: "مباشر", stop: (c) => `توقف في ${c}`,
      stay: (s, area, n) => `فندق ${s} نجوم، ${area} · ${n} ليالٍ`, rooms: (r, p) => `${r} غرفة لـ ${p}`,
      makkahStay: (n) => `فندق قرب الحرم، مكة · ${n} ليالٍ`, makkahPick: "من مطار جدة إلى مكة، بالسيارة",
      esim: (c) => `شريحة eSIM لـ ${c}، ١٠ جيجا`, esimSub: "تشتغل أول ما توصل، واحدة لكل مسافر",
      pickup: "استقبال من المطار", pickupSub: "سائق بانتظارك عند الوصول",
      car: "سيارة إيجار", carSub: (n) => `صغيرة، أوتوماتيك · ${n} أيام`,
      visa: "التأشيرة", visaNo: "ما تحتاجها بالجواز السعودي", visaYes: "نتحقق ونقدّم عنك", visaChk: "تم التحقق",
      totalFor: (p) => `الإجمالي لـ ${p}، شامل كل شيء`, book: "احجز الرحلة", share: "أرسلها للعائلة",
      shareText: (c, d, p, amt) => `رحلة إلى ${c}، ${d}، لـ ${p}: ${amt} شامل كل شيء، خططناها مع مادا للسفر.`,
      soon: "شاشة الدفع هي الخطوة اللي نبنيها الآن.",
      mineTitle: "رحلاتك.", upcoming: "قادمة", inDays: "أيام متبقية", checkIn: (n) => `يفتح إصدار بطاقة الصعود بعد ${n} أيام`, details: "تفاصيل الرحلة",
      flightK: "الرحلة", departK: "الإقلاع", seatK: "المقعد", travK: "المسافرون",
      watchH: "متابعة السعر", watch: (c, amt) => `${c} صارت <span class="note__down">أرخص بـ ${amt}</span> من يوم شفتها الاثنين.`, watchGo: "خطط لها",
      esimH: "قبل السفر", esimP: (c, amt) => `أضف شريحة eSIM لـ ${c}: ١٠ جيجا بـ ${amt} للمسافر، تشتغل أول ما توصل.`, esimGo: "أضفها لرحلتي",
      advH: "مستشارك متصل الآن", advP: "اسأل أي شيء عن رحلتك، في أي وقت.", advGo: "افتح واتساب",
      railNew: (c) => `الأكثر طلبًا من ${c}. <span class="dim">هذا الويكند، طيران وفندق، شامل كل شيء.</span>`,
      railBack: () => `مختارة لك. <span class="dim">حسب رحلاتك، طيران وفندق، شامل كل شيء.</span>`,
      railFor: (p, rt) => `${p} · ${rt}`, nightsL: (n) => `${n} ليالٍ`,
      whyH: "حجز بدون حيل.", whyH2: "وعودنا في كل رحلة.",
      w1h: "أول سعر هو السعر النهائي.", w1: "الضرائب والشنط والرسوم داخلة. ما يُضاف شيء عند الدفع.",
      w2h: "بدون عدّاد. بدون ضغط.", w2: "ما راح نخترع «باقي مقعدين» عشان نستعجلك.",
      w3h: "شخص حقيقي مسؤول عن رحلتك.", w3: "مستشار من مادا على واتساب قبل السفر وأثناءه وبعده.",
      w4h: "قرّروا مع بعض.", w4: "أرسل الرحلة كاملة للعائلة على واتساب. إذا سمحت شركة الطيران، نحجز المقاعد وأنتم تتشاورون ونقول لك بالضبط لين متى.",
      advisor: "مستشارك في مادا", advisorMsg: "بوابتك تغيّرت إلى B18. ما عليك شيء، حدّثت رحلتك.",
      only2: "باقي مقعدين فقط!", shareTo: "إلى: العائلة", shareLine: "الخميس ٢٩ – السبت ٣١ أكتوبر · بالغين · 3,960 ر.س", shareHeld: "المقاعد محجوزة حتى ٩:٤٠ مساءً، حسب شركة الطيران",
      rFare: "الطيران", rTax: "الضرائب ورسوم المطار", rStay: "الفندق، ليلتين", rFee: "رسوم الحجز", rTotal: "الإجمالي",
      calTitle: "متى مسافر؟", calNote: (p) => `أسعار الطيران، إجمالي لـ ${p}، ذهاب فقط.`, oneWay: "ذهاب فقط", returnL: "ذهاب وعودة", done: "تم",
      whoTitle: "مين مسافر؟", adultsK: "البالغون", adultsS: "١٢ سنة فأكثر", childrenK: "الأطفال", childrenS: "من ٢ إلى ١١", babiesK: "الرضّع", babiesS: "أقل من سنتين، في الحضن",
      fromTitle: "السفر من", fFrom: "من", fTo: "إلى", fToPh: "مدينة أو مطار", fWhen: "متى", fWho: "المسافرون", fGo: "ابحث", addDates: "أضف التاريخ",
      footer: "© مادا للسفر، الرياض. الأسعار في هذه النسخة تقديرية.", photos: "حقوق الصور",
      demo: "معاينة كـ", demoNew: "زائر جديد", demoBack: "عائد",
    },
  };
  let lang = params.get("lang") || store.get("lang") || "en";
  const t = (k) => T[lang][k];
  const nf = new Intl.NumberFormat("en-US");
  const money = (n) => (lang === "ar" ? `${nf.format(n)} ر.س` : `SAR ${nf.format(n)}`);
  const loc = () => (lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");
  const fmt = (iso, o) => new Intl.DateTimeFormat(loc(), o).format(new Date(iso + "T12:00:00"));
  const day = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
  const range = (a, b) => {
    if (!b) return day(a);
    if (lang !== "ar") return `${day(a)} – ${day(b)}`;
    const o = { day: "numeric", month: "short" };
    return a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })} – ${fmt(b, o)}` : `${fmt(a, o)} – ${fmt(b, o)}`;
  };
  const city = (c) => { const a = D.byCode[c]; return a ? (lang === "ar" ? a.cityAr : a.city) : ""; };
  const country = (cc) => new Intl.DisplayNames([lang === "ar" ? "ar" : "en"], { type: "region" }).of(cc);
  const plural = (n, k) => `${n} ${t(k)[n === 1 ? 0 : 1]}`;
  const paxText = (p) => [p.a && plural(p.a, "adult"), p.c && plural(p.c, "child"), p.i && plural(p.i, "infant")].filter(Boolean).join(", ");
  const hrs = (m) => (lang === "ar" ? `${Math.floor(m / 60)}س ${m % 60}د` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const todayIso = () => D.iso(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return D.iso(d); };
  const nightsOf = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const weekend = (k = 0) => { const th = D.iso(P.nextDow(new Date(), 4, false)); return { dep: addDays(th, 7 * k), ret: addDays(th, 7 * k + 2) }; };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  const ICO = {
    flights: '<path d="M21 15.5v-1.6l-8-5V4a1.5 1.5 0 0 0-3 0v4.9l-8 5v1.6l8-2.4v4.4l-2 1.5V21l3.5-1 3.5 1v-1.5l-2-1.5v-4.4z"/>',
    stays: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
    umrah: '<path d="M4 8.5 12 5l8 3.5V19H4z"/><path d="M4 11.5h16"/>',
    visa: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
    esim: '<path d="M7 3h7l4 4v14H7z"/><rect x="9.5" y="11" width="6" height="6" rx="1"/>',
    car: '<path d="M5 17h14M5 17v2M19 17v2M4 13l2-5h12l2 5v4H4z"/><circle cx="8" cy="14.5" r=".6"/><circle cx="16" cy="14.5" r=".6"/>',
    pickup: '<path d="M5 17h14M4 13l2-5h12l2 5v4H4z"/><path d="M9 8V5h6v3"/>',
    watch: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    chat: '<path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8z"/>',
  };
  const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
  const SUN = '<svg viewBox="0 0 132 89"><path d="M73.3 0 68.4 41.7a17 17 0 0 0-4.5 0L59 0zM74.1 43.4a17 17 0 0 1 4.2 2.8l25.4-23.5-10.2-8.5zM114.3 35.4 81.8 50.4c.6 1.1 1.2 2.2 1.6 3.4l37.7-6.4zM84.4 60.2l47.9 9.3-4.8-11.4-43.2.5zM58.2 43.4a17 17 0 0 0-4.2 2.8L28.6 22.7l10.2-8.5zM18.1 35.4l32.4 15c-.6 1.1-1.2 2.2-1.6 3.4L11.2 47.4zM48 60.2 0 69.5l4.8-11.4 43.2.5z"/></svg>';

  // ---------- who's visiting ----------
  // A real build reads the signed-in account; the preview fakes one returning traveler so both states can be judged.
  const asParam = params.get("as");
  let as = asParam || store.get("as") || "new";
  const persona = () => ({ name: lang === "ar" ? "فيصل" : "Faisal", trip: { from: "RUH", to: "DXB", dep: addDays(todayIso(), 5), ret: addDays(todayIso(), 8), pax: { a: 2, c: 0, i: 0 }, flight: "SV 553", time: "08:15", seat: "14A" }, watched: "IST" });

  // ---------- the conversation ----------
  const convo = { msgs: [], trip: null, tier: 1, items: {}, flightsOnly: false };
  let from = store.get("from") || "RUH";

  function flightInfo(f, to, dateIso, pax) {
    const q = D.quote(f, to, dateIso, pax); if (!q) return null;
    const h = hash(f + to + dateIso + q.airline);
    const depMin = (6 * 60 + (h % 64) * 15) % (24 * 60);
    const arrMin = (depMin + q.minutes + Math.round((D.byCode[to].tz - D.byCode[f].tz) * 60) + 1440) % 1440;
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { ...q, no: `${q.airline} ${100 + (h % 800)}`, dep: hm(depMin), arr: hm(arrMin), name: lang === "ar" ? D.AIRLINES[q.airline].nameAr : D.AIRLINES[q.airline].name };
  }

  // Everything the plan card shows, priced. Off items stay listed so people can switch them back on.
  function buildPlan(tr) {
    const a = D.byCode[tr.to], cc = a.country, umrah = tr.umrah;
    const out = flightInfo(tr.from, tr.to, tr.dep, tr.pax), back = tr.ret ? flightInfo(tr.to, tr.from, tr.ret, tr.pax) : null;
    const nights = tr.ret ? nightsOf(tr.dep, tr.ret) : 3;
    const people = tr.pax.a + tr.pax.c, rooms = Math.max(1, Math.ceil(tr.pax.a / 2));
    const rates = D.STAY[tr.to] || [250, 450, 950];
    const items = [];
    if (out) items.push({ k: "flight", icon: "flights", title: `${t("flight")} · ${out.name} ${out.no}`, sub: `${day(tr.dep)} ${out.dep} → ${out.arr} · ${hrs(out.minutes)} ${out.direct ? t("direct") : t("stop")(city(out.via))}${back ? ` · ${t("ret")} ${day(tr.ret)} ${back.dep}` : ""}`, price: out.total + (back ? back.total : 0) });
    if (!(D.byCode[tr.from].country === "SA" && cc === "SA" && !umrah && nights < 1)) {
      const stars = [3, 4, 5][convo.tier];
      items.push({ k: "stay", icon: "stays", title: umrah ? t("makkahStay")(nights) : t("stay")(stars, AREA[tr.to] ? AREA[tr.to][lang === "ar" ? 1 : 0] : city(tr.to), nights), sub: t("rooms")(rooms, paxText(tr.pax)), price: rates[convo.tier] * nights * rooms });
    }
    if (D.ESIM[cc]) items.push({ k: "esim", icon: "esim", title: t("esim")(country(cc)), sub: t("esimSub"), price: D.ESIM[cc] * people });
    const pk = umrah ? 260 : D.PICKUP[tr.to];
    if (pk) items.push({ k: "pickup", icon: "pickup", title: umrah ? t("makkahPick") : t("pickup"), sub: t("pickupSub"), price: pk * (people > 4 ? 2 : 1) });
    if (convo.items.car) items.push({ k: "car", icon: "car", title: t("car"), sub: t("carSub")(nights || 1), price: 175 * Math.max(1, nights) });
    if (cc !== "SA") items.push({ k: "visa", icon: "visa", title: t("visa"), sub: D.GCC.has(cc) ? t("visaNo") : t("visaYes"), price: null, info: true });
    for (const it of items) if (!it.info) it.on = convo.items[it.k] !== false && !(convo.flightsOnly && it.k !== "flight");
    const total = items.reduce((s, it) => s + (it.on ? it.price : 0), 0);
    return { items, total, nights };
  }
  const AREA = { DXB: ["Downtown", "داون تاون"], IST: ["Sultanahmet", "السلطان أحمد"], ULH: ["Old Town", "البلدة القديمة"], CAI: ["Zamalek", "الزمالك"], MLE: ["water villa", "فيلا على الماء"], LHR: ["Mayfair", "مايفير"], KUL: ["KLCC", "وسط المدينة"], GVA: ["the lake", "على البحيرة"], JED: ["the Corniche", "الكورنيش"] };

  function say(html, extra = "") { convo.msgs.push({ who: "mada", html, extra }); }
  function you(text) { convo.msgs.push({ who: "you", text }); }

  // Read a message in the context of the trip so far: new facts replace old ones, everything else is kept.
  function reply(text, raw) {
    const s = raw ? "" : P.norm(text);
    const p = P.parse(raw ? "" : text);
    const tr = convo.trip ? { ...convo.trip } : { from, to: null, dep: null, ret: null, pax: store.get("pax") || { a: 1, c: 0, i: 0 } };
    let changed = false, note = "";
    const has = (re) => re.test(s);

    if (has(/visa|تاشير/) && !convo.visa) {
      convo.visa = { to: p.to || tr.to };
      if (convo.visa.to) return say(esc(t("visaAsk")(country(D.byCode[convo.visa.to].country))), chips(t("passports").map((x, i) => ({ a: "pp", v: i, l: x }))));
      return say(esc(t("askWhere")), destChips());
    }
    if (convo.trip && convo.plan) {
      if (has(/cheap|less|lower|ارخص|رخيص/)) {
        if (convo.tier > 0) convo.tier--; else { const ctx = D.priceContext(tr.from, tr.to, tr.dep, tr.pax); if (ctx && ctx.cheaper) { const n = tr.ret ? nightsOf(tr.dep, tr.ret) : 0; tr.dep = ctx.cheaper.date; if (n) tr.ret = addDays(tr.dep, n); note = t("cheapest")(day(tr.dep)); } }
        changed = true;
      }
      if (has(/earlier|day before|قبلها|قبل بيوم/)) { tr.dep = addDays(tr.dep, -1); if (tr.ret) tr.ret = addDays(tr.ret, -1); if (tr.dep < todayIso()) tr.dep = todayIso(); changed = true; }
      if (has(/later|day after|بعدها بيوم/)) { tr.dep = addDays(tr.dep, 1); if (tr.ret) tr.ret = addDays(tr.ret, 1); changed = true; }
      if (has(/5 ?star|five star|luxury|فخم|5 نجوم|٥ نجوم/)) { convo.tier = 2; changed = true; }
      if (has(/4 ?star|four star/)) { convo.tier = 1; changed = true; }
      if (has(/just the flight|only the flight|flight only|الطيران بس|طيران فقط/)) { convo.flightsOnly = true; changed = true; }
      if (has(/add a traveler|one more|another person|اضف مسافر|شخص زياده/)) { tr.pax = { ...tr.pax, a: Math.min(9, tr.pax.a + 1) }; changed = true; }
    }
    if (p.from) tr.from = p.from;
    if (p.to && p.to !== tr.to) { tr.to = p.to; changed = true; convo.tier = 1; convo.items = {}; convo.flightsOnly = false; }
    tr.umrah = tr.to === "JED" && (p.makkah || tr.umrah);
    if (p.dates.length) { tr.dep = p.dates[0]; tr.ret = p.oneWay ? null : p.dates[1] || (p.nights ? addDays(p.dates[0], p.nights) : null); changed = true; }
    else if (p.nights && tr.dep) { tr.ret = addDays(tr.dep, p.nights); changed = true; }
    if (p.pax) { tr.pax = p.pax; store.set("pax", p.pax); changed = true; }
    if (has(/\bcar\b|سياره/)) { convo.items.car = true; convo.flightsOnly = false; changed = true; }
    // "A hotel in Dubai" or "an eSIM for Istanbul": start the plan with just that switched on.
    if (!convo.plan && has(/hotel|\bstay\b|فندق/) && !has(/flight|طيران/)) convo.items = { ...convo.items, flight: false };
    if (!convo.plan && has(/esim|شريحه/)) convo.items = { ...convo.items, flight: false, stay: false, pickup: false };

    convo.trip = tr;
    if (!tr.to) {
      if (p.budget) return budgetAnswer(p.budget, tr);
      return say(esc(t("askWhere")), destChips());
    }
    if (!tr.dep) return say(esc(tr.umrah ? t("askWhenUmrah") : t("askWhen")(city(tr.to))), chips([{ a: "wk", v: 0, l: t("wkThis") }, { a: "wk", v: 1, l: t("wkNext") }, { a: "in2", l: t("in2") }, { a: "cal", l: t("pickDates") }]));
    if (tr.ret && tr.ret <= tr.dep) tr.ret = null;
    const first = !convo.plan;
    convo.plan = true;
    store.set("last", { from: tr.from, to: tr.to, dep: tr.dep, ret: tr.ret, pax: tr.pax });
    say((note ? esc(note) + " " : first || !changed ? t("planIntro")(esc(city(tr.to)), esc(range(tr.dep, tr.ret)), esc(paxText(tr.pax))) : esc(t("updated"))), "plan");
  }

  function budgetAnswer(budget, tr) {
    const w = weekend();
    const list = D.POPULAR.filter((c) => c !== tr.from).map((c) => ({ c, total: tripTotal(tr.from, c, w.dep, w.ret, tr.pax) })).filter((x) => x.total && x.total <= budget).sort((a, b) => a.total - b.total).slice(0, 4);
    if (!list.length) return say(esc(t("budgetNone")), chips([{ a: "say", l: t("wkNext"), v: t("wkNext") }]));
    say(esc(t("budgetIntro")(money(budget), paxText(tr.pax))), chips(list.map((x) => ({ a: "go", v: x.c, l: `${city(x.c)} · ${money(x.total)}` }))));
  }
  const tripTotal = (f, to, dep, ret, pax) => {
    const o = D.quote(f, to, dep, pax), r = ret && D.quote(to, f, ret, pax); if (!o) return null;
    const rooms = Math.max(1, Math.ceil(pax.a / 2)), n = ret ? nightsOf(dep, ret) : 0;
    return o.total + (r ? r.total : 0) + (D.STAY[to] ? D.STAY[to][1] * n * rooms : 0);
  };
  const ensureTrip = () => (convo.trip = convo.trip || { from, to: null, dep: null, ret: null, pax: store.get("pax") || { a: 1, c: 0, i: 0 } });
  const destChips = () => chips(D.POPULAR.slice(0, 5).map((c) => ({ a: "go", v: c, l: city(c) })));
  const chips = (list) => `<div class="chips">${list.map((c) => `<button type="button" class="chip" data-a="${c.a}" data-v="${esc(c.v ?? "")}">${esc(c.l)}</button>`).join("")}</div>`;

  // ---------- render the thread ----------
  function renderThread(working) {
    const el = $("#thread");
    let html = "";
    convo.msgs.forEach((m, i) => {
      if (m.who === "you") { html += `<div class="bub">${esc(m.text)}</div>`; return; }
      const last = i === convo.msgs.length - 1;
      html += `<div class="say"><span class="say__mark">${SUN}</span><div class="say__body"><p class="say__text">${m.html}</p>${last ? (m.extra === "plan" ? planCard() + followChips() : m.extra) : ""}</div></div>`;
    });
    if (working) html += `<div class="say"><span class="say__mark">${SUN}</span><div class="say__body"><span class="say__work">${esc(t("working"))} <i></i><i></i><i></i></span></div></div>`;
    el.innerHTML = html;
    const wasChat = document.body.classList.contains("is-chat");
    document.body.classList.toggle("is-chat", convo.msgs.length > 0);
    if (!wasChat && convo.msgs.length) typePlaceholder();
    grow();
  }
  function planCard() {
    const tr = convo.trip, plan = buildPlan(tr), d = D.DEST[tr.to];
    const img = d ? `<img src="${D.photo(tr.to)}" alt="" style="object-position:${d.pos}" />${d.credit !== "Mada Trips" ? `<small>${esc(d.credit)}</small>` : ""}` : "";
    return `<div class="plan">
      <div class="plan__hero">${img}<b>${esc(tr.umrah ? (lang === "ar" ? "عمرة، مكة" : "Umrah, Makkah") : city(tr.to))}</b><span>${esc(range(tr.dep, tr.ret))} · ${esc(paxText(tr.pax))}</span></div>
      ${plan.items.map((it) => `<div class="item${it.info ? " info" : it.on ? "" : " off"}" data-k="${it.k}">${ico(it.icon)}<div class="item__t"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></div><span class="item__p">${it.info ? esc(t("visaChk")) : esc(money(it.price))}</span><button type="button" class="tog" data-tog="${it.k}" ${it.info ? "disabled" : ""} aria-pressed="${!!it.on}" aria-label="${esc(it.title)}"></button></div>`).join("")}
      <div class="plan__foot"><div class="plan__total"><small>${esc(t("totalFor")(paxText(tr.pax)))}</small><b>${esc(money(plan.total))}</b></div>
        <div class="plan__go"><button type="button" class="btn btn--plain" data-a="share">${esc(t("share"))}</button><button type="button" class="btn btn--main" data-a="book">${esc(t("book"))}</button></div></div>
    </div>`;
  }
  function followChips() {
    const f = t("follow");
    return chips([{ a: "say", v: f.cheaper, l: f.cheaper }, { a: "say", v: f.earlier, l: f.earlier }, { a: "say", v: f.lux, l: f.lux }, { a: "say", v: f.addCar, l: f.addCar }, { a: "say", v: f.flightOnly, l: f.flightOnly }, { a: "say", v: f.plus1, l: f.plus1 }]);
  }

  let busy = false;
  // raw: the trip was already changed by a tap (a chip, a card, the calendar); the text is only what the bubble shows.
  function send(text, raw) {
    text = text.trim(); if (!text || busy) return;
    you(text); busy = true; renderThread(true);
    const show = () => { const last = $("#thread").lastElementChild; if (last) last.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); };
    show();
    // Show the newest answer from its first line, so a plan card reads top-down.
    setTimeout(() => { reply(text, raw); busy = false; renderThread(false); renderRest(); show(); }, reduce ? 0 : 650);
  }

  // ---------- returning visitor: their trips ----------
  function renderMine() {
    const el = $("#trips");
    if (as !== "back") { el.innerHTML = ""; return; }
    const me = persona(), tr = me.trip, daysTo = nightsOf(todayIso(), tr.dep);
    el.innerHTML = `<h2 class="sec-title">${esc(t("mineTitle"))}</h2>
      <div class="mine__grid">
        <article class="pass">
          <div class="pass__main">
            <span class="pass__eye">${esc(t("upcoming"))} · ${esc(range(tr.dep, tr.ret))}</span>
            <div class="pass__route"><div><b>${tr.from}</b><span>${esc(city(tr.from))}</span></div><i class="pass__line"></i><div><b>${tr.to}</b><span>${esc(city(tr.to))}</span></div></div>
            <dl class="pass__grid"><div><dt>${esc(t("flightK"))}</dt><dd>${tr.flight}</dd></div><div><dt>${esc(t("departK"))}</dt><dd>${tr.time}</dd></div><div><dt>${esc(t("seatK"))}</dt><dd>${tr.seat}</dd></div><div><dt>${esc(t("travK"))}</dt><dd>${tr.pax.a}</dd></div></dl>
          </div>
          <div class="pass__stub"><div class="pass__count"><b>${daysTo}</b><span>${esc(t("inDays"))}</span></div><span class="dim" style="font-size:13px">${esc(t("checkIn")(Math.max(1, daysTo - 1)))}</span><a href="#">${esc(t("details"))} →</a></div>
        </article>
        <div class="mine__side">
          <div class="note">${ico("watch")}<div><b>${esc(t("watchH"))}</b><p>${t("watch")(esc(city(me.watched)), esc(money(210)))}</p><button type="button" data-a="say" data-v="${esc(city(me.watched))} ${esc(lang === "ar" ? "الويكند" : "this weekend")}">${esc(t("watchGo"))} →</button></div></div>
          <div class="note">${ico("esim")}<div><b>${esc(t("esimH"))}</b><p>${esc(t("esimP")(country("AE"), money(D.ESIM.AE)))}</p><button type="button" data-a="toast">${esc(t("esimGo"))} →</button></div></div>
          <div class="note">${ico("chat")}<div><b>${esc(t("advH"))}</b><p>${esc(t("advP"))}</p><a class="lnk" href="https://wa.me/966566682662" target="_blank" rel="noopener">${esc(t("advGo"))} →</a></div></div>
        </div>
      </div>`;
  }

  // ---------- rail ----------
  function renderRail() {
    const w = weekend(), pax = (convo.trip && convo.trip.pax) || store.get("pax") || { a: 2, c: 0, i: 0 };
    let list = D.POPULAR.filter((c) => c !== from);
    if (as === "back") list = list.filter((c) => c !== "DXB").sort((a, b) => (a === persona().watched ? -1 : b === persona().watched ? 1 : 0));
    $("#railTitle").innerHTML = as === "back" ? t("railBack")() : t("railNew")(esc(city(from)));
    $("#track").innerHTML = list.map((code) => {
      const d = D.DEST[code], q = D.quote(from, code, w.dep, pax), total = tripTotal(from, code, w.dep, w.ret, pax);
      if (!q || !total) return "";
      return `<button type="button" class="card" data-a="go" data-v="${code}" data-dates="1">
        <img src="${D.photo(code, true)}" alt="" loading="lazy" style="object-position:${d.pos}" />
        <span class="card__eye">${esc(q.direct ? `${hrs(q.minutes)} ${t("direct")}` : `${hrs(q.minutes)} · ${t("stop")(city(q.via))}`)}</span>
        <span class="card__city">${esc(city(code))}</span>
        <span class="card__line">${esc(lang === "ar" ? d.ar : d.en)}</span>
        <span class="card__foot"><span class="card__price"><b>${esc(money(total))}</b><small>${esc(t("railFor")(paxText(pax), t("nightsL")(2)))}</small></span><span class="card__plus" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5v11M2.5 8h11"/></svg></span></span>
      </button>`;
    }).join("");
    railArrows();
  }
  function railArrows() {
    const tr = $("#track"), x = tr.scrollLeft * (lang === "ar" ? -1 : 1);
    $('.rail__arrow[data-dir="-1"]').disabled = x <= 4;
    $('.rail__arrow[data-dir="1"]').disabled = x >= tr.scrollWidth - tr.clientWidth - 4;
  }

  function renderReceipt() {
    const tr = convo.trip && convo.plan ? convo.trip : null;
    let fl = 1830, stay = 1240;
    if (tr) { const pl = buildPlan(tr); fl = (pl.items.find((i) => i.k === "flight") || {}).price || 0; stay = pl.total - fl; }
    const tax = Math.round(fl * 0.12 / 5) * 5;
    $("#receipt").innerHTML = `<div><span>${esc(t("rFare"))}</span><span>${esc(money(fl - tax))}</span></div><div><span>${esc(t("rTax"))}</span><span>${esc(money(tax))}</span></div><div><span>${esc(tr ? t("rStay").split(",")[0] : t("rStay"))}</span><span>${esc(money(stay))}</span></div><div><span>${esc(t("rFee"))}</span><span class="zero">${esc(money(0))}</span></div><div><span>${esc(t("rTotal"))}</span><span>${esc(money(fl + stay))}</span></div>`;
  }

  // ---------- static parts ----------
  function renderStatic() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
    $("#langBtn").textContent = t("lang");
    const me = persona(), back = as === "back";
    $("#hi").textContent = back ? t("hiBack")(me.name) : "";
    $("#title").textContent = back ? t("titleBack") : t("titleNew");
    $("#sub").textContent = back ? t("subBack")(city(me.trip.to), nightsOf(todayIso(), me.trip.dep)) : t("subNew");
    const acct = $("#acct");
    acct.classList.toggle("is-in", back);
    acct.innerHTML = back ? `<i>${esc(me.name[0])}</i>${esc(me.name)}` : esc(t("signIn"));
    const tools = t("tools");
    $("#tools").innerHTML = Object.keys(tools).map((k) => `<button type="button" class="tool${k === "flights" && fieldsOpen ? " on" : ""}" data-tool="${k}">${ico(k)}${esc(tools[k])}</button>`).join("");
    $("#hints").innerHTML = `<span>${esc(t("tryL"))}</span>` + t("ph").slice(0, 3).map((s) => `<button type="button" data-a="say" data-v="${esc(s)}">${esc(s)}</button>`).join("");
    $$(".demo button").forEach((b) => b.classList.toggle("on", b.dataset.as === as));
    $("#credits").innerHTML = Object.entries(D.DEST).filter(([, d]) => d.src).map(([c, d]) => `<li>${esc(city(c))}: <a href="${d.src}" target="_blank" rel="noopener">${esc(d.credit)}</a></li>`).join("");
    renderFields();
  }
  function renderRest() { renderMine(); renderRail(); renderReceipt(); }

  // ---------- classic flight fields (for people who prefer them) ----------
  let fieldsOpen = false;
  const fstate = { to: null, dep: null, ret: null, pax: null };
  function renderFields() {
    let el = $("#fields");
    if (!fieldsOpen) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "fields"; el.className = "fields"; $("#hints").before(el); }
    const pax = fstate.pax || store.get("pax") || { a: 1, c: 0, i: 0 };
    el.innerHTML = `<button type="button" class="seg seg--from" data-pop="from"><span class="seg__k">${esc(t("fFrom"))}</span><span class="seg__v">${esc(city(from))}</span></button>
      <label class="seg seg--to"><span class="seg__k">${esc(t("fTo"))}</span><input class="seg__in" id="fTo" placeholder="${esc(t("fToPh"))}" value="${fstate.to ? esc(city(fstate.to)) : ""}" /></label>
      <button type="button" class="seg seg--when" data-pop="when"><span class="seg__k">${esc(t("fWhen"))}</span><span class="seg__v${fstate.dep ? "" : " is-muted"}">${esc(fstate.dep ? range(fstate.dep, fstate.ret) : t("addDates"))}</span></button>
      <button type="button" class="seg seg--who" data-pop="who"><span class="seg__k">${esc(t("fWho"))}</span><span class="seg__v">${esc(paxText(pax))}</span></button>
      <button type="button" class="btn btn--main" data-a="fgo">${esc(t("fGo"))}</button>`;
  }

  // ---------- popovers (dates, travelers, origin) ----------
  let open = null, calMonth = null, calMode = "ret", popFor = null;
  const popTrip = () => (popFor === "fields" ? { from, to: fstate.to, dep: fstate.dep, ret: fstate.ret, pax: fstate.pax || store.get("pax") || { a: 1, c: 0, i: 0 } } : convo.trip || { from, pax: { a: 1, c: 0, i: 0 } });
  function openPop(kind, anchor, forWhat) {
    open = kind; popFor = forWhat;
    $$(".is-open").forEach((s) => s.classList.remove("is-open")); anchor.classList.add("is-open");
    const tr = popTrip();
    if (kind === "when") calMonth = (tr.dep || todayIso()).slice(0, 7);
    $("#pop").hidden = false; drawPop();
    const card = $("#popCard"), r = anchor.getBoundingClientRect(), w = card.offsetWidth;
    let x = lang === "ar" ? r.right - w : r.left; x = Math.max(12, Math.min(x, innerWidth - w - 12));
    let y = r.bottom + 10; if (y + card.offsetHeight > innerHeight - 12) y = Math.max(12, r.top - card.offsetHeight - 10);
    card.style.left = x + "px"; card.style.top = y + "px";
  }
  function closePop() { open = null; $("#pop").hidden = true; $$(".is-open").forEach((s) => s.classList.remove("is-open")); }
  function drawPop() {
    const card = $("#popCard"), tr = popTrip(), today = todayIso();
    if (open === "who") {
      const p = tr.pax, room = 9 - p.a - p.c;
      const row = (k, key, sub, v, min, max) => `<div class="who__row"><div><b>${esc(t(key))}</b><small>${esc(t(sub))}</small></div><div class="step"><button type="button" data-step="${k}" data-d="-1" ${v <= min ? "disabled" : ""} aria-label="−">−</button><output>${v}</output><button type="button" data-step="${k}" data-d="1" ${v >= max ? "disabled" : ""} aria-label="+">+</button></div></div>`;
      card.innerHTML = `<div class="who"><div class="pop__h"><b>${esc(t("whoTitle"))}</b></div>${row("a", "adultsK", "adultsS", p.a, 1, p.a + room)}${row("c", "childrenK", "childrenS", p.c, 0, p.c + room)}${row("i", "babiesK", "babiesS", p.i, 0, p.a)}<div class="pop__foot"><span></span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div></div>`;
    } else if (open === "from") {
      card.innerHTML = `<div class="from"><div class="pop__h"><b>${esc(t("fromTitle"))}</b></div>${["RUH", "JED", "DMM", "MED", "AHB", "TUU", "ULH", "GIZ", "TIF"].map((c) => `<button type="button" data-from="${c}" class="${c === from ? "on" : ""}">${esc(city(c))}<span>${c}</span></button>`).join("")}</div>`;
    } else if (open === "when") {
      const next = (() => { const [y, m] = calMonth.split("-").map(Number); return D.iso(new Date(y, m, 1, 12)).slice(0, 7); })();
      const dows = [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(loc(), { weekday: "narrow" }).format(new Date(2024, 0, 7 + i, 12)));
      const short = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
      const html = [calMonth, next].map((ym) => {
        const [y, m] = ym.split("-").map(Number), first = new Date(y, m - 1, 1, 12), days = new Date(y, m, 0).getDate();
        const prices = []; for (let d = 1; d <= days; d++) { const iso = D.iso(new Date(y, m - 1, d, 12)); const q = tr.to && iso >= today ? D.quote(tr.from || from, tr.to, iso, tr.pax) : null; prices.push(q ? q.total : null); }
        const vals = prices.filter(Boolean).sort((a, b) => a - b), low = vals[Math.floor(vals.length * 0.25)] || 0;
        let g = dows.map((w) => `<span class="cal__dow">${w}</span>`).join("") + "<span></span>".repeat(first.getDay());
        for (let d = 1; d <= days; d++) {
          const iso = D.iso(new Date(y, m - 1, d, 12)), p = prices[d - 1];
          const cls = [iso < today ? "off" : "", iso === tr.dep || iso === tr.ret ? "sel" : "", tr.dep && tr.ret && iso > tr.dep && iso < tr.ret ? "in" : "", p && p <= low ? "low" : ""].join(" ");
          g += `<button type="button" class="cal__d ${cls}" data-day="${iso}" ${iso < today ? "disabled" : ""}>${d}${p ? `<small>${short(p)}</small>` : ""}</button>`;
        }
        return `<div class="cal__m"><b>${esc(new Intl.DateTimeFormat(loc(), { month: "long", year: "numeric" }).format(first))}</b><div class="cal__g">${g}</div></div>`;
      }).join("");
      card.innerHTML = `<div class="pop__h"><b>${esc(t("calTitle"))}</b><span class="seg2"><button type="button" data-mode="one" class="${calMode === "one" ? "on" : ""}">${esc(t("oneWay"))}</button><button type="button" data-mode="ret" class="${calMode === "ret" ? "on" : ""}">${esc(t("returnL"))}</button></span><span class="step"><button type="button" data-month="-1" aria-label="Previous month" ${calMonth <= today.slice(0, 7) ? "disabled" : ""}>‹</button><button type="button" data-month="1" aria-label="Next month">›</button></span></div><div class="cal">${html}</div><div class="pop__foot"><span>${esc(tr.to ? t("calNote")(paxText(tr.pax)) : "")}</span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div>`;
    }
  }
  function setDates(dep, ret) {
    if (popFor === "fields") { fstate.dep = dep; fstate.ret = ret; renderFields(); return; }
    const tr = convo.trip; tr.dep = dep; tr.ret = ret;
  }
  function onPop(e) {
    const b = e.target.closest("button");
    if (!b) { if (e.target === $("#pop")) finishPop(); return; }
    const tr = popTrip();
    if (b.dataset.close != null) return finishPop();
    if (b.dataset.step) { const p = { ...tr.pax }; p[b.dataset.step] += +b.dataset.d; p.i = Math.min(p.i, p.a); store.set("pax", p); if (popFor === "fields") { fstate.pax = p; renderFields(); } else if (convo.trip) convo.trip.pax = p; drawPop(); return; }
    if (b.dataset.from) { from = b.dataset.from; store.set("from", from); if (convo.trip) convo.trip.from = from; renderFields(); renderRail(); closePop(); return; }
    if (b.dataset.mode) { calMode = b.dataset.mode; if (calMode === "one" && tr.dep) setDates(tr.dep, null); drawPop(); return; }
    if (b.dataset.month) { const [y, m] = calMonth.split("-").map(Number); calMonth = D.iso(new Date(y, m - 1 + +b.dataset.month, 1, 12)).slice(0, 7); drawPop(); return; }
    if (b.dataset.day) {
      const d = b.dataset.day;
      if (calMode === "ret" && tr.dep && !tr.ret && d > tr.dep) { setDates(tr.dep, d); drawPop(); setTimeout(finishPop, 260); }
      else { setDates(d, null); drawPop(); if (calMode === "one") setTimeout(finishPop, 260); }
    }
  }
  // Dates picked for the conversation go back to Mada as an answer, so the plan follows.
  function finishPop() {
    const was = open, forWhat = popFor; closePop();
    if (forWhat === "chat" && was === "when" && convo.trip && convo.trip.dep) send(range(convo.trip.dep, convo.trip.ret), true);
  }

  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("is-on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("is-on"), 2600); }

  // ---------- placeholder that types example trips ----------
  let phTimer;
  function typePlaceholder() {
    clearTimeout(phTimer);
    const input = $("#q"), ex = t(document.body.classList.contains("is-chat") ? "ph2" : "ph");
    if (reduce) { input.placeholder = ex[0]; return; }
    let i = 0, n = 0, del = false;
    const tick = () => { const s = ex[i]; n += del ? -1 : 1; input.placeholder = s.slice(0, n); let w = del ? 16 : 48; if (!del && n >= s.length) { del = true; w = 2600; } else if (del && n <= 0) { del = false; i = (i + 1) % ex.length; w = 400; } phTimer = setTimeout(tick, w); };
    tick();
  }

  // ---------- speech ----------
  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $("#mic"); if (!SR) return;
    mic.hidden = false;
    let rec = null;
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = lang === "ar" ? "ar-SA" : "en-US"; rec.interimResults = true;
      mic.classList.add("is-live");
      rec.onresult = (e) => { const txt = [...e.results].map((r) => r[0].transcript).join(" "); $("#q").value = txt; grow(); if (e.results[e.results.length - 1].isFinal) { send(txt); $("#q").value = ""; grow(); } };
      rec.onend = () => { mic.classList.remove("is-live"); rec = null; };
      rec.start();
    });
  }
  const grow = () => { const q = $("#q"); q.style.height = "auto"; q.style.height = q.scrollHeight + "px"; };

  // ---------- wire ----------
  function onAction(b) {
    const a = b.dataset.a, v = b.dataset.v;
    if (a === "say") return send(v);
    if (a === "go") {
      const tr = ensureTrip();
      if (tr.to !== v) { tr.to = v; tr.umrah = false; convo.tier = 1; convo.items = {}; convo.flightsOnly = false; convo.plan = false; }
      if (b.dataset.dates) { const w = weekend(); tr.dep = w.dep; tr.ret = w.ret; return send(`${city(v)}, ${range(w.dep, w.ret)}`, true); }
      return send(city(v), true);
    }
    if (a === "wk") { const w = weekend(+v), tr = ensureTrip(); tr.dep = w.dep; tr.ret = w.ret; return send(range(w.dep, w.ret), true); }
    if (a === "in2") { const d = addDays(todayIso(), 14), tr = ensureTrip(); tr.dep = d; tr.ret = addDays(d, 3); return send(range(tr.dep, tr.ret), true); }
    if (a === "cal") return openPop("when", b, "chat");
    if (a === "pp") {
      const c = country(D.byCode[convo.visa.to].country), saudi = +v === 0, gcc = D.GCC.has(D.byCode[convo.visa.to].country);
      you(b.textContent); say(esc(saudi && gcc ? t("visaFree")(c) : t("visaDo")(c)), saudi && gcc ? chips([{ a: "go", v: convo.visa.to, l: city(convo.visa.to) }]) : "");
      convo.visa = null; renderThread(false); return;
    }
    if (a === "book" || a === "toast") return toast(t("soon"));
    if (a === "share") {
      const tr = convo.trip, plan = buildPlan(tr);
      window.open("https://wa.me/?text=" + encodeURIComponent(t("shareText")(city(tr.to), range(tr.dep, tr.ret), paxText(tr.pax), money(plan.total)) + " " + location.origin + "/book"), "_blank", "noopener");
      return;
    }
    if (a === "fgo") {
      const typed = $("#fTo").value; const p = P.parse(typed); fstate.to = p.to || fstate.to;
      if (!fstate.to) return $("#fTo").focus();
      if (!fstate.dep) return openPop("when", $(".fields .seg--when"), "fields");
      convo.trip = { from, to: fstate.to, dep: fstate.dep, ret: fstate.ret, pax: fstate.pax || store.get("pax") || { a: 1, c: 0, i: 0 } };
      convo.flightsOnly = true; convo.plan = false;
      return send(`${city(from)} → ${city(fstate.to)}, ${range(fstate.dep, fstate.ret)}`, true);
    }
  }

  function init() {
    const q = $("#q");
    q.addEventListener("input", grow);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ask").requestSubmit(); } });
    $("#ask").addEventListener("submit", (e) => { e.preventDefault(); const v = q.value; q.value = ""; grow(); send(v); });
    $("#tools").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]"); if (!b) return;
      const k = b.dataset.tool;
      if (k === "flights") { fieldsOpen = !fieldsOpen; renderStatic(); if (fieldsOpen) setTimeout(() => $("#fTo") && $("#fTo").focus(), 30); return; }
      q.value = t("starts")[k]; grow(); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
    });
    document.addEventListener("click", (e) => {
      const tg = e.target.closest("[data-tog]");
      if (tg) { const k = tg.dataset.tog, on = tg.getAttribute("aria-pressed") === "true"; if (k === "flight" || !on) convo.flightsOnly = false; convo.items[k] = !on; renderThread(false); renderReceipt(); return; }
      const seg = e.target.closest(".fields [data-pop]"); if (seg) return openPop(seg.dataset.pop, seg, "fields");
      const b = e.target.closest("[data-a]"); if (b && !b.closest("#pop")) onAction(b);
    });
    $("#pop").addEventListener("click", onPop);
    addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
    $("#track").addEventListener("scroll", railArrows, { passive: true });
    $$(".rail__arrow").forEach((b) => b.addEventListener("click", () => { const tr = $("#track"); tr.scrollBy({ left: +b.dataset.dir * (lang === "ar" ? -1 : 1) * tr.clientWidth * 0.8, behavior: "smooth" }); }));
    $("#langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("lang", lang); renderStatic(); typePlaceholder(); renderThread(false); renderRest(); });
    $$(".demo button").forEach((b) => b.addEventListener("click", () => { as = b.dataset.as; store.set("as", as); renderStatic(); renderRest(); }));
    $("#acct").addEventListener("click", (e) => { e.preventDefault(); toast(t("soon")); });
    setupMic(); renderStatic(); typePlaceholder(); renderRest();
    if (params.get("q")) send(params.get("q"));
  }
  document.addEventListener("DOMContentLoaded", init);
})();
