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

  // Destinations we feature, with a photo, where to anchor it when cropped, a short line, and the photo credit.
  const DEST = {
    DXB: { pos: "62% 40%", en: "Skyline weekends", ar: "عطلة بين الأبراج", credit: "Tim Reckmann, CC BY 2.0", src: "https://commons.wikimedia.org/wiki/File:Dubai_skyline_2015.jpg" },
    IST: { pos: "50% 50%", en: "Two continents, one city", ar: "مدينة على قارتين", credit: "Arild Vågen, CC BY-SA 3.0", src: "https://commons.wikimedia.org/wiki/File:Hagia_Sophia_Mars_2013.jpg" },
    ULH: { pos: "40% 50%", en: "Sandstone and silence", ar: "صخور وسكون", credit: "Mada Trips" },
    CAI: { pos: "45% 50%", en: "Pyramids before breakfast", ar: "الأهرامات قبل الفطور", credit: "Ricardo Liberato, CC BY-SA 2.0", src: "https://commons.wikimedia.org/wiki/File:All_Gizah_Pyramids.jpg" },
    MLE: { pos: "50% 60%", en: "Water, and nothing else", ar: "ماء ولا شيء غيره", credit: "Mada Trips" },
    LHR: { pos: "50% 50%", en: "Autumn by the river", ar: "خريف على النهر", credit: "Colin, CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Tower_Bridge_from_Shad_Thames.jpg" },
    KUL: { pos: "50% 30%", en: "Towers and rainforest", ar: "أبراج وغابات", credit: "Someformofhuman, CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Petronas_Panorama_II.jpg" },
    GVA: { pos: "30% 50%", en: "Lake air in winter", ar: "هواء البحيرة شتاءً", credit: "Daniel Culsan, CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Jet_d%27eau_de_Gen%C3%A8ve.jpg" },
    RUH: { pos: "50% 50%", en: "Home", ar: "الرياض", credit: "B.alotaby, CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Riyadh_Skyline.jpg" },
  };
  const POPULAR = ["DXB", "IST", "ULH", "CAI", "MLE", "LHR", "KUL", "GVA"];
  // Rough nightly rates (SAR) for a good 3★ / 4★ / 5★ room, the eSIM we'd sell for that country, and an airport pickup.
  // Estimates for the preview; the live version reads these from the hotel and eSIM suppliers.
  const STAY = { DXB: [320, 620, 1350], IST: [280, 520, 1100], ULH: [450, 900, 2200], CAI: [220, 450, 950], MLE: [900, 1800, 4200], LHR: [520, 900, 1900], KUL: [190, 380, 800], GVA: [600, 1050, 2100], JED: [260, 480, 1100] };
  const ESIM = { AE: 39, TR: 45, EG: 39, MV: 59, GB: 49, MY: 35, CH: 55, SA: 0 };
  const PICKUP = { DXB: 140, IST: 160, ULH: 180, CAI: 120, MLE: 0, LHR: 260, KUL: 110, GVA: 240, JED: 110 };
  const GCC = new Set(["SA", "AE", "QA", "BH", "KW", "OM"]);
  const photo = (code, small) => (DEST[code] ? `/assets/img/dest/${code.toLowerCase()}${small ? "-s" : ""}.jpg` : null);

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

  // Every bookable flight for a day, with the price already including a checked bag (low-cost fares add one),
  // so the number on each option is the number paid. Two departures a day for nonstop carriers, one for connections.
  const BAG_FEE = 90;
  function options(from, to, dateIso, pax) {
    if (!byCode[from] || !byCode[to] || from === to) return [];
    const { dist, list } = carriers(from, to);
    const people = pax.a + pax.c;
    const fly = Math.round(dist / 820 * 60 + 35);
    const out = [];
    for (const c of list) {
      const slots = c.direct ? 2 : 1;
      for (let k = 0; k < slots; k++) {
        const r = rng(hash(from + to + dateIso + c.al + k));
        const dep = (k === 0 ? 6 * 60 : 15 * 60) + Math.floor(r() * 30) * 15;
        const lay = c.direct ? 0 : 70 + Math.floor(r() * 8) * 15;
        const minutes = fly + (c.direct ? 0 : lay + 25);
        const base = fare(from, to, c.al, dateIso, c.direct) * (k === 0 ? 1 : 0.93 + r() * 0.14);
        const bagAdded = AIRLINES[c.al].bag === 0;
        const total = Math.round((paxTotal(base, pax) + (bagAdded ? BAG_FEE * people : 0)) / 5) * 5;
        const arrAbs = dep + minutes + Math.round((byCode[to].tz - byCode[from].tz) * 60);
        out.push({
          id: `${c.al}${k}`, al: c.al, no: `${c.al} ${100 + (hash(from + to + c.al + k) % 800)}`, direct: c.direct, via: c.via, lay,
          minutes, dep, arr: ((arrAbs % 1440) + 1440) % 1440, plusDay: Math.floor(arrAbs / 1440), total, bagAdded,
          bag: bagAdded ? 23 : AIRLINES[c.al].bag, change: AIRLINES[c.al].tier >= 1, hold: AIRLINES[c.al].tier >= 0.9,
        });
      }
    }
    // "Best" weighs price against time and stops, the way people actually choose.
    for (const o of out) o.score = o.total / Math.max(1, people) + o.minutes * 1.4 + (o.direct ? 0 : 160);
    return out;
  }
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // How long an unpaid booking can be held. Airlines set this per fare; the preview uses a rule of thumb
  // (full-service carriers, not inside 3 days of departure). The live version reads the PNR's ticketing limit.
  function holdUntil(opt, dateIso) {
    if (!opt || !opt.hold) return null;
    const dep = new Date(dateIso + "T12:00:00");
    if ((dep - new Date()) / 864e5 < 3) return null;
    const until = new Date(Date.now() + 24 * 3600e3);
    until.setMinutes(Math.floor(until.getMinutes() / 5) * 5, 0, 0);
    return until.toISOString();
  }

  // Sample hotels: two per star level, described rather than named until the hotel supplier is connected.
  const HOTEL_AREAS = {
    DXB: [["Downtown", "داون تاون"], ["Dubai Marina", "دبي مارينا"], ["Jumeirah Beach", "شاطئ جميرا"]],
    IST: [["Sultanahmet", "السلطان أحمد"], ["Taksim", "تقسيم"], ["Bosphorus, Beşiktaş", "البوسفور، بشكتاش"]],
    ULH: [["Old Town", "البلدة القديمة"], ["Ashar Valley", "وادي عشار"], ["Hegra road", "طريق الحجر"]],
    CAI: [["Zamalek", "الزمالك"], ["Giza, pyramids view", "الجيزة، إطلالة الأهرامات"], ["Nile Corniche", "كورنيش النيل"]],
    MLE: [["North Malé Atoll", "أتول ماليه الشمالي"], ["South Ari Atoll", "أتول آري الجنوبي"], ["Baa Atoll", "أتول با"]],
    LHR: [["Mayfair", "مايفير"], ["Kensington", "كنسينغتون"], ["South Bank", "ساوث بانك"]],
    KUL: [["KLCC", "وسط المدينة"], ["Bukit Bintang", "بوكيت بينتانغ"], ["Bangsar", "بانغسار"]],
    GVA: [["Lakefront", "على البحيرة"], ["Old Town", "البلدة القديمة"], ["Pâquis", "باكي"]],
    JED: [["Makkah, near the Haram", "مكة، قرب الحرم"], ["Makkah, Ajyad", "مكة، أجياد"], ["Makkah, Aziziyah", "مكة، العزيزية"]],
  };
  const PERKS = [["Breakfast included", "الإفطار مشمول"], ["Free cancellation until 3 days before", "إلغاء مجاني حتى ٣ أيام قبل الوصول"], ["Family rooms", "غرف عائلية"], ["Pool", "مسبح"], ["Airport shuttle", "نقل من المطار"], ["Prayer room nearby", "مصلى قريب"]];
  function hotels(code) {
    const areas = HOTEL_AREAS[code] || [["City centre", "وسط المدينة"], ["Old town", "البلدة القديمة"], ["Waterfront", "الواجهة"]];
    const rates = STAY[code] || [250, 450, 950];
    const out = [];
    for (let tier = 0; tier < 3; tier++) for (let k = 0; k < 2; k++) {
      const r = rng(hash(code + tier + k));
      const area = areas[(tier + k) % areas.length];
      const perks = PERKS.filter((_, i) => r() > 0.45 || i === (tier + k) % PERKS.length).slice(0, 3);
      out.push({ id: `${code}-${tier}${k}`, tier, stars: tier + 3, area, rating: (7.8 + tier * 0.5 + r() * 0.6).toFixed(1), perks, rate: Math.round(rates[tier] * (0.9 + r() * 0.25) / 5) * 5 });
    }
    return out;
  }

  window.MadaData = { AIRPORTS, byCode, DEST, POPULAR, photo, STAY, ESIM, PICKUP, GCC, AIRLINES, quote, options, hotels, holdUntil, hm, priceContext, km, iso };
})();
