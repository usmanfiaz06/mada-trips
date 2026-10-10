/**
 * Arabic names for places and airlines that arrive from suppliers in English (COPY.md §7.4). Used by t() for
 * `{city}`, `{country}`, `{airline}` and similar values, and by screens that show a name on its own. Only exact
 * matches are swapped: a hotel's own name, a person's name or a code is never touched.
 */
export const NAMES_AR: Readonly<Record<string, string>> = {
  // Saudi cities and regions
  Riyadh: 'الرياض', Jeddah: 'جدة', Makkah: 'مكة', Mecca: 'مكة', Madinah: 'المدينة', Medina: 'المدينة', Dammam: 'الدمام',
  Khobar: 'الخبر', 'Al Khobar': 'الخبر', Dhahran: 'الظهران', Abha: 'أبها', Taif: 'الطائف', AlUla: 'العُلا', 'Al Ula': 'العُلا',
  Tabuk: 'تبوك', Hail: 'حائل', Jazan: 'جازان', Najran: 'نجران', Yanbu: 'ينبع', Qassim: 'القصيم', Buraidah: 'بريدة',
  Neom: 'نيوم', NEOM: 'نيوم', 'Red Sea': 'البحر الأحمر', Diriyah: 'الدرعية', 'Riyadh Season': 'موسم الرياض',
  // Cities abroad
  Istanbul: 'إسطنبول', Ankara: 'أنقرة', Antalya: 'أنطاليا', Trabzon: 'طرابزون', Bursa: 'بورصة', Bodrum: 'بودروم', Erzurum: 'أرضروم',
  Dubai: 'دبي', 'Abu Dhabi': 'أبوظبي', Sharjah: 'الشارقة', Doha: 'الدوحة', Manama: 'المنامة', Muscat: 'مسقط', Salalah: 'صلالة',
  Kuwait: 'الكويت', 'Kuwait City': 'الكويت', Cairo: 'القاهرة', Alexandria: 'الإسكندرية', 'Sharm El Sheikh': 'شرم الشيخ',
  Amman: 'عمّان', Beirut: 'بيروت', Baku: 'باكو', Tbilisi: 'تبليسي', Batumi: 'باتومي', Gudauri: 'غوداوري', Yerevan: 'يريفان',
  London: 'لندن', Manchester: 'مانشستر', Paris: 'باريس', Nice: 'نيس', Geneva: 'جنيف', Zurich: 'زيورخ', Interlaken: 'إنترلاكن',
  Vienna: 'فيينا', Munich: 'ميونخ', Berlin: 'برلين', Rome: 'روما', Milan: 'ميلانو', Madrid: 'مدريد', Barcelona: 'برشلونة',
  Amsterdam: 'أمستردام', Prague: 'براغ', Sarajevo: 'سراييفو', Athens: 'أثينا', Lisbon: 'لشبونة',
  'Kuala Lumpur': 'كوالالمبور', Bali: 'بالي', Jakarta: 'جاكرتا', Bangkok: 'بانكوك', Phuket: 'بوكيت', Singapore: 'سنغافورة',
  Tokyo: 'طوكيو', Seoul: 'سول', Male: 'ماليه', Maldives: 'جزر المالديف', 'New York': 'نيويورك', Marrakech: 'مراكش',
  Casablanca: 'الدار البيضاء', Tunis: 'تونس', Zanzibar: 'زنجبار', Mumbai: 'مومباي', Delhi: 'دلهي', Karachi: 'كراتشي',
  Lahore: 'لاهور', Islamabad: 'إسلام آباد', Dhaka: 'دكا', Manila: 'مانيلا', Colombo: 'كولومبو', Almaty: 'ألماتي', Tashkent: 'طشقند',
  // Countries
  'Saudi Arabia': 'السعودية', 'Kingdom of Saudi Arabia': 'المملكة العربية السعودية', Türkiye: 'تركيا', Turkey: 'تركيا',
  'United Arab Emirates': 'الإمارات', UAE: 'الإمارات', Qatar: 'قطر', Bahrain: 'البحرين', Oman: 'عُمان', Egypt: 'مصر',
  Jordan: 'الأردن', Lebanon: 'لبنان', Azerbaijan: 'أذربيجان', Georgia: 'جورجيا', Armenia: 'أرمينيا',
  'United Kingdom': 'المملكة المتحدة', UK: 'المملكة المتحدة', France: 'فرنسا', Switzerland: 'سويسرا', Austria: 'النمسا',
  Germany: 'ألمانيا', Italy: 'إيطاليا', Spain: 'إسبانيا', Netherlands: 'هولندا', 'Czechia': 'التشيك', 'Bosnia and Herzegovina': 'البوسنة والهرسك',
  Greece: 'اليونان', Portugal: 'البرتغال', Malaysia: 'ماليزيا', Indonesia: 'إندونيسيا', Thailand: 'تايلاند', Japan: 'اليابان',
  'South Korea': 'كوريا الجنوبية', 'United States': 'الولايات المتحدة', USA: 'الولايات المتحدة', Morocco: 'المغرب', Tunisia: 'تونس',
  Tanzania: 'تنزانيا', India: 'الهند', Pakistan: 'باكستان', Bangladesh: 'بنغلاديش', Philippines: 'الفلبين', 'Sri Lanka': 'سريلانكا',
  Kazakhstan: 'كازاخستان', Uzbekistan: 'أوزبكستان', Schengen: 'شنغن', 'the Schengen area': 'منطقة شنغن',
  // Airlines
  Saudia: 'السعودية', flynas: 'طيران ناس', flyadeal: 'طيران أديل', 'Riyadh Air': 'طيران الرياض', 'Turkish Airlines': 'الخطوط التركية',
  Emirates: 'طيران الإمارات', 'Qatar Airways': 'الخطوط القطرية', Etihad: 'الاتحاد للطيران', 'Gulf Air': 'طيران الخليج',
  'Oman Air': 'الطيران العُماني', EgyptAir: 'مصر للطيران', 'Royal Jordanian': 'الملكية الأردنية', flydubai: 'فلاي دبي',
  'Pegasus': 'بيغاسوس', 'Azerbaijan Airlines': 'الخطوط الأذربيجانية', 'Georgian Airways': 'الخطوط الجورجية',
  // The desk: agents' names as they sign in Arabic
  Faisal: 'فيصل', Noura: 'نورة',
  // Airports people say by name
  'King Khalid': 'مطار الملك خالد', 'King Khalid International': 'مطار الملك خالد الدولي', 'King Abdulaziz International': 'مطار الملك عبدالعزيز الدولي',
  'Istanbul Airport': 'مطار إسطنبول', 'Sabiha Gökçen': 'مطار صبيحة كوكجن',
};

