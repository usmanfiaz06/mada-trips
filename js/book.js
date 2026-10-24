/* =========================================================
   MADA BOOK: the booking home
   One search with four plain fields. The "To" field also takes a whole sentence ("Dubai this weekend, 2 of us")
   and fills the other fields as you type. The picture below becomes the place you're going, and the price
   shown is always the total for everyone, everything included.
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

  // ---------- words ----------
  const T = {
    en: {
      trips: "Trips", help: "Help", lang: "العربية",
      title: "Where to?",
      subNew: (h) => `${h}. Type a place, or say the whole trip: <b>“Dubai this weekend, 2 of us.”</b>`,
      subBack: (h, c) => `${h}. Your ${c} trip is waiting below.`,
      morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening",
      from: "From", to: "To", when: "When", who: "Travelers", search: "Search",
      examples: ["Dubai this weekend, 2 of us", "Istanbul on 12 Dec for a week", "Cairo next Thursday, family of 4", "London, me and my wife, direct"],
      addDates: "Add dates", oneWay: "One way", returnL: "Return",
      adult: ["adult", "adults"], child: ["child", "children"], infant: ["baby", "babies"],
      adultsK: "Adults", adultsS: "12 and over", childrenK: "Children", childrenS: "2 to 11", babiesK: "Babies", babiesS: "Under 2, on a lap",
      direct: (h) => `${h} direct`, via: (h, c) => `${h}, 1 stop in ${c}`,
      about: "about", allIn: (p, rt) => `for ${p}, ${rt ? "return" : "one way"}, all in`,
      needDate: "Add a date to see the price", pickDate: "Pick dates",
      good: "Good price", save: (amt, day) => `${day} is ${amt} less`,
      makkah: "Makkah has no airport, so you'll land in Jeddah, about an hour away by road.",
      thereNow: (t) => `It's ${t} there`,
      railWeekend: (c, p) => `Weekend escapes. <span class="dim">From ${c}, for ${p}, all in.</span>`,
      railDate: (c, d, p) => `Leaving ${d}. <span class="dim">From ${c}, for ${p}, all in.</span>`,
      railBudget: (amt) => `Under ${amt}. <span class="dim">Everywhere that fits, all in.</span>`,
      noneFit: "Nothing fits that budget on these dates. Try other dates or a little more.",
      totalFor: (p, rt) => `${p} · ${rt ? "return" : "one way"}`,
      cont: "Continue planning", contGo: "Pick up →", depart: "Depart", retK: "Return", trav: "Travelers",
      whyH: "Booking, without the tricks.", whyH2: "Four things we promise on every trip.",
      w1h: "The first price is the final price.", w1: "Taxes, bags and fees are already in. Nothing gets added at the end.",
      w2h: "No countdowns. No pressure.", w2: "We'll never tell you there are only two seats left to rush you.",
      w3h: "A real person owns your trip.", w3: "One Mada advisor on WhatsApp before, during and after you fly.",
      w4h: "Hold it, then decide.", w4: "Keep the fare for 24 hours while you check with family.",
      advisor: "Your Mada advisor", advisorMsg: "Your gate moved to B18. You don't need to do anything, I've updated your trip.",
      only2: "Only 2 seats left!", hours: "hours",
      rFare: "Fare", rTax: "Taxes and airport fees", rBags: "Checked bags", rBagsV: "Included", rFee: "Booking fee", rTotal: "Total",
      calTitle: "When are you going?", calNote: (p) => `Prices are the total for ${p}, one way.`, calNoTo: "Pick a destination to see prices.",
      done: "Done", fromTitle: "Flying from", whoTitle: "Who's going?",
      soon: "Results are the next screen we're building.", needTo: "Where would you like to go?",
      footer: "© Mada Trips, Riyadh. Prices shown in this preview are estimates.", photos: "Photo credits",
    },
    ar: {
      trips: "رحلاتي", help: "مساعدة", lang: "English",
      title: "إلى أين؟",
      subNew: (h) => `${h}. اكتب المدينة، أو قل الرحلة كاملة: <b>«دبي الويكند شخصين»</b>.`,
      subBack: (h, c) => `${h}. رحلتك إلى ${c} بانتظارك بالأسفل.`,
      morning: "صباح الخير", afternoon: "مساء الخير", evening: "مساء الخير",
      from: "من", to: "إلى", when: "متى", who: "المسافرون", search: "ابحث",
      examples: ["دبي الويكند شخصين", "إسطنبول ١٢ ديسمبر لمدة أسبوع", "القاهرة الخميس الجاي عائلة من ٤", "لندن أنا وزوجتي مباشر"],
      addDates: "أضف التاريخ", oneWay: "ذهاب فقط", returnL: "ذهاب وعودة",
      adult: ["بالغ", "بالغين"], child: ["طفل", "أطفال"], infant: ["رضيع", "رضّع"],
      adultsK: "البالغون", adultsS: "١٢ سنة فأكثر", childrenK: "الأطفال", childrenS: "من ٢ إلى ١١", babiesK: "الرضّع", babiesS: "أقل من سنتين، في الحضن",
      direct: (h) => `${h} مباشر`, via: (h, c) => `${h}، توقف في ${c}`,
      about: "حوالي", allIn: (p, rt) => `لـ ${p}، ${rt ? "ذهاب وعودة" : "ذهاب فقط"}، شامل كل شيء`,
      needDate: "أضف التاريخ لترى السعر", pickDate: "اختر التاريخ",
      good: "سعر جيد", save: (amt, day) => `يوم ${day} أقل بـ ${amt}`,
      makkah: "مكة ما فيها مطار، فبتنزل في جدة، على بعد ساعة تقريبًا بالسيارة.",
      thereNow: (t) => `الساعة ${t} هناك الآن`,
      railWeekend: (c, p) => `عطلات نهاية الأسبوع. <span class="dim">من ${c}، لـ ${p}، شامل كل شيء.</span>`,
      railDate: (c, d, p) => `السفر ${d}. <span class="dim">من ${c}، لـ ${p}، شامل كل شيء.</span>`,
      railBudget: (amt) => `أقل من ${amt}. <span class="dim">كل وجهة تناسب ميزانيتك، شاملة كل شيء.</span>`,
      noneFit: "لا شيء ضمن هذه الميزانية في هذه التواريخ. جرّب تواريخ أخرى أو زِد قليلًا.",
      totalFor: (p, rt) => `${p} · ${rt ? "ذهاب وعودة" : "ذهاب فقط"}`,
      cont: "كمّل التخطيط", contGo: "كمّل ←", depart: "الذهاب", retK: "العودة", trav: "المسافرون",
      whyH: "حجز بدون حيل.", whyH2: "أربعة وعود في كل رحلة.",
      w1h: "أول سعر هو السعر النهائي.", w1: "الضرائب والشنط والرسوم داخلة. لا شيء يُضاف في النهاية.",
      w2h: "بدون عدّاد. بدون ضغط.", w2: "ما راح نقول لك «باقي مقعدين» عشان نستعجلك.",
      w3h: "شخص حقيقي مسؤول عن رحلتك.", w3: "مستشار واحد من مادا على واتساب قبل السفر وأثناءه وبعده.",
      w4h: "احجز السعر، وقرّر بعدين.", w4: "نثبّت لك السعر ٢٤ ساعة لين تشاور عائلتك.",
      advisor: "مستشارك في مادا", advisorMsg: "بوابتك تغيّرت إلى B18. ما تحتاج تسوي شيء، حدّثت رحلتك.",
      only2: "باقي مقعدين فقط!", hours: "ساعة",
      rFare: "سعر التذكرة", rTax: "الضرائب ورسوم المطار", rBags: "الشنط", rBagsV: "مشمولة", rFee: "رسوم الحجز", rTotal: "الإجمالي",
      calTitle: "متى مسافر؟", calNote: (p) => `الأسعار إجمالي لـ ${p}، ذهاب فقط.`, calNoTo: "اختر وجهة لترى الأسعار.",
      done: "تم", fromTitle: "السفر من", whoTitle: "مين مسافر؟",
      soon: "شاشة النتائج هي الخطوة اللي نبنيها الآن.", needTo: "وين حاب تسافر؟",
      footer: "© مادا للسفر، الرياض. الأسعار في هذه النسخة تقديرية.", photos: "حقوق الصور",
    },
  };
  let lang = store.get("lang") || "en";
  const t = (k) => T[lang][k];
  const nf = new Intl.NumberFormat("en-US");
  const money = (n) => (lang === "ar" ? `${nf.format(n)} ر.س` : `SAR ${nf.format(n)}`);
  const loc = () => (lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");
  const fmt = (iso, o) => new Intl.DateTimeFormat(loc(), o).format(new Date(iso + "T12:00:00"));
  const day = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
  // "Thu 29 Oct – Sat 31 Oct"; Arabic weekday names are long, so there a range reads "29 – 31 أكتوبر".
  const range = (a, b) => {
    if (lang !== "ar") return `${day(a)} – ${day(b)}`;
    const o = { day: "numeric", month: "short" };
    return a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })} – ${fmt(b, o)}` : `${fmt(a, o)} – ${fmt(b, o)}`;
  };
  const city = (c) => { const a = D.byCode[c]; return a ? (lang === "ar" ? a.cityAr : a.city) : ""; };
  const plural = (n, k) => `${n} ${t(k)[n === 1 ? 0 : 1]}`;
  const paxText = (p) => [p.a && plural(p.a, "adult"), p.c && plural(p.c, "child"), p.i && plural(p.i, "infant")].filter(Boolean).join(", ");
  const hrs = (m) => (lang === "ar" ? `${Math.floor(m / 60)}س ${m % 60}د` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const todayIso = () => D.iso(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return D.iso(d); };

  // ---------- state ----------
  // Typed words fill the fields; anything picked by hand wins until the words about that field change.
  const state = { text: "", from: store.get("from") || "RUH", pick: null, dates: null, pax: null, sig: { dates: "", pax: "" } };

  function trip() {
    const p = P.parse(state.text);
    const sig = { dates: p.dates.join() + "|" + p.nights + "|" + p.oneWay, pax: JSON.stringify(p.pax) };
    if (sig.dates !== state.sig.dates) state.dates = null;
    if (sig.pax !== state.sig.pax) state.pax = null;
    state.sig = sig;
    const from = p.from || state.from;
    let to = p.to || state.pick;
    if (to === from) to = null;
    let dep = p.dates[0] || null, ret = p.oneWay ? null : p.dates[1] || null;
    if (dep && p.nights && !ret) ret = addDays(dep, p.nights);
    if (ret && ret <= dep) ret = null;
    if (state.dates) ({ dep, ret } = state.dates);
    const pax = state.pax || p.pax || store.get("pax") || { a: 1, c: 0, i: 0 };
    return { ...p, from, to, dep, ret, pax };
  }
  function price(tr, dep = tr.dep, ret = tr.ret, to = tr.to) {
    if (!to || !dep) return null;
    const o = D.quote(tr.from, to, dep, tr.pax); if (!o) return null;
    const r = ret ? D.quote(to, tr.from, ret, tr.pax) : null;
    return { total: o.total + (r ? r.total : 0), out: o, back: r };
  }
  const weekend = () => { const th = P.nextDow(new Date(), 4, false); return { dep: D.iso(th), ret: addDays(D.iso(th), 2) }; };

  // ---------- fields ----------
  function setVal(el, txt, muted) {
    if (el.textContent !== txt) { el.textContent = txt; el.classList.remove("is-new"); void el.offsetWidth; el.classList.add("is-new"); }
    el.classList.toggle("is-muted", !!muted);
  }
  function renderFields(tr) {
    setVal($("#vFrom"), city(tr.from));
    setVal($("#vWhen"), tr.dep ? (tr.ret ? range(tr.dep, tr.ret) : day(tr.dep)) : t("addDates"), !tr.dep);
    setVal($("#vWho"), paxText(tr.pax));
  }

  function renderAnswer(tr, pr) {
    const el = $("#answer");
    if (!tr.to) { el.classList.remove("is-on"); return; }
    const q = pr ? pr.out : D.quote(tr.from, tr.to, tr.dep || weekend().dep, tr.pax);
    const route = `<span class="answer__route"><b>${tr.from} → ${tr.to}</b><span>${esc(q ? (q.direct ? t("direct")(hrs(q.minutes)) : t("via")(hrs(q.minutes), city(q.via))) : "")}</span></span>`;
    let right;
    if (pr) {
      const ctx = D.priceContext(tr.from, tr.to, tr.dep, tr.pax);
      let tag = "";
      if (ctx && ctx.cheaper) tag = `<button type="button" class="answer__save" data-date="${ctx.cheaper.date}">${esc(t("save")(money(ctx.q.total - ctx.cheaper.total), fmt(ctx.cheaper.date, { weekday: "long", day: "numeric", month: "short" })))}</button>`;
      else if (ctx && ctx.rank <= 0.35) tag = `<span class="answer__tag">${esc(t("good"))}</span>`;
      right = `${tag}<span class="answer__price"><span>${esc(t("about"))}</span><strong>${esc(money(pr.total))}</strong><span>${esc(t("allIn")(paxText(tr.pax), !!tr.ret))}</span></span>`;
    } else right = `<span class="answer__price"><button type="button" class="answer__save" data-open="when">${esc(t("needDate"))}</button></span>`;
    const note = tr.makkah && tr.to === "JED" ? `<span>${esc(t("makkah"))}</span>` : "";
    el.innerHTML = `<div><div class="answer__in">${route}${note}${right}</div></div>`;
    el.classList.add("is-on");
  }

  // ---------- stage ----------
  let stageCode = null, layer = 0;
  function renderStage(tr) {
    const code = tr.to && D.DEST[tr.to] ? tr.to : null;
    const stage = $("#stage"), video = $(".stage__video");
    if (code !== stageCode) {
      stageCode = code;
      const imgs = [$("#layerA"), $("#layerB")];
      if (code) {
        const next = imgs[layer ^= 1], prev = imgs[layer ^ 1];
        next.onload = () => { next.classList.add("is-on"); prev.classList.remove("is-on"); video.classList.remove("is-on"); };
        next.style.objectPosition = D.DEST[code].pos;
        next.alt = city(code);
        next.src = D.photo(code);
        if (next.complete && next.naturalWidth) next.onload();
        $("#capCredit").textContent = D.DEST[code].credit === "Mada Trips" ? "" : D.DEST[code].credit;
      } else {
        imgs.forEach((i) => i.classList.remove("is-on")); video.classList.add("is-on");
        $("#capCredit").textContent = "";
      }
    }
    stage.classList.toggle("has-cap", !!tr.to);
    if (tr.to) {
      const a = D.byCode[tr.to];
      const now = new Date(Date.now() + (a.tz * 60 + new Date().getTimezoneOffset()) * 60000);
      $("#capCity").textContent = city(tr.to);
      $("#capLine").textContent = t("thereNow")(new Intl.DateTimeFormat(loc(), { hour: "numeric", minute: "2-digit", hour12: true }).format(now));
    }
  }

  // ---------- rail ----------
  function renderRail(tr) {
    const base = tr.dep ? { dep: tr.dep, ret: tr.ret } : weekend();
    let list = D.POPULAR.filter((c) => c !== tr.from).map((code) => ({ code, pr: price(tr, base.dep, base.ret, code) })).filter((x) => x.pr);
    if (tr.budget) list = list.filter((x) => x.pr.total <= tr.budget).sort((a, b) => a.pr.total - b.pr.total);
    else if (tr.cheap) list.sort((a, b) => a.pr.total - b.pr.total);
    $("#railTitle").innerHTML = tr.budget ? t("railBudget")(esc(money(tr.budget))) : tr.dep ? t("railDate")(esc(city(tr.from)), esc(fmt(tr.dep, { weekday: "short", day: "numeric", month: "short" })), esc(paxText(tr.pax))) : t("railWeekend")(esc(city(tr.from)), esc(paxText(tr.pax)));

    let html = "";
    const last = store.get("last");
    if (last && last.to && last.dep >= todayIso() && !state.text && !state.pick) {
      const pr = price({ ...last }, last.dep, last.ret, last.to);
      html += `<button type="button" class="card card--pass" data-resume>
        <div class="pass">
          <span class="pass__eye">${esc(t("cont"))}</span>
          <div class="pass__route"><div><b>${last.from}</b><span>${esc(city(last.from))}</span></div><i class="pass__line"></i><div><b>${last.to}</b><span>${esc(city(last.to))}</span></div></div>
          <dl class="pass__grid">
            <div><dt>${esc(t("depart"))}</dt><dd>${esc(day(last.dep))}</dd></div>
            <div><dt>${esc(t("retK"))}</dt><dd>${esc(last.ret ? day(last.ret) : t("oneWay"))}</dd></div>
            <div><dt>${esc(t("trav"))}</dt><dd>${esc(paxText(last.pax))}</dd></div>
          </dl>
          <i class="pass__tear"></i>
          <div class="pass__foot"><b>${pr ? esc(money(pr.total)) : ""}</b><span class="pass__go">${esc(t("contGo"))}</span></div>
        </div></button>`;
    }
    if (!list.length) html += `<p class="card card--pass" style="padding:26px">${esc(t("noneFit"))}</p>`;
    html += list.map(({ code, pr }) => {
      const d = D.DEST[code];
      const eye = pr.out.direct ? t("direct")(hrs(pr.out.minutes)) : t("via")(hrs(pr.out.minutes), city(pr.out.via));
      return `<button type="button" class="card${tr.to === code ? " is-sel" : ""}" data-code="${code}">
        <img src="${D.photo(code, true)}" alt="" loading="lazy" style="object-position:${d.pos}" />
        <span class="card__eye">${esc(eye)}</span>
        <span class="card__city">${esc(city(code))}</span>
        <span class="card__line">${esc(lang === "ar" ? d.ar : d.en)}</span>
        <span class="card__foot">
          <span class="card__price"><b>${esc(money(pr.total))}</b><small>${esc(t("totalFor")(paxText(tr.pax), !!base.ret))}</small></span>
          <span class="card__plus" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5v11M2.5 8h11"/></svg></span>
        </span>
      </button>`;
    }).join("");
    $("#track").innerHTML = html;
    railArrows();
  }
  function railArrows() {
    const tr = $("#track"), dir = lang === "ar" ? -1 : 1, x = tr.scrollLeft * dir;
    $('.rail__arrow[data-dir="-1"]').disabled = x <= 4;
    $('.rail__arrow[data-dir="1"]').disabled = x >= tr.scrollWidth - tr.clientWidth - 4;
  }

  function renderReceipt(tr, pr) {
    const total = pr ? pr.total : 1830;
    const tax = Math.round(total * 0.12 / 5) * 5;
    $("#receipt").innerHTML = `
      <div><span>${esc(t("rFare"))}</span><span>${esc(money(total - tax))}</span></div>
      <div><span>${esc(t("rTax"))}</span><span>${esc(money(tax))}</span></div>
      <div><span>${esc(t("rBags"))}</span><span>${esc(t("rBagsV"))}</span></div>
      <div><span>${esc(t("rFee"))}</span><span class="zero">${esc(money(0))}</span></div>
      <div><span>${esc(t("rTotal"))}</span><span>${esc(money(total))}</span></div>`;
  }

  function render() {
    const tr = trip(), pr = price(tr);
    renderFields(tr); renderAnswer(tr, pr); renderStage(tr); renderRail(tr); renderReceipt(tr, pr);
    if (tr.to && tr.dep) store.set("last", { from: tr.from, to: tr.to, dep: tr.dep, ret: tr.ret, pax: tr.pax });
    if (state.pax || tr.paxGiven) store.set("pax", tr.pax);
  }

  function renderStatic() {
    const h = new Date().getHours(), greet = t(h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
    document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
    const last = store.get("last");
    $("#heroSub").innerHTML = last && last.to && last.dep >= todayIso() ? esc(t("subBack")(greet, city(last.to))) : t("subNew")(esc(greet));
    $("#langBtn").textContent = t("lang");
    $("#credits").innerHTML = Object.entries(D.DEST).filter(([, d]) => d.src).map(([c, d]) => `<li>${esc(city(c))}: <a href="${d.src}" target="_blank" rel="noopener">${esc(d.credit)}</a></li>`).join("");
  }

  // ---------- placeholder that types example trips ----------
  let phTimer;
  function typePlaceholder() {
    clearTimeout(phTimer);
    const input = $("#q"), ex = t("examples");
    if (reduce) { input.placeholder = ex[0]; return; }
    let i = 0, n = 0, del = false;
    const tick = () => {
      const s = ex[i];
      n += del ? -1 : 1;
      input.placeholder = s.slice(0, n);
      let wait = del ? 16 : 48;
      if (!del && n >= s.length) { del = true; wait = 2600; } else if (del && n <= 0) { del = false; i = (i + 1) % ex.length; wait = 400; }
      phTimer = setTimeout(tick, wait);
    };
    tick();
  }

  // ---------- popovers ----------
  let open = null, calMonth = null, calMode = null;
  function openPop(kind) {
    const seg = $(`.seg[data-pop="${kind}"]`);
    if (open === kind) return closePop();
    open = kind;
    $$(".seg.is-open").forEach((s) => s.classList.remove("is-open")); seg.classList.add("is-open");
    const pop = $("#pop"), card = $("#popCard");
    pop.hidden = false;
    if (kind === "when") { const tr = trip(); calMonth = calMonth || (tr.dep || todayIso()).slice(0, 7); calMode = calMode || (tr.dep && !tr.ret ? "one" : "ret"); }
    drawPop();
    const r = seg.getBoundingClientRect(), w = card.offsetWidth;
    let x = lang === "ar" ? r.right - w : r.left;
    x = Math.max(12, Math.min(x, innerWidth - w - 12));
    card.style.left = x + "px"; card.style.top = r.bottom + 10 + "px";
  }
  function closePop() { open = null; $("#pop").hidden = true; $$(".seg.is-open").forEach((s) => s.classList.remove("is-open")); }

  function drawPop() {
    const card = $("#popCard"), tr = trip();
    if (open === "who") {
      const p = tr.pax, row = (k, key, sub, v, min, max) => `<div class="who__row"><div><b>${esc(t(key))}</b><small>${esc(t(sub))}</small></div><div class="step"><button type="button" data-step="${k}" data-d="-1" ${v <= min ? "disabled" : ""} aria-label="−">−</button><output>${v}</output><button type="button" data-step="${k}" data-d="1" ${v >= max ? "disabled" : ""} aria-label="+">+</button></div></div>`;
      const room = 9 - p.a - p.c;
      card.innerHTML = `<div class="who"><div class="pop__h"><b>${esc(t("whoTitle"))}</b></div>
        ${row("a", "adultsK", "adultsS", p.a, 1, p.a + room)}${row("c", "childrenK", "childrenS", p.c, 0, p.c + room)}${row("i", "babiesK", "babiesS", p.i, 0, p.a)}
        <div class="pop__foot"><span></span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div></div>`;
    } else if (open === "from") {
      card.innerHTML = `<div class="from"><div class="pop__h"><b>${esc(t("fromTitle"))}</b></div>${["RUH", "JED", "DMM", "MED", "AHB", "TUU", "ULH", "GIZ", "TIF"].map((c) => `<button type="button" data-from="${c}" class="${c === tr.from ? "on" : ""}">${esc(city(c))}<span>${c}</span></button>`).join("")}</div>`;
    } else if (open === "when") {
      const months = [calMonth, (() => { const [y, m] = calMonth.split("-").map(Number); return D.iso(new Date(y, m, 1)).slice(0, 7); })()];
      const dows = [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(loc(), { weekday: "narrow" }).format(new Date(2024, 0, 7 + i, 12)));
      const today = todayIso();
      const cell = (iso, cls, label, pr) => `<button type="button" class="cal__d ${cls}" data-day="${iso}" ${cls.includes("off") ? "disabled" : ""}>${label}${pr ? `<small>${pr}</small>` : ""}</button>`;
      const short = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
      const html = months.map((ym) => {
        const [y, m] = ym.split("-").map(Number), first = new Date(y, m - 1, 1, 12), days = new Date(y, m, 0).getDate();
        const prices = [];
        for (let d = 1; d <= days; d++) { const iso = D.iso(new Date(y, m - 1, d, 12)); const q = tr.to && iso >= today ? D.quote(tr.from, tr.to, iso, tr.pax) : null; prices.push(q ? q.total : null); }
        const vals = prices.filter(Boolean).sort((a, b) => a - b), low = vals[Math.floor(vals.length * 0.25)] || 0;
        let g = dows.map((w) => `<span class="cal__dow">${w}</span>`).join("") + "<span></span>".repeat(first.getDay());
        for (let d = 1; d <= days; d++) {
          const iso = D.iso(new Date(y, m - 1, d, 12)), p = prices[d - 1];
          const cls = [iso < today ? "off" : "", iso === tr.dep || iso === tr.ret ? "sel" : "", tr.dep && tr.ret && iso > tr.dep && iso < tr.ret ? "in" : "", p && p <= low ? "low" : ""].join(" ");
          g += cell(iso, cls, d, p ? short(p) : "");
        }
        return `<div class="cal__m"><b>${esc(new Intl.DateTimeFormat(loc(), { month: "long", year: "numeric" }).format(first))}</b><div class="cal__g">${g}</div></div>`;
      }).join("");
      card.innerHTML = `<div class="pop__h"><b>${esc(t("calTitle"))}</b>
          <span class="seg2"><button type="button" data-mode="one" class="${calMode === "one" ? "on" : ""}">${esc(t("oneWay"))}</button><button type="button" data-mode="ret" class="${calMode === "ret" ? "on" : ""}">${esc(t("returnL"))}</button></span>
          <span class="step"><button type="button" data-month="-1" aria-label="Previous month" ${calMonth <= today.slice(0, 7) ? "disabled" : ""}>‹</button><button type="button" data-month="1" aria-label="Next month">›</button></span></div>
        <div class="cal">${html}</div>
        <div class="pop__foot"><span>${esc(tr.to ? t("calNote")(paxText(tr.pax)) : t("calNoTo"))}</span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div>`;
    }
  }

  function onPopClick(e) {
    const tr = trip();
    const b = e.target.closest("button");
    if (!b) { if (e.target === $("#pop")) closePop(); return; }
    if (b.dataset.close != null) return closePop();
    if (b.dataset.step) {
      const p = { ...tr.pax }; p[b.dataset.step] += +b.dataset.d; p.i = Math.min(p.i, p.a);
      state.pax = p; store.set("pax", p); render(); drawPop(); return;
    }
    if (b.dataset.from) { state.from = b.dataset.from; store.set("from", state.from); render(); closePop(); return; }
    if (b.dataset.mode) { calMode = b.dataset.mode; if (calMode === "one" && tr.dep) state.dates = { dep: tr.dep, ret: null }; render(); drawPop(); return; }
    if (b.dataset.month) { const [y, m] = calMonth.split("-").map(Number); calMonth = D.iso(new Date(y, m - 1 + +b.dataset.month, 1, 12)).slice(0, 7); drawPop(); return; }
    if (b.dataset.day) {
      const d = b.dataset.day;
      if (calMode === "ret" && tr.dep && !tr.ret && d > tr.dep) { state.dates = { dep: tr.dep, ret: d }; render(); drawPop(); setTimeout(closePop, 260); }
      else { state.dates = { dep: d, ret: null }; render(); drawPop(); if (calMode === "one") setTimeout(closePop, 260); }
    }
  }

  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("is-on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("is-on"), 2600); }

  // ---------- wire ----------
  function init() {
    const q = $("#q");
    q.addEventListener("input", () => { state.text = q.value; if (P.parse(q.value).to) state.pick = null; render(); });
    q.addEventListener("focus", () => closePop());
    $$(".seg[data-pop]").forEach((s) => s.addEventListener("click", () => openPop(s.dataset.pop)));
    $("#pop").addEventListener("click", onPopClick);
    addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
    addEventListener("resize", () => open && closePop());
    $("#search").addEventListener("submit", (e) => { e.preventDefault(); const tr = trip(); if (!tr.to) { q.focus(); toast(t("needTo")); return; } if (!tr.dep) return openPop("when"); toast(t("soon")); });
    $("#answer").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.open) openPop(b.dataset.open);
      if (b.dataset.date) { const tr = trip(); const len = tr.ret ? (new Date(tr.ret) - new Date(tr.dep)) / 864e5 : 0; state.dates = { dep: b.dataset.date, ret: len ? addDays(b.dataset.date, len) : null }; render(); }
    });
    $("#track").addEventListener("click", (e) => {
      const c = e.target.closest(".card"); if (!c) return;
      if (c.dataset.resume != null) {
        const l = store.get("last"); state.text = ""; q.value = ""; state.pick = l.to; state.from = l.from; state.sig = { dates: "|null|false", pax: "null" }; state.dates = { dep: l.dep, ret: l.ret }; state.pax = l.pax;
      } else {
        const code = c.dataset.code, p = P.parse(state.text);
        if (p.to) { const hit = P.findCities(" " + P.norm(state.text) + " ").find((h) => h.code === p.to); state.text = hit ? state.text.replace(new RegExp(hit.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), city(code)) : state.text; q.value = state.text; }
        state.pick = code;
        if (!trip().dep) state.dates = weekend();
      }
      render();
      scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
    $("#track").addEventListener("scroll", railArrows, { passive: true });
    $$(".rail__arrow").forEach((b) => b.addEventListener("click", () => { const tr = $("#track"); tr.scrollBy({ left: +b.dataset.dir * (lang === "ar" ? -1 : 1) * tr.clientWidth * 0.8, behavior: "smooth" }); }));
    $("#langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("lang", lang); stageCode = undefined; renderStatic(); typePlaceholder(); render(); });
    renderStatic(); typePlaceholder(); render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
