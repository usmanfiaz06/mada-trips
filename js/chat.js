/* =========================================================
   MADA TRIPS: Concierge chat engine
   Understands free text (English + Arabic, typos, plurals), pulls details
   out of sentences, runs guided requests, and hands off to WhatsApp.
   Knowledge lives in js/chat-kb.js. No backend, no API keys.
   ========================================================= */
(() => {
  const KB = window.MADA_KB;
  if (!KB) return;
  const PHONE = KB.company.phone, PHONE_DISPLAY = KB.company.phoneDisplay;
  const STORE = 'mada-concierge-v2';

  /* ================================================================
     TEXT UNDERSTANDING
     ================================================================ */
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const norm = s => String(s || '')
    .replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d))
    .replace(/(\d)[,٬](?=\d{3})/g, '$1')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}+\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const hasArabic = s => /[؀-ۿ]/.test(s);
  const isArabicText = s => { const ar = (s.match(/[؀-ۿ]/g) || []).length, la = (s.match(/[a-z]/gi) || []).length; return ar > 0 && ar >= la; };
  const stem = w => {
    if (w.length <= 4 || !/[a-z]$/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ss|us|is)$/.test(w)) return w;
    if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
    return w.replace(/s$/, '');
  };
  const arStrip = w => w.length > 4 ? w.replace(/^(وال|بال|فال|كال|لل|ال|و|ب|ف)/, '') : w;
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const prep = text => {
    const n = norm(text);
    const toks = n.split(' ').filter(Boolean);
    return { n, pad: ' ' + n + ' ', toks, stems: new Set(toks.map(stem)), ar: new Set(toks.map(arStrip)) };
  };
  // score one trigger word/phrase against prepared text
  const keyScore = (key, P) => {
    if (key.includes(' ')) return P.pad.includes(' ' + key + ' ') ? 3 + key.split(' ').length * .5 : 0;
    if (P.toks.includes(key)) return 2;
    if (key.length >= 4) {
      const ks = stem(key);
      if (P.stems.has(ks) || P.ar.has(key) || P.ar.has(arStrip(key))) return 2;
      if (key.length >= 5) for (const t of P.toks) if (t.length >= 4 && lev(t, key) <= 1) return 1.4;
    }
    return 0;
  };
  // pre-normalise the knowledge base once
  // one entry per word form, so "عمرة" and "العمرة" don't count twice
  KB.intents.forEach(it => { const seen = new Set(); it._keys = it.keys.map(norm).filter(k => { const c = k.includes(' ') ? k : stem(arStrip(k)); if (seen.has(c)) return false; seen.add(c); return true; }); });
  Object.values(KB.entities).forEach(list => list.forEach(e => (e[1] = e[1].map(norm))));

  const rankIntents = P => KB.intents.map(it => {
    const scores = it._keys.map(k => keyScore(k, P)).filter(Boolean).sort((a, b) => b - a);
    let s = (scores[0] || 0) + (scores[1] || 0) * .5;
    if (s && it.flow) s += .3;
    if (s && it.id === 'visa') s += .6; // "umrah visa" is a visa request, not a trip
    if (s && (it.id === 'urgent' || it.id === 'complaint')) s += .8; // never bury these
    if (it.weak) s *= .8;
    return { it, s };
  }).filter(r => r.s >= 1.4).sort((a, b) => b.s - a.s);

  /* ---------------- entity extraction ---------------- */
  const findEntity = (type, P) => {
    let best = null;
    for (const [label, keys] of KB.entities[type] || []) {
      const sc = Math.max(0, ...keys.map(k => keyScore(k, P)));
      if (sc >= 2 && (!best || sc > best.s)) best = { label, s: sc };
    }
    return best && best.label;
  };
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12,
    واحد: 1, اثنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90 };
  // "two hundred", "around eighty", "a few thousand", "خمسين"
  const wordsToNum = n => {
    const toks = n.split(' '); let total = 0, cur = 0, seen = false;
    for (const w of toks) {
      if (WORDNUM[w] !== undefined) { cur += WORDNUM[w]; seen = true; }
      else if (w === 'hundred' || w === 'مئه' || w === 'ميه') { cur = (cur || 1) * 100; seen = true; }
      else if (w === 'thousand' || w === 'الف') { total += (cur || 1) * 1000; cur = 0; seen = true; }
      else if (w === 'few' || w === 'several') { cur = cur || 3; }
    }
    return seen ? total + cur : null;
  };
  const PEOPLE_WORDS = /(people|persons?|pax|guests?|travell?ers?|adults?|visitors?|attendees?|delegates?|workers?|staff|employees?|engineers?|technicians?|men|heads?|applicants?|ضيف|ضيوف|شخص|اشخاص|افراد|فرد|عامل|عمال|موظف|موظفين|مسافر|مسافرين|نفر)/;
  const ROOM_WORDS = /(rooms?|غرفه|غرف)/;
  const numberNear = (P, words, anyNumber) => {
    const m = P.n.match(new RegExp('(\\d[\\d,]*)\\s*(k|الف)?\\s*' + words.source)) || P.n.match(new RegExp(words.source + '\\s*(\\d[\\d,]*)'));
    if (m) { let v = parseInt((m[1].match(/\d/) ? m[1] : m[2]).replace(/,/g, ''), 10); if (m[2] === 'k' || m[2] === 'الف') v *= 1000; return v; }
    if (/(just me|only me|myself|alone|لوحدي|انا فقط|شخص واحد)/.test(P.n)) return 1;
    if (/(couple|two of us|me and my (wife|husband)|انا وزوجتي|شخصين)/.test(P.n)) return 2;
    const fam = P.n.match(/(family|group|team|party) of (\d+)|عائله من (\d+)|(\d+) افراد/); if (fam) return +(fam[2] || fam[3] || fam[4]);
    if (anyNumber) { const k = P.n.match(/\b(\d[\d,]*)\s*(k|الف)?\b/); if (k) return parseInt(k[1].replace(/,/g, ''), 10) * (k[2] ? 1000 : 1); const w = wordsToNum(P.n); if (w) return w; }
    // "for 200", "لـ 200"
    if (words === PEOPLE_WORDS) { const f = P.n.match(/\b(for|لـ|ل|حوالي|تقريبا) (\d{2,5})\b(?! (days?|nights?|rooms?|sar|riyals?|hours?|يوم|ايام|ليله|ريال|غرف))/); if (f) return +f[2]; }
    // "40 welders", "12 hosts": a number followed by a noun that isn't a unit
    if (words === PEOPLE_WORDS) { const g = P.n.match(/\b(\d{1,5})\s+([a-z\u0600-\u06ff]{3,})/); if (g && !/^(day|days|week|weeks|month|months|year|years|hour|hours|min|mins|minutes|am|pm|sar|riyal|riyals|rooms?|nights?|km|percent|star|stars|st|nd|rd|th|يوم|ايام|اسبوع|شهر|اشهر|سنه|ساعه|ريال|غرفه|غرف|ليله|ليالي)$/.test(g[2]) && !MONTHS.flat().includes(g[2])) return +g[1]; }
    return null;
  };
  const MONTHS = [['january', 'jan', 'يناير', 'كانون الثاني'], ['february', 'feb', 'فبراير', 'شباط'], ['march', 'mar', 'مارس', 'اذار'], ['april', 'apr', 'ابريل', 'نيسان'], ['may', 'مايو', 'ايار'], ['june', 'jun', 'يونيو', 'حزيران'], ['july', 'jul', 'يوليو', 'تموز'], ['august', 'aug', 'اغسطس', 'اب'], ['september', 'sep', 'sept', 'سبتمبر', 'ايلول'], ['october', 'oct', 'اكتوبر', 'تشرين الاول'], ['november', 'nov', 'نوفمبر', 'تشرين الثاني'], ['december', 'dec', 'ديسمبر', 'كانون الاول']];
  const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const findDate = P => {
    const n = P.n;
    const rel = [
      [/\b(asap|urgent|immediately|right away|straight away)\b|فورا|عاجل|باسرع وقت/, 'As soon as possible'],
      [/\btoday\b|اليوم/, 'Today'], [/\btomorrow\b|بكره|بكرا|غدا/, 'Tomorrow'],
      [/\bthis weekend\b|نهايه الاسبوع/, 'This weekend'], [/\bthis week\b|هذا الاسبوع/, 'This week'],
      [/\bnext week\b|الاسبوع (الجاي|القادم)/, 'Next week'], [/\bthis month\b|هذا الشهر/, 'This month'],
      [/\bnext month\b|الشهر (الجاي|القادم)/, 'Next month'], [/\bnext year\b|السنه (الجايه|القادمه)/, 'Next year'],
      [/\b(by|on|this|next)? ?sunday\b|الاحد/, 'Sunday'], [/\b(by|on|this|next)? ?monday\b|الاثنين/, 'Monday'], [/\b(by|on|this|next)? ?tuesday\b|الثلاثاء/, 'Tuesday'], [/\b(by|on|this|next)? ?wednesday\b|الاربعاء/, 'Wednesday'], [/\b(by|on|this|next)? ?thursday\b|الخميس/, 'Thursday'], [/\b(by|on|this|next)? ?friday\b|الجمعه/, 'Friday'], [/\b(by|on|this|next)? ?saturday\b|السبت/, 'Saturday'],
      [/\bramadan\b|رمضان/, 'Ramadan'], [/\beid\b|العيد/, 'Eid'], [/\bsummer\b|الصيف/, 'Summer'], [/\bwinter\b|الشتاء/, 'Winter'],
      [/\b(flexible|any ?time|not sure|dont know)\b|مرن|اي وقت|ما ادري/, 'Flexible']
    ];
    for (const [re, v] of rel) if (re.test(n)) return v;
    const inN = n.match(/\bin (\d+|a|one|two|three|few) (days?|weeks?|months?)\b/) || n.match(/بعد (\d+) (يوم|ايام|اسبوع|اسابيع|شهر|اشهر)/);
    if (inN) return 'In ' + inN[1].replace(/^a$|^one$/, '1') + ' ' + inN[2].replace(/يوم|ايام/, 'days').replace(/اسبوع|اسابيع/, 'weeks').replace(/شهر|اشهر/, 'months');
    const dm = n.match(/\b(\d{1,2})[ /.-](\d{1,2})(?:[ /.-](\d{2,4}))?\b/);
    if (dm && +dm[2] <= 12 && +dm[1] <= 31) return `${dm[1]}/${dm[2]}${dm[3] ? '/' + dm[3] : ''}`;
    for (let i = 0; i < 12; i++) for (const m of MONTHS[i]) {
      if (m.length <= 3 && !/^[a-z]+$/.test(m)) continue;
      if (P.toks.includes(m) || (m.includes(' ') && P.pad.includes(' ' + m + ' '))) {
        if (m === 'may' && !/\b(in|on|by|early|late|mid|of) may\b|\bmay \d/.test(n)) continue; // "may" as a verb
        if (m === 'mar' || m === 'jun' || m === 'jul') { /* short forms fine */ }
        const day = n.match(new RegExp('(\\d{1,2})\\s*(st|nd|rd|th)?\\s*(of )?' + m)) || n.match(new RegExp(m + '\\s*(\\d{1,2})\\b'));
        return (day ? day[1] + ' ' : '') + MONTH_EN[i];
      }
    }
    return null;
  };
  // parse bucket ranges from option labels like "50 to 250", "Under 50", "1,000+"
  const bucketFor = (opts, v) => {
    for (const [en] of opts) {
      const l = en.toLowerCase().replace(/,/g, '');
      let lo = null, hi = null, m;
      if ((m = l.match(/under (\d+)/))) { lo = 0; hi = +m[1] - 1; }
      else if ((m = l.match(/(\d+) to (\d+)/))) { lo = +m[1]; hi = +m[2]; }
      else if ((m = l.match(/(\d+)\s*(\+|or more)/))) { lo = +m[1]; hi = Infinity; }
      else if ((m = l.match(/^(\d+)$/))) { lo = hi = +m[1]; }
      else if (/just me/.test(l)) { lo = hi = 1; }
      else if (/large group|group block/.test(l)) { lo = 21; hi = Infinity; }
      if (lo !== null && v >= lo && v <= hi) return en;
    }
    return null;
  };
  const extractFor = (step, P, awaiting) => {
    switch (step.entity) {
      case 'people': { const v = numberNear(P, PEOPLE_WORDS, awaiting); return v ? `${v.toLocaleString('en')}` : null; }
      case 'rooms': { const v = numberNear(P, ROOM_WORDS, awaiting); return v ? `${v}` : null; }
      case 'date': return findDate(P);
      default: return findEntity(step.entity, P);
    }
  };
  const isGibberish = raw => {
    const t = raw.trim();
    if (hasArabic(t) || /\d/.test(t)) return false;
    const letters = t.replace(/[^a-z]/gi, '');
    if (letters.length < 2) return true;
    const words = t.toLowerCase().match(/[a-z]+/g) || [];
    const long = words.filter(w => w.length > 3);
    if (long.length && long.every(w => !/[aeiouy]/.test(w))) return true;
    if (/(.)\1{4,}/.test(t)) return true;
    if (/^(asdf|qwer|zxcv|hjkl|sdfg|jkl)/i.test(letters)) return true;
    return false;
  };
  // is this a question rather than an answer?
  const QWORDS_EN = /^(do|does|did|can|could|would|will|should|is|are|was|were|have|has|had|may|might|how|what|whats|where|when|why|which|who|whom|whose|any|anything|tell me|explain|is there|are there)\b/;
  const QWORDS_AR = /^(هل|كم|وين|فين|اين|متى|كيف|شلون|ايش|وش|شو|ليش|لماذا|ماذا|ما هي|ما هو|من|مين|عندكم|تقدرون|ممكن|تسوون|تشتغلون)\b/;
  const isQuestion = (raw, n) => /[?؟]\s*$/.test(raw.trim()) || QWORDS_EN.test(n) || QWORDS_AR.test(n);
  // does free text look like a sensible answer to this step?
  const NUMWORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen|dozens|few|several|many|hundreds|thousands)\b|واحد|اثنين|ثلاث|اربع|خمس|ست|سبع|ثمان|تسع|عشر|عشرين|مئه|ميه|الف|كثير|قليل/;
  const plausible = (st, raw, P) => {
    const words = P.toks.length;
    if (isQuestion(raw, P.n) || isGibberish(raw)) return false;
    switch (st.entity) {
      case 'date': return !!findDate(P) || /\d/.test(P.n) || /\b(soon|later|next|this|end of|early|mid|late|season|year|month|week)\b|قريب|بعدين|نهايه|بدايه|منتصف/.test(P.n);
      case 'people': case 'rooms': return /\d/.test(P.n) || NUMWORDS.test(P.n);
      case 'city': return words <= 4;
      default: return words <= 6;
    }
  };
  const HINT = {
    en: { date: 'I just need a rough date here, like “March”, “next month” or “15/3”.', people: 'I just need a rough number here, like “120”.', rooms: 'I just need the number of rooms, like “4”.', city: 'I just need the city here, like “Riyadh” or “AlUla”.', other: 'Pick one below, or type a short answer.' },
    ar: { date: 'أحتاج موعداً تقريبياً فقط، مثل "مارس" أو "الشهر القادم" أو "15/3".', people: 'أحتاج رقماً تقريبياً فقط، مثل "120".', rooms: 'أحتاج عدد الغرف فقط، مثل "4".', city: 'أحتاج اسم المدينة فقط، مثل "الرياض" أو "العلا".', other: 'اختر من الخيارات أو اكتب إجابة قصيرة.' }
  };

  const CMD = {
    restart: /^(start over|restart|reset|new request|begin again|from the start|ابدا من جديد|من جديد|اعاده|ابدا)$/,
    menu: /^(menu|main menu|options|help|القائمه|مساعده|الخيارات)$/,
    cancel: /^(cancel|stop|never ?mind|forget it|quit|exit|الغاء|الغ|خلاص|لا شكرا)$/,
    back: /^(back|go back|previous|undo|رجوع|ارجع|السابق)$/,
    skip: /^(skip|pass|no|none|not now|تخطي|لا|بدون)$/,
    en: /^(en|eng|english|in english|انجليزي|بالانجليزي)$/,
    ar: /^(ع|ar|arabic|in arabic|عربي|بالعربي|العربيه)$/
  };

  /* ================================================================
     WORDS THE BOT SAYS
     ================================================================ */
  const T = {
    en: {
      title: 'Mada Concierge', sub: 'Replies in seconds · team on WhatsApp', placeholder: 'Ask anything or describe your plan', langBtn: 'ع',
      hello: '<b>Marhaba.</b> <span lang="ar" dir="rtl">مرحبا</span><br>I’m Mada’s concierge. Ask me anything, or tell me what you’re planning. Something like <i>“a gala for 300 in Riyadh in March”</i> works.',
      menu: 'What can we help with?', noted: 'Noted:', askName: 'Great. What name should the team use?', askPhone: 'And the best number to reach you? <span class="mc-muted">(optional)</span>',
      badPhone: 'That doesn’t look like a phone number. Try something like 05X XXX XXXX, or skip.', nameAgain: 'Just your name is perfect.',
      back: 'Back to your request.', switchQ: n => `Switch to <b>${n}</b>, or carry on with your current request?`, switchYes: n => `Switch to ${n}`, carryOn: 'Carry on',
      wrap: n => `All set${n ? ', ' + n : ''}. Here’s your request:`, wrapTail: 'Send it on WhatsApp and the team will pick it up right away.',
      wa: 'Send on WhatsApp', call: 'Call ' + PHONE_DISPLAY, form: 'Use the full form', edit: 'Change something', restart: 'Start over', skip: 'Skip', menuChip: 'Main menu', human: 'Talk to the team',
      whichEdit: 'What would you like to change?', humanMsg: 'Of course. Tap below to continue with a real person on WhatsApp, or call us.',
      huh: 'Sorry, I didn’t quite catch that. Could you say it another way?', huh2: 'I’m not getting this one right. Let me hand you to the team, they’ll sort it out.',
      repeat: 'Looks like I’m not helping with that. The team can take it from here.',
      fallback: 'I can help with travel, events, talent, visas, hotels and IT. Which is closest?', sendNote: 'Send my message to the team',
      otherAsk: 'Of course. Tell me in a sentence what you need.', gotIt: 'Got it. I’ll pass that straight to the team.',
      anything: 'Anything else I can help with?', cancelled: 'No problem, I’ve cleared that. What else can I help with?', long: 'Thanks for the detail. I’ll include all of it for the team.',
      also: 'Also interested in', details: 'Details', name: 'Name', phone: 'Phone', service: 'Request', sentFrom: 'Sent from',
      hello2: 'Hello Mada Trips,', helpWith: 'I’d like help with:',
      qNoted: 'Good question. I’ve added it to your request so the team answers it personally.', qNotedOpen: 'Good question, and one the team should answer personally. Want me to send it to them?',
      sendQ: 'Send my question', questions: 'Questions', notSure: k => `I didn’t catch the ${k.toLowerCase()}.`
    },
    ar: {
      title: 'كونسيرج مادا', sub: 'رد فوري · الفريق على واتساب', placeholder: 'اسأل أي سؤال أو صف خطتك', langBtn: 'EN',
      hello: '<b>مرحباً بك.</b><br>أنا مساعد مادا. اسألني أي شيء أو أخبرني بما تخطط له، مثلاً: <i>"حفل عشاء لـ 300 شخص في الرياض في مارس"</i>.',
      menu: 'كيف نقدر نساعدك؟', noted: 'تم تسجيل:', askName: 'ممتاز. ما الاسم الذي يستخدمه الفريق؟', askPhone: 'وما أفضل رقم للتواصل معك؟ <span class="mc-muted">(اختياري)</span>',
      badPhone: 'هذا لا يبدو رقم جوال. جرّب مثلاً 05X XXX XXXX أو تخطَّ.', nameAgain: 'يكفي اسمك فقط.',
      back: 'نعود إلى طلبك.', switchQ: n => `هل تريد الانتقال إلى <b>${n}</b> أم نكمل طلبك الحالي؟`, switchYes: n => `انتقل إلى ${n}`, carryOn: 'نكمل',
      wrap: n => `تم${n ? ' يا ' + n : ''}. هذا ملخص طلبك:`, wrapTail: 'أرسله عبر واتساب وسيتابعه الفريق فوراً.',
      wa: 'إرسال عبر واتساب', call: 'اتصال ' + PHONE_DISPLAY, form: 'النموذج الكامل', edit: 'تعديل', restart: 'البدء من جديد', skip: 'تخطي', menuChip: 'القائمة', human: 'تحدث مع الفريق',
      whichEdit: 'ماذا تريد أن تعدّل؟', humanMsg: 'بكل سرور. اضغط أدناه للتواصل مع شخص من الفريق عبر واتساب، أو اتصل بنا.',
      huh: 'عذراً، لم أفهم تماماً. هل يمكنك صياغتها بطريقة أخرى؟', huh2: 'يبدو أنني لم أفهم طلبك. دعني أحوّلك إلى الفريق.',
      repeat: 'يبدو أنني لم أساعدك في هذا. الفريق سيتولى الأمر.',
      fallback: 'أستطيع المساعدة في السفر والفعاليات والكفاءات والتأشيرات والفنادق والتقنية. أيها الأقرب؟', sendNote: 'أرسل رسالتي للفريق',
      otherAsk: 'بكل سرور. أخبرني في جملة ماذا تحتاج.', gotIt: 'تمام، سأرسلها للفريق مباشرة.',
      anything: 'هل هناك شيء آخر أساعدك فيه؟', cancelled: 'لا مشكلة، تم الإلغاء. بماذا أساعدك؟', long: 'شكراً على التفاصيل، سأرسلها كاملة للفريق.',
      also: 'مهتم أيضاً بـ', details: 'تفاصيل', name: 'الاسم', phone: 'الجوال', service: 'الطلب', sentFrom: 'أُرسل من',
      hello2: 'مرحباً مادا تربس،', helpWith: 'أحتاج مساعدة في:',
      qNoted: 'سؤال مهم. أضفته إلى طلبك ليجيبك الفريق شخصياً.', qNotedOpen: 'سؤال مهم، والأفضل أن يجيبك عليه الفريق شخصياً. هل أرسله لهم؟',
      sendQ: 'أرسل سؤالي', questions: 'أسئلة', notSure: k => `لم أفهم ${k}.`
    }
  };
  const VAL_AR = { Riyadh: 'الرياض', Jeddah: 'جدة', 'Jeddah & the Red Sea': 'جدة والبحر الأحمر', AlUla: 'العلا', 'Makkah or Madinah': 'مكة أو المدينة', 'Eastern Province': 'المنطقة الشرقية', NEOM: 'نيوم', Abha: 'أبها', Taif: 'الطائف', Abroad: 'خارج المملكة', Umrah: 'عمرة', Flights: 'طيران',
    'As soon as possible': 'في أقرب وقت', Today: 'اليوم', Tomorrow: 'غداً', 'This weekend': 'نهاية هذا الأسبوع', 'This week': 'هذا الأسبوع', 'Next week': 'الأسبوع القادم', 'This month': 'هذا الشهر', 'Next month': 'الشهر القادم', 'Next year': 'السنة القادمة', Ramadan: 'رمضان', Eid: 'العيد', Summer: 'الصيف', Winter: 'الشتاء', Flexible: 'مرن',
    Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت',
    January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', May: 'مايو', June: 'يونيو', July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر' };
  // show a stored value in the visitor's language
  const showVal = (key, v) => {
    if (S.lang !== 'ar' || hasArabic(v)) return v;
    for (const f of Object.values(KB.flows)) for (const st of f.steps) if (st.key === key) { const o = st.opts.find(o => o[0] === v); if (o) return o[1]; }
    if (VAL_AR[v]) return VAL_AR[v];
    let m;
    if ((m = v.match(/^(\d{1,2}) ([A-Z][a-z]+)$/)) && VAL_AR[m[2]]) return `${m[1]} ${VAL_AR[m[2]]}`;
    if ((m = v.match(/^In (\d+) (days|weeks|months)$/))) return `بعد ${m[1]} ${{ days: 'أيام', weeks: 'أسابيع', months: 'أشهر' }[m[2]]}`;
    return v;
  };
  const KEY_AR = { Destination: 'الوجهة', Travellers: 'عدد المسافرين', When: 'الموعد', 'Event type': 'نوع الفعالية', Guests: 'عدد الضيوف', City: 'المدينة', Need: 'الاحتياج', 'Team size': 'حجم الفريق', Start: 'البدء', 'Visa type': 'نوع التأشيرة', Applicants: 'عدد المتقدمين', Rooms: 'عدد الغرف', Service: 'الخدمة' };

  /* ================================================================
     STATE (persists across pages for this visit)
     ================================================================ */
  let S = { questions: [], lang: /^ar/i.test(navigator.language || '') ? 'ar' : 'en', flow: null, step: 0, answers: {}, name: '', phone: '', note: '', also: '', awaiting: null, editing: false, misses: 0, last: '', lastCount: 0, phoneTries: 0, nameTries: 0, started: false, log: [], chips: [], open: false };
  try { const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (saved && saved.log) S = Object.assign(S, saved); } catch (_) {}
  // the chat speaks the language of the page it's on
  const PAGE_AR = document.documentElement.lang === 'ar';
  S.lang = PAGE_AR ? 'ar' : (S.log.length ? S.lang : 'en');
  const localUrl = u => (PAGE_AR && u.startsWith('/') && !u.startsWith('/ar') ? (u === '/' ? '/ar' : '/ar' + u) : u);
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(S)); } catch (_) {} };
  const t = () => T[S.lang];
  const L = obj => obj[S.lang] || obj.en;
  const flowName = id => L(KB.flows[id]);
  const keyName = k => (S.lang === 'ar' ? KEY_AR[k] || k : k);

  /* ================================================================
     UI
     ================================================================ */
  const RAYS = '<path d="M63.33,61.18h-2.23c-.71,0-1.39.32-1.84.88l-21.48,26.55h18.76l6.79-27.43Z"/><path d="M47.95,59.75c0,.14,0,.28,0,.42L0,69.45l4.77-11.37,43.22.48c-.03.39-.04.79-.04,1.19Z"/><path d="M18.07,35.39l32.47,15.02c-.64,1.07-1.17,2.21-1.59,3.4l-37.72-6.41,6.84-12.01Z"/><path d="M58.2,43.37c-1.53.74-2.95,1.7-4.2,2.83l-25.36-23.54,10.22-8.47,19.34,29.19Z"/><path d="M73.28,0l-4.89,41.68c-.73-.09-1.48-.14-2.23-.14s-1.5.05-2.23.14L59.03,0h14.25Z"/><path d="M74.11,43.37c1.53.74,2.95,1.7,4.2,2.83l25.36-23.54-10.22-8.47-19.34,29.19Z"/><path d="M114.25,35.39l-32.47,15.02c.64,1.07,1.17,2.21,1.59,3.4l37.72-6.41-6.84-12.01Z"/><path d="M84.36,59.75c0,.14,0,.28,0,.42l47.96,9.28-4.77-11.37-43.22.48c.03.39.04.79.04,1.19Z"/><path d="M68.98,61.18h2.23c.71,0,1.39.32,1.84.88l21.48,26.55h-18.76s-6.79-27.43-6.79-27.43Z"/>';
  const sun = cls => `<svg class="${cls}" viewBox="0 0 132.31 88.61" aria-hidden="true">${RAYS}</svg>`;
  const root = document.createElement('div');
  root.className = 'mc';
  root.innerHTML = `
    <button class="mc-launch" type="button" aria-expanded="false" aria-controls="mc-panel">
      ${sun('mc-launch__sun')}<span class="mc-launch__label">Ask Mada</span><span class="mc-launch__close" aria-hidden="true">×</span>
      <span class="mc-launch__badge" aria-hidden="true">1</span>
    </button>
    <section class="mc-panel" id="mc-panel" role="dialog" aria-modal="false" aria-hidden="true">
      <header class="mc-head">
        <div class="mc-head__ava">${sun('')}</div>
        <div class="mc-head__t"><b class="js-t-title"></b><span><i></i><em class="js-t-sub"></em></span></div>
        <button class="mc-head__btn js-lang" type="button" aria-label="Switch language"></button>
        <button class="mc-head__btn js-restart" type="button" aria-label="Start over" title="Start over">↺</button>
        <button class="mc-head__btn mc-head__x" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="mc-body" aria-live="polite" aria-relevant="additions"></div>
      <div class="mc-chips"></div>
      <form class="mc-input" autocomplete="off">
        <input type="text" maxlength="800" aria-label="Message" />
        <button type="submit" aria-label="Send">→</button>
      </form>
    </section>`;
  document.body.appendChild(root);
  const q = s => root.querySelector(s);
  const launch = q('.mc-launch'), panel = q('.mc-panel'), body = q('.mc-body'), chipsEl = q('.mc-chips'), form = q('.mc-input'), input = form.querySelector('input');

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => s.replace(/\[([^\]]+)\]\(((?:\/|tel:|https:\/\/)[^)\s]*)\)/g, (_, txt, url) => `<a href="${localUrl(url)}"${url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`);
  const paintUI = () => {
    q('.mc-launch__label').textContent = S.lang === 'ar' ? 'اسأل مادا' : 'Ask Mada';
    launch.setAttribute('aria-label', S.lang === 'ar' ? 'افتح المحادثة مع مادا' : 'Open chat with Mada');
    q('.js-t-title').textContent = t().title; q('.js-t-sub').textContent = t().sub;
    q('.js-lang').textContent = t().langBtn; input.placeholder = t().placeholder;
    panel.setAttribute('dir', S.lang === 'ar' ? 'rtl' : 'ltr');
    panel.setAttribute('aria-label', t().title);
  };
  const scrollDown = () => requestAnimationFrame(() => (body.scrollTop = body.scrollHeight));
  const renderMsg = (m, animate) => {
    const el = document.createElement('div');
    el.className = 'mc-msg mc-msg--' + m.who + (animate ? '' : ' is-static');
    if (m.lang === 'ar') el.dir = 'rtl';
    el.innerHTML = m.html;
    body.appendChild(el); scrollDown();
    return el;
  };
  const renderChips = () => {
    chipsEl.innerHTML = '';
    S.chips.forEach(c => {
      const el = document.createElement(c.href ? 'a' : 'button');
      el.className = 'mc-chip' + (c.cls ? ' ' + c.cls : '');
      el.textContent = c.label;
      if (c.href) { el.href = c.href; if (/^https?:/.test(c.href)) { el.target = '_blank'; el.rel = 'noopener'; } }
      else { el.type = 'button'; el.addEventListener('click', () => act(c.act, c.label)); }
      chipsEl.appendChild(el);
    });
  };
  const setChips = list => { S.chips = list; renderChips(); save(); };

  let queue = Promise.resolve();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const say = (html, { fast } = {}) => (queue = queue.then(async () => {
    const tmp = renderMsg({ who: 'bot', html: '<span class="mc-typing"><i></i><i></i><i></i></span>' }, true);
    await wait(fast ? 280 : Math.min(1100, 380 + html.replace(/<[^>]+>/g, '').length * 9));
    tmp.innerHTML = md(html); tmp.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    S.log.push({ who: 'bot', html: md(html), lang: S.lang }); if (S.log.length > 80) S.log.splice(0, S.log.length - 80);
    save(); scrollDown();
  }));
  const me = text => { const m = { who: 'me', html: esc(text), lang: isArabicText(text) ? 'ar' : 'en' }; S.log.push(m); renderMsg(m, true); save(); };
  const chipsAfter = list => (queue = queue.then(() => setChips(list)));

  /* ================================================================
     CONVERSATION
     ================================================================ */
  const menuChips = () => Object.keys(KB.flows).map(id => ({ label: flowName(id), act: 'flow:' + id }));
  const handoffChips = () => [
    { label: t().wa, href: waLink(), cls: 'mc-chip--wa' },
    { label: t().call, href: 'tel:+' + PHONE },
    { label: t().form, href: localUrl('/contact') + (S.flow && S.flow !== 'Other' ? '?topic=' + encodeURIComponent(S.flow) : '') },
    { label: t().menuChip, act: 'menu' }
  ];
  const expandChips = (list = []) => list.flatMap(c => c === 'menu' ? menuChips() : c === 'human' ? [{ label: t().human, act: 'human' }] : KB.flows[c] ? [{ label: flowName(c), act: 'flow:' + c }] : []);

  const waLink = () => {
    const x = t(), lines = [x.hello2, ''];
    if (S.flow) lines.push(`${x.helpWith} ${flowName(S.flow)}`);
    Object.entries(S.answers).forEach(([k, v]) => lines.push(`${keyName(k)}: ${showVal(k, v)}`));
    if (S.also) lines.push(`${x.also}: ${S.also}`);
    if (S.note) lines.push(`${x.details}: ${S.note}`);
    if (S.questions && S.questions.length) lines.push(`${x.questions}: ${S.questions.join(' | ')}`);
    if (S.name || S.phone) lines.push('');
    if (S.name) lines.push(`${x.name}: ${S.name}`);
    if (S.phone) lines.push(`${x.phone}: ${S.phone}`);
    lines.push(`${x.sentFrom} ${location.hostname}${location.pathname}`);
    return `https://wa.me/${PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
  };

  function greet() {
    S.started = true;
    say(t().hello, { fast: true });
    say(t().menu, { fast: true });
    chipsAfter(menuChips());
  }

  function resetRequest() { Object.assign(S, { questions: [], flow: null, step: 0, answers: {}, note: '', also: '', awaiting: null, editing: false, phoneTries: 0, nameTries: 0 }); }

  function startFlow(id, P, preset) {
    resetRequest();
    S.flow = id;
    const f = KB.flows[id];
    if (preset) Object.assign(S.answers, preset);
    // pull out anything the visitor already told us
    const got = [];
    if (P) f.steps.forEach(st => { if (S.answers[st.key]) return; const v = extractFor(st, P, false); if (v) { S.answers[st.key] = v; got.push(`${keyName(st.key)}: <b>${esc(showVal(st.key, v))}</b>`); } });
    if (got.length) say(`${t().noted} ${got.join(' · ')}`, { fast: true });
    if (id === 'Other') { S.awaiting = 'note'; say(t().otherAsk); chipsAfter([{ label: t().menuChip, act: 'menu' }]); return; }
    nextStep();
  }

  function nextStep() {
    const f = KB.flows[S.flow];
    while (S.step < f.steps.length && S.answers[f.steps[S.step].key]) S.step++;
    const st = f.steps[S.step];
    if (!st) { S.editing = false; return S.name ? wrapUp() : askName(); }
    S.awaiting = 'opt';
    say(L(st));
    const opts = st.opts.map(([en, ar]) => ({ label: S.lang === 'ar' ? ar : en, act: 'opt:' + (S.lang === 'ar' ? ar : en) }));
    if (S.step > 0) opts.push({ label: S.lang === 'ar' ? '← رجوع' : '← Back', act: 'back', cls: 'mc-chip--ghost' });
    chipsAfter(opts);
  }

  function answerStep(value) {
    S.stepMiss = 0;
    const st = KB.flows[S.flow].steps[S.step];
    S.answers[st.key] = value;
    S.step++;
    if (S.editing) { S.editing = false; S.awaiting = null; return wrapUp(); }
    nextStep();
  }

  function askName() {
    S.awaiting = 'name';
    say(t().askName);
    chipsAfter([{ label: t().skip, act: 'skip' }]);
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }
  function askPhone() {
    S.awaiting = 'phone';
    say(t().askPhone);
    chipsAfter([{ label: t().skip, act: 'skip' }]);
  }

  function wrapUp() {
    S.awaiting = null;
    const rows = Object.entries(S.answers).map(([k, v]) => `<div><span>${esc(keyName(k))}</span><b>${esc(showVal(k, v))}</b></div>`).join('')
      + (S.also ? `<div><span>${esc(t().also)}</span><b>${esc(S.also)}</b></div>` : '')
      + (S.note ? `<div><span>${esc(t().details)}</span><b>${esc(S.note.length > 140 ? S.note.slice(0, 140) + '…' : S.note)}</b></div>` : '')
      + (S.questions && S.questions.length ? `<div><span>${esc(t().questions)}</span><b>${esc(S.questions.join(' · ').slice(0, 140))}</b></div>` : '')
      + (S.phone ? `<div><span>${esc(t().phone)}</span><b>${esc(S.phone)}</b></div>` : '');
    say(`${t().wrap(esc((S.name || '').split(' ')[0]))}<div class="mc-sum">${rows || `<div><span>${esc(t().service)}</span><b>${esc(flowName(S.flow || 'Other'))}</b></div>`}</div>${t().wrapTail}`);
    const editable = S.flow && KB.flows[S.flow].steps.length;
    chipsAfter([
      { label: t().wa, href: waLink(), cls: 'mc-chip--wa' },
      { label: t().call, href: 'tel:+' + PHONE },
      ...(editable ? [{ label: t().edit, act: 'edit' }] : []),
      { label: t().form, href: localUrl('/contact') + (S.flow && S.flow !== 'Other' ? '?topic=' + encodeURIComponent(S.flow) : '') },
      { label: t().restart, act: 'restart', cls: 'mc-chip--ghost' }
    ]);
  }

  function handoff(msg) {
    S.awaiting = null;
    say(msg || t().humanMsg);
    chipsAfter(handoffChips());
  }

  /* ---------------- chip actions ---------------- */
  function act(a, label) {
    if (a.startsWith('flow:')) { me(label); return startFlow(a.slice(5)); }
    if (a.startsWith('opt:')) { me(label); return answerStep(a.slice(4)); }
    if (a.startsWith('editkey:')) {
      me(label);
      const f = KB.flows[S.flow]; const i = f.steps.findIndex(s => s.key === a.slice(8));
      delete S.answers[a.slice(8)]; S.step = i; S.editing = true; return nextStep();
    }
    if (a.startsWith('switch:')) { me(label); const id = a.slice(7); const P = S.pendingP; S.pendingP = null; return startFlow(id, P ? prep(P) : null); }
    switch (a) {
      case 'menu': me(label); resetRequest(); say(t().menu, { fast: true }); return chipsAfter(menuChips());
      case 'human': me(label); return handoff();
      case 'restart': me(label); return restart();
      case 'back': me(label); return goBack();
      case 'carry': me(label); say(t().back, { fast: true }); S.step = Math.max(0, S.step); return nextStep();
      case 'skip':
        me(label);
        if (S.awaiting === 'name') { S.name = ''; return askPhone(); }
        if (S.awaiting === 'phone') { S.phone = ''; return wrapUp(); }
        return nextStep();
      case 'edit': {
        me(label);
        const f = KB.flows[S.flow];
        say(t().whichEdit, { fast: true });
        return chipsAfter([
          ...f.steps.map(s => ({ label: keyName(s.key), act: 'editkey:' + s.key })),
          { label: t().name, act: 'editname' }, { label: t().phone, act: 'editphone' }
        ]);
      }
      case 'editname': me(label); S.name = ''; S.editing = true; S.awaiting = 'name'; say(t().askName); return chipsAfter([]);
      case 'editphone': me(label); S.phone = ''; S.editing = true; return askPhone();
      case 'sendnote': me(label); S.flow = S.flow || 'Other'; return S.name ? wrapUp() : askName();
      case 'skipstep': me(label); return answerStep(S.lang === 'ar' ? 'غير محدد' : 'Not sure yet');
      case 'sendq': me(label); S.flow = 'Other'; return S.name ? wrapUp() : askName();
    }
  }

  function goBack() {
    if (!S.flow) { say(t().menu, { fast: true }); return chipsAfter(menuChips()); }
    const f = KB.flows[S.flow];
    let i = Math.min(S.step, f.steps.length) - 1;
    if (S.awaiting === 'phone') { S.awaiting = 'name'; say(t().askName); return chipsAfter([{ label: t().skip, act: 'skip' }]); }
    if (i < 0) { resetRequest(); say(t().menu, { fast: true }); return chipsAfter(menuChips()); }
    delete S.answers[f.steps[i].key]; S.step = i; nextStep();
  }

  function restart() {
    resetRequest(); Object.assign(S, { name: '', phone: '', misses: 0, lastCount: 0 });
    say(t().menu, { fast: true }); chipsAfter(menuChips());
  }

  function setLang(l, silent) {
    if (S.lang === l) return;
    S.lang = l; paintUI(); save();
    if (!silent) {
      // re-ask whatever we were doing, in the new language
      if (S.awaiting === 'opt') { return nextStep(); }
      if (S.awaiting === 'name') return askName();
      if (S.awaiting === 'phone') return askPhone();
      say(t().menu, { fast: true }); chipsAfter(menuChips());
    }
  }

  /* ---------------- free text ---------------- */
  function onText(raw) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 800);
    if (!text) return;
    me(text);
    setChips([]);
    // explicit language switch
    const n0 = norm(text);
    if (CMD.ar.test(n0)) { S.last = ''; return S.lang === 'ar' ? (S.awaiting === 'opt' ? nextStep() : (say(t().menu, { fast: true }), chipsAfter(menuChips()))) : setLang('ar'); }
    if (CMD.en.test(n0)) { S.last = ''; return S.lang === 'en' ? (S.awaiting === 'opt' ? nextStep() : (say(t().menu, { fast: true }), chipsAfter(menuChips()))) : setLang('en'); }
    // follow the visitor's language
    if (isArabicText(text) && S.lang !== 'ar') setLang('ar', true);
    else if (!hasArabic(text) && /[a-z]{3,}/i.test(text) && S.lang !== 'en' && text.split(' ').length > 2) setLang('en', true);

    const P = prep(text);
    const n = P.n;

    // same message again and again
    if (n && n === S.last) { S.lastCount++; if (S.lastCount >= 2) { S.lastCount = 0; S.last = ''; return handoff(t().repeat); } } else { S.last = n; S.lastCount = 0; }

    // commands
    if (CMD.en.test(n)) return setLang('en');
    if (CMD.ar.test(n)) return setLang('ar');
    if (CMD.restart.test(n)) return restart();
    if (CMD.menu.test(n)) { resetRequest(); say(t().menu, { fast: true }); return chipsAfter(menuChips()); }
    if (CMD.cancel.test(n)) { resetRequest(); say(t().cancelled, { fast: true }); return chipsAfter(menuChips()); }
    if (CMD.back.test(n) && S.flow) return goBack();
    if (CMD.skip.test(n) && S.awaiting === 'name') { S.name = ''; return askPhone(); }
    if (CMD.skip.test(n) && S.awaiting === 'phone') { S.phone = ''; return wrapUp(); }

    const ranked = rankIntents(P);
    // greetings and thanks give way to any real topic in the same message
    const top = (ranked[0] && ranked[0].it.weak && ranked.find(r => !r.it.weak && r.s >= 2)) || ranked[0];

    /* ----- waiting for a name ----- */
    if (S.awaiting === 'name') {
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) { const ph = parsePhone(text); if (ph) { S.phone = ph; say(t().nameAgain, { fast: true }); return chipsAfter([{ label: t().skip, act: 'skip' }]); } }
      if ((isQuestion(text, n) && (/[?؟]/.test(text) || P.toks.length >= 4)) || (top && top.s >= 2.5 && !top.it.weak && P.toks.length >= 3)) {
        if (top && top.s >= 2 && !top.it.flow) answerIntent(top.it, P, true); else { S.questions.push(text.slice(0, 200)); say(t().qNoted); }
        return queue.then(() => { S.awaiting = 'name'; say(t().askName, { fast: true }); chipsAfter([{ label: t().skip, act: 'skip' }]); });
      }
      let nm = text.replace(/^(hi|hello|hey)[, ]+/i, '').replace(/^(my name is|my name's|i am|i'm|im|this is|it's|its|name is|name:?|call me)\s+/i, '').replace(/^(اسمي|انا|معك|أنا)\s+/, '').replace(/[.!,]+$/, '').trim();
      if (!nm || nm.split(' ').length > 5 || nm.length > 40 || isGibberish(nm)) {
        if (++S.nameTries < 2) { say(t().nameAgain, { fast: true }); return chipsAfter([{ label: t().skip, act: 'skip' }]); }
        nm = nm.split(' ').slice(0, 3).join(' ').slice(0, 40);
      }
      S.name = hasArabic(nm) ? nm : nm.replace(/\b\p{L}/gu, c => c.toUpperCase());
      if (S.editing) { S.editing = false; return wrapUp(); }
      return S.phone ? wrapUp() : askPhone();
    }

    /* ----- waiting for a phone ----- */
    if (S.awaiting === 'phone') {
      const ph = parsePhone(text);
      if (ph) { S.phone = ph; S.editing = false; return wrapUp(); }
      if (!/\d/.test(text) && (isQuestion(text, n) || (top && top.s >= 2.5))) {
        if (top && top.s >= 2 && !top.it.flow) answerIntent(top.it, P, true); else { S.questions.push(text.slice(0, 200)); say(t().qNoted); }
        return queue.then(askPhone);
      }
      if (++S.phoneTries >= 2) { S.phone = ''; return wrapUp(); }
      say(t().badPhone, { fast: true }); return chipsAfter([{ label: t().skip, act: 'skip' }]);
    }

    /* ----- waiting for "tell me what you need" ----- */
    if (S.awaiting === 'note') {
      S.note = text; S.awaiting = null;
      if (text.length > 300) say(t().long, { fast: true });
      return askName();
    }

    /* ----- inside a guided request ----- */
    if (S.awaiting === 'opt' && S.flow) {
      const f = KB.flows[S.flow], st = f.steps[S.step];
      // 1. typed one of the options
      const hit = st.opts.map(o => o[S.lang === 'ar' ? 1 : 0]).concat(st.opts.map(o => o[S.lang === 'ar' ? 0 : 1]))
        .find(o => { const on = norm(o); return on === n || (n.length >= 3 && (on.includes(n) || n.includes(on))); });
      if (hit) return answerStep(hit);
      // 2. said something we can pull this step (and later ones) out of
      const v = extractFor(st, P, true);
      if (v) {
        f.steps.forEach((s2, i) => { if (i > S.step && !S.answers[s2.key]) { const v2 = extractFor(s2, P, false); if (v2) S.answers[s2.key] = v2; } });
        return answerStep(v);
      }
      // skip or not sure
      if (/^(skip|skip it|skip this|pass|not sure|no idea|dont know|i dont know|unsure|n a|na|تخطي|ما ادري|مدري|لا اعرف|مو متاكد)$/.test(n)) return answerStep(S.lang === 'ar' ? 'غير محدد' : 'Not sure yet');
      // small talk or filler: don't record it as an answer
      if ((top && ['thanks', 'greeting', 'howareyou', 'bye'].includes(top.it.id)) || /^(ok|okay|k|yes|yeah|yep|sure|fine|alright|cool|hmm+|hm+|تمام|اوكي|ok+|طيب|نعم|اي|ايوه|ماشي)$/.test(n)) {
        say(S.lang === 'ar' ? 'اختر أحد الخيارات أو اكتب إجابتك.' : 'Pick an option below, or type your own answer.', { fast: true });
        return nextStep();
      }
      // 3. asked a question mid-request
      if (top && top.s >= 2 && !top.it.flow) {
        if (top.it.action === 'human') return handoff();
        answerIntent(top.it, P, true);
        say(t().back, { fast: true });
        return queue.then(nextStep);
      }
      // 4. wants a different service
      if (top && top.it.flow && top.it.flow !== S.flow && top.s >= 2) {
        S.pendingP = text;
        say(t().switchQ(esc(flowName(top.it.flow))));
        return chipsAfter([{ label: t().switchYes(flowName(top.it.flow)), act: 'switch:' + top.it.flow }, { label: t().carryOn, act: 'carry' }]);
      }
      // 5. a question we don't have an answer for: note it for the team, then carry on
      if (isQuestion(text, n)) {
        S.questions.push(text.slice(0, 200));
        say(t().qNoted);
        say(t().back, { fast: true });
        return queue.then(nextStep);
      }
      // 6. a sensible free-form answer
      if (plausible(st, text, P) && text.length <= 80) return answerStep(text);
      // 7. long message: keep it as details and move on
      if (text.length > 80) { S.note = (S.note ? S.note + ' ' : '') + text; return answerStep(S.lang === 'ar' ? 'انظر التفاصيل' : 'See details'); }
      // 8. doesn't fit this question: ask again with an example
      S.stepMiss = (S.stepMiss || 0) + 1;
      say(HINT[S.lang][st.entity] || HINT[S.lang].other, { fast: true });
      nextStep();
      if (S.stepMiss >= 2) queue = queue.then(() => setChips(S.chips.concat({ label: S.lang === 'ar' ? 'تخطَّ هذا السؤال' : 'Skip this question', act: 'skipstep', cls: 'mc-chip--ghost' })));
      return;
    }

    /* ----- open conversation ----- */
    if (isGibberish(text)) return miss();

    // a long message that only opens with a greeting is a request, not small talk
    if (top && top.it.weak && !top.it.flow && text.length > 40 && !ranked.some(r => !r.it.weak && r.s >= 2)) { resetRequest(); S.flow = 'Other'; S.note = text; say(t().gotIt, { fast: true }); return askName(); }

    if (top) {
      S.misses = 0;
      // a second service in the same message
      const second = ranked.find(r => r !== top && r.it.flow && r.it.flow !== top.it.flow && r.s >= 2);
      if (top.it.action === 'human') { if (top.it.en && top.it.id === 'abuse') { return handoff(L(top.it)); } return handoff(); }
      if (top.it.flow) {
        say(L(top.it), { fast: true });
        startFlow(top.it.flow, P, top.it.preset);
        if (second && !(top.it.id === 'visa' && second.it.id === 'umrah')) S.also = flowName(second.it.flow);
        return;
      }
      if (top.it.then) { answerIntent(top.it, P, true); return startFlow(top.it.then, P); }
      answerIntent(top.it, P, !!second || !!ranked.find(r => r.it.flow && r.s >= 2));
      // an info question that also names a service, e.g. "how much is a hotel in Riyadh"
      const svc = ranked.find(r => r.it.flow && r.s >= 2);
      if (svc) startFlow(svc.it.flow, P, svc.it.preset);
      return;
    }

    // no topic, but details suggest one
    const guess = [['eventType', 'Events'], ['visaType', 'Visa'], ['staffType', 'Manpower'], ['itType', 'IT']].find(([e]) => findEntity(e, P));
    if (guess) return startFlow(guess[1], P);
    if (numberNear(P, ROOM_WORDS, false)) return startFlow('Hotels', P);
    const city = findEntity('city', P), date = findDate(P), ppl = numberNear(P, PEOPLE_WORDS, false);
    if (city || date || ppl) {
      S.pendingP = text;
      say(t().fallback);
      return chipsAfter(Object.keys(KB.flows).filter(id => id !== 'Other').map(id => ({ label: flowName(id), act: 'switch:' + id })));
    }

    // a question we can't answer: offer to send it to the team
    if (isQuestion(text, n)) {
      S.questions = [text.slice(0, 200)];
      say(t().qNotedOpen);
      return chipsAfter([{ label: t().sendQ, act: 'sendq', cls: 'mc-chip--wa-soft' }, ...menuChips()]);
    }

    // long message with no match: treat it as a request
    if (text.length > 60) { resetRequest(); S.flow = 'Other'; S.note = text; say(t().gotIt, { fast: true }); return askName(); }
    return miss(text);
  }

  function answerIntent(it, P, quiet) {
    if (it.action === 'human') return handoff(it.en ? L(it) : null);
    say(L(it));
    if (!quiet) chipsAfter(expandChips(it.chips || ['menu']));
  }

  function miss(text) {
    S.misses++;
    if (S.misses >= 2) { S.misses = 0; if (text) { S.flow = 'Other'; S.note = text; } return handoff(t().huh2); }
    say(text && text.length > 25 ? t().fallback : t().huh, { fast: true });
    const chips = menuChips();
    if (text && text.length > 25) { S.note = text; chips.push({ label: t().sendNote, act: 'sendnote', cls: 'mc-chip--ghost' }); }
    chipsAfter(chips);
  }

  function parsePhone(raw) {
    const d = raw.replace(/[^\d+]/g, '').replace(/^00/, '+');
    let m;
    if ((m = d.match(/^(?:\+?966|0)?(5\d{8})$/))) return '+966 ' + m[1].replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3');
    if ((m = d.match(/^\+?(\d{8,15})$/)) && !/^0/.test(m[1])) return '+' + m[1];
    if ((m = d.match(/^0(1\d{7,8})$/))) return '+966 ' + m[1];
    return null;
  }

  /* ================================================================
     OPEN / CLOSE / RESTORE
     ================================================================ */
  const setOpen = open => {
    S.open = open; save();
    root.classList.toggle('is-open', open);
    root.classList.remove('has-badge');
    launch.setAttribute('aria-expanded', open);
    panel.setAttribute('aria-hidden', !open);
    if (open) {
      if (!S.started) greet();
      scrollDown();
      if (matchMedia('(hover: hover)').matches) setTimeout(() => input.focus({ preventScroll: true }), 300);
    }
  };
  launch.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
  q('.mc-head__x').addEventListener('click', () => { setOpen(false); launch.focus(); });
  q('.js-lang').addEventListener('click', () => setLang(S.lang === 'ar' ? 'en' : 'ar'));
  q('.js-restart').addEventListener('click', () => { body.innerHTML = ''; S.log = []; resetRequest(); Object.assign(S, { name: '', phone: '', misses: 0 }); greet(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('is-open')) { setOpen(false); launch.focus(); } });
  form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; onText(v); });
  document.addEventListener('click', e => { const tr = e.target.closest('[data-chat]'); if (tr) { e.preventDefault(); setOpen(true); } });

  paintUI();
  if (S.log.length) { S.log.forEach(m => renderMsg(m, false)); renderChips(); }
  if (S.open && matchMedia('(min-width: 821px)').matches) setOpen(true);

  // a gentle nudge once per visit
  let nudged = false;
  try { nudged = sessionStorage.getItem('mc-nudged') === '1'; } catch (_) {}
  if (!nudged && !S.started) setTimeout(() => {
    if (root.classList.contains('is-open') || document.body.classList.contains('is-loading')) return;
    root.classList.add('is-nudge', 'has-badge');
    try { sessionStorage.setItem('mc-nudged', '1'); } catch (_) {}
    setTimeout(() => root.classList.remove('is-nudge'), 2000);
  }, 15000);

  // exposed for testing in the console: MadaConcierge.say('a gala for 300 in Riyadh')
  window.MadaConcierge = { open: () => setOpen(true), say: txt => { setOpen(true); onText(txt); }, state: () => S };
})();
