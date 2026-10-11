/*
 * Arabic in Ask: what was typed in Arabic is read by the same rules as English. The words the rules look for (kinds,
 * places, days, how many, how long) are put in English in place, so "فندق في دبي الويكند الجاي لـ ٤" is read as
 * "hotel in dubai next weekend for 4". Words the rules don't know stay as they were typed (a hotel's or an outing's own
 * name, a free-text wish). Pure, no I/O.
 */
import { NAMES_AR } from '../copy/names-ar';

const HAS_ARABIC = /[؀-ۿ]/;

/** One spelling for the letters people type several ways: hamza seats, alef maqsura, ta marbuta, digits, tatweel, marks. */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ْٰ]/g, '') // harakat, tanween, dagger alef
    .replace(/ـ/g, '') // tatweel ("لـ")
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[،؛]/g, ',')
    .replace(/؟/g, '?');
}

/** Arabic word boundaries: \b doesn't see Arabic letters. */
const B = '(?<=^|[\\s,.!?:;()"\'«»-])';
const E = '(?=$|[\\s,.!?:;()"\'«»-])';
/** Prefixes glued to a word: و (and), ب (in), ل (to/for), ف, and their pairs. */
const PFX = '(و|ف)?(ب|ل|لل)?';

type Rule = [RegExp, string | ((...m: string[]) => string)];
const w = (src: string, flags = 'g') => new RegExp(`${B}${src}${E}`, flags);

const NUM_AR: Record<string, string> = {
  واحد: '1', شخص: '1', اثنين: '2', اثنان: '2', ثنين: '2', شخصين: '2', ثلاث: '3', ثلاثه: '3', اربع: '4', اربعه: '4', خمس: '5', خمسه: '5', سته: '6', ست: '6', سبع: '7', سبعه: '7',
};
const num = (x: string) => NUM_AR[x] ?? x;
const NUM = '(\\d+|واحد|اثنين|اثنان|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه)';
const DAYS = '(ايام|يوم|يوما)';
const NIGHTS = '(ليالي|ليال|ليله)';
const WEEKS = '(اسابيع|اسبوع)';

