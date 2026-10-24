/* =========================================================
   MADA BOOK: understanding a sentence
   "Dubai this weekend, 2 of us" → { to: "DXB", dates: [...], pax: {a: 2} }. English and Gulf Arabic, typos forgiven.
   ========================================================= */
(function () {
  const D = window.MadaData;
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
        if (/[^a-z]/.test(n) || n.length < 5 || Math.abs(n.length - m[0].length) > 2) continue;
        const d = lev(m[0], n);
        if (d <= (n.length >= 7 ? 2 : 1) && (!best || d < best.d)) best = { code, d, n };
      }
      if (best) hits.push({ code: best.code, start: m.index, end: m.index + m[0].length, word: m[0], fixed: true });
    }
    return hits.sort((a, b) => a.start - b.start);
  }
  const STOP = new Set(["make", "take", "more", "less", "cheaper", "hotel", "hotels", "star", "stars", "just", "only", "earlier", "later", "traveler", "traveller", "need", "visa", "umrah", "want", "please", "book", "plan", "show", "same", "long", "luxury", "stay", "rental", "pickup", "esim", "this", "next", "week", "weekend", "with", "wife", "husband", "kids", "children", "family", "people", "adults", "under", "below", "direct", "nonstop", "from", "days", "nights", "month", "return", "back", "cheap", "somewhere", "anywhere", "friday", "monday", "sunday", "tuesday", "thursday", "saturday", "wednesday", "baby", "babies", "today", "tomorrow", "trip", "flight", "flights", "honeymoon", "couple", "friend", "friends", "mother", "father", "november", "december", "january", "october"]);

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
  window.MadaParse = { parse, findCities, norm, nextDow };
})();
