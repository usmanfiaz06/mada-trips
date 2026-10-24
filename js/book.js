/* =========================================================
   MADA BOOK: the booking home
   One sentence in, a trip out. People type the trip the way they'd say it to a friend; we show what we understood
   as it happens, fill a ticket live, and price it all-in for everyone before they press anything.
   ========================================================= */
(function () {
  const D = window.MadaData;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("mada." + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("mada." + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- language ----------
  const T = {
    en: {
      tabFlights: "Flights", tabStays: "Stays", tabVisas: "Visas", tabUmrah: "Umrah", myTrips: "My trips", human: "Talk to a person",
      morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening",
      ask: "Where to next?",
      sub: "Type it the way you'd say it. We'll work out the rest.",
      from: "From", change: "change",
      examples: ["Dubai this weekend, 2 of us", "Jeddah next Thursday, family of 5", "Somewhere under 2,000 in November", "London on 12 Dec for a week", "Istanbul, me and my wife, direct"],
      go: "Show me flights", goShort: "Flights", oneStop: "1 stop",
      understood: "Here's what I got",
      noDest: "Where to? Type a city or pick one below",
      to: "To", depart: "Depart", ret: "Return", who: "Travelers", oneWay: "One way",
      adult: ["adult", "adults"], child: ["child", "children"], infant: ["baby", "babies"],
      direct: "Direct only", cheap: "Cheapest first", budget: "Under", flight: "Flight",
      allIn: "everything included, for everyone",
      about: "about",
      goodPrice: "Good price. Cheaper than most days around it.",
      highPrice: "Busy day. Prices are higher than usual.",
      saveOn: (amt, day) => `Fly ${day} instead and save ${amt}`,
      apply: "Use it",
      directH: (h) => `${h} direct`, via: (h, c) => `${h} · 1 stop in ${c}`,
      popular: (city) => `Weekends from ${city}`,
      popularBudget: (amt, n) => `Where ${amt} takes ${n}`,
      totalFor: (n) => `total for ${n}`, roundTrip: "round trip", oneWayL: "one way",
      noneFit: "Nothing fits that budget on these dates. Try other dates or a little more.",
      promiseH: "The Mada promise",
      p1h: "One price, start to finish", p1: "The number you see first is the number you pay. Taxes, bags and fees are already in it.",
      p2h: "No fake pressure", p2: "No “only 2 seats left”, no countdown timers. Take your time.",
      p3h: "A real person owns your trip", p3: "One named Mada advisor on WhatsApp, before and after you fly. No call centres, no ping-pong with the airline.",
      p4h: "Hold it, then pay", p4: "Not sure yet? Hold the fare for 24 hours and decide with your family.",
      resume: "Pick up where you left off",
      ticketTitle: "Your trip", ticketEmpty: "Your ticket fills in as you type",
      soon: "The results screen is the next thing we're building.",
      edit: "Tap to change",
      footer: "Mada Trips · Riyadh",
      weekday: "long",
      makkahNote: "Makkah has no airport, so we fly you to Jeddah (about 1 hour by road).",
      lang: "العربية",
    },
    ar: {
      tabFlights: "طيران", tabStays: "فنادق", tabVisas: "تأشيرات", tabUmrah: "عمرة", myTrips: "رحلاتي", human: "كلّم شخصًا",
      morning: "صباح الخير", afternoon: "مساء الخير", evening: "مساء الخير",
      ask: "وين وجهتك الجاية؟",
      sub: "اكتبها مثل ما تقولها، والباقي علينا.",
      from: "من", change: "تغيير",
      examples: ["دبي الويكند شخصين", "جدة الخميس الجاي عائلة من ٥", "أي مكان بأقل من ٢٠٠٠ في نوفمبر", "لندن ١٢ ديسمبر لمدة أسبوع", "إسطنبول أنا وزوجتي مباشر"],
      go: "اعرض الرحلات", goShort: "الرحلات", oneStop: "توقف واحد",
      understood: "هذا اللي فهمته",
      noDest: "إلى أين؟ اكتب مدينة أو اختر من الأسفل",
      to: "إلى", depart: "الذهاب", ret: "العودة", who: "المسافرون", oneWay: "ذهاب فقط",
      adult: ["بالغ", "بالغين"], child: ["طفل", "أطفال"], infant: ["رضيع", "رضّع"],
      direct: "مباشر فقط", cheap: "الأرخص أولًا", budget: "أقل من", flight: "الرحلة",
      allIn: "شامل كل شيء، لجميع المسافرين",
      about: "حوالي",
      goodPrice: "سعر جيد، أرخص من أغلب الأيام القريبة.",
      highPrice: "يوم مزدحم، الأسعار أعلى من المعتاد.",
      saveOn: (amt, day) => `سافر يوم ${day} ووفّر ${amt}`,
      apply: "اختره",
      directH: (h) => `${h} مباشر`, via: (h, c) => `${h} · توقف في ${c}`,
      popular: (city) => `عطلات من ${city}`,
      popularBudget: (amt, n) => `وين توصلك ${amt} لـ ${n}`,
      totalFor: (n) => `الإجمالي لـ ${n}`, roundTrip: "ذهاب وعودة", oneWayL: "ذهاب فقط",
      noneFit: "لا شيء ضمن هذه الميزانية في هذه التواريخ. جرّب تواريخ أخرى أو زِد قليلًا.",
      promiseH: "وعد مادا",
      p1h: "سعر واحد من البداية للنهاية", p1: "الرقم اللي تشوفه أول مرة هو اللي تدفعه. الضرائب والشنط والرسوم كلها داخلة.",
      p2h: "بدون ضغط مزيّف", p2: "لا «باقي مقعدين» ولا عدّاد تنازلي. خذ وقتك.",
      p3h: "شخص حقيقي مسؤول عن رحلتك", p3: "مستشار من مادا باسمه على واتساب، قبل السفر وبعده. بدون مراكز اتصال ولا تحويل بينك وبين شركة الطيران.",
      p4h: "احجز الآن وادفع بعدين", p4: "ما قررت؟ نحجز لك السعر ٢٤ ساعة وتقرر مع عائلتك.",
      resume: "كمّل من حيث توقفت",
      ticketTitle: "رحلتك", ticketEmpty: "تذكرتك تتعبّى وأنت تكتب",
      soon: "شاشة النتائج هي الخطوة اللي نبنيها الآن.",
      edit: "اضغط للتغيير",
      footer: "مادا للسفر · الرياض",
      weekday: "long",
      makkahNote: "مكة ما فيها مطار، فنوصلك إلى جدة (حوالي ساعة بالسيارة).",
      lang: "English",
    },
  };
  let lang = store.get("lang") || (document.documentElement.lang === "ar" ? "ar" : "en");
  const t = (k) => T[lang][k];
  const nf = new Intl.NumberFormat("en-US");
  const money = (n) => (lang === "ar" ? `${nf.format(n)} ر.س` : `SAR ${nf.format(n)}`);
  const dayFmt = (iso, opts) => new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", opts).format(new Date(iso + "T12:00:00"));
  const shortDay = (iso) => dayFmt(iso, { weekday: "short", day: "numeric", month: "short" });
  const cityName = (code) => { const a = D.byCode[code]; return a ? (lang === "ar" ? a.cityAr : a.city) : ""; };
  const plural = (n, k) => `${n} ${t(k)[n === 1 ? 0 : 1]}`;
  const paxText = (p) => [p.a && plural(p.a, "adult"), p.c && plural(p.c, "child"), p.i && plural(p.i, "infant")].filter(Boolean).join(", ");
  const paxCount = (p) => p.a + p.c + p.i;
  const hrs = (m) => (lang === "ar" ? `${Math.floor(m / 60)}س ${m % 60}د` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

  // ---------- understanding a sentence ----------
  const AR_DIGITS = { "٠": 0, "١": 1, "٢": 2, "٣": 3, "٤": 4, "٥": 5, "٦": 6, "٧": 7, "٨": 8, "٩": 9 };
  const norm = (s) => s.toLowerCase().replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "").replace(/,(?=\d{3})/g, "");
  const WD = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
    "الاحد": 0, "الاثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الخميس": 4, "الجمعه": 5, "السبت": 6 };
  const MO = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
    "يناير": 0, "فبراير": 1, "مارس": 2, "ابريل": 3, "مايو": 4, "يونيو": 5, "يوليو": 6, "اغسطس": 7, "سبتمبر": 8, "اكتوبر": 9, "نوفمبر": 10, "ديسمبر": 11 };
  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, a: 1, "واحد": 1, "اثنين": 2, "ثلاثه": 3, "اربعه": 4, "خمسه": 5, "سته": 6 };
  const numOf = (w) => (w == null ? null : /^\d+$/.test(w) ? +w : NUMW[w] ?? null);

  const lev = (a, b) => {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // swapped letters
    }
    return d[m][n];
  };
  const NAMES = D.AIRPORTS.flatMap((a) => [a.city, a.cityAr, ...a.alias.split(",")].map((n) => ({ n: norm(n), code: a.code })));
  NAMES.sort((x, y) => y.n.length - x.n.length);

  function findCities(s) {
    const hits = [];
    const taken = (i, j) => hits.some((h) => i < h.end && j > h.start);
    for (const { n, code } of NAMES) {
      const arabic = /[؀-ۿ]/.test(n);
      const re = arabic ? new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      let m;
      while ((m = re.exec(s))) if (!taken(m.index, m.index + n.length)) hits.push({ code, start: m.index, end: m.index + n.length, word: n });
    }
    for (const m of s.matchAll(/\b([a-z]{3})\b/g)) {
      const c = m[1].toUpperCase();
      if (D.byCode[c] && !taken(m.index, m.index + 3) && !["THE", "AND", "FOR"].includes(c)) hits.push({ code: c, start: m.index, end: m.index + 3, word: m[1] });
    }
    // Forgive typos ("dubia", "istanbol") on longer words nobody else claimed.
    for (const m of s.matchAll(/[a-z]{4,}/g)) {
      if (taken(m.index, m.index + m[0].length) || STOP.has(m[0])) continue;
      let best = null;
      for (const { n, code } of NAMES) {
        if (/[^a-z]/.test(n) || Math.abs(n.length - m[0].length) > 2) continue;
        const d = lev(m[0], n);
        if (d <= (n.length >= 7 ? 2 : 1) && (!best || d < best.d)) best = { code, d, n };
      }
      if (best) hits.push({ code: best.code, start: m.index, end: m.index + m[0].length, word: m[0], fixed: true });
    }
    return hits.sort((a, b) => a.start - b.start);
  }
  const STOP = new Set(["this", "next", "week", "weekend", "with", "wife", "husband", "kids", "children", "family", "people", "adults", "under", "below", "direct", "nonstop", "from", "days", "nights", "month", "return", "back", "cheap", "somewhere", "anywhere", "friday", "monday", "sunday", "tuesday", "thursday", "saturday", "wednesday", "baby", "babies", "today", "tomorrow", "trip", "flight", "flights", "honeymoon", "couple", "friend", "friends", "mother", "father", "november", "december", "january", "october"]);

  function nextDow(from, dow, strict = true) {
    const d = new Date(from); const diff = (dow - d.getDay() + 7) % 7 || (strict ? 7 : 0);
    d.setDate(d.getDate() + diff); return d;
  }

  function parse(raw, now = new Date()) {
    const s = " " + norm(raw) + " ";
    const out = { to: null, from: null, dates: [], pax: null, budget: null, direct: false, cheap: false, oneWay: false, nights: null, makkah: false, fixed: [] };
    now = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);

    // places
    const hits = findCities(s);
    for (const h of hits) {
      const before = s.slice(Math.max(0, h.start - 6), h.start);
      if (/(from|من)\s*$/.test(before)) out.from = h.code;
      else if (/(to|الى|ل|for)\s*$/.test(before) && !out.to) out.to = h.code;
      else if (!out.to) out.to = h.code;
      else if (!out.from) { out.from = out.to; out.to = h.code; }
      if (/makk|mecca|مكه|عمره|umrah/.test(h.word)) out.makkah = true;
      if (h.fixed) out.fixed.push({ typed: h.word, code: h.code });
    }
    if (out.from && out.from === out.to) out.to = null;

    // dates
    const add = (d) => { if (d >= now) out.dates.push(D.iso(d)); };
    const plus = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
    if (/\b(today|tonight)\b|اليوم|الليله/.test(s)) add(plus(0));
    if (/day after tomorrow|بعد بكره|بعد غد/.test(s)) add(plus(2));
    else if (/\btomorrow\b|بكره|بكرا|غدا/.test(s)) add(plus(1));
    if (/weekend|ويكند|نهايه الاسبوع|العطله/.test(s)) { const th = nextDow(now, 4, false); add(th); const sa = new Date(th); sa.setDate(sa.getDate() + 2); add(sa); }
    if (/next week|الاسبوع الجاي|الاسبوع القادم/.test(s) && !/for (a|one) week/.test(s)) add(nextDow(now, 0));
    if (/next month|الشهر الجاي|الشهر القادم/.test(s)) add(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12));
    let m;
    const inRe = /\bin (\d+|a|one|two|three) (day|days|week|weeks)\b|بعد (\d+|اسبوع|اسبوعين|يومين)/g;
    while ((m = inRe.exec(s))) {
      if (m[2]) add(plus(numOf(m[1]) * (m[2].startsWith("week") ? 7 : 1)));
      else add(plus(m[3] === "اسبوع" ? 7 : m[3] === "اسبوعين" ? 14 : m[3] === "يومين" ? 2 : +m[3]));
    }
    for (const [w, dow] of Object.entries(WD)) {
      const re = /[؀-ۿ]/.test(w) ? new RegExp(w, "g") : new RegExp(`\\b(next |this |on )?${w}\\b`, "g");
      while ((m = re.exec(s))) add(nextDow(now, dow, !/this/.test(m[1] || "")));
    }
    const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?([a-z]{3,9}\b|[؀-ۿ]{4,7}(?![؀-ۿ]))|\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
    while ((m = dm.exec(s))) {
      const day = +(m[1] || m[4]); const mw = (m[2] || m[3] || "");
      const mo = MO[mw] ?? MO[mw.slice(0, 3)];
      if (mo == null || day < 1 || day > 31) continue;
      let d = new Date(now.getFullYear(), mo, day, 12); if (d < now) d = new Date(now.getFullYear() + 1, mo, day, 12);
      add(d);
    }
    for (const mm of s.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
      let d = new Date(now.getFullYear(), +mm[2] - 1, +mm[1], 12); if (d < now) d.setFullYear(d.getFullYear() + 1); add(d);
    }
    // a month on its own ("in November") means the first good day of it
    if (!out.dates.length) for (const [w, mo] of Object.entries(MO)) {
      const re = /[؀-ۿ]/.test(w) ? new RegExp(`(في )?${w}`) : new RegExp(`\\b(in )?${w}[a-z]*\\b`);
      if (w.length >= 3 && re.test(s)) { let d = new Date(now.getFullYear(), mo, 1, 12); if (d < now) d = mo === now.getMonth() ? plus(7) : new Date(now.getFullYear() + 1, mo, 1, 12); add(nextDow(d, 4, false)); break; }
    }
    out.dates = [...new Set(out.dates)].sort();
    // length of stay
    const dur = s.match(/\bfor (\d+|a|one|two|three|four|five|six|seven) (day|days|night|nights|week|weeks)\b|لمده (\d+|اسبوع|اسبوعين) ?(يوم|ايام|ليال|ليالي)?/);
    if (dur) {
      const n = dur[1] ? numOf(dur[1]) * (dur[2].startsWith("week") ? 7 : 1) : dur[3] === "اسبوع" ? 7 : dur[3] === "اسبوعين" ? 14 : +dur[3];
      out.nights = n;
    }
    if (/one ?way|ذهاب فقط|بدون عوده/.test(s)) out.oneWay = true;

    // people
    let a = null, c = 0, i = 0;
    if (/just me|\balone\b|\bsolo\b|by myself|لوحدي|بس انا/.test(s)) a = 1;
    if (/\b(couple|honeymoon|2 of us|two of us)\b|شهر عسل|شخصين|اثنين/.test(s)) a = 2;
    if ((m = s.match(/\b(\d+|two|three|four|five|six) of us\b|we are (\d+)/))) a = numOf(m[1] || m[2]);
    if ((m = s.match(/\b(\d+|two|three|four|five|six|seven|eight|nine) (people|persons|adults|travellers|travelers|pax|guests)\b|(\d+) (اشخاص|شخص|بالغين|مسافرين)/))) a = numOf(m[1] || m[3]);
    const fam = s.match(/family of (\d+|three|four|five|six|seven|eight)|عائله من (\d+)/);
    if (fam) { const n = numOf(fam[1] || fam[2]); a = 2; c = Math.max(0, n - 2); }
    else if (/\bfamily\b|عائله|العائله/.test(s) && a == null) { a = 2; c = 2; }
    if (/(me and|with) my (wife|husband|friend|mother|mom|father|dad|brother|sister)|انا وزوجتي|انا وزوجي|مع زوجتي|مع زوجي|مع صديقي|مع امي|مع ابوي/.test(s)) a = Math.max(a || 0, 2);
    if ((m = s.match(/\b(\d+|a|one|two|three|four) (kids|kid|children|child|boys|girls)\b|(\d+) (اطفال|عيال)|طفلين|طفل/))) c = m[0] === "طفلين" ? 2 : m[0] === "طفل" ? 1 : numOf(m[1] || m[3]) || 1;
    if ((m = s.match(/\b(\d+|a|one|two) (babies|baby|infants|infant)\b|رضيع/))) i = m[0] === "رضيع" ? 1 : numOf(m[1]) || 1;
    if (a != null || c || i) out.pax = { a: Math.min(9, a || 1), c: Math.min(8, c), i: Math.min(a || 1, i) };

    // money and preferences
    if ((m = s.match(/(?:under|below|less than|max|budget|up to|within|اقل من|تحت|بحدود|ميزانيه)\s*(?:sar|sr|ريال)?\s*(\d{3,6})/))) out.budget = +m[1];
    else if ((m = s.match(/\b(\d{3,6})\s*(?:sar|sr|riyals?|ريال)\b/))) out.budget = +m[1];
    if (/\b(direct|nonstop|non-stop)\b|مباشر/.test(s)) out.direct = true;
    if (/\bcheap|cheapest|budget|رخيص|ارخص/.test(s)) out.cheap = true;
    return out;
  }

  // ---------- state ----------
  const state = {
    text: "",
    from: store.get("from") || "RUH",
    pick: null, // destination chosen from a postcard
    applyDate: null,
  };
  const defaultWeekend = () => { const now = new Date(); const th = nextDow(now, 4, false); const sa = new Date(th); sa.setDate(sa.getDate() + 2); return [D.iso(th), D.iso(sa)]; };

  function trip() {
    const p = parse(state.text);
    const from = p.from || state.from;
    const to = p.to || state.pick;
    let dep = state.applyDate || p.dates[0] || null;
    let ret = p.oneWay ? null : p.dates[1] || null;
    if (dep && p.nights && !ret) { const d = new Date(dep + "T12:00:00"); d.setDate(d.getDate() + p.nights); ret = D.iso(d); }
    if (ret && ret <= dep) ret = null;
    const pax = p.pax || { a: 1, c: 0, i: 0 };
    return { ...p, from, to, dep, ret, pax, paxGiven: !!p.pax };
  }

  function priceTrip(tr, dep = tr.dep, ret = tr.ret) {
    if (!tr.to || !dep) return null;
    const o = D.quote(tr.from, tr.to, dep, tr.pax); if (!o) return null;
    const r = ret ? D.quote(tr.to, tr.from, ret, tr.pax) : null;
    return { total: o.total + (r ? r.total : 0), out: o, back: r };
  }

  // ---------- render ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICON = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    ppl: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.6.1 4.4 1.8 5 4.9"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.9 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.4-.5-2.9-1.5M12 6.3v1.5M12 16.2v1.5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/></svg>',
    ret: '<svg viewBox="0 0 24 24"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z"/></svg>',
    plane: '<svg viewBox="0 0 24 24"><path d="M21 15.5v-1.6l-8-5V4a1.5 1.5 0 0 0-3 0v4.9l-8 5v1.6l8-2.4v4.4l-2 1.5V21l3.5-1 3.5 1v-1.5l-2-1.5v-4.4l8 2.4z"/></svg>',
    wa: '<svg viewBox="0 0 24 24"><path d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.3 20.7l4.4-1.1A8.8 8.8 0 1 0 12 3.2z"/><path d="M8.8 8.4c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.5l.8 1.8c.1.2.1.4 0 .6l-.5.7c-.1.2-.1.4 0 .5.6 1 1.4 1.8 2.5 2.4.2.1.4.1.5 0l.7-.8c.2-.2.4-.2.6-.1l1.7.8c.3.1.4.3.4.5 0 1-.7 1.9-1.7 2-.8.1-2.6-.1-4.6-1.9-1.8-1.6-2.6-3.4-2.7-4.4 0-.8.2-1.5.4-2.1z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.6c0 4.6 3.2 8.2 7.5 9.4 4.3-1.2 7.5-4.8 7.5-9.4V6L12 3z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.4"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c.8-4 3.8-6.2 7.5-6.2s6.7 2.2 7.5 6.2"/></svg>',
    hold: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  function chips(tr, pr) {
    const c = [];
    if (tr.to) c.push(["pin", `${cityName(tr.from)} → ${cityName(tr.to)}`, "route"]);
    if (tr.dep) c.push(["cal", tr.ret ? `${shortDay(tr.dep)} – ${shortDay(tr.ret)}` : shortDay(tr.dep), "date"]);
    if (tr.paxGiven) c.push(["ppl", paxText(tr.pax), "pax"]);
    if (tr.budget) c.push(["coin", `${t("budget")} ${money(tr.budget)}`, "budget"]);
    if (tr.direct) c.push(["bolt", t("direct"), "pref"]);
    if (tr.cheap) c.push(["coin", t("cheap"), "pref"]);
    if (!state.text.trim()) return "";
    if (!c.length) return `<p class="und__none">${esc(t("noDest"))}</p>`;
    const fixed = tr.fixed.map((f) => `<span class="und__fix">“${esc(f.typed)}” → ${esc(cityName(f.code))}</span>`).join("");
    return `<span class="und__lbl">${ICON.spark}${esc(t("understood"))}</span>` + c.map(([i, txt, k], n) => `<span class="chip chip--${k}" style="--i:${n}">${ICON[i]}${esc(txt)}</span>`).join("") + fixed;
  }

  function renderTicket(tr, pr) {
    const el = $("#ticket");
    const from = D.byCode[tr.from], to = tr.to && D.byCode[tr.to];
    const filled = !!(to || tr.dep || tr.paxGiven);
    el.classList.toggle("is-empty", !filled);
    el.classList.toggle("has-route", !!to);
    const ctx = to && tr.dep ? D.priceContext(tr.from, tr.to, tr.dep, tr.pax) : null;
    let insight = "";
    if (ctx && ctx.cheaper && !state.applyDate) {
      const save = ctx.q.total - ctx.cheaper.total;
      insight = `<div class="tk__tip tk__tip--save">${ICON.spark}<span>${esc(t("saveOn")(money(save), dayFmt(ctx.cheaper.date, { weekday: "long", day: "numeric", month: "short" })))}</span><button type="button" class="tk__apply" data-date="${ctx.cheaper.date}">${esc(t("apply"))}</button></div>`;
    } else if (ctx && ctx.rank <= 0.35) insight = `<div class="tk__tip tk__tip--good">${ICON.check}<span>${esc(t("goodPrice"))}</span></div>`;
    else if (ctx && ctx.rank >= 0.8) insight = `<div class="tk__tip">${ICON.eye}<span>${esc(t("highPrice"))}</span></div>`;

    const flightLine = pr ? (pr.out.direct ? t("directH")(hrs(pr.out.minutes)) : t("via")(hrs(pr.out.minutes), cityName(pr.out.via))) : "";
    el.innerHTML = `
      <div class="tk__head"><span>${esc(t("ticketTitle"))}</span><span class="tk__ref">MADA · ${new Date().getFullYear()}</span></div>
      <div class="tk__route">
        <div class="tk__end"><b>${from.code}</b><span>${esc(cityName(from.code))}</span></div>
        <div class="tk__path"><svg viewBox="0 0 120 30" preserveAspectRatio="none"><path d="M2 26 C 40 -4, 80 -4, 118 26" /></svg><i class="tk__plane">${ICON.plane}</i></div>
        <div class="tk__end tk__end--to"><b>${to ? to.code : "···"}</b><span>${to ? esc(cityName(to.code)) : esc(t("to"))}</span></div>
      </div>
      ${tr.makkah && tr.to === "JED" ? `<p class="tk__note">${esc(t("makkahNote"))}</p>` : ""}
      <dl class="tk__grid">
        <div class="${tr.dep ? "on" : ""}"><dt>${esc(t("depart"))}</dt><dd>${tr.dep ? esc(shortDay(tr.dep)) : "—"}</dd></div>
        <div class="${tr.ret ? "on" : ""}"><dt>${esc(t("ret"))}</dt><dd>${tr.ret ? esc(shortDay(tr.ret)) : tr.dep ? esc(t("oneWay")) : "—"}</dd></div>
        <div class="${tr.paxGiven ? "on" : ""}"><dt>${esc(t("who"))}</dt><dd>${esc(paxText(tr.pax))}</dd></div>
        <div class="${pr ? "on" : ""}"><dt>${esc(t("flight"))}</dt><dd>${pr ? esc(flightLine) : "—"}</dd></div>
      </dl>
      <div class="tk__tear"></div>
      <div class="tk__price">
        ${pr ? `<span class="tk__about">${esc(t("about"))}</span><b class="tk__total" data-n="${pr.total}">${esc(money(pr.total))}</b><span class="tk__allin">${ICON.shield}${esc(t("allIn"))}</span>` : `<span class="tk__hint">${esc(t("ticketEmpty"))}</span>`}
      </div>
      ${insight}
      <button type="button" class="tk__go" ${to ? "" : "disabled"}>${esc(t("go"))}<i>→</i></button>`;
    const total = $(".tk__total", el);
    if (total && el.dataset.last && +el.dataset.last !== pr.total) countTo(total, +el.dataset.last, pr.total);
    el.dataset.last = pr ? pr.total : "";
  }

  function countTo(el, a, b) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now(), dur = 520;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = money(Math.round(a + (b - a) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function renderCards(tr) {
    const [wkDep, wkRet] = defaultWeekend();
    const dep = tr.dep || wkDep, ret = tr.dep ? tr.ret : wkRet;
    const n = paxCount(tr.pax);
    let list = D.POPULAR.filter((c) => c !== tr.from).map((code) => ({ code, pr: priceTrip({ ...tr, to: code }, dep, ret) })).filter((x) => x.pr);
    if (tr.budget) list = list.filter((x) => x.pr.total <= tr.budget).sort((a, b) => a.pr.total - b.pr.total);
    else if (tr.cheap) list.sort((a, b) => a.pr.total - b.pr.total);
    $("#cardsTitle").textContent = tr.budget ? t("popularBudget")(money(tr.budget), paxText(tr.pax)) : t("popular")(cityName(tr.from));
    const grid = $("#cards");
    if (!list.length) { grid.innerHTML = `<p class="cards__none">${esc(t("noneFit"))}</p>`; return; }
    grid.innerHTML = list.slice(0, 8).map(({ code, pr }, i) => {
      const L = D.LOOKS[code] || ["#5d7a6e", "#132620", "", ""];
      const sel = tr.to === code ? " is-sel" : "";
      return `<button type="button" class="pc${sel}" data-code="${code}" style="--a:${L[0]};--b:${L[1]};--i:${i}">
        <span class="pc__art" aria-hidden="true"><svg viewBox="0 0 200 120"><circle cx="168" cy="22" r="14"/><path d="M0 92 Q 50 64 100 84 T 200 76 V120 H0z"/><path class="b" d="M0 104 Q 60 86 120 100 T 200 96 V120 H0z"/></svg></span>
        <span class="pc__code">${code}</span>
        <span class="pc__city">${esc(cityName(code))}</span>
        <span class="pc__why">${esc(L[lang === "ar" ? 3 : 2])}</span>
        <span class="pc__foot"><span class="pc__time">${ICON.plane}${esc(hrs(pr.out.minutes))}${pr.out.direct ? "" : " · " + esc(t("oneStop"))}</span><span class="pc__price"><b>${esc(money(pr.total))}</b><small>${esc(t("totalFor")(n))} · ${esc(ret ? t("roundTrip") : t("oneWayL"))}</small></span></span>
      </button>`;
    }).join("");
  }

  function renderStatic() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    const h = new Date().getHours();
    $("#greet").textContent = t(h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
    $("#fromCity").textContent = cityName(state.from);
    $("#langBtn").textContent = t("lang");
    const last = store.get("last");
    const res = $("#resume");
    if (last && last.text && !state.text) { res.hidden = false; $("#resumeText").textContent = last.text; } else res.hidden = true;
  }

  function render() {
    const tr = trip();
    const pr = priceTrip(tr);
    $("#und").innerHTML = chips(tr, pr);
    renderTicket(tr, pr);
    renderCards(tr);
    $("#stub").innerHTML = tr.to ? `<span><b>${tr.from} → ${tr.to}</b>${pr ? ` · ${esc(money(pr.total))}` : ""}</span><button type="button" class="tk__go">${esc(t("goShort"))}<i>→</i></button>` : "";
    $("#stub").classList.toggle("is-on", !!tr.to);
  }

  // ---------- placeholder that types example trips ----------
  let phTimer;
  function typePlaceholder() {
    clearTimeout(phTimer);
    const input = $("#q");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { input.placeholder = t("examples")[0]; return; }
    let ex = 0, ch = 0, del = false;
    const tick = () => {
      const s = t("examples")[ex];
      if (document.activeElement === input && input.value) return (phTimer = setTimeout(tick, 600));
      ch += del ? -1 : 1;
      input.placeholder = s.slice(0, ch);
      let wait = del ? 18 : 46;
      if (!del && ch >= s.length) { del = true; wait = 2200; }
      else if (del && ch <= 0) { del = false; ex = (ex + 1) % t("examples").length; wait = 300; }
      phTimer = setTimeout(tick, wait);
    };
    tick();
  }

  function toast(msg) {
    const el = $("#toast"); el.textContent = msg; el.classList.add("is-on");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("is-on"), 2600);
  }

  // ---------- wire ----------
  function init() {
    const q = $("#q");
    q.addEventListener("input", () => {
      state.text = q.value; state.applyDate = null; $("#resume").hidden = true;
      q.style.height = "auto"; q.style.height = q.scrollHeight + "px";
      const p = parse(q.value); if (p.to) state.pick = null;
      store.set("last", { text: q.value });
      render();
    });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    $("#ex").addEventListener("click", (e) => { const b = e.target.closest("[data-ex]"); if (!b) return; q.value = b.textContent; q.dispatchEvent(new Event("input")); q.focus(); });
    $("#cards").addEventListener("click", (e) => {
      const b = e.target.closest(".pc"); if (!b) return;
      const p = parse(state.text);
      if (p.to) { state.text = state.text.replace(new RegExp(findCities(" " + norm(state.text) + " ").find((h) => h.code === p.to)?.word || "^$", "i"), cityName(b.dataset.code)); q.value = state.text; }
      state.pick = b.dataset.code;
      render();
      if (matchMedia("(max-width: 960px)").matches) $("#ticket").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    document.addEventListener("click", (e) => {
      const ap = e.target.closest(".tk__apply"); if (ap) { state.applyDate = ap.dataset.date; render(); return; }
      if (e.target.closest(".tk__go")) go();
    });
    $("#langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("lang", lang); renderStatic(); renderEx(); typePlaceholder(); render(); });
    $("#fromBtn").addEventListener("click", () => {
      const order = ["RUH", "JED", "DMM", "MED"]; state.from = order[(order.indexOf(state.from) + 1) % order.length];
      store.set("from", state.from); renderStatic(); render();
    });
    $("#resumeBtn").addEventListener("click", () => { q.value = store.get("last").text; q.dispatchEvent(new Event("input")); $("#resume").hidden = true; });
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => { if (!b.classList.contains("on")) toast(t("soon")); }));
    // The bottom bar repeats the ticket on phones, so hide it while the ticket itself is on screen.
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => $("#stub").classList.toggle("is-hidden", e.isIntersecting), { threshold: 0.3 }).observe($("#ticket"));
    renderStatic(); renderEx(); typePlaceholder(); render();
  }
  function renderEx() { $("#ex").innerHTML = t("examples").slice(0, 4).map((s) => `<button type="button" data-ex>${esc(s)}</button>`).join(""); }
  function go() { if (!trip().to) { $("#q").focus(); return; } toast(t("soon")); }

  window.MadaBook = { parse };
  document.addEventListener("DOMContentLoaded", init);
})();