/** Phrases first (longest), then words. Each turns into the English the rules read. */
const RULES: Rule[] = [
  // When.
  [w('(?:في )?(?:الويكند|الويك اند|نهايه الاسبوع|عطله نهايه الاسبوع) (?:الجاي|القادم|الياي|اللي بعده)'), ' next weekend '],
  [w('(?:هذا |ها)?(?:الويكند|الويك اند|نهايه الاسبوع|عطله نهايه الاسبوع)(?: هذا| الحين)?'), ' this weekend '],
  [w('هالويكند'), ' this weekend '],
  [w('(?:الاسبوع|الاسبوع) (?:الجاي|القادم|الياي)'), ' next week '],
  [w('(?:الليله|هالليله|الحين|اليوم بالليل)'), ' tonight '],
  [w('اليوم'), ' today '],
  [w('(?:بكره|بكرا|باكر|غدا|بكرة)'), ' tomorrow '],
  [w('(?:عيد الاضحي|العيد الكبير|الاضحي)'), ' eid al-adha '],
  [w('(?:عيد الفطر|العيد|في العيد|بالعيد)'), ' eid '],
  [w('(?:في |ب)?رمضان'), ' in ramadan '],
  [w('(?:في |ب)?الصيف'), ' summer '],
  [w('(?:اجازه منتصف العام|اجازه الربيع|اجازه المدارس)'), ' school break '],
  // How long.
  [w(`(?:لمده |مده )?${NUM} ${DAYS}`), (_m, n) => ` for ${num(n!)} days `],
  [w(`(?:لمده |مده )?${NUM} ${NIGHTS}`), (_m, n) => ` for ${num(n!)} nights `],
  [w(`(?:لمده |مده )?${NUM} ${WEEKS}`), (_m, n) => ` for ${num(n!)} weeks `],
  [w('(?:لمده )?يومين'), ' for 2 days '],
  [w('(?:لمده )?ليلتين'), ' for 2 nights '],
  [w('(?:لمده )?(?:اسبوعين)'), ' for 2 weeks '],
  [w('(?:لمده |لمده )(?:يوم|يوم واحد)'), ' for 1 day '],
  [w('لمده اسبوع'), ' for a week '],
  // Who.
  [w(`(?:ل|لـ|عدد|ل عدد) ?${NUM} ?(?:اشخاص|اشخاص|افراد|نفر|انفار|بالغين|ناس)?`), (_m, n) => ` for ${num(n!)} `],
  [w(`${NUM} (?:اشخاص|افراد|نفر|انفار|بالغين)`), (_m, n) => ` ${num(n!)} people `],
  [w('(?:لشخصين|لنا اثنين|انا وزوجتي|انا وزوجي|انا ومرتي|انا وحرمي)'), ' the two of us '],
  [w('(?:مع |و)?(?:زوجتي|مرتي|حرمي|المدام)'), ' my wife '],
  [w('(?:مع |و)?زوجي'), ' my husband '],
  [w('(?:مع |و)?(?:العائله|العايله|العيله|الاهل|اهلي|عائلتي|عايلتي)'), ' the family '],
  [w('(?:مع |و)?(?:الاطفال|الاولاد|العيال|البزران|اطفالي|عيالي)'), ' kids '],
  [w('(?:لحالي|وحدي|بمفردي|لي بس|لي فقط|انا بس)'), ' just me '],
  [w('(?:الشغاله|الخادمه|المربيه)'), ' helper '],
  [w('(?:رضيع|طفل رضيع)'), ' baby '],
  // What.
  [w('(?:ذهاب فقط|ذهاب بس|اتجاه واحد)'), ' one-way '],
  [w('(?:ذهاب وعوده|ذهاب واياب|ذهاب ورجوع|ذهاب وعودة)'), ' return '],
  [w('(?:درجه رجال الاعمال|درجه الاعمال|بزنس|رجال اعمال)'), ' business '],
  [w('(?:الدرجه الاولي|درجه اولي|فيرست)'), ' first class '],
  [w('(?:الدرجه السياحيه|سياحي|اقتصادي|ايكونومي)'), ' economy '],
  [w(`${PFX}(?:تذاكر طيران|تذكره طيران|حجز طيران|رحلات طيران|رحله طيران|طيران|طياره|رحلات|رحله جويه)`), (_m, a, b) => ` ${b ? (b === 'ب' ? 'by ' : 'for ') : ''}flights `],
  [w(`${PFX}(?:مكان للاقامه|مكان اقامه|مكان اسكن فيه|مكان انام فيه|فنادق|فندق|اوتيل|سكن|اقامه|غرف|غرفه|شقه|شقق|فيلا|منتجع|شاليه|جناح)`), ' hotel '],
  [w(`${PFX}(?:عمره|العمره|اعتمار)`), ' umrah '],
  [w(`${PFX}(?:تاشيره|تاشيرة|التاشيره|فيزا|الفيزا|تاشيرات|شنغن|الشنغن|موعد سفاره|موعد في السفاره)`), (m) => (/شنغن/.test(m) ? ' schengen visa ' : ' visa ')],
  [w(`${PFX}(?:شريحه بيانات|شريحه انترنت|شريحه|باقه انترنت|باقه بيانات|انترنت)`), ' esim '],
  [w(`${PFX}(?:تاجير سيارات|تاجير سياره|استئجار سياره|ايجار سياره|سياره بسواق|سياره مع سائق|سيارات|سياره|سيارة)`), (m) => (/سواق|سائق/.test(m) ? ' a car with a driver ' : ' car ')],
  [w(`${PFX}(?:سواق|سائق)`), ' driver '],
  [w(`${PFX}(?:حجز طاوله|طاوله|طاولة|حجز مطعم|مطعم|مطاعم)`), (m) => (/مطعم|مطاعم/.test(m) ? ' restaurant ' : ' table ')],
  [w(`${PFX}(?:عشاء|عشا)`), ' dinner '],
  [w(`${PFX}(?:غداء)`), ' lunch '],
  [w(`${PFX}(?:فطور|ريوق)`), ' breakfast '],
  [w('(?:بوليفارد وورلد|بوليفارد ورلد|البوليفارد وورلد)'), ' Boulevard World '],
  [w('(?:بوليفارد سيتي|البوليفارد سيتي)'), ' Boulevard City '],
  [w('(?:بوليفارد|البوليفارد)'), ' boulevard '],
  [w('(?:موسم الرياض)'), ' Riyadh Season '],
  [w('(?:ونتر وندرلاند|ونتر وندر لاند)'), ' Winter Wonderland '],
  [w(`${PFX}(?:حفله|حفلات|الحفله|حفل)`), ' concert '],
  [w(`${PFX}(?:مهرجان|المهرجان)`), ' festival '],
  [w(`${PFX}(?:فعاليه|فعاليات|الفعاليات|الفعاليه|ايفنت)`), ' event '],
  [w(`${PFX}(?:مباراه|ماتش|المباراه)`), ' match '],
  [w(`${PFX}(?:متحف|المتحف|متاحف)`), ' museum '],
  [w(`${PFX}(?:جوله|جولات|رحله سياحيه)`), ' tour '],
  [w(`${PFX}(?:انشطه|نشاطات|نشاط|اشياء اسويها|وش اسوي|شي اسويه|اماكن سياحيه|اماكن اروحها)`), ' things to do '],
  [w(`${PFX}(?:تذاكر|تذكره)`), ' tickets '],
  [w('(?:بالليل|في الليل|ليلا)'), ' at night '],
  [w(`${PFX}(?:خطه|جدول|برنامج سياحي|برنامج)`), ' plan a '],
  [w('(?:قريب من الحرم|جنب الحرم|قرب الحرم|مطل علي الحرم)'), ' near the haram '],
  [w('(?:كرسي متحرك|كرسي عجلات)'), ' wheelchair '],
  [w('(?:رحله|سفره|سفر)'), ' trip '],
  [w('(?:عائليه|عايليه|للعائله)'), ' family '],
  // Wanting: "أبغى", "أبي", "أريد", "ودي" read as "I want" (the rules strip it from an outing's name).
  [w('(?:ابغي|ابغا|ابي|اريد|ودي|احتاج|نبغي|نبي|نريد|ممكن|لو سمحت|من فضلك)'), ' i want '],
  // Little words that carry meaning for the rules.
  [w('(?:الي|إلى|لـ)'), ' to '],
  [w('(?:في|فى)'), ' in '],
  [w('من'), ' from '],
];