/**
 * Phrases suppliers send as they are (fare reasons, bag allowances, fare rules, arrival facts). Exact matches only.
 */
export const PHRASES_AR: Readonly<Record<string, string>> = {
  'Not refundable': 'غير قابل للاسترداد', Free: 'مجانًا', 'One stop in Istanbul': 'توقف واحد في إسطنبول',
  '7 kg cabin bag': 'حقيبة مقصورة 7 كجم',
  'A daytime flight. Meals on board.': 'رحلة نهارية. وجبات على متن الطائرة.',
  'A full first day, after a short night.': 'يوم أول كامل، بعد ليلة قصيرة.',
  'After work. Cabin bag only.': 'بعد الدوام. حقيبة مقصورة فقط.',
  'Arrives at Terminal 1 before lunch.': 'تصل إلى الصالة 1 قبل الغداء.',
  'Arrives for sunset.': 'تصل وقت الغروب.',
  'Cabin bag only. A 20 kg bag is SAR 120 more.': 'حقيبة مقصورة فقط. حقيبة 20 كجم بـ 120 ر.س إضافية.',
  'Cabin bag only.': 'حقيبة مقصورة فقط.',
  'Direct to Heathrow. Sleep on the way.': 'مباشرة إلى هيثرو. نَم في الطريق.',
  'Direct. Lands before check-in.': 'مباشرة. تهبط قبل موعد تسجيل الدخول.',
  'Early start, a full first day.': 'بداية مبكرة، ويوم أول كامل.',
  'Every hour through the day. This one beats the traffic.': 'رحلة كل ساعة طوال اليوم. هذه تسبق الزحام.',
  'In time for lunch in the Old Town.': 'تصل في وقت الغداء في البلدة القديمة.',
  'Morning in the mountains.': 'صباح في الجبال.',
  'One stop in Istanbul, 1h 50m to change.': 'توقف واحد في إسطنبول، ساعة و50 دقيقة للتبديل.',
  'One stop in Istanbul. Two bags each.': 'توقف واحد في إسطنبول. حقيبتان لكل مسافر.',
  'The only direct flight. Arrives mid-afternoon.': 'الرحلة المباشرة الوحيدة. تصل منتصف العصر.',
  'The other airport, about 50 minutes from Galata.': 'المطار الآخر، على بعد 50 دقيقة تقريبًا من غلطة.',
  'Light rain. Pack the umbrella.': 'مطر خفيف. خذ المظلة.', 'Light rain. Dry by Thursday.': 'مطر خفيف. يصحو بحلول الخميس.',
  'light rain': 'مطر خفيف', 'Light rain': 'مطر خفيف', sunny: 'مشمس', Sunny: 'مشمس', clear: 'صافٍ', cloudy: 'غائم',
  'Rooms near Galata Tower': 'غرف قرب برج غلطة', 'Airport pickup both ways': 'استقبال من المطار وتوصيل إليه',
};

/** Patterns in supplier text: fees, refunds, bag allowances, doors, carousels and terminals. */
const PATTERNS_AR: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  [/^SAR ([\d,]+) per person$/, (m) => `${m[1]} ر.س للشخص`],
  [/^Refund minus SAR ([\d,]+) per person$/, (m) => `استرداد بعد خصم ${m[1]} ر.س للشخص`],
  [/^(\d+) × (\d+) kg$/, (m) => `${m[1]} × ${m[2]} كجم`],
  [/^[Dd]oor (\d+)$/, (m) => `البوابة ${m[1]}`],
  [/^carousel (\d+)$/i, (m) => `السير ${m[1]}`],
  [/^Terminal (\d+)$/, (m) => `الصالة ${m[1]}`],
  [/^(\d+) min$/, (m) => `${m[1]} د`],
  [/^(\d+)[–-](\d+) min$/, (m) => `${m[1]}–${m[2]} د`],
  [/^(Visa|Mastercard|mada|Card) ending (\d{2,4})$/, (m) => `${m[1] === 'mada' ? 'مدى' : m[1] === 'Card' ? 'البطاقة' : m[1]} المنتهية بـ \u2066${m[2]}\u2069`],
];

/** The Arabic for a place, airline or well-known supplier phrase that came in English, or the text unchanged. */
export function nameIn(name: string, locale: 'en' | 'ar'): string {
  if (locale !== 'ar' || !name) return name;
  const key = name.trim();
  const known = NAMES_AR[key] ?? PHRASES_AR[key];
  if (known) return known;
  for (const [re, to] of PATTERNS_AR) {
    const m = re.exec(key);
    if (m) return to(m);
  }
  return name;
}
