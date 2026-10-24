/* =========================================================
   MADA BOOK: data + quote engine
   Airports, airlines and a deterministic fare model so the booking flow works end to end without a live supplier.
   Swap `MadaData.quote()` for a call to the real fare source (GDS / NDC aggregator) and nothing else changes.
   ========================================================= */
(function () {
  // code, city, Arabic city, country, lat, lon, UTC offset (standard time), aliases people actually type (comma-separated)
  const A = [
    ["RUH", "Riyadh", "الرياض", "SA", 24.96, 46.70, 3, "riyad,riyadh,الرياض"],
    ["JED", "Jeddah", "جدة", "SA", 21.68, 39.16, 3, "jeddah,jedda,jidda,جده,جدة,makkah,mecca,makka,مكة,umrah,عمرة"],
    ["DMM", "Dammam", "الدمام", "SA", 26.47, 49.80, 3, "dammam,khobar,alkhobar,dhahran,الخبر,الظهران"],
    ["MED", "Madinah", "المدينة", "SA", 24.55, 39.70, 3, "medina,madina,madinah,المدينة,المدينه"],
    ["AHB", "Abha", "أبها", "SA", 18.24, 42.66, 3, "abha,ابها,أبها"],
    ["TIF", "Taif", "الطائف", "SA", 21.48, 40.54, 3, "taif,الطايف"],
    ["TUU", "Tabuk", "تبوك", "SA", 28.37, 36.62, 3, "tabuk"],
    ["ULH", "AlUla", "العلا", "SA", 26.48, 38.12, 3, "alula,al ula,ula,العلا"],
    ["GIZ", "Jazan", "جازان", "SA", 16.90, 42.59, 3, "jazan,jizan,جيزان"],
    ["RSI", "Red Sea", "البحر الأحمر", "SA", 25.54, 37.02, 3, "red sea,redsea"],
    ["DXB", "Dubai", "دبي", "AE", 25.25, 55.36, 4, "dubai,dubay,دبي"],
    ["AUH", "Abu Dhabi", "أبوظبي", "AE", 24.43, 54.65, 4, "abu dhabi,abudhabi,ابوظبي"],
    ["DOH", "Doha", "الدوحة", "QA", 25.27, 51.61, 3, "doha,qatar,قطر,الدوحه"],
    ["BAH", "Bahrain", "البحرين", "BH", 26.27, 50.63, 3, "bahrain,manama,المنامة"],
    ["KWI", "Kuwait", "الكويت", "KW", 29.24, 47.97, 3, "kuwait"],
    ["MCT", "Muscat", "مسقط", "OM", 23.59, 58.28, 4, "muscat,oman,عمان"],
    ["SLL", "Salalah", "صلالة", "OM", 17.04, 54.09, 4, "salalah,صلاله"],
    ["CAI", "Cairo", "القاهرة", "EG", 30.12, 31.41, 2, "cairo,egypt,مصر,القاهره"],
    ["SSH", "Sharm El Sheikh", "شرم الشيخ", "EG", 27.98, 34.39, 2, "sharm"],
    ["AMM", "Amman", "عمّان", "JO", 31.72, 35.99, 3, "amman,jordan,الاردن"],
    ["BEY", "Beirut", "بيروت", "LB", 33.82, 35.49, 2, "beirut,lebanon,لبنان"],
    ["IST", "Istanbul", "إسطنبول", "TR", 41.26, 28.74, 3, "istanbul,turkey,تركيا,اسطنبول"],
    ["TZX", "Trabzon", "طرابزون", "TR", 41.00, 39.79, 3, "trabzon"],
    ["AYT", "Antalya", "أنطاليا", "TR", 36.90, 30.80, 3, "antalya,انطاليا"],
    ["GYD", "Baku", "باكو", "AZ", 40.47, 50.05, 4, "baku,azerbaijan,اذربيجان"],
    ["TBS", "Tbilisi", "تبليسي", "GE", 41.67, 44.95, 4, "tbilisi,georgia,جورجيا"],
    ["CMN", "Casablanca", "الدار البيضاء", "MA", 33.37, -7.59, 1, "casablanca,morocco,المغرب"],
    ["RAK", "Marrakech", "مراكش", "MA", 31.60, -8.04, 1, "marrakech,marrakesh"],
    ["KHI", "Karachi", "كراتشي", "PK", 24.90, 67.16, 5, "karachi"],
    ["LHE", "Lahore", "لاهور", "PK", 31.52, 74.40, 5, "lahore"],
    ["ISB", "Islamabad", "إسلام آباد", "PK", 33.55, 72.83, 5, "islamabad,pakistan,باكستان"],
    ["DEL", "Delhi", "دلهي", "IN", 28.56, 77.10, 5.5, "delhi,new delhi,india,الهند"],
    ["BOM", "Mumbai", "مومباي", "IN", 19.09, 72.87, 5.5, "mumbai,bombay"],
    ["COK", "Kochi", "كوتشي", "IN", 10.15, 76.40, 5.5, "kochi,cochin,kerala"],
    ["DAC", "Dhaka", "دكا", "BD", 23.84, 90.40, 6, "dhaka,bangladesh"],
    ["CMB", "Colombo", "كولومبو", "LK", 7.18, 79.88, 5.5, "colombo,sri lanka,سريلانكا"],
    ["MLE", "Maldives", "المالديف", "MV", 4.19, 73.53, 5, "maldives,male,المالديف"],
    ["KUL", "Kuala Lumpur", "كوالالمبور", "MY", 2.74, 101.70, 8, "kuala lumpur,malaysia,ماليزيا"],
    ["BKK", "Bangkok", "بانكوك", "TH", 13.69, 100.75, 7, "bangkok,thailand,تايلند"],
    ["HKT", "Phuket", "بوكيت", "TH", 8.11, 98.31, 7, "phuket"],
    ["DPS", "Bali", "بالي", "ID", -8.75, 115.17, 8, "bali,indonesia,اندونيسيا"],
    ["SIN", "Singapore", "سنغافورة", "SG", 1.36, 103.99, 8, "singapore"],
    ["ICN", "Seoul", "سيول", "KR", 37.46, 126.44, 9, "seoul,korea,كوريا"],
    ["HND", "Tokyo", "طوكيو", "JP", 35.55, 139.78, 9, "tokyo,japan,اليابان"],
    ["TAS", "Tashkent", "طشقند", "UZ", 41.26, 69.28, 5, "tashkent,uzbekistan"],
    ["ALA", "Almaty", "ألماتي", "KZ", 43.35, 77.04, 5, "almaty,kazakhstan"],
    ["NBO", "Nairobi", "نيروبي", "KE", -1.32, 36.93, 3, "nairobi,kenya"],
    ["ZNZ", "Zanzibar", "زنجبار", "TZ", -6.22, 39.22, 3, "zanzibar"],
    ["SEZ", "Seychelles", "سيشل", "SC", -4.67, 55.52, 4, "seychelles"],
    ["MRU", "Mauritius", "موريشيوس", "MU", -20.43, 57.68, 4, "mauritius"],
    ["LHR", "London", "لندن", "GB", 51.47, -0.45, 0, "london,uk,england,britain,بريطانيا"],
    ["CDG", "Paris", "باريس", "FR", 49.00, 2.55, 1, "paris,france,فرنسا"],
    ["GVA", "Geneva", "جنيف", "CH", 46.24, 6.11, 1, "geneva,switzerland,سويسرا"],
    ["ZRH", "Zurich", "زيورخ", "CH", 47.46, 8.55, 1, "zurich"],
    ["MUC", "Munich", "ميونخ", "DE", 48.35, 11.79, 1, "munich,germany,المانيا"],
    ["VIE", "Vienna", "فيينا", "AT", 48.11, 16.57, 1, "vienna,austria,النمسا"],
    ["FCO", "Rome", "روما", "IT", 41.80, 12.25, 1, "rome,italy,ايطاليا"],
    ["MXP", "Milan", "ميلانو", "IT", 45.63, 8.72, 1, "milan"],
    ["MAD", "Madrid", "مدريد", "ES", 40.47, -3.56, 1, "madrid,spain,اسبانيا"],
    ["BCN", "Barcelona", "برشلونة", "ES", 41.30, 2.08, 1, "barcelona"],
    ["AMS", "Amsterdam", "أمستردام", "NL", 52.31, 4.76, 1, "amsterdam,netherlands,holland"],
    ["ATH", "Athens", "أثينا", "GR", 37.94, 23.94, 2, "athens,greece,اليونان"],
    ["SVO", "Moscow", "موسكو", "RU", 55.97, 37.41, 3, "moscow,russia,روسيا"],
    ["JFK", "New York", "نيويورك", "US", 40.64, -73.78, -5, "new york,nyc,usa,america,امريكا"],
    ["IAD", "Washington", "واشنطن", "US", 38.95, -77.46, -5, "washington"],
    ["LAX", "Los Angeles", "لوس أنجلوس", "US", 33.94, -118.40, -8, "los angeles"],
    ["YYZ", "Toronto", "تورنتو", "CA", 43.68, -79.63, -5, "toronto,canada,كندا"],
    ["SYD", "Sydney", "سيدني", "AU", -33.94, 151.18, 11, "sydney,australia,استراليا"],
  ];
  const AIRPORTS = A.map(([code, city, cityAr, country, lat, lon, tz, alias]) => ({ code, city, cityAr, country, lat, lon, tz, alias }));
  const byCode = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

  // Visual identity for destination postcards: two tones and a one-line reason to go.
  const LOOKS = {
    DXB: ["#c9773b", "#3a1d14", "Skyline weekends", "عطلة,بين,الأبراج"],
    JED: ["#2f7d7a", "#0f2a2b", "Red Sea and Umrah", "البحر,الأحمر,والعمرة"],
    ULH: ["#b7603a", "#2d140c", "Desert under stars", "صحراء,تحت,النجوم"],
    CAI: ["#c9a25d", "#3b2a12", "Pyramids and the Nile", "الأهرامات,والنيل"],
    IST: ["#a8435a", "#2a0f19", "Two continents, one trip", "قارتان,في,رحلة"],
    GYD: ["#5a6fa8", "#141c33", "Cool air, old city", "جو,بارد,ومدينة,عريقة"],
    MLE: ["#2aa3a8", "#0a2e33", "Water villas", "فلل,فوق,الماء"],
    LHR: ["#56627a", "#151a24", "Shopping and parks", "تسوّق,وحدائق"],
    AHB: ["#4f8a5b", "#11261a", "Green mountains", "جبال,خضراء"],
    TBS: ["#8a6aa8", "#211833", "Wine-red hills", "تلال,ومدن,قديمة"],
    KUL: ["#3e8a6b", "#0d261c", "Rainforest and towers", "غابات,وأبراج"],
    GVA: ["#6b8fb3", "#14202e", "Lakes and Alps", "بحيرات,وجبال,الألب"],
  };
  const POPULAR = ["DXB", "JED", "ULH", "CAI", "IST", "GYD", "MLE", "LHR", "AHB", "TBS", "KUL", "GVA"];

  const AIRLINES = {
    SV: { name: "Saudia", nameAr: "السعودية", tier: 1.12, bag: 23 },
    XY: { name: "flynas", nameAr: "طيران ناس", tier: 0.78, bag: 0 },
    F3: { name: "flyadeal", nameAr: "طيران أديل", tier: 0.74, bag: 0 },
    RX: { name: "Riyadh Air", nameAr: "طيران الرياض", tier: 1.18, bag: 23 },
    EK: { name: "Emirates", nameAr: "طيران الإمارات", tier: 1.2, bag: 25 },
    FZ: { name: "flydubai", nameAr: "فلاي دبي", tier: 0.86, bag: 0 },
    QR: { name: "Qatar Airways", nameAr: "القطرية", tier: 1.15, bag: 25 },
    EY: { name: "Etihad", nameAr: "الاتحاد", tier: 1.08, bag: 23 },
    GF: { name: "Gulf Air", nameAr: "طيران الخليج", tier: 0.95, bag: 23 },
    TK: { name: "Turkish Airlines", nameAr: "التركية", tier: 1.02, bag: 23 },
    MS: { name: "EgyptAir", nameAr: "مصر للطيران", tier: 0.92, bag: 23 },
  };
  const HUB = { EK: "DXB", FZ: "DXB", QR: "DOH", EY: "AUH", GF: "BAH", TK: "IST", MS: "CAI" };

  // ---------- helpers ----------
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const km = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isSaudi = (c) => byCode[c] && byCode[c].country === "SA";

  // Which airlines plausibly fly a route, and whether nonstop.
  function carriers(from, to) {
    const d = km(byCode[from], byCode[to]);
    const out = [];
    const sa = isSaudi(from) || isSaudi(to);
    if (sa) {
      out.push({ al: "SV", direct: d < 7000 });
      if (d < 4200) out.push({ al: "XY", direct: true });
      if (d < 3200) out.push({ al: "F3", direct: true });
      if (from === "RUH" || to === "RUH") out.push({ al: "RX", direct: d < 7000 });
    }
    for (const [al, hub] of Object.entries(HUB)) {
      if (hub === from || hub === to) out.push({ al, direct: true });
      else if (sa && !(isSaudi(from) && isSaudi(to))) {
        // Only connect through a hub that is roughly on the way.
        const detour = (km(byCode[from], byCode[hub]) + km(byCode[hub], byCode[to])) / d;
        if (detour < 1.35) out.push({ al, direct: false, via: hub });
      }
    }
    return { dist: d, list: out };
  }

  // Price for one adult, one way, on a date. Deterministic so the calendar, tiles and results always agree.
  function fare(from, to, al, dateIso, direct) {
    const { dist } = carriers(from, to);
    const d = new Date(dateIso + "T12:00:00");
    const days = Math.max(0, (d - new Date()) / 864e5);
    const dow = d.getDay(); // Thu/Fri busiest out of the Kingdom, Sat back
    const wk = dow === 4 || dow === 5 ? 1.22 : dow === 6 ? 1.1 : dow === 2 ? 0.92 : 1;
    const soon = days < 3 ? 1.45 : days < 10 ? 1.18 : days < 21 ? 1.04 : 0.96;
    const noise = 0.86 + rng(hash(from + to + al + dateIso))() * 0.32;
    const base = 230 + dist * 0.3;
    const p = base * AIRLINES[al].tier * wk * soon * noise * (direct ? 1 : 0.88);
    return Math.round(p / 5) * 5;
  }

  const paxTotal = (oneAdult, pax) => Math.round(oneAdult * (pax.a + pax.c * 0.75) + oneAdult * 0.1 * pax.i);

  // Cheapest, all-in total for the whole party on a date (one way). Used by postcards and the live ticket.
  function quote(from, to, dateIso, pax) {
    if (!byCode[from] || !byCode[to] || from === to) return null;
    const { dist, list } = carriers(from, to);
    if (!list.length) return null;
    let best = null;
    for (const c of list) {
      const p = fare(from, to, c.al, dateIso, c.direct);
      // A connection has to be clearly cheaper before we lead with it over a nonstop.
      const score = c.direct ? p : p * 1.12;
      if (!best || score < best.score) best = { ...c, p, score };
    }
    const fly = Math.round(dist / 820 * 60 + 35);
    const minutes = best.direct ? fly : fly + 95;
    return { total: paxTotal(best.p, pax), perAdult: best.p, airline: best.al, direct: best.direct, via: best.via, minutes, directExists: list.some((c) => c.direct) };
  }

  // How a day's price compares with the 30 days around it, so we can say "good price" honestly.
  function priceContext(from, to, dateIso, pax) {
    const q = quote(from, to, dateIso, pax);
    if (!q) return null;
    const d = new Date(dateIso + "T12:00:00");
    const all = [];
    for (let i = -14; i <= 14; i++) {
      const x = new Date(d); x.setDate(x.getDate() + i);
      if (x < new Date()) continue;
      const qq = quote(from, to, iso(x), pax);
      if (qq) all.push({ date: iso(x), total: qq.total });
    }
    const sorted = all.map((x) => x.total).sort((a, b) => a - b);
    const rank = sorted.findIndex((v) => v >= q.total) / Math.max(1, sorted.length - 1);
    const cheaper = all.filter((x) => Math.abs(new Date(x.date) - d) <= 3 * 864e5 && x.total < q.total * 0.9).sort((a, b) => a.total - b.total)[0] || null;
    return { q, rank, cheaper };
  }

  window.MadaData = { AIRPORTS, byCode, LOOKS, POPULAR, AIRLINES, quote, priceContext, km, iso };
})();