/** Arabic month names (Gregorian, and the Levantine ones people also type). */
const MONTHS_AR: [string, string][] = [
  ['يناير|كانون الثاني', 'january'], ['فبراير|شباط', 'february'], ['مارس|اذار', 'march'], ['ابريل|نيسان', 'april'], ['مايو|ايار', 'may'], ['يونيو|حزيران', 'june'],
  ['يوليو|تموز', 'july'], ['اغسطس|اب', 'august'], ['سبتمبر|ايلول', 'september'], ['اكتوبر|تشرين الاول', 'october'], ['نوفمبر|تشرين الثاني', 'november'], ['ديسمبر|كانون الاول', 'december'],
];

/** Places we know in Arabic, longest first, with the prefixes people glue on ("لدبي", "بإسطنبول", "للرياض"). */
const PLACE_EXTRA: Record<string, string> = {
  بريطانيا: 'UK', انجلترا: 'UK', انقلترا: 'UK', لندن: 'London', امريكا: 'USA', 'الولايات المتحده': 'USA', اوروبا: 'Europe', فرنسا: 'France', المانيا: 'Germany', ايطاليا: 'Italy', اسبانيا: 'Spain',
  تركيا: 'Turkey', اسطنبول: 'Istanbul', اسطمبول: 'Istanbul', الاماره: 'Dubai', الامارات: 'Dubai', العلا: 'AlUla', جده: 'Jeddah', جدة: 'Jeddah', ابها: 'Abha', مكه: 'Makkah', 'مكه المكرمه': 'Makkah',
  المدينه: 'Madinah', 'المدينه المنوره': 'Madinah', جورجيا: 'Georgia', المالديف: 'Maldives', 'جزر المالديف': 'Maldives',
};
let PLACES: [string, string][] | null = null;
function places(): [string, string][] {
  if (PLACES) return PLACES;
  const out = new Map<string, string>();
  for (const [en, ar] of Object.entries(NAMES_AR)) {
    if (!HAS_ARABIC.test(ar)) continue;
    const k = normalizeArabic(ar);
    if (k.length >= 3 && !out.has(k)) out.set(k, en);
  }
  for (const [ar, en] of Object.entries(PLACE_EXTRA)) out.set(normalizeArabic(ar), en);
  // Names that are also everyday words ("السعودية" is the airline and the country; "عُمان" reads as a city): the rules
  // only need cities and countries, so the airline names are dropped.
  for (const k of ['السعوديه', 'الاتحاد للطيران', 'طيران الامارات']) out.delete(k);
  PLACES = [...out.entries()].sort((a, b) => b[0].length - a[0].length);
  return PLACES;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What was typed, with the Arabic the rules need put in English. English text comes back unchanged (lower-cased only
 * where Arabic was replaced), so parseAskRules keeps reading English exactly as before.
 */
export function arabicForRules(text: string): string {
  if (!HAS_ARABIC.test(text)) return text;
  let s = ` ${normalizeArabic(text)} `;
  for (const [ar, en] of places()) {
    const base = escape(ar);
    // للرياض = ل + الرياض; لدبي = ل + دبي; بدبي = ب + دبي; ودبي = و + دبي.
    const lam = ar.startsWith('ال') ? `لل${escape(ar.slice(2))}` : null;
    const re = new RegExp(`${B}(و)?(?:(ل|ب)?${base}${lam ? `|(${lam})` : ''})${E}`, 'g');
    s = s.replace(re, (...m: unknown[]) => {
      const [, and, pre, ll] = m as (string | undefined)[];
      const to = (typeof ll === 'string' && ll) || pre === 'ل';
      return ` ${and ? 'and ' : ''}${to ? 'to ' : pre === 'ب' ? 'in ' : ''}${en.toLowerCase()} `;
    });
  }
  for (const [ar, en] of MONTHS_AR) s = s.replace(w(`(?:شهر )?(?:${ar})`), ` ${en} `);
  for (const [re, to] of RULES) s = s.replace(re, to as never);
  return s.replace(/\s{2,}/g, ' ').trim();
}
