import { DESTINATIONS } from './booking-data';
import { COUNTRY_CODES } from './esim-data';

/*
 * Where an eSIM is for: any country (ISO 3166-1 alpha-2) or a region the supplier sells. The names here, in English and
 * Arabic, let the eSIM planner search them as you type and let Ask read "Pakistan", "باكستان", "Lahore" or "لاهور" as
 * a place. Which of these the supplier actually covers comes from its catalogue (GET /esim/places); this table only
 * names them. Cities map to their country: an eSIM is sold per country, never per city.
 */

export type Continent = 'EU' | 'ME' | 'AS' | 'AF' | 'NA' | 'SA' | 'OC';
export type EsimCountry = { code: string; en: string; ar: string; cont: Continent; words: readonly string[] };

// CODE|English|Arabic|continent|other words and cities (English or Arabic, comma separated)
const ROWS = `
AD|Andorra|أندورا|EU|
AE|United Arab Emirates|الإمارات|ME|uae,the uae,emirates,dubai,abu dhabi,sharjah,ajman,ras al khaimah,دبي,ابوظبي,ابو ظبي,الشارقة,عجمان,راس الخيمة,امارات
AF|Afghanistan|أفغانستان|AS|kabul,كابل
AG|Antigua and Barbuda|أنتيغوا وباربودا|NA|antigua
AL|Albania|ألبانيا|EU|tirana,تيرانا
AM|Armenia|أرمينيا|AS|yerevan,يريفان
AO|Angola|أنغولا|AF|luanda
AR|Argentina|الأرجنتين|SA|buenos aires,بوينس آيرس
AT|Austria|النمسا|EU|vienna,salzburg,innsbruck,zell am see,فيينا,سالزبورغ,زيلامسي
AU|Australia|أستراليا|OC|sydney,melbourne,brisbane,perth,سيدني,ملبورن
AW|Aruba|أروبا|NA|
AZ|Azerbaijan|أذربيجان|AS|baku,gabala,qabala,باكو,قبالا,اذربيجان
BA|Bosnia and Herzegovina|البوسنة والهرسك|EU|bosnia,sarajevo,mostar,البوسنة,سراييفو,موستار
BB|Barbados|باربادوس|NA|
BD|Bangladesh|بنغلاديش|AS|dhaka,دكا,بنقلاديش
BE|Belgium|بلجيكا|EU|brussels,bruges,antwerp,بروكسل
BF|Burkina Faso|بوركينا فاسو|AF|
BG|Bulgaria|بلغاريا|EU|sofia,صوفيا
BH|Bahrain|البحرين|ME|manama,المنامة
BI|Burundi|بوروندي|AF|
BJ|Benin|بنين|AF|
BN|Brunei|بروناي|AS|
BO|Bolivia|بوليفيا|SA|
BR|Brazil|البرازيل|SA|rio,rio de janeiro,sao paulo,ريو,ساو باولو
BS|Bahamas|الباهاما|NA|the bahamas
BT|Bhutan|بوتان|AS|
BW|Botswana|بوتسوانا|AF|
BY|Belarus|بيلاروسيا|EU|minsk
BZ|Belize|بليز|NA|
CA|Canada|كندا|NA|toronto,vancouver,montreal,تورنتو,فانكوفر,مونتريال
CD|DR Congo|الكونغو الديمقراطية|AF|congo kinshasa,kinshasa
CF|Central African Republic|أفريقيا الوسطى|AF|
CG|Congo|الكونغو|AF|congo brazzaville
CH|Switzerland|سويسرا|EU|zurich,geneva,interlaken,lucerne,zermatt,زيورخ,جنيف,انترلاكن,لوزيرن
CI|Côte d’Ivoire|ساحل العاج|AF|ivory coast,cote divoire,abidjan
CL|Chile|تشيلي|SA|santiago
CM|Cameroon|الكاميرون|AF|
CN|China|الصين|AS|beijing,shanghai,guangzhou,shenzhen,بكين,شنغهاي,قوانغتشو
CO|Colombia|كولومبيا|SA|bogota
CR|Costa Rica|كوستاريكا|NA|
CU|Cuba|كوبا|NA|havana
CV|Cape Verde|الرأس الأخضر|AF|cabo verde
CY|Cyprus|قبرص|EU|larnaca,limassol,لارنكا
CZ|Czechia|التشيك|EU|czech republic,the czech republic,prague,براغ
DE|Germany|ألمانيا|EU|berlin,munich,frankfurt,hamburg,برلين,ميونخ,فرانكفورت,المانيا
DJ|Djibouti|جيبوتي|AF|
DK|Denmark|الدنمارك|EU|copenhagen,كوبنهاغن
DM|Dominica|دومينيكا|NA|
DO|Dominican Republic|الدومينيكان|NA|punta cana
DZ|Algeria|الجزائر|AF|algiers
EC|Ecuador|الإكوادور|SA|quito
EE|Estonia|إستونيا|EU|tallinn
EG|Egypt|مصر|AF|cairo,sharm el sheikh,sharm,hurghada,alexandria,luxor,القاهرة,شرم الشيخ,الغردقة,الاسكندرية,الأقصر
ES|Spain|إسبانيا|EU|madrid,barcelona,malaga,marbella,seville,مدريد,برشلونة,ماربيا,ملقا,اسبانيا
ET|Ethiopia|إثيوبيا|AF|addis ababa,اديس ابابا
FI|Finland|فنلندا|EU|helsinki,lapland,rovaniemi,هلسنكي
FJ|Fiji|فيجي|OC|
FR|France|فرنسا|EU|paris,cannes,lyon,marseille,باريس,نيس,كان
GA|Gabon|الغابون|AF|
GB|United Kingdom|بريطانيا|EU|uk,the uk,england,scotland,wales,britain,great britain,london,manchester,edinburgh,birmingham,لندن,مانشستر,ادنبرة,المملكة المتحدة,انجلترا,اسكتلندا
GD|Grenada|غرينادا|NA|
GE|Georgia|جورجيا|AS|tbilisi,batumi,تبليسي,باتومي
GH|Ghana|غانا|AF|accra
GI|Gibraltar|جبل طارق|EU|
GM|Gambia|غامبيا|AF|
GN|Guinea|غينيا|AF|
GP|Guadeloupe|غوادلوب|NA|
GR|Greece|اليونان|EU|athens,santorini,mykonos,crete,أثينا,سانتوريني,ميكونوس
GT|Guatemala|غواتيمالا|NA|
GU|Guam|غوام|OC|
GW|Guinea-Bissau|غينيا بيساو|AF|
GY|Guyana|غيانا|SA|
HK|Hong Kong|هونغ كونغ|AS|هونج كونج
HN|Honduras|هندوراس|NA|
HR|Croatia|كرواتيا|EU|zagreb,dubrovnik
HT|Haiti|هايتي|NA|
HU|Hungary|المجر|EU|budapest,بودابست,هنغاريا
ID|Indonesia|إندونيسيا|AS|bali,jakarta,بالي,جاكرتا,اندونيسيا
IE|Ireland|أيرلندا|EU|dublin,دبلن
IL|Israel|إسرائيل|ME|
IN|India|الهند|AS|delhi,new delhi,mumbai,bangalore,goa,kerala,hyderabad,نيودلهي,مومباي,دلهي
IQ|Iraq|العراق|ME|baghdad,erbil,najaf,karbala,بغداد,اربيل,النجف,كربلاء
IR|Iran|إيران|ME|tehran,mashhad,طهران,مشهد
IS|Iceland|آيسلندا|EU|reykjavik
IT|Italy|إيطاليا|EU|rome,milan,venice,florence,naples,lake como,روما,ميلان,البندقية,فلورنسا,ايطاليا
JM|Jamaica|جامايكا|NA|
JO|Jordan|الأردن|ME|amman,petra,aqaba,dead sea,البتراء,العقبة,البحر الميت
JP|Japan|اليابان|AS|tokyo,osaka,kyoto,طوكيو,اوساكا
KE|Kenya|كينيا|AF|nairobi,نيروبي
KG|Kyrgyzstan|قرغيزستان|AS|bishkek,قيرغيزستان
KH|Cambodia|كمبوديا|AS|phnom penh,siem reap
KN|Saint Kitts and Nevis|سانت كيتس ونيفيس|NA|
KR|South Korea|كوريا الجنوبية|AS|korea,seoul,busan,سيول,كوريا
KW|Kuwait|الكويت|ME|kuwait city
KY|Cayman Islands|جزر كايمان|NA|
KZ|Kazakhstan|كازاخستان|AS|almaty,astana,ألماتي
LA|Laos|لاوس|AS|
LB|Lebanon|لبنان|ME|beirut,بيروت
LC|Saint Lucia|سانت لوسيا|NA|
LI|Liechtenstein|ليختنشتاين|EU|
LK|Sri Lanka|سريلانكا|AS|colombo,سري لانكا,كولومبو
LR|Liberia|ليبيريا|AF|
LS|Lesotho|ليسوتو|AF|
LT|Lithuania|ليتوانيا|EU|vilnius
LU|Luxembourg|لوكسمبورغ|EU|
LV|Latvia|لاتفيا|EU|riga
LY|Libya|ليبيا|AF|tripoli
MA|Morocco|المغرب|AF|marrakech,marrakesh,casablanca,rabat,fes,tangier,مراكش,الدار البيضاء,الرباط,طنجة
MC|Monaco|موناكو|EU|
MD|Moldova|مولدوفا|EU|
ME|Montenegro|الجبل الأسود|EU|
MG|Madagascar|مدغشقر|AF|
MK|North Macedonia|مقدونيا الشمالية|EU|macedonia,skopje
ML|Mali|مالي|AF|
MM|Myanmar|ميانمار|AS|burma
MN|Mongolia|منغوليا|AS|
MO|Macao|ماكاو|AS|macau
MQ|Martinique|مارتينيك|NA|
MR|Mauritania|موريتانيا|AF|nouakchott
MT|Malta|مالطا|EU|valletta
MU|Mauritius|موريشيوس|AF|
MV|Maldives|المالديف|AS|the maldives
MW|Malawi|مالاوي|AF|
MX|Mexico|المكسيك|NA|cancun,mexico city,كانكون
MY|Malaysia|ماليزيا|AS|kuala lumpur,langkawi,penang,كوالالمبور,كوالا لمبور,لنكاوي,بينانج
MZ|Mozambique|موزمبيق|AF|
NA|Namibia|ناميبيا|AF|
NC|New Caledonia|كاليدونيا الجديدة|OC|
NE|Niger|النيجر|AF|
NG|Nigeria|نيجيريا|AF|lagos,abuja
NI|Nicaragua|نيكاراغوا|NA|
NL|Netherlands|هولندا|EU|the netherlands,holland,amsterdam,rotterdam,امستردام
NO|Norway|النرويج|EU|oslo,tromso,bergen,اوسلو
NP|Nepal|نيبال|AS|kathmandu,كاتماندو
NZ|New Zealand|نيوزيلندا|OC|auckland,queenstown,اوكلاند
OM|Oman|عُمان|ME|muscat,salalah,مسقط,صلالة,سلطنة عمان
PA|Panama|بنما|NA|
PE|Peru|بيرو|SA|lima
PF|French Polynesia|بولينيزيا الفرنسية|OC|tahiti,bora bora
PG|Papua New Guinea|بابوا غينيا الجديدة|OC|
PH|Philippines|الفلبين|AS|manila,cebu,boracay,مانيلا
PK|Pakistan|باكستان|AS|lahore,karachi,islamabad,rawalpindi,peshawar,faisalabad,multan,لاهور,كراتشي,اسلام اباد,إسلام آباد,بيشاور,راولبندي
PL|Poland|بولندا|EU|warsaw,krakow,وارسو
PR|Puerto Rico|بورتوريكو|NA|
PS|Palestine|فلسطين|ME|
PT|Portugal|البرتغال|EU|lisbon,porto,madeira,لشبونة
PY|Paraguay|باراغواي|SA|
QA|Qatar|قطر|ME|doha,الدوحة
RE|Réunion|لا ريونيون|AF|reunion
RO|Romania|رومانيا|EU|bucharest
RS|Serbia|صربيا|EU|belgrade,بلغراد
RU|Russia|روسيا|EU|moscow,st petersburg,saint petersburg,موسكو,سانت بطرسبرغ
RW|Rwanda|رواندا|AF|kigali
SA|Saudi Arabia|السعودية|ME|saudi,ksa,riyadh,jeddah,makkah,mecca,madinah,medina,dammam,khobar,abha,alula,taif,الرياض,جدة,جده,مكة,الدمام,الخبر,ابها,العلا,الطائف,المدينة المنورة
SC|Seychelles|سيشل|AF|
SD|Sudan|السودان|AF|khartoum
SE|Sweden|السويد|EU|stockholm,ستوكهولم
SG|Singapore|سنغافورة|AS|
SI|Slovenia|سلوفينيا|EU|ljubljana
SK|Slovakia|سلوفاكيا|EU|bratislava
SL|Sierra Leone|سيراليون|AF|
SM|San Marino|سان مارينو|EU|
SN|Senegal|السنغال|AF|dakar
SO|Somalia|الصومال|AF|mogadishu
SR|Suriname|سورينام|SA|
SV|El Salvador|السلفادور|NA|
SY|Syria|سوريا|ME|damascus,aleppo,دمشق,حلب
SZ|Eswatini|إسواتيني|AF|swaziland
TC|Turks and Caicos|جزر تركس وكايكوس|NA|
TD|Chad|تشاد|AF|
TG|Togo|توغو|AF|
TH|Thailand|تايلاند|AS|bangkok,phuket,pattaya,krabi,chiang mai,koh samui,بانكوك,بوكيت,باتايا,كرابي
TJ|Tajikistan|طاجيكستان|AS|dushanbe
TL|Timor-Leste|تيمور الشرقية|AS|east timor
TM|Turkmenistan|تركمانستان|AS|
TN|Tunisia|تونس|AF|tunis
TR|Türkiye|تركيا|EU|turkey,turkiye,istanbul,antalya,bodrum,trabzon,bursa,izmir,ankara,cappadocia,uzungol,sapanca,اسطنبول,إسطنبول,انطاليا,بودروم,طرابزون,بورصة,ازمير,انقرة,كابادوكيا,اوزنجول,سبانجا,تركيه
TT|Trinidad and Tobago|ترينيداد وتوباغو|NA|
TW|Taiwan|تايوان|AS|taipei
TZ|Tanzania|تنزانيا|AF|zanzibar,dar es salaam,زنجبار
UA|Ukraine|أوكرانيا|EU|kyiv,kiev
UG|Uganda|أوغندا|AF|kampala
US|United States|أمريكا|NA|usa,the usa,us,america,the us,united states of america,new york,los angeles,miami,orlando,las vegas,chicago,washington,san francisco,boston,houston,نيويورك,لوس انجلوس,ميامي,اورلاندو,لاس فيغاس,امريكا,الولايات المتحدة
UY|Uruguay|الأوروغواي|SA|montevideo
UZ|Uzbekistan|أوزبكستان|AS|tashkent,samarkand,bukhara,طشقند,سمرقند,بخارى
VC|Saint Vincent and the Grenadines|سانت فنسنت والغرينادين|NA|
VE|Venezuela|فنزويلا|SA|
VG|British Virgin Islands|جزر العذراء البريطانية|NA|
VI|US Virgin Islands|جزر العذراء الأمريكية|NA|
VN|Vietnam|فيتنام|AS|hanoi,ho chi minh,saigon,da nang,هانوي
XK|Kosovo|كوسوفو|EU|pristina
YE|Yemen|اليمن|ME|sanaa,aden,صنعاء,عدن
ZA|South Africa|جنوب أفريقيا|AF|cape town,johannesburg,كيب تاون,جوهانسبرغ
ZM|Zambia|زامبيا|AF|lusaka
ZW|Zimbabwe|زيمبابوي|AF|harare
`;

export const ESIM_COUNTRIES: readonly EsimCountry[] = ROWS.trim().split('\n').map((line) => {
  const [code, en, ar, cont, words] = line.split('|') as [string, string, string, Continent, string];
  return { code, en, ar, cont, words: (words ?? '').split(',').map((w) => w.trim()).filter(Boolean) };
});
const BY_CODE = new Map(ESIM_COUNTRIES.map((c) => [c.code, c]));
export const esimCountry = (code: string | null | undefined): EsimCountry | null => (code ? BY_CODE.get(code.toUpperCase()) ?? null : null);

/** The flag of an ISO country code, as an emoji ("PK" → 🇵🇰); null for a region. */
export function esimFlag(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  return String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Regions a traveller may type: Mada's key for each and how a supplier's own regions are recognised. */
export const ESIM_REGION_WORDS: readonly { key: string; en: string; ar: string; words: readonly string[]; match: RegExp }[] = [
  { key: 'europe', en: 'Europe', ar: 'أوروبا', words: ['europe', 'european union', 'eu', 'schengen', 'اوروبا', 'أوروبا', 'شنغن'], match: /^(europe|eu-?\d*)$|europe/i },
  { key: 'gulf', en: 'The Gulf', ar: 'دول الخليج', words: ['gulf', 'gcc', 'the gulf', 'الخليج', 'دول الخليج'], match: /gulf|gcc/i },
  { key: 'middle-east', en: 'Middle East', ar: 'الشرق الأوسط', words: ['middle east', 'mena', 'الشرق الاوسط'], match: /middle\s*east|mena/i },
  { key: 'asia', en: 'Asia', ar: 'آسيا', words: ['asia', 'south east asia', 'southeast asia', 'اسيا', 'آسيا'], match: /asia/i },
  { key: 'africa', en: 'Africa', ar: 'أفريقيا', words: ['africa', 'افريقيا', 'أفريقيا'], match: /africa/i },
  { key: 'americas', en: 'The Americas', ar: 'الأمريكتين', words: ['americas', 'north america', 'south america', 'latin america', 'الامريكتين'], match: /america/i },
  { key: 'world', en: 'Global', ar: 'أغلب دول العالم', words: ['global', 'world', 'worldwide', 'everywhere', 'many countries', 'عالمي', 'عالمية', 'كل العالم', 'العالم', 'دول العالم'], match: /^(world|global|gl-?\d*)$/i },
];

/** Typed words folded for matching: lower case, no accents, Arabic letters in one form, Arabic digits as Western. */
export function foldPlace(text: string): string {
  return ` ${text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

type Term = { term: string; code: string; region: boolean };
let TERMS: Term[] | null = null;
function terms(): Term[] {
  if (TERMS) return TERMS;
  const out: Term[] = [];
  const add = (w: string, code: string, region = false) => {
    const f = foldPlace(w).trim();
    if (f.length < 2) return;
    out.push({ term: f, code, region });
    // Arabic "ال": "الامارات" and "امارات" alike.
    if (f.startsWith('ال') && f.length > 4) out.push({ term: f.slice(2), code, region });
  };
  for (const c of ESIM_COUNTRIES) { add(c.en, c.code); add(c.ar, c.code); for (const w of c.words) add(w, c.code); }
  for (const d of Object.values(DESTINATIONS)) add(d.name, d.country);
  for (const [name, code] of Object.entries(COUNTRY_CODES)) add(name, code);
  for (const r of ESIM_REGION_WORDS) { add(r.en, r.key, true); add(r.ar, r.key, true); for (const w of r.words) add(w, r.key, true); }
  // Longest first: "south africa" before "africa", "new zealand" before "zealand".
  TERMS = out.sort((a, b) => b.term.length - a.term.length);
  return TERMS;
}

export type EsimPlaceHit = { kind: 'country' | 'region'; code: string };

/**
 * The country or region named in what was typed: "Pakistan", "باكستان", "pakistan for 10 days", "Lahore", "لاهور",
 * "esim for istanbul", "Europe". Cities give their country. Null when no place is named.
 */
export function findEsimPlace(text: string): EsimPlaceHit | null {
  const s = foldPlace(text);
  if (/^ [a-z]{2} $/i.test(s) && esimCountry(s.trim())) return { kind: 'country', code: s.trim().toUpperCase() };
  for (const t of terms()) {
    // A whole word, or (Arabic) joined to ل / ب / و / لـ: "لباكستان", "بتركيا".
    if (s.includes(` ${t.term} `) || (/[؀-ۿ]/.test(t.term) && new RegExp(` (?:لل|[لبو])${t.term} `).test(s))) {
      // Two-letter English words ("us", "uk") only when typed on their own or with "the".
      if (t.term.length <= 2 && !/^ (?:the )?[a-z]{2} $/.test(s) && !/ (?:in|to) (?:the )?(?:us|uk) | for (?:the )?uk /.test(s)) continue;
      return { kind: t.region ? 'region' : 'country', code: t.code };
    }
  }
  return null;
}

/** "Pakistan" / "باكستان" for a country code, a region's name for a region key; null when Mada has no name for it. */
export function esimPlaceName(code: string, locale: 'en' | 'ar'): string | null {
  const c = esimCountry(code);
  if (c) return locale === 'ar' ? c.ar : c.en;
  const r = ESIM_REGION_WORDS.find((x) => x.key === code.toLowerCase());
  return r ? (locale === 'ar' ? r.ar : r.en) : null;
}

/** How many days were said: "10 days", "for a week", "two weeks", "١٠ أيام", "اسبوعين", "شهر", or a number on its own. */
export function esimDaysIn(text: string): number | null {
  const s = foldPlace(text);
  const ok = (n: number) => (n >= 1 && n <= 90 ? n : null);
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
    واحد: 1, يومين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, اسبوعين: 14, شهرين: 60 };
  const n = (w: string) => (/^\d+$/.test(w) ? Number(w) : words[w] ?? null);
  let m = / (\d{1,2}|[a-z]+|[؀-ۿ]+) (?:days?|nights?|ايام|يوم|ليالي|ليله|ليال) /.exec(s);
  if (m && n(m[1]!) !== null) return ok(n(m[1]!)!);
  m = / (\d{1,2}|[a-z]+) weeks? /.exec(s);
  if (m && n(m[1]!) !== null) return ok(n(m[1]!)! * 7);
  m = / (\d{1,2}|[a-z]+) months? /.exec(s);
  if (m && n(m[1]!) !== null) return ok(n(m[1]!)! * 30);
  if (/ (?:يومين) /.test(s)) return 2;
  if (/ (?:اسبوعين) /.test(s)) return 14;
  if (/ (?:a week|one week|اسبوع|الاسبوع) /.test(s)) return 7;
  if (/ (?:شهرين) /.test(s)) return 60;
  if (/ (?:a month|one month|شهر|الشهر) /.test(s)) return 30;
  m = /^ (\d{1,2}) $/.exec(s);
  if (m) return ok(Number(m[1]));
  return null;
}
