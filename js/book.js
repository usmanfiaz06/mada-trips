/* =========================================================
   MADA BOOK: the booking platform
   Routes (hash, so Back and Forward always work):
     #/              home: the ask, your trips, ideas, promises
     #/plan          studio: chat with Mada on one side, the live plan on the other (tabs on phones)
     #/flights/out   choose the flight there      #/flights/back  choose the flight back
     #/stay          choose the hotel
     #/travelers     who's going (names as on passports) and where to send tickets
     #/pay           review and pay, or hold seats when the airline allows    #/pay/REF  pay for a held trip
     #/trip/REF      the booked trip: status, what happens next, calendar, advisor
     #/trips         all trips        #/signin  phone + code        #/account  profile and saved travelers

   Preview: answers, fares, hotels and payments are simulated here from js/book-data.js. In production the
   plan comes from the assistant service (an LLM with tools for fares, hotels, eSIMs and visas), payment goes
   to the payment gateway, and the trip and account live on the server. Nothing in this file charges anyone.
   ========================================================= */
(function () {
  const D = window.MadaData, P = window.MadaParse, W = window.MadaWords;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("mada." + k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem("mada." + k) : localStorage.setItem("mada." + k, JSON.stringify(v)); } catch {} },
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);

  // ---------- language + formatting ----------
  let lang = params.get("lang") || store.get("lang") || "en";
  const t = (k) => W[lang][k];
  const nf = new Intl.NumberFormat("en-US");
  const money = (n) => (lang === "ar" ? `${nf.format(Math.round(n))} ر.س` : `SAR ${nf.format(Math.round(n))}`);
  const loc = () => (lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");
  const fmt = (iso, o) => new Intl.DateTimeFormat(loc(), o).format(new Date(iso.length > 10 ? iso : iso + "T12:00:00"));
  const day = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
  const when = (iso) => new Intl.DateTimeFormat(loc(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const range = (a, b) => {
    if (!b) return day(a);
    if (lang !== "ar") return `${day(a)} – ${day(b)}`;
    const o = { day: "numeric", month: "short" };
    return a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })} – ${fmt(b, o)}` : `${fmt(a, o)} – ${fmt(b, o)}`;
  };
  const city = (c) => { const a = D.byCode[c]; return a ? (lang === "ar" ? a.cityAr : a.city) : ""; };
  const country = (cc) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(cc); } catch { return cc; } };
  const plural = (n, k) => `${n} ${t(k)[n === 1 ? 0 : 1]}`;
  const paxText = (p) => [p.a && plural(p.a, "adult"), p.c && plural(p.c, "child"), p.i && plural(p.i, "infant")].filter(Boolean).join(", ");
  const hrs = (m) => (lang === "ar" ? `${Math.floor(m / 60)}س ${m % 60}د` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const todayIso = () => D.iso(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return D.iso(d); };
  const nightsOf = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  const weekend = (k = 0) => { const th = D.iso(P.nextDow(new Date(), 4, false)); return { dep: addDays(th, 7 * k), ret: addDays(th, 7 * k + 2) }; };
  const wa = (text) => `https://wa.me/966566682662?text=${encodeURIComponent(text)}`;
  const placeName = (x) => (x.umrah ? (lang === "ar" ? "عمرة، مكة" : "Umrah, Makkah") : city(x.to));
  const itemLabel = (i) => (i.k === "flight" ? t("flight") : i.k === "stay" ? (lang === "ar" ? "الفندق" : "Hotel") : i.title);

  const ICO = {
    flights: '<path d="M21 15.5v-1.6l-8-5V4a1.5 1.5 0 0 0-3 0v4.9l-8 5v1.6l8-2.4v4.4l-2 1.5V21l3.5-1 3.5 1v-1.5l-2-1.5v-4.4z"/>',
    stays: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
    umrah: '<path d="M4 8.5 12 5l8 3.5V19H4z"/><path d="M4 11.5h16"/>',
    visa: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
    esim: '<path d="M7 3h7l4 4v14H7z"/><rect x="9.5" y="11" width="6" height="6" rx="1"/>',
    car: '<path d="M5 17h14M5 17v2M19 17v2M4 13l2-5h12l2 5v4H4z"/>',
    pickup: '<path d="M5 17h14M4 13l2-5h12l2 5v4H4z"/><path d="M9 8V5h6v3"/>',
    watch: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    chat: '<path d="M4 18.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8z"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    ppl: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.6.1 4.4 1.8 5 4.9"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r=".8"/>',
    pool: '<path d="M3 17c2 0 2-1.2 4.5-1.2S9.5 17 12 17s2-1.2 4.5-1.2S18.5 17 21 17M3 20.5c2 0 2-1.2 4.5-1.2s2 1.2 4.5 1.2 2-1.2 4.5-1.2 2 1.2 4.5 1.2M8 14V5.5a2 2 0 0 1 4 0M16 14V5.5a2 2 0 0 0-4 0M8 9h8"/>',
    gym: '<path d="M3 9.5v5M6 7.5v9M18 7.5v9M21 9.5v5M6 12h12"/>',
    spa: '<path d="M12 20c-4.5 0-8-3.2-8-7.5 3 0 5.5 1.3 8 4 2.5-2.7 5-4 8-4 0 4.3-3.5 7.5-8 7.5zM12 16.5c-2-2.5-2-6.5 0-10 2 3.5 2 7.5 0 10z"/>',
    parking: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M10 16.5v-9h3a2.7 2.7 0 0 1 0 5.4h-3"/>',
    prayer: '<path d="M15.5 4.5a7.5 7.5 0 1 0 4 12.8A6 6 0 0 1 15.5 4.5z"/>',
    halal: '<path d="M7 3v8M5 3v4.5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3"/>',
    kids: '<circle cx="12" cy="6" r="2.5"/><path d="M7 11l5-1.5 5 1.5M12 9.5V15l-3 5M12 15l3 5"/>',
    shuttle: '<rect x="4" y="4" width="16" height="12" rx="3"/><path d="M4 11h16M7 19v-3M17 19v-3"/><circle cx="8" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
  };
  const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[k] || ""}</svg>`;
  const SUN = '<svg viewBox="0 0 132 89"><path d="M73.3 0 68.4 41.7a17 17 0 0 0-4.5 0L59 0zM74.1 43.4a17 17 0 0 1 4.2 2.8l25.4-23.5-10.2-8.5zM114.3 35.4 81.8 50.4c.6 1.1 1.2 2.2 1.6 3.4l37.7-6.4zM84.4 60.2l47.9 9.3-4.8-11.4-43.2.5zM58.2 43.4a17 17 0 0 0-4.2 2.8L28.6 22.7l10.2-8.5zM18.1 35.4l32.4 15c-.6 1.1-1.2 2.2-1.6 3.4L11.2 47.4zM48 60.2 0 69.5l4.8-11.4 43.2.5z"/></svg>';

  // ---------- state ----------
  let user = store.get("user");
  let trips = store.get("trips") || [];
  let saved = store.get("travelers") || [];
  let draft = store.get("draft");
  let co = store.get("checkout") || {};
  let from = store.get("from") || "RUH";
  const saveDraft = () => store.set("draft", draft);
  const saveTrips = () => store.set("trips", trips);
  const freshDraft = () => ({ from, to: null, dep: null, ret: null, pax: store.get("pax") || { a: 1, c: 0, i: 0 }, umrah: false, tier: 1, items: {}, flightsOnly: false, outId: null, backId: null, backPicked: false, hotelId: null, msgs: [], plan: false, visa: null });

  // ---------- the plan ----------
  const pick = (list, id) => list.find((o) => o.id === id) || [...list].sort((a, b) => a.score - b.score)[0] || null;
  const flightsFor = (d, leg) => (leg === "back" ? D.options(d.to, d.from, d.ret, d.pax) : D.options(d.from, d.to, d.dep, d.pax));
  function chosen(d) {
    const out = d.dep ? pick(flightsFor(d, "out"), d.outId) : null;
    const back = d.ret ? pick(flightsFor(d, "back"), d.backId) : null;
    const nights = d.ret ? nightsOf(d.dep, d.ret) : 3;
    const list = D.hotels(d.to);
    const hotel = list.find((h) => h.id === d.hotelId) || list.find((h) => h.tier === d.tier) || list[0];
    const room = (hotel && hotel.rooms.find((r) => r.id === d.roomId)) || (hotel && (d.pax.c && d.pax.a >= 2 ? hotel.rooms[2] : hotel.rooms[0]));
    return { out, back, nights, hotel, room };
  }

  // Everything the plan shows, priced. Items that are off stay listed so they can be switched back on.
  function buildPlan(d) {
    const cc = D.byCode[d.to].country, umrah = d.umrah;
    const { out, back, nights, hotel, room } = chosen(d);
    const people = d.pax.a + d.pax.c, rooms = roomsFor(room, d.pax);
    const al = (o) => (lang === "ar" ? D.AIRLINES[o.al].nameAr : D.AIRLINES[o.al].name);
    const items = [];
    if (out) items.push({
      k: "flight", icon: "flights", go: "#/flights/out",
      title: `${al(out)} ${out.no}${back && back.al !== out.al ? ` · ${al(back)} ${back.no}` : ""}`,
      sub: `${day(d.dep)} ${D.hm(out.dep)} → ${D.hm(out.arr)}${out.plusDay ? " " + t("nextDay") : ""} · ${hrs(out.minutes)} ${out.direct ? t("direct") : t("stop")(city(out.via))}${back ? ` · ${t("ret")} ${day(d.ret)} ${D.hm(back.dep)}` : ""} · ${out.bagAdded ? t("bagAdded") : t("bagIn")(out.bag)}`,
      price: out.total + (back ? back.total : 0),
    });
    if (hotel && !(cc === "SA" && !umrah && D.byCode[d.from].country === "SA" && nights < 1)) {
      items.push({ k: "stay", icon: "stays", go: "#/stay", title: `${hotel.stars}★ ${L(hotel.kind)}, ${L(hotel.area)}`, sub: `${lang === "ar" ? room.ar : room.en} · ${t("forStay")(nights, rooms)} · ${hotel.breakfast ? t("bfast") : t("noBfast")}`, price: stayPrice(hotel, room, nights, d.pax) });
    }
    if (D.ESIM[cc]) items.push({ k: "esim", icon: "esim", title: t("esim")(country(cc)), sub: t("esimSub"), price: D.ESIM[cc] * people });
    const pk = umrah ? 260 : D.PICKUP[d.to];
    if (pk) items.push({ k: "pickup", icon: "pickup", title: umrah ? t("makkahPick") : t("pickup"), sub: t("pickupSub"), price: pk * (people > 4 ? 2 : 1) });
    if (d.items.car) items.push({ k: "car", icon: "car", title: t("car"), sub: t("carSub")(Math.max(1, nights)), price: 175 * Math.max(1, nights) });
    if (cc !== "SA") items.push({ k: "visa", icon: "visa", title: t("visa"), sub: D.GCC.has(cc) ? t("visaNo") : t("visaYes"), price: null, info: true });
    for (const it of items) if (!it.info) it.on = d.items[it.k] !== false && !(d.flightsOnly && it.k !== "flight");
    const total = items.reduce((s, it) => s + (it.on ? it.price : 0), 0);
    return { items, total, nights, out, back, hotel };
  }
  const L = (pair) => pair[lang === "ar" ? 1 : 0];
  const roomsFor = (room, pax) => (room && room.sleeps >= 4 ? Math.max(1, Math.ceil((pax.a + pax.c) / 4)) : Math.max(1, Math.ceil(pax.a / 2)));
  const stayPrice = (h, room, nights, pax) => Math.round(h.rate * room.mult * nights * roomsFor(room, pax) / 5) * 5;
  const tripTotal = (f, to, dep, ret, pax) => {
    const o = D.quote(f, to, dep, pax), r = ret && D.quote(to, f, ret, pax); if (!o) return null;
    const rooms = Math.max(1, Math.ceil(pax.a / 2)), n = ret ? nightsOf(dep, ret) : 0;
    return o.total + (r ? r.total : 0) + (D.STAY[to] ? D.STAY[to][1] * n * rooms : 0);
  };

  // ---------- the conversation ----------
  const say = (html, extra = "") => draft.msgs.push({ who: "mada", html, extra });
  const you = (text) => draft.msgs.push({ who: "you", text });
  const chips = (list) => `<div class="chips">${list.map((c) => `<button type="button" class="chip" data-a="${c.a}" data-v="${esc(c.v ?? "")}">${esc(c.l)}</button>`).join("")}</div>`;
  const destChips = () => chips(D.POPULAR.slice(0, 5).map((c) => ({ a: "go", v: c, l: city(c) })));

  // Read a message in the context of the trip so far: new facts replace old ones, everything else stays.
  function reply(text, raw) {
    const s = raw ? "" : P.norm(text), p = P.parse(raw ? "" : text), d = draft;
    const has = (re) => re.test(s);
    let changed = false, note = "";
    if (has(/visa|تاشير/) && !d.visa) {
      d.visa = { to: p.to || d.to };
      if (d.visa.to) return say(esc(t("visaAsk")(country(D.byCode[d.visa.to].country))), chips(t("passports").map((x, i) => ({ a: "pp", v: i, l: x }))));
      return say(esc(t("askWhere")), destChips());
    }
    if (d.plan) {
      if (has(/cheap|less|lower|ارخص|رخيص/)) {
        if (d.tier > 0) { d.tier--; d.hotelId = null; }
        else { const ctx = D.priceContext(d.from, d.to, d.dep, d.pax); if (ctx && ctx.cheaper) { const n = d.ret ? nightsOf(d.dep, d.ret) : 0; d.dep = ctx.cheaper.date; if (n) d.ret = addDays(d.dep, n); d.outId = d.backId = null; note = t("cheapest")(day(d.dep)); } }
        changed = true;
      }
      if (has(/earlier|day before|قبلها|قبل بيوم/)) { d.dep = addDays(d.dep, -1); if (d.ret) d.ret = addDays(d.ret, -1); if (d.dep < todayIso()) d.dep = todayIso(); d.outId = d.backId = null; changed = true; }
      if (has(/later|day after|بعدها بيوم/)) { d.dep = addDays(d.dep, 1); if (d.ret) d.ret = addDays(d.ret, 1); d.outId = d.backId = null; changed = true; }
      if (has(/5 ?★|5 ?star|five star|luxury|فخم|5 نجوم/)) { d.tier = 2; d.hotelId = null; d.items.stay = true; d.flightsOnly = false; changed = true; }
      if (has(/4 ?star|four star/)) { d.tier = 1; d.hotelId = null; changed = true; }
      if (has(/just the flight|only the flight|flight only|الطيران بس|طيران فقط/)) { d.flightsOnly = true; changed = true; }
      if (has(/add a traveler|one more|another person|اضف مسافر|شخص زياده/)) { d.pax = { ...d.pax, a: Math.min(9, d.pax.a + 1) }; changed = true; }
    }
    if (has(/\bcar\b|سياره/)) { d.items.car = true; d.flightsOnly = false; changed = true; }
    if (p.from) d.from = p.from;
    if (p.to && p.to !== d.to) { d.to = p.to; d.tier = 1; d.items = {}; d.flightsOnly = false; d.outId = d.backId = d.hotelId = null; d.plan = false; changed = true; }
    d.umrah = d.to === "JED" && (p.makkah || d.umrah);
    if (p.dates.length) { d.dep = p.dates[0]; d.ret = p.oneWay ? null : p.dates[1] || (p.nights ? addDays(p.dates[0], p.nights) : null); d.outId = d.backId = null; changed = true; }
    else if (p.nights && d.dep) { d.ret = addDays(d.dep, p.nights); changed = true; }
    if (p.pax) { d.pax = p.pax; store.set("pax", p.pax); changed = true; }
    if (!d.plan && has(/^flights? to|طيران الى/)) d.flightsOnly = true;
    if (!d.plan && has(/hotel|\bstay\b|فندق/) && !has(/flight|طيران/)) d.items = { ...d.items, flight: false };
    if (!d.plan && has(/esim|شريحه/)) d.items = { ...d.items, flight: false, stay: false, pickup: false };

    if (!d.to) {
      if (p.budget) return budgetAnswer(p.budget);
      return say(esc(t("askWhere")), destChips());
    }
    if (!d.dep) return say(esc(d.umrah ? t("askWhenUmrah") : t("askWhen")(city(d.to))), chips([{ a: "wk", v: 0, l: t("wkThis") }, { a: "wk", v: 1, l: t("wkNext") }, { a: "in2", l: t("in2") }, { a: "cal", l: t("pickDates") }]));
    if (d.ret && d.ret <= d.dep) d.ret = null;
    const first = !d.plan;
    d.plan = true;
    say(note ? esc(note) : first || !changed ? t("planIntro")(esc(placeName(d)), esc(range(d.dep, d.ret)), esc(paxText(d.pax))) : esc(t("updated")), "plan");
  }
  function budgetAnswer(budget) {
    const w = weekend(), d = draft;
    const list = D.POPULAR.filter((c) => c !== d.from).map((c) => ({ c, total: tripTotal(d.from, c, w.dep, w.ret, d.pax) })).filter((x) => x.total && x.total <= budget).sort((a, b) => a.total - b.total).slice(0, 4);
    if (!list.length) return say(esc(t("budgetNone")), chips([{ a: "wk", v: 1, l: t("wkNext") }]));
    say(esc(t("budgetIntro")(money(budget), paxText(d.pax))), chips(list.map((x) => ({ a: "goWk", v: x.c, l: `${city(x.c)} · ${money(x.total)}` }))));
  }

  let busy = false, prevSig = {};
  // raw: the trip was already changed by a tap (a chip, a card, the calendar); the text is only what the bubble shows.
  function send(text, raw) {
    text = String(text).trim(); if (!text || busy) return;
    if (!draft) draft = freshDraft();
    you(text); busy = true; saveDraft();
    if (route().name !== "plan") location.hash = "#/plan"; else renderThread(true);
    setTimeout(() => { reply(text, raw); busy = false; saveDraft(); if (route().name === "plan") { renderThread(false); renderPlanPane(true); } }, reduce ? 0 : 650);
  }

  function renderThread(working) {
    const el = $("#thread"); if (!el || !draft) return;
    let html = "";
    draft.msgs.forEach((m, i) => {
      if (m.who === "you") { html += `<div class="bub">${esc(m.text)}</div>`; return; }
      const last = i === draft.msgs.length - 1;
      let extra = "";
      if (last && m.extra === "plan" && draft.plan) {
        const pl = buildPlan(draft);
        extra = `<div class="say__mini"><span>${esc(t("totalFor")(paxText(draft.pax)))} · <b>${esc(money(pl.total))}</b></span><button type="button" class="link" data-a="tab" data-v="plan">${esc(t("viewPlan"))} →</button></div>` + followChips();
      } else if (last) extra = m.extra;
      html += `<div class="say"><span class="say__mark">${SUN}</span><div class="say__body"><p class="say__text">${m.html}</p>${extra}</div></div>`;
    });
    if (working || busy) html += `<div class="say"><span class="say__mark">${SUN}</span><div class="say__body"><span class="say__work">${esc(t("working"))} <i></i><i></i><i></i></span></div></div>`;
    el.innerHTML = html;
    const last = el.lastElementChild;
    if (last) requestAnimationFrame(() => {
      if (matchMedia("(max-width: 960px)").matches) { const y = last.getBoundingClientRect().top + scrollY - 120; scrollTo({ top: Math.max(0, y), behavior: reduce ? "auto" : "smooth" }); }
      else el.scrollTo({ top: last.offsetTop - 12, behavior: reduce ? "auto" : "smooth" });
    });
  }
  function followChips() {
    const f = t("follow");
    return chips(["cheaper", "earlier", "lux", "addCar", "flightOnly", "plus1"].map((k) => ({ a: "say", v: f[k], l: f[k] })));
  }

  function planCard(d) {
    const plan = buildPlan(d), dd = D.DEST[d.to];
    const img = dd ? `<img src="${D.photo(d.to)}" alt="" style="object-position:${dd.pos}" />${dd.credit !== "Mada Trips" ? `<small>${esc(dd.credit)}</small>` : ""}` : "";
    return `<div class="plan">
      <div class="plan__hero${dd ? "" : " plan__hero--plain"}">${img}<b>${esc(placeName(d))}</b></div>
      <div class="plan__meta">
        <button type="button" data-pop="when">${ico("cal")}<span>${esc(range(d.dep, d.ret))}</span></button>
        <button type="button" data-pop="who">${ico("ppl")}<span>${esc(paxText(d.pax))}</span></button>
        <button type="button" data-pop="from">${ico("pin")}<span>${esc(city(d.from))}</span></button>
      </div>
      ${plan.items.map((it) => `<div class="item${it.info ? " info" : it.on ? "" : " off"}" data-k="${it.k}">${ico(it.icon)}<div class="item__t"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span>${it.go && it.on ? `<a class="item__chg" href="${it.go}">${esc(t("change"))}</a>` : ""}</div><span class="item__p">${it.info ? esc(t("visaChk")) : esc(money(it.price))}</span><button type="button" class="tog" data-tog="${it.k}" ${it.info ? "disabled" : ""} aria-pressed="${!!it.on}" aria-label="${esc(it.title)}"></button></div>`).join("")}
      <div class="plan__foot"><div class="plan__total"><small>${esc(t("totalFor")(paxText(d.pax)))}</small><b>${esc(money(plan.total))}</b></div>
        <div class="plan__go"><button type="button" class="btn btn--plain" data-a="share">${esc(t("share"))}</button><a class="btn btn--main" href="#/travelers">${esc(t("cont"))}</a></div></div>
    </div>`;
  }
  function renderPlanPane(flash) {
    const el = $("#planPane"); if (!el) return;
    if (!draft || !draft.plan) { el.innerHTML = `<div class="plan-empty">${SUN}<p>${esc(t("noPlanYet"))}</p></div>`; $("#planTab").textContent = t("planTab"); prevSig = {}; return; }
    const plan = buildPlan(draft);
    el.innerHTML = planCard(draft);
    $("#planTab").textContent = `${t("planTab")} · ${money(plan.total)}`;
    const sig = Object.fromEntries(plan.items.map((it) => [it.k, `${it.price}|${it.on}|${it.title}`]));
    if (flash) for (const k in sig) if (prevSig[k] && prevSig[k] !== sig[k]) $(`.item[data-k="${k}"]`, el)?.classList.add("flash");
    prevSig = sig;
  }

  // ---------- views ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "").split("?")[0];
    const [name = "", a, b] = h.split("/");
    return { name: name || "home", a, b };
  }
  function show(id) {
    for (const v of ["home", "studio", "page"]) $("#" + v).hidden = v !== id;
    document.body.classList.toggle("v-studio", id === "studio");
  }
  const needPlan = () => { if (!draft || !draft.plan) { location.replace("#/"); return false; } return true; };

  function render() {
    const r = route();
    closePop(); $("#acctMenu").hidden = true;
    renderHeader();
    if (r.name === "home") return viewHome();
    if (r.name === "plan") return viewStudio();
    if (r.name === "flights") return needPlan() && viewFlights(r.a === "back" && draft.ret ? "back" : "out");
    if (r.name === "stay") return needPlan() && viewStay();
    if (r.name === "hotel") return needPlan() && viewHotel(decodeURIComponent(r.a || ""));
    if (r.name === "travelers") return needPlan() && viewTravelers();
    if (r.name === "pay") return r.a ? viewPay(r.a) : needPlan() && viewPay();
    if (r.name === "trip") return viewTrip(r.a);
    if (r.name === "trips") return viewTrips();
    if (r.name === "signin") return viewSignin();
    if (r.name === "account") return user ? viewAccount() : location.replace("#/signin?next=account");
    location.replace("#/");
  }
  function page(html) { show("page"); $("#page").innerHTML = html; scrollTo(0, 0); }
  const backLink = (href, label = t("back")) => `<a class="link pg__back" href="${href}">${ico("back")}${esc(label)}</a>`;
  const steps = (n) => `<div class="steps">${t("steps").map((s, i) => `<span class="${i === n ? "on" : i < n ? "ok" : ""}"><i>${i < n ? "✓" : i + 1}</i>${esc(s)}</span>`).join("")}</div>`;

  function renderHeader() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
    $("#langBtn").textContent = t("lang");
    const acct = $("#acct");
    acct.classList.toggle("is-in", !!user);
    acct.innerHTML = user ? `<i>${esc((user.name || "?")[0])}</i><span>${esc(user.name)}</span>` : esc(t("signIn"));
    $$(".demo button").forEach((b) => b.classList.toggle("on", b.dataset.as === (user ? "back" : "new")));
    $("#credits").innerHTML = Object.entries(D.DEST).filter(([, x]) => x.src).map(([c, x]) => `<li>${esc(city(c))}: <a href="${x.src}" target="_blank" rel="noopener">${esc(x.credit)}</a></li>`).join("") + `<li>${esc(D.HOTEL_CREDIT)}</li>`;
  }
  const toolsHtml = () => { const tools = t("tools"); return Object.keys(tools).map((k) => `<button type="button" class="tool" data-tool="${k}">${ico(k)}${esc(tools[k])}</button>`).join(""); };

  // ---------- home ----------
  const upcoming = () => trips.filter((x) => x.dep >= todayIso() && x.status !== "expired").sort((a, b) => (a.dep < b.dep ? -1 : 1));
  function viewHome() {
    show("home"); moveAsk("home"); scrollTo(0, 0);
    const next = upcoming()[0];
    $("#hi").textContent = user ? t("hiBack")(user.name) : "";
    $("#title").textContent = user ? t("titleBack") : t("titleNew");
    $("#sub").textContent = user ? (next ? t("subBack")(city(next.to), Math.max(0, nightsOf(todayIso(), next.dep))) : t("subBackNone")) : t("subNew");
    $("#tools").innerHTML = toolsHtml();
    $("#hints").innerHTML = `<span>${esc(t("tryL"))}</span>` + t("ph").slice(0, 3).map((s) => `<button type="button" data-a="say" data-v="${esc(s)}">${esc(s)}</button>`).join("");
    $("#cont").innerHTML = draft && draft.plan ? `<button type="button" class="cont__card" data-a="open">${D.DEST[draft.to] ? `<img src="${D.photo(draft.to, true)}" alt="" />` : ""}<div><small>${esc(t("contH"))}</small><b>${esc(placeName(draft))} · ${esc(range(draft.dep, draft.ret))}</b><span>${esc(paxText(draft.pax))} · ${esc(money(buildPlan(draft).total))}</span></div><em>${esc(t("contGo"))} →</em></button>` : "";
    renderMine(); renderRail(); renderReceipt(); typePlaceholder();
  }
  function renderMine() {
    const el = $("#mine"), next = upcoming()[0];
    if (!next) { el.innerHTML = ""; return; }
    const daysTo = Math.max(0, nightsOf(todayIso(), next.dep));
    const hasEsim = next.plan.items.some((i) => i.k === "esim" && i.on);
    const cc = D.byCode[next.to].country, watch = store.get("watch"), held = next.status === "held";
    el.innerHTML = `<h2 class="sec-title">${esc(t("mineTitle"))}</h2>
      <div class="mine__grid">
        <a class="pass" href="#/trip/${next.ref}">
          <div class="pass__main">
            <span class="pass__eye${held ? " held" : ""}">${esc(held ? t("held") : t("upcoming"))} · ${esc(range(next.dep, next.ret))}</span>
            <div class="pass__route"><div><b>${next.from}</b><span>${esc(city(next.from))}</span></div><i class="pass__line"></i><div><b>${next.to}</b><span>${esc(city(next.to))}</span></div></div>
            <dl class="pass__grid"><div><dt>${esc(t("flightK"))}</dt><dd>${esc(next.flightNo || "—")}</dd></div><div><dt>${esc(t("departK"))}</dt><dd>${esc(next.depTime || "—")}</dd></div><div><dt>${esc(t("seatK"))}</dt><dd>${esc(next.seat || "—")}</dd></div><div><dt>${esc(t("travK"))}</dt><dd>${next.pax.a + next.pax.c + next.pax.i}</dd></div></dl>
          </div>
          <div class="pass__stub"><div class="pass__count"><b>${daysTo || esc(t("today"))}</b><span>${daysTo ? esc(t("inDays")) : ""}</span></div><span class="pass__hint">${esc(held ? t("heldUntil")(when(next.heldUntil)) : t("checkIn")(Math.max(1, daysTo - 1)))}</span><span class="link">${esc(t("details"))} →</span></div>
        </a>
        <div class="mine__side">
          ${watch ? `<div class="note">${ico("watch")}<div><b>${esc(t("watchH"))}</b><p>${t("watch")(esc(city(watch.to)), esc(money(watch.drop)))}</p><button type="button" class="link" data-a="goWk" data-v="${watch.to}">${esc(t("watchGo"))} →</button></div></div>` : ""}
          ${!hasEsim && D.ESIM[cc] ? `<div class="note">${ico("esim")}<div><b>${esc(t("esimH"))}</b><p>${esc(t("esimP")(country(cc), money(D.ESIM[cc])))}</p><button type="button" class="link" data-a="addEsim" data-v="${next.ref}">${esc(t("esimGo"))} →</button></div></div>` : ""}
          <div class="note">${ico("chat")}<div><b>${esc(t("advH"))}</b><p>${esc(t("advP"))}</p><a class="link" href="${wa(t("waHi")(next.ref))}" target="_blank" rel="noopener">${esc(t("advGo"))} →</a></div></div>
        </div>
      </div>`;
  }
  function renderRail() {
    const w = weekend(), pax = store.get("pax") || { a: 2, c: 0, i: 0 };
    const mineTo = new Set(upcoming().map((x) => x.to));
    const list = D.POPULAR.filter((c) => c !== from && !mineTo.has(c));
    const watch = store.get("watch");
    if (watch) list.sort((a, b) => (a === watch.to ? -1 : b === watch.to ? 1 : 0));
    $("#railTitle").innerHTML = user ? t("railBack")() : t("railNew")(esc(city(from)));
    $("#track").innerHTML = list.map((code) => {
      const x = D.DEST[code], q = D.quote(from, code, w.dep, pax), total = tripTotal(from, code, w.dep, w.ret, pax);
      if (!q || !total) return "";
      return `<button type="button" class="card" data-a="goWk" data-v="${code}">
        <img src="${D.photo(code, true)}" alt="" loading="lazy" style="object-position:${x.pos}" />
        <span class="card__eye">${esc(q.direct ? `${hrs(q.minutes)} ${t("direct")}` : `${hrs(q.minutes)} · ${t("stop")(city(q.via))}`)}</span>
        <span class="card__city">${esc(city(code))}</span>
        <span class="card__line">${esc(lang === "ar" ? x.ar : x.en)}</span>
        <span class="card__foot"><span class="card__price"><b>${esc(money(total))}</b><small>${esc(t("railFor")(paxText(pax)))}</small></span><span class="card__plus" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5v11M2.5 8h11"/></svg></span></span>
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
    let fl = 1830, stay = 1240, stayL = t("rStay");
    if (draft && draft.plan) { const pl = buildPlan(draft); fl = (pl.items.find((i) => i.k === "flight" && i.on) || {}).price || 0; stay = pl.total - fl; stayL = lang === "ar" ? "الفندق والإضافات" : "Hotel and extras"; }
    const tax = Math.round(fl * 0.12 / 5) * 5;
    $("#receipt").innerHTML = `<div><span>${esc(t("rFare"))}</span><span>${esc(money(fl - tax))}</span></div><div><span>${esc(t("rTax"))}</span><span>${esc(money(tax))}</span></div><div><span>${esc(stayL)}</span><span>${esc(money(stay))}</span></div><div><span>${esc(t("rFee"))}</span><span class="zero">${esc(money(0))}</span></div><div><span>${esc(t("rTotal"))}</span><span>${esc(money(fl + stay))}</span></div>`;
  }

  // ---------- studio ----------
  let tab = "chat";
  function viewStudio() {
    if (!draft) draft = freshDraft();
    show("studio"); moveAsk("studio");
    const st = $("#studio");
    st.classList.toggle("tab-chat", tab === "chat"); st.classList.toggle("tab-plan", tab === "plan");
    $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $("#tools").innerHTML = toolsHtml();
    renderThread(busy); renderPlanPane(false); typePlaceholder();
  }
  function setTab(v) { tab = v; viewStudio(); scrollTo(0, 0); }

  // The one ask box moves between the home hero and the bottom of the studio, so typing never jumps elsewhere.
  function moveAsk(where) {
    const ask = $("#ask");
    if (where === "home") $("#hints").before(ask); else $("#dockSlot").append(ask);
    grow();
  }

  // ---------- flights ----------
  let flSort = "best", flDirect = false;
  function viewFlights(leg) {
    const d = draft, list = flightsFor(d, leg), cur = leg === "back" ? chosen(d).back : chosen(d).out;
    const dest = leg === "back" ? d.from : d.to, date = leg === "back" ? d.ret : d.dep;
    const best = [...list].sort((a, b) => a.score - b.score)[0], cheap = [...list].sort((a, b) => a.total - b.total)[0], fast = [...list].sort((a, b) => a.minutes - b.minutes || a.total - b.total)[0];
    const sorters = { best: (a, b) => a.score - b.score, cheapest: (a, b) => a.total - b.total, fastest: (a, b) => a.minutes - b.minutes, earliest: (a, b) => a.dep - b.dep };
    const rows = list.filter((o) => !flDirect || o.direct).sort(sorters[flSort]);
    const al = (o) => (lang === "ar" ? D.AIRLINES[o.al].nameAr : D.AIRLINES[o.al].name);
    const isCur = (o) => cur && o.id === cur.id;
    // When one flight is best, cheapest and fastest at once, show it once with all its labels.
    const mergedPicks = [];
    for (const [k, o] of [["best", best], ["cheapest", cheap], ["fastest", fast]]) { if (!o) continue; const m = mergedPicks.find(([x]) => x.id === o.id); if (m) m[1].push(k); else mergedPicks.push([o, [k]]); }
    const pickCard = (ks, o) => `<button type="button" class="pick${isCur(o) ? " on" : ""}" data-fl="${o.id}"><span class="pick__k">${esc(ks.map((k) => t("picks")[k]).join(" · "))}</span><span class="pick__p">${esc(money(o.total))}</span><span class="pick__s">${esc(al(o))} · ${D.hm(o.dep)} → ${D.hm(o.arr)}${o.plusDay ? " +1" : ""}</span><span class="pick__s">${esc(hrs(o.minutes))} ${esc(o.direct ? t("direct") : t("stop")(city(o.via)))}</span></button>`;
    page(`<div class="wrap pg">
      ${backLink("#/plan")}
      <h1 class="pg__h">${esc(leg === "back" ? t("flTitleBack")(city(dest)) : t("flTitle")(city(dest)))}</h1>
      <p class="pg__sub">${esc(t("flSub")(day(date), paxText(d.pax)))}</p>
      <div class="picks">${mergedPicks.map(([o, ks]) => pickCard(ks, o)).join("")}</div>
      <div class="bar"><h2>${esc(t("allFlights")(list.length))}</h2>
        <div class="bar__r"><span class="seg2">${Object.keys(sorters).map((k) => `<button type="button" data-sort="${k}" class="${flSort === k ? "on" : ""}">${esc(t("sortBy")[k])}</button>`).join("")}</span>
        <label class="check"><input type="checkbox" id="flDirect" ${flDirect ? "checked" : ""} />${esc(t("directOnly"))}</label></div></div>
      ${rows.length ? rows.map((o) => `<div class="fl${isCur(o) ? " on" : ""}">
        <div class="fl__al"><b>${esc(al(o))}</b><span>${esc(o.no)}</span></div>
        <div class="fl__times"><b>${D.hm(o.dep)}</b><div class="fl__line">${esc(hrs(o.minutes))}<i></i>${esc(o.direct ? t("direct") : t("stop")(city(o.via)))}</div><b>${D.hm(o.arr)}${o.plusDay ? `<sup>+1</sup>` : ""}</b></div>
        <div class="fl__inc"><span>${esc(o.bagAdded ? t("bagAdded") : t("bagIn")(o.bag))}</span><span class="${o.change ? "" : "no"}">${esc(o.change ? t("changeOk") : t("changeFee"))}</span></div>
        <div class="fl__pr"><small>${esc(paxText(d.pax))}</small><b>${esc(money(o.total))}</b><button type="button" class="btn btn--sm ${isCur(o) ? "btn--plain" : "btn--main"}" data-fl="${o.id}">${esc(isCur(o) ? t("selected") : t("select"))}</button></div>
      </div>`).join("") : `<p class="empty">${esc(t("noFlights"))}</p>`}
    </div>`);
    $$("[data-fl]").forEach((b) => b.addEventListener("click", () => {
      if (leg === "back") { draft.backId = b.dataset.fl; draft.backPicked = true; } else draft.outId = b.dataset.fl;
      draft.items.flight = true; draft.flightsOnly = draft.flightsOnly && true; saveDraft();
      location.hash = leg === "out" && draft.ret && !draft.backPicked ? "#/flights/back" : "#/plan";
    }));
    $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { flSort = b.dataset.sort; viewFlights(leg); }));
    $("#flDirect").addEventListener("change", (e) => { flDirect = e.target.checked; viewFlights(leg); });
  }

  // ---------- hotels ----------
  let stSort = "rec", stStars = "all", stF = { breakfast: false, cancel: false, pool: false };
  const cancelDate = (d) => fmt(addDays(d.dep, -3), { day: "numeric", month: "short" });
  // One honest line on why this hotel suits this trip: family, walkability, reviews, quiet, or value.
  function take(h, d, cheapestId) {
    const c = d.umrah ? (lang === "ar" ? "مكة" : "Makkah") : city(d.to);
    if (d.pax.c && h.amen.includes("kids")) return t("takeFamily");
    if (h.rating >= 9) return t("takeTop")(c);
    if (h.walk <= 7) return t("takeWalk")(h.walk, L(h.landmark));
    if (h.id === cheapestId) return t("takeValue")(L(h.area));
    return t("takeQuiet")(L(h.landmark));
  }
  const ratingBadge = (h) => `<span class="ht__rate"><b>${h.rating}</b><span>${esc(t("ratingWord")(h.rating))}</span><small>${esc(t("reviews")(h.reviews))}</small></span>`;
  const amenRow = (h, n = 6) => `<div class="amen">${h.amen.slice(0, n).map((a) => `<span title="${esc(t("amen")[a])}">${ico(a)}<em>${esc(t("amen")[a])}</em></span>`).join("")}</div>`;
  const gallery = (h, id) => `<div class="gal" data-gal="${id}"><div class="gal__track">${[0, 1, 2, 3].map((i) => `<img src="${D.hotelPhoto(h, i, true)}" alt="" loading="lazy" />`).join("")}</div>
      <button type="button" class="gal__b gal__prev" aria-label="Previous photo">${ico("back")}</button><button type="button" class="gal__b gal__next" aria-label="Next photo">${ico("back")}</button>
      <span class="gal__dots">${[0, 1, 2, 3].map((i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</span></div>`;
  function wireGalleries(root) {
    $$(".gal", root).forEach((g) => {
      const tr = $(".gal__track", g), dots = $$(".gal__dots i", g), dir = lang === "ar" ? -1 : 1;
      const go = (n) => tr.scrollBy({ left: n * dir * tr.clientWidth, behavior: "smooth" });
      $(".gal__prev", g).addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
      $(".gal__next", g).addEventListener("click", (e) => { e.stopPropagation(); go(1); });
      tr.addEventListener("scroll", () => { const i = Math.round(Math.abs(tr.scrollLeft) / tr.clientWidth); dots.forEach((d, k) => d.classList.toggle("on", k === i)); }, { passive: true });
    });
  }
  function viewStay() {
    const d = draft, { hotel: cur, nights, room } = chosen(d);
    const all = D.hotels(d.to);
    const cheapestId = [...all].sort((a, b) => a.rate - b.rate)[0].id;
    let list = all.filter((h) => (stStars === "all" || h.stars === +stStars) && (!stF.breakfast || h.breakfast) && (!stF.cancel || h.freeCancel) && (!stF.pool || h.amen.includes("pool")));
    const score = (h) => h.rating * 10 - h.rate / 60 + (d.pax.c && h.family ? 8 : 0) + (h.walk <= 7 ? 3 : 0);
    list.sort(stSort === "price" ? (a, b) => a.rate - b.rate : stSort === "rating" ? (a, b) => b.rating - a.rating : (a, b) => score(b) - score(a));
    const stayOn = d.items.stay !== false && !d.flightsOnly;
    const where = d.umrah ? (lang === "ar" ? "مكة" : "Makkah") : city(d.to);
    page(`<div class="wrap pg">
      ${backLink("#/plan")}
      <h1 class="pg__h">${esc(t("stTitle")(where))}</h1>
      <p class="pg__sub">${esc(range(d.dep, d.ret))} · ${esc(paxText(d.pax))}</p>
      <div class="bar ht-bar">
        <div class="bar__r">
          <span class="seg2">${["all", "3", "4", "5"].map((k) => `<button type="button" data-st="${k}" class="${stStars === k ? "on" : ""}">${esc(k === "all" ? t("allStars") : k + "★")}</button>`).join("")}</span>
          ${[["breakfast", "fBreakfast"], ["cancel", "fCancel"], ["pool", "fPool"]].map(([k, w]) => `<button type="button" class="fchip${stF[k] ? " on" : ""}" data-f="${k}">${esc(t(w))}</button>`).join("")}
        </div>
        <div class="bar__r"><span class="seg2">${Object.keys(t("stSort")).map((k) => `<button type="button" data-sort="${k}" class="${stSort === k ? "on" : ""}">${esc(t("stSort")[k])}</button>`).join("")}</span></div>
      </div>
      ${list.map((h) => {
        const on = stayOn && cur && cur.id === h.id, r0 = h.rooms[d.pax.c && d.pax.a >= 2 ? 2 : 0], price = stayPrice(h, on ? room : r0, nights, d.pax), rooms = roomsFor(on ? room : r0, d.pax);
        return `<article class="ht${on ? " on" : ""}">
          ${gallery(h, h.id)}
          <a class="ht__body" href="#/hotel/${encodeURIComponent(h.id)}">
            <span class="ht__top"><span class="ht__stars">${"★".repeat(h.stars)}</span>${on ? `<span class="ht__in">${esc(t("inPlan"))}</span>` : ""}</span>
            <b class="ht__t">${esc(L(h.kind))}, ${esc(L(h.area))}</b>
            <span class="ht__loc">${ico("pin")}${esc(t("walk")(h.walk, L(h.landmark)))}</span>
            ${ratingBadge(h)}
            <p class="ht__take"><span>${SUN}</span>${esc(take(h, d, cheapestId))}</p>
            <span class="ht__perks"><span class="${h.breakfast ? "" : "no"}">${esc(h.breakfast ? t("bfast") : t("noBfast"))}</span><span class="${h.freeCancel ? "" : "no"}">${esc(h.freeCancel ? t("cancelBy")(cancelDate(d)) : t("nonRef"))}</span></span>
            ${amenRow(h, 5)}
          </a>
          <div class="ht__pr">
            <small>${esc(t("forStay")(nights, rooms))}</small>
            <b>${esc(money(price))}</b>
            <span class="ht__night">${esc(t("perNight")(money(price / nights / rooms)))}</span>
            <button type="button" class="btn btn--sm ${on ? "btn--plain" : "btn--main"}" data-ht="${h.id}">${esc(on ? t("selected") : t("select"))}</button>
            <a class="link ht__more" href="#/hotel/${encodeURIComponent(h.id)}">${esc(t("viewHotel"))} →</a>
          </div>
        </article>`; }).join("") || `<p class="empty">${esc(t("noFlights").split(".")[0])}.</p>`}
      <div class="bar"><button type="button" class="link" id="noHotel">${esc(t("noHotel"))}</button><p class="note-s" style="margin:0">${esc(t("sample"))}</p></div>
    </div>`);
    wireGalleries($("#page"));
    $$("[data-ht]").forEach((b) => b.addEventListener("click", () => { const h = all.find((x) => x.id === b.dataset.ht); d.hotelId = h.id; d.tier = h.tier; d.roomId = null; d.items.stay = true; d.flightsOnly = false; saveDraft(); location.hash = "#/plan"; }));
    $$("[data-st]").forEach((b) => b.addEventListener("click", () => { stStars = b.dataset.st; viewStay(); }));
    $$("[data-f]").forEach((b) => b.addEventListener("click", () => { stF[b.dataset.f] = !stF[b.dataset.f]; viewStay(); }));
    $$(".ht-bar [data-sort]").forEach((b) => b.addEventListener("click", () => { stSort = b.dataset.sort; viewStay(); }));
    $("#noHotel").addEventListener("click", () => { d.items.stay = false; saveDraft(); location.hash = "#/plan"; });
  }

  function viewHotel(id) {
    const d = draft, all = D.hotels(d.to), h = all.find((x) => x.id === id);
    if (!h) return location.replace("#/stay");
    const { hotel: cur, room: curRoom, nights } = chosen(d);
    const inPlan = d.items.stay !== false && !d.flightsOnly && cur && cur.id === h.id;
    const cheapestId = [...all].sort((a, b) => a.rate - b.rate)[0].id;
    page(`<div class="wrap pg">
      ${backLink("#/stay")}
      <div class="hd-gal">${[0, 1, 2, 3].map((i) => `<img src="${D.hotelPhoto(h, i, i > 0)}" alt="" ${i ? 'loading="lazy"' : ""} />`).join("")}<span class="hd-gal__n">${esc(t("photosN")(4))}</span></div>
      <div class="pg__grid">
        <div>
          <span class="ht__stars">${"★".repeat(h.stars)}</span>
          <h1 class="pg__h" style="margin-top:6px">${esc(L(h.kind))}, ${esc(L(h.area))}</h1>
          <p class="ht__loc" style="margin-top:10px">${ico("pin")}${esc(t("walk")(h.walk, L(h.landmark)))}</p>
          ${ratingBadge(h)}
          <div class="box hd-take"><span class="say__mark">${SUN}</span><div><b>${esc(t("takeL"))}</b><p>${esc(take(h, d, cheapestId))}</p></div></div>
          <h2 class="hd-h">${esc(t("roomsH"))}</h2>
          ${h.rooms.map((r) => { const on = inPlan && curRoom && curRoom.id === r.id, n = roomsFor(r, d.pax), price = stayPrice(h, r, nights, d.pax); return `<div class="room${on ? " on" : ""}">
            <img src="${D.hotelPhoto(h, 1, true)}" alt="" loading="lazy" />
            <div class="room__t"><b>${esc(lang === "ar" ? r.ar : r.en)}</b>
              <span>${esc(t("m2")(r.size))} · ${esc(lang === "ar" ? r.bedAr : r.bedEn)} · ${esc(t("sleeps")(r.sleeps))}</span>
              <span class="ht__perks"><span class="${h.breakfast ? "" : "no"}">${esc(h.breakfast ? t("bfast") : t("noBfast"))}</span><span class="${h.freeCancel ? "" : "no"}">${esc(h.freeCancel ? t("cancelBy")(cancelDate(d)) : t("nonRef"))}</span></span></div>
            <div class="room__pr"><small>${esc(t("forStay")(nights, n))}</small><b>${esc(money(price))}</b><button type="button" class="btn btn--sm ${on ? "btn--plain" : "btn--main"}" data-room="${r.id}">${esc(on ? t("chosenRoom") : t("selectRoom"))}</button></div>
          </div>`; }).join("")}
          <h2 class="hd-h">${esc(t("amenH"))}</h2>
          <div class="amen amen--full">${h.amen.map((a) => `<span>${ico(a)}<em>${esc(t("amen")[a])}</em></span>`).join("")}</div>
          <h2 class="hd-h">${esc(t("policyH"))}</h2>
          <ul class="pol"><li>${esc(t("checkin"))}</li><li>${esc(t("checkout"))}</li><li>${esc(h.freeCancel ? t("cancelBy")(cancelDate(d)) : t("nonRef"))}</li><li>${esc(t("idNote"))}</li></ul>
          <p class="note-s">${esc(t("photosNote"))}</p>
        </div>
        <aside class="pg__side">${sumCard(d)}</aside>
      </div></div>`);
    $$("[data-room]").forEach((b) => b.addEventListener("click", () => { d.hotelId = h.id; d.tier = h.tier; d.roomId = b.dataset.room; d.items.stay = true; d.flightsOnly = false; saveDraft(); location.hash = "#/plan"; }));
  }

  // ---------- checkout: travelers ----------
  const NATS = ["SA", "AE", "KW", "BH", "QA", "OM", "EG", "JO", "PK", "IN", "BD", "PH", "YE", "SD", "GB", "US"];
  const kinds = (pax) => [...Array(pax.a).fill("a"), ...Array(pax.c).fill("c"), ...Array(pax.i).fill("i")];
  function sumCard(d, total) {
    const pl = buildPlan(d), dd = D.DEST[d.to];
    return `<div class="box">${dd ? `<div class="sum__img"><img src="${D.photo(d.to, true)}" alt="" style="object-position:${dd.pos}" /></div>` : ""}
      <div class="sum__t">${esc(placeName(d))}</div><div class="sum__s">${esc(range(d.dep, d.ret))} · ${esc(paxText(d.pax))}</div>
      <div class="sum__rows">${pl.items.filter((i) => i.on).map((i) => `<div><span>${esc(itemLabel(i))}</span><span>${esc(money(i.price))}</span></div>`).join("")}</div>
      <div class="sum__tot"><span>${esc(t("rTotal"))}</span><b>${esc(money(total ?? pl.total))}</b></div></div>`;
  }
  function viewTravelers() {
    const d = draft, ks = kinds(d.pax);
    co.trv = ks.map((k, i) => { const prev = (co.trv || [])[i]; return prev && prev.k === k ? prev : { k, title: "mr", first: "", last: "", dob: "", nat: "SA", doc: "" }; });
    co.contact = co.contact || { phone: user ? user.phone || "" : "", email: user ? user.email || "" : "" };
    if (co.together == null) co.together = true;
    store.set("checkout", co);
    const label = { a: t("tAdult"), c: t("tChild"), i: t("tInfant") };
    page(`<div class="wrap pg">
      ${backLink("#/plan")}${steps(1)}
      <h1 class="pg__h">${esc(t("trvTitle"))}</h1><p class="pg__sub">${esc(t("trvSub"))}</p>
      <div class="pg__grid"><form id="trvForm" novalidate>
        ${user ? (saved.length ? `<div class="box"><h2 class="box__h">${esc(t("savedPick"))}</h2><div class="saved">${saved.map((s, i) => `<button type="button" class="chip" data-saved="${i}">${esc(s.first)} ${esc(s.last)}</button>`).join("")}</div></div>` : "") : `<div class="nudge"><span>${esc(t("trvSignin"))}</span><a class="link" href="#/signin?next=travelers">${esc(t("trvSigninGo"))} →</a></div>`}
        <div class="box">${co.trv.map((x, i) => `<div class="trv" data-i="${i}">
          <div class="trv__h"><b>${esc(t("travelerN")(i + 1, label[x.k]))}</b><span class="tagname" data-tag="${i}"></span></div>
          <div class="fgrid">
            ${x.k === "a" ? `<div class="full"><span class="seg2">${["mr", "ms"].map((g) => `<button type="button" data-title="${g}" class="${x.title === g ? "on" : ""}">${esc(t(g))}</button>`).join("")}</span></div>` : ""}
            <label class="fld"><span>${esc(t("first"))}</span><input name="first" value="${esc(x.first)}" autocomplete="given-name" autocapitalize="characters" /><em>${esc(t("errName"))}</em></label>
            <label class="fld"><span>${esc(t("last"))}</span><input name="last" value="${esc(x.last)}" autocomplete="family-name" autocapitalize="characters" /><em>${esc(t("errName"))}</em></label>
            ${x.k !== "a" ? `<label class="fld"><span>${esc(t("dob"))}</span><input name="dob" type="date" value="${esc(x.dob)}" max="${todayIso()}" /><em>${esc(x.k === "c" ? t("errChildAge") : t("errInfAge"))}</em></label>` : ""}
            <label class="fld"><span>${esc(t("nat"))}</span><select name="nat">${NATS.map((c) => `<option value="${c}" ${x.nat === c ? "selected" : ""}>${esc(country(c))}</option>`).join("")}</select></label>
            <label class="fld"><span>${esc(t("doc"))}</span><input name="doc" value="${esc(x.doc)}" autocapitalize="characters" /><small>${esc(t("docHint"))}</small></label>
          </div></div>`).join("")}</div>
        <div class="box"><h2 class="box__h">${esc(t("contactH"))}</h2><div class="fgrid">
          <label class="fld" id="fPhone"><span>${esc(t("phone"))}</span><div class="phone"><b>+966</b><input name="phone" inputmode="tel" value="${esc(co.contact.phone)}" placeholder="5X XXX XXXX" autocomplete="tel-national" /></div><em>${esc(t("errPhone"))}</em></label>
          <label class="fld" id="fEmail"><span>${esc(t("email"))}</span><input name="email" type="email" inputmode="email" value="${esc(co.contact.email)}" autocomplete="email" /><em>${esc(t("errEmail"))}</em></label>
        </div>
        ${ks.length > 1 ? `<div class="row-tog"><div><b>${esc(t("together"))}</b><small>${esc(t("togetherSub"))}</small></div><button type="button" class="tog" id="together" aria-pressed="${!!co.together}"></button></div>` : ""}
        ${user ? `<label class="check" style="margin-top:16px"><input type="checkbox" id="saveTrv" ${co.save !== false ? "checked" : ""} />${esc(t("saveTrv"))}</label>` : ""}
        </div>
        <button type="submit" class="primary">${esc(t("toPay"))}</button>
      </form><aside class="pg__side">${sumCard(d)}</aside></div></div>`);

    const form = $("#trvForm");
    const tag = (i) => { const x = co.trv[i]; $(`[data-tag="${i}"]`).textContent = x.last || x.first ? `${(x.last || "").toUpperCase()}/${(x.first || "").toUpperCase()}${x.k === "a" ? " " + x.title.toUpperCase() : ""}` : ""; };
    co.trv.forEach((_, i) => tag(i));
    form.addEventListener("input", (e) => {
      const row = e.target.closest(".trv");
      if (row) { const i = +row.dataset.i; co.trv[i][e.target.name] = e.target.value; tag(i); }
      else if (e.target.name) co.contact[e.target.name] = e.target.value;
      e.target.closest(".fld")?.classList.remove("err");
      store.set("checkout", co);
    });
    form.addEventListener("click", (e) => {
      const tb = e.target.closest("[data-title]"); if (tb) { const i = +tb.closest(".trv").dataset.i; co.trv[i].title = tb.dataset.title; $$("[data-title]", tb.parentElement).forEach((b) => b.classList.toggle("on", b === tb)); tag(i); store.set("checkout", co); return; }
      const sv = e.target.closest("[data-saved]");
      if (sv) {
        const s = saved[+sv.dataset.saved];
        let j = co.trv.findIndex((x) => !x.first && x.k === (s.kind || "a")); if (j < 0) j = co.trv.findIndex((x) => !x.first);
        if (j >= 0) { co.trv[j] = { ...co.trv[j], title: s.title || "mr", first: s.first, last: s.last, dob: s.dob || "", nat: s.nat || "SA", doc: s.doc || "" }; store.set("checkout", co); viewTravelers(); }
        return;
      }
      if (e.target.id === "together") { co.together = !co.together; e.target.setAttribute("aria-pressed", co.together); store.set("checkout", co); }
    });
    $("#saveTrv")?.addEventListener("change", (e) => { co.save = e.target.checked; store.set("checkout", co); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let firstBad = null;
      const bad = (el) => { el.classList.add("err"); firstBad = firstBad || el; };
      const latin = /^[A-Za-z][A-Za-z' -]*$/;
      co.trv.forEach((x, i) => {
        const row = $(`.trv[data-i="${i}"]`);
        if (!latin.test(x.first.trim())) bad($('[name="first"]', row).closest(".fld"));
        if (!latin.test(x.last.trim())) bad($('[name="last"]', row).closest(".fld"));
        if (x.k !== "a") {
          const age = x.dob ? (new Date(d.dep) - new Date(x.dob)) / (365.25 * 864e5) : -1;
          if (x.k === "c" ? age < 2 || age >= 12 : age < 0 || age >= 2) bad($('[name="dob"]', row).closest(".fld"));
        }
      });
      const ph = String(co.contact.phone || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
      if (!/^5\d{8}$/.test(ph)) bad($("#fPhone")); else co.contact.phone = ph;
      if (co.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(co.contact.email)) bad($("#fEmail"));
      store.set("checkout", co);
      if (firstBad) { firstBad.scrollIntoView({ behavior: "smooth", block: "center" }); $("input,select", firstBad)?.focus({ preventScroll: true }); return; }
      location.hash = "#/pay";
    });
  }

  // ---------- checkout: pay ----------
  function viewPay(heldRef) {
    const held = heldRef ? trips.find((x) => x.ref === heldRef) : null;
    if (heldRef && (!held || held.status !== "held")) return location.replace(held ? `#/trip/${held.ref}` : "#/trips");
    if (!held && (!co.trv || !co.contact || !/^5\d{8}$/.test(co.contact.phone || ""))) return location.replace("#/travelers");
    const pl = held ? held.plan : buildPlan(draft), total = held ? held.total : pl.total;
    const holdIso = held ? null : D.holdUntil(pl.out, draft.dep);
    if (!co.method || (co.method === "hold" && (!holdIso || held))) co.method = "apple";
    const people = held ? held.travelers : co.trv, contact = held ? held.contact : co.contact;
    const names = people.map((x) => `${x.first} ${x.last}`.trim()).join(", ");
    const m = (k, b, small, badge, dis) => `<label class="${co.method === k ? "on" : ""}${dis ? " dis" : ""}"><input type="radio" name="pm" value="${k}" ${co.method === k ? "checked" : ""} ${dis ? "disabled" : ""} /><div><b>${esc(b)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>${badge ? `<i>${esc(badge)}</i>` : "<span></span>"}</label>`;
    page(`<div class="wrap pg">
      ${backLink(held ? `#/trip/${held.ref}` : "#/travelers")}${held ? "" : steps(2)}
      <h1 class="pg__h">${esc(t("payTitle"))}</h1>
      <div class="pg__grid"><form id="payForm" novalidate>
        <div class="box"><h2 class="box__h">${esc(t("whoGoing"))}</h2><p style="margin:0">${esc(names)}</p><p class="note-s">${esc(t("contact"))}: +966 ${esc(contact.phone)}${contact.email ? " · " + esc(contact.email) : ""}</p></div>
        <div class="box"><h2 class="box__h">${esc(t("payHow"))}</h2><div class="pm" id="pm">
          ${m("apple", t("applePay"), "", "Pay")}
          ${m("mada", t("mada"), "", "mada")}
          ${m("card", t("card"), "", "VISA · MC")}
          ${m("tabby", t("tabby"), t("tabbySub")(money(total / 4)), "4×")}
          ${m("tamara", t("tamara"), t("tamaraSub")(money(total / 3)), "3×")}
          ${held ? "" : m("hold", t("holdH"), holdIso ? t("holdSub")(when(holdIso)) : t("holdNo"), "", !holdIso)}
        </div>
        <div id="cardFields"></div>
        <p class="note-s">${esc(t("terms"))}</p>
        <p class="note-s">${esc(t("preview"))}</p></div>
        <button type="submit" class="primary" id="payBtn"></button>
      </form><aside class="pg__side">${held ? `<div class="box"><div class="sum__t">${esc(placeName(held))}</div><div class="sum__s">${esc(range(held.dep, held.ret))}</div><div class="sum__tot"><span>${esc(t("rTotal"))}</span><b>${esc(money(total))}</b></div></div>` : sumCard(draft, total)}</aside></div></div>`);
    const sync = () => {
      $$("#pm label").forEach((l) => l.classList.toggle("on", $("input", l).checked));
      const card = co.method === "mada" || co.method === "card";
      $("#cardFields").innerHTML = card ? `<div class="cardf"><label class="fld full" id="fCard"><span>${esc(t("cardNo"))}</span><input name="cno" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" /><em>${esc(t("errCard"))}</em></label><label class="fld"><span>${esc(t("exp"))}</span><input name="cexp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" /></label><label class="fld"><span>${esc(t("cvc"))}</span><input name="ccvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" /></label><label class="fld wide"><span>${esc(t("nameOnCard"))}</span><input name="cname" autocomplete="cc-name" /></label></div>` : "";
      $("#payBtn").textContent = co.method === "hold" ? t("holdBtn")(when(holdIso)) : t("payBtn")(money(total));
    };
    sync();
    $("#pm").addEventListener("change", (e) => { co.method = e.target.value; store.set("checkout", co); sync(); });
    $("#payForm").addEventListener("input", (e) => e.target.closest(".fld")?.classList.remove("err"));
    $("#payForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if (co.method === "mada" || co.method === "card") {
        const no = ($('[name="cno"]').value || "").replace(/\D/g, ""), exp = $('[name="cexp"]').value.trim(), cvc = $('[name="ccvc"]').value.trim();
        if (no.length < 15 || !/^\d{2}\/?\d{2}$/.test(exp) || !/^\d{3,4}$/.test(cvc)) { $("#fCard").classList.add("err"); $("#fCard input").focus(); return; }
      }
      busyOn(t("processing"));
      setTimeout(() => {
        busyOff();
        if (held) { held.status = "confirmed"; held.method = co.method; delete held.heldUntil; saveTrips(); co = {}; store.set("checkout", null); location.hash = `#/trip/${held.ref}`; return; }
        location.hash = `#/trip/${makeTrip(co.method === "hold" ? holdIso : null)}`;
      }, reduce ? 200 : 1600);
    });
  }
  function makeTrip(heldUntil) {
    const d = draft, pl = buildPlan(d), out = pl.out;
    const ref = "M" + Math.random().toString(36).slice(2, 7).toUpperCase();
    trips.push({
      ref, status: heldUntil ? "held" : "confirmed", heldUntil, created: new Date().toISOString(),
      from: d.from, to: d.to, dep: d.dep, ret: d.ret, pax: d.pax, umrah: d.umrah,
      flightNo: out ? out.no : null, depTime: out ? D.hm(out.dep) : null, backNo: pl.back ? pl.back.no : null, backTime: pl.back ? D.hm(pl.back.dep) : null,
      plan: { items: pl.items.map(({ k, icon, title, sub, price, on, info }) => ({ k, icon, title, sub, price, on, info })) }, total: pl.total,
      travelers: co.trv.map(({ k, title, first, last, dob, nat, doc }) => ({ k, title, first, last, dob, nat, doc })), contact: co.contact, method: co.method,
    });
    saveTrips();
    if (user && co.save !== false) {
      for (const x of co.trv) if (!saved.some((s) => s.first === x.first && s.last === x.last)) saved.push({ kind: x.k, title: x.title, first: x.first, last: x.last, dob: x.dob, nat: x.nat, doc: x.doc });
      store.set("travelers", saved);
    }
    draft = null; store.set("draft", null); co = {}; store.set("checkout", null); tab = "chat";
    return ref;
  }

  // ---------- trip ----------
  function viewTrip(ref) {
    const x = trips.find((y) => y.ref === ref);
    if (!x) return location.replace("#/trips");
    if (x.status === "held" && new Date(x.heldUntil) < new Date()) { x.status = "expired"; saveTrips(); }
    const held = x.status === "held", dd = D.DEST[x.to], st = t("st");
    page(`<div class="wrap pg">
      ${backLink("#/trips", t("tripsTitle"))}
      <span class="status${held ? " held" : ""}">${esc(held ? t("heldS") : t("confirmed"))}</span>
      <h1 class="pg__h" style="margin-top:12px">${esc(t("tripTo")(x.umrah ? (lang === "ar" ? "مكة" : "Makkah") : city(x.to)))}</h1>
      <p class="pg__sub">${esc(t("refL"))} <span class="ref">${esc(x.ref)}</span></p>
      <div class="trip-hero">${dd ? `<img src="${D.photo(x.to)}" alt="" style="object-position:${dd.pos}" />` : ""}<b>${x.from} → ${x.to}</b><span>${esc(range(x.dep, x.ret))} · ${esc(paxText(x.pax))}${x.flightNo ? ` · ${esc(x.flightNo)} ${esc(x.depTime)}` : ""}</span></div>
      <div class="pg__grid">
        <div>
          <div class="box"><p style="margin:0">${esc(held ? t("heldNote")(when(x.heldUntil)) : t("sentTo")("+966 " + x.contact.phone + (x.contact.email ? ", " + x.contact.email : "")))}</p>
            ${held ? `<a class="primary primary--link" href="#/pay/${x.ref}">${esc(t("payNow")(money(x.total)))}</a>` : ""}</div>
          <div class="box"><h2 class="box__h">${esc(t("itemsH"))}</h2><div class="st-rows">${x.plan.items.filter((i) => i.on || i.info).map((i) => `<div>${ico(i.icon)}<span><b class="st-t">${esc(i.title)}</b><small class="dim">${esc(i.sub)}</small></span><em class="${held && i.k === "flight" ? "held" : ""}">${esc(i.k === "flight" ? (held ? st.flightH : st.flight) : st[i.k] || "")}</em></div>`).join("")}</div></div>
          <div class="box"><h2 class="box__h">${esc(t("next"))}</h2><ol class="tl">
            <li class="done">${esc(held ? t("n1h") : t("n1"))}</li><li class="${held ? "" : "done"}">${esc(t("n2"))}</li><li>${esc(t("n3"))}</li>${x.plan.items.some((i) => i.k === "esim" && i.on) ? `<li>${esc(t("n4"))}</li>` : ""}<li>${esc(t("n5"))}</li></ol></div>
        </div>
        <aside class="pg__side">
          <div class="box"><h2 class="box__h">${esc(t("advIntro"))}</h2><p class="note-s" style="margin-top:0">${esc(t("advLine"))}</p>
            <div class="actions" style="margin-top:14px">
              <a class="btn btn--main" href="${wa(t("waHi")(x.ref))}" target="_blank" rel="noopener">${esc(t("msgAdv"))}</a>
              <button type="button" class="btn btn--plain" id="ics">${esc(t("addCal"))}</button>
              <a class="btn btn--plain" href="${wa(t("waChange")(x.ref))}" target="_blank" rel="noopener">${esc(t("reqChange"))}</a>
              <a class="btn btn--plain" href="${wa(t("waCancel")(x.ref))}" target="_blank" rel="noopener">${esc(t("reqCancel"))}</a>
            </div></div>
          <div class="box"><div class="sum__rows" style="margin:0">${x.plan.items.filter((i) => i.on).map((i) => `<div><span>${esc(itemLabel(i))}</span><span>${esc(money(i.price))}</span></div>`).join("")}</div><div class="sum__tot"><span>${esc(t("rTotal"))}</span><b>${esc(money(x.total))}</b></div></div>
        </aside>
      </div></div>`);
    $("#ics").addEventListener("click", () => downloadIcs(x));
  }
  function downloadIcs(x) {
    const stamp = (iso, time) => iso.replace(/-/g, "") + "T" + (time || "09:00").replace(":", "") + "00";
    const ev = (uid, d, time, title) => `BEGIN:VEVENT\r\nUID:${uid}@madatrips.sa\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\r\nDTSTART:${stamp(d, time)}\r\nDURATION:PT2H\r\nSUMMARY:${title}\r\nDESCRIPTION:Mada Trips booking ${x.ref}\r\nEND:VEVENT\r\n`;
    let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mada Trips//Book//EN\r\n";
    ics += ev(x.ref + "-out", x.dep, x.depTime, `${x.flightNo || "Flight"} ${x.from} - ${x.to}`);
    if (x.ret) ics += ev(x.ref + "-back", x.ret, x.backTime, `${x.backNo || "Flight"} ${x.to} - ${x.from}`);
    ics += "END:VCALENDAR\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = `mada-${x.ref}.ics`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- trips ----------
  function viewTrips() {
    const up = upcoming(), past = trips.filter((x) => !up.includes(x)).sort((a, b) => (a.dep > b.dep ? -1 : 1));
    const badge = (x) => (x.status === "held" ? `<em class="status held">${esc(t("heldS"))}</em>` : x.status === "expired" ? `<em class="status off">—</em>` : `<em class="status">${esc(t("confirmed"))}</em>`);
    const card = (x) => `<a class="tcard" href="#/trip/${x.ref}">${D.DEST[x.to] ? `<img src="${D.photo(x.to, true)}" alt="" />` : `<span class="tcard__ph"></span>`}<div><b>${esc(placeName(x))}</b><span>${esc(range(x.dep, x.ret))} · ${esc(paxText(x.pax))}</span></div><span>${badge(x)}</span></a>`;
    page(`<div class="wrap pg">
      <h1 class="pg__h">${esc(t("tripsTitle"))}</h1>
      ${!user ? `<div class="nudge" style="margin-top:20px"><span>${esc(t("tripsSignin"))}</span><a class="link" href="#/signin?next=trips">${esc(t("signIn"))} →</a></div>` : ""}
      ${trips.length ? `<div class="tlist">${up.map(card).join("")}</div>${past.length ? `<div class="bar"><h2>${esc(t("past"))}</h2></div><div class="tlist tlist--past">${past.map(card).join("")}</div>` : ""}`
        : `<div class="empty"><p>${esc(t("tripsNone"))}</p><a class="btn btn--main" href="#/">${esc(t("tripsPlan"))}</a></div>`}
    </div>`);
  }

  // ---------- sign in ----------
  let si = { step: "phone", phone: "" };
  function viewSignin() {
    const next = (location.hash.split("?next=")[1] || "").replace(/[^a-z/]/g, "");
    const done = () => { si = { step: "phone", phone: "" }; renderHeader(); location.hash = next ? `#/${next}` : "#/"; };
    let body = "";
    if (si.step === "phone") body = `<form id="si" novalidate><label class="fld" id="fSi"><span>${esc(t("siPhone"))}</span><div class="phone"><b>+966</b><input name="phone" inputmode="tel" placeholder="5X XXX XXXX" autocomplete="tel-national" value="${esc(si.phone)}" /></div><em>${esc(t("errPhone"))}</em></label><button class="primary">${esc(t("siSend"))}</button></form>
      <div class="or">${esc(t("orL"))}</div><div class="sso"><button type="button" data-sso="Apple">${esc(t("apple"))}</button><button type="button" data-sso="Google">${esc(t("google"))}</button></div>`;
    else if (si.step === "code") body = `<p class="pg__sub">${esc(t("siCode")("+966 " + si.phone))}</p><form id="si" novalidate><div class="otp">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" maxlength="1" data-o="${i}" aria-label="${i + 1}" />`).join("")}</div><p class="note-s" style="text-align:center">${esc(t("siCodeHint"))}</p><button class="primary">${esc(t("siVerify"))}</button></form><p style="text-align:center"><button type="button" class="link" id="resend">${esc(t("siResend"))}</button></p>`;
    else body = `<form id="si" novalidate><label class="fld"><span>${esc(t("siNameL"))}</span><input name="name" autocomplete="given-name" /></label><button class="primary">${esc(t("siDone"))}</button></form>`;
    page(`<div class="auth"><h1 class="pg__h">${esc(si.step === "name" ? t("siName") : t("siTitle"))}</h1>${si.step === "phone" ? `<p class="pg__sub">${esc(t("siSub"))}</p>` : ""}${body}</div>`);
    const f = $("#si");
    if (si.step === "code") {
      const os = $$("[data-o]"); os[0].focus();
      os.forEach((o, i) => {
        o.addEventListener("input", () => { o.value = o.value.replace(/\D/g, "").slice(-1); if (o.value && os[i + 1]) os[i + 1].focus(); if (os.every((x) => x.value)) f.requestSubmit(); });
        o.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !o.value && os[i - 1]) os[i - 1].focus(); });
      });
      $("#resend").addEventListener("click", () => toast("✓"));
    } else $("input", f)?.focus();
    $$("[data-sso]").forEach((b) => b.addEventListener("click", () => { si = { step: "name", phone: "" }; viewSignin(); }));
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      if (si.step === "phone") { const ph = $('[name="phone"]').value.replace(/\D/g, "").replace(/^966/, "").replace(/^0/, ""); if (!/^5\d{8}$/.test(ph)) { $("#fSi").classList.add("err"); return; } si = { step: "code", phone: ph }; return viewSignin(); }
      if (si.step === "code") { if ($$("[data-o]").some((x) => !x.value)) return; const known = store.get("known") || {}; if (known[si.phone]) { user = known[si.phone]; store.set("user", user); return done(); } si.step = "name"; return viewSignin(); }
      const name = $('[name="name"]').value.trim(); if (!name) return;
      user = { name, phone: si.phone, email: "" }; store.set("user", user);
      if (si.phone) { const known = store.get("known") || {}; known[si.phone] = user; store.set("known", known); }
      done();
    });
  }

  // ---------- account ----------
  function viewAccount() {
    page(`<div class="wrap pg pg--narrow">
      <h1 class="pg__h">${esc(t("acTitle"))}</h1>
      <form class="box" id="acForm" style="margin-top:24px"><h2 class="box__h">${esc(t("acProfile"))}</h2><div class="fgrid">
        <label class="fld"><span>${esc(t("siNameL"))}</span><input name="name" value="${esc(user.name)}" /></label>
        <label class="fld"><span>${esc(t("email"))}</span><input name="email" type="email" value="${esc(user.email || "")}" /></label>
        <label class="fld"><span>${esc(t("siPhone"))}</span><input value="${user.phone ? "+966 " + esc(user.phone) : "—"}" disabled /></label>
        <label class="fld"><span>${esc(t("acLang"))}</span><select name="lang"><option value="en" ${lang === "en" ? "selected" : ""}>English</option><option value="ar" ${lang === "ar" ? "selected" : ""}>العربية</option></select></label>
      </div><button class="btn btn--main" style="margin-top:16px">${esc(t("acSave"))}</button></form>
      <div class="box"><h2 class="box__h">${esc(t("acTravelers"))}</h2>${saved.length ? `<div class="st-rows">${saved.map((s, i) => `<div>${ico("ppl")}<span>${esc(s.first)} ${esc(s.last)} <small class="dim">· ${esc(country(s.nat || "SA"))}</small></span><button type="button" class="link" data-rm="${i}">${esc(t("acRemove"))}</button></div>`).join("")}</div>` : `<p class="note-s" style="margin:0">${esc(t("acNone"))}</p>`}</div>
      <button type="button" class="btn btn--plain" id="acOut" style="margin-top:16px">${esc(t("signOut"))}</button>
    </div>`);
    $("#acForm").addEventListener("submit", (e) => { e.preventDefault(); user.name = $('[name="name"]').value.trim() || user.name; user.email = $('[name="email"]').value.trim(); store.set("user", user); const l = $('[name="lang"]').value; if (l !== lang) { lang = l; store.set("lang", lang); } render(); toast("✓"); });
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { saved.splice(+b.dataset.rm, 1); store.set("travelers", saved); viewAccount(); }));
    $("#acOut").addEventListener("click", signOut);
  }
  function signOut() { user = null; store.set("user", null); location.hash = "#/"; render(); }

  // ---------- popovers on the plan: dates, travelers, origin ----------
  let open = null, calMonth = null, calMode = "ret", popChanged = false, popFromChat = false;
  function openPop(kind, anchor) {
    if (!draft) return;
    open = kind;
    if (kind === "when") { calMonth = (draft.dep || todayIso()).slice(0, 7); calMode = draft.dep && !draft.ret ? "one" : "ret"; }
    $("#pop").hidden = false; drawPop();
    const card = $("#popCard"), r = anchor.getBoundingClientRect(), w = card.offsetWidth;
    let x = lang === "ar" ? r.right - w : r.left; x = Math.max(12, Math.min(x, innerWidth - w - 12));
    let y = r.bottom + 8; if (y + card.offsetHeight > innerHeight - 12) y = Math.max(12, r.top - card.offsetHeight - 8);
    card.style.left = x + "px"; card.style.top = y + "px";
  }
  function closePop() { open = null; const p = $("#pop"); if (p) p.hidden = true; }
  function drawPop() {
    const card = $("#popCard"), d = draft, today = todayIso();
    if (open === "who") {
      const p = d.pax, room = 9 - p.a - p.c;
      const row = (k, key, sub, v, min, max) => `<div class="who__row"><div><b>${esc(t(key))}</b><small>${esc(t(sub))}</small></div><div class="step"><button type="button" data-step="${k}" data-d="-1" ${v <= min ? "disabled" : ""} aria-label="−">−</button><output>${v}</output><button type="button" data-step="${k}" data-d="1" ${v >= max ? "disabled" : ""} aria-label="+">+</button></div></div>`;
      card.innerHTML = `<div class="who"><div class="pop__h"><b>${esc(t("whoTitle"))}</b></div>${row("a", "adultsK", "adultsS", p.a, 1, p.a + room)}${row("c", "childrenK", "childrenS", p.c, 0, p.c + room)}${row("i", "babiesK", "babiesS", p.i, 0, p.a)}<div class="pop__foot"><span></span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div></div>`;
    } else if (open === "from") {
      card.innerHTML = `<div class="from"><div class="pop__h"><b>${esc(t("fromTitle"))}</b></div>${["RUH", "JED", "DMM", "MED", "AHB", "TUU", "ULH", "GIZ", "TIF"].filter((c) => c !== d.to).map((c) => `<button type="button" data-from="${c}" class="${c === d.from ? "on" : ""}">${esc(city(c))}<span>${c}</span></button>`).join("")}</div>`;
    } else if (open === "when") {
      const nextM = (() => { const [y, m] = calMonth.split("-").map(Number); return D.iso(new Date(y, m, 1, 12)).slice(0, 7); })();
      const dows = [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(loc(), { weekday: "narrow" }).format(new Date(2024, 0, 7 + i, 12)));
      const short = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
      const html = [calMonth, nextM].map((ym) => {
        const [y, m] = ym.split("-").map(Number), first = new Date(y, m - 1, 1, 12), days = new Date(y, m, 0).getDate();
        const prices = []; for (let i = 1; i <= days; i++) { const iso = D.iso(new Date(y, m - 1, i, 12)); const q = d.to && iso >= today ? D.quote(d.from, d.to, iso, d.pax) : null; prices.push(q ? q.total : null); }
        const vals = prices.filter(Boolean).sort((a, b) => a - b), low = vals[Math.floor(vals.length * 0.25)] || 0;
        let g = dows.map((w) => `<span class="cal__dow">${w}</span>`).join("") + "<span></span>".repeat(first.getDay());
        for (let i = 1; i <= days; i++) {
          const iso = D.iso(new Date(y, m - 1, i, 12)), p = prices[i - 1];
          const cls = [iso < today ? "off" : "", iso === d.dep || iso === d.ret ? "sel" : "", d.dep && d.ret && iso > d.dep && iso < d.ret ? "in" : "", p && p <= low ? "low" : ""].join(" ");
          g += `<button type="button" class="cal__d ${cls}" data-day="${iso}" ${iso < today ? "disabled" : ""}>${i}${p ? `<small>${short(p)}</small>` : ""}</button>`;
        }
        return `<div class="cal__m"><b>${esc(new Intl.DateTimeFormat(loc(), { month: "long", year: "numeric" }).format(first))}</b><div class="cal__g">${g}</div></div>`;
      }).join("");
      card.innerHTML = `<div class="pop__h"><b>${esc(t("calTitle"))}</b><span class="seg2"><button type="button" data-mode="one" class="${calMode === "one" ? "on" : ""}">${esc(t("oneWay"))}</button><button type="button" data-mode="ret" class="${calMode === "ret" ? "on" : ""}">${esc(t("returnL"))}</button></span><span class="step"><button type="button" data-month="-1" aria-label="Previous month" ${calMonth <= today.slice(0, 7) ? "disabled" : ""}>‹</button><button type="button" data-month="1" aria-label="Next month">›</button></span></div><div class="cal">${html}</div><div class="pop__foot"><span>${esc(d.to ? t("calNote")(paxText(d.pax)) : "")}</span><button type="button" class="pop__done" data-close>${esc(t("done"))}</button></div>`;
    }
  }
  function onPop(e) {
    const b = e.target.closest("button"), d = draft;
    if (!b) { if (e.target === $("#pop")) finishPop(); return; }
    if (b.dataset.close != null) return finishPop();
    if (b.dataset.step) { const p = { ...d.pax }; p[b.dataset.step] += +b.dataset.d; p.i = Math.min(p.i, p.a); d.pax = p; store.set("pax", p); popChanged = true; drawPop(); afterPlanEdit(); return; }
    if (b.dataset.from) { d.from = from = b.dataset.from; store.set("from", from); d.outId = d.backId = null; popChanged = true; finishPop(); return; }
    if (b.dataset.mode) { calMode = b.dataset.mode; if (calMode === "one" && d.dep) { d.ret = null; popChanged = true; afterPlanEdit(); } drawPop(); return; }
    if (b.dataset.month) { const [y, m] = calMonth.split("-").map(Number); calMonth = D.iso(new Date(y, m - 1 + +b.dataset.month, 1, 12)).slice(0, 7); drawPop(); return; }
    if (b.dataset.day) {
      const v = b.dataset.day; popChanged = true; d.outId = d.backId = null; d.backPicked = false;
      if (calMode === "ret" && d.dep && !d.ret && v > d.dep) { d.ret = v; drawPop(); afterPlanEdit(); setTimeout(finishPop, 260); }
      else { d.dep = v; d.ret = null; drawPop(); if (calMode === "one") { afterPlanEdit(); setTimeout(finishPop, 260); } }
    }
  }
  function afterPlanEdit() { saveDraft(); if (draft.plan && route().name === "plan") { renderPlanPane(true); renderThread(false); } }
  // Dates picked from a chat chip go back to Mada as an answer, so the plan follows from the conversation.
  function finishPop() {
    const was = open; if (!was) return; closePop();
    if (!popChanged) return; popChanged = false;
    if (popFromChat && was === "when" && draft.dep) { popFromChat = false; return send(range(draft.dep, draft.ret), true); }
    afterPlanEdit();
  }

  // ---------- small things ----------
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("is-on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("is-on"), 2400); }
  function busyOn(text) { $("#busyText").textContent = text; $("#busy").hidden = false; }
  function busyOff() { $("#busy").hidden = true; }
  const grow = () => { const q = $("#q"); q.style.height = "auto"; q.style.height = q.scrollHeight + "px"; };
  let phTimer;
  function typePlaceholder() {
    clearTimeout(phTimer);
    const input = $("#q"), ex = t(route().name === "plan" && draft && draft.msgs.length ? "ph2" : "ph");
    if (reduce) { input.placeholder = ex[0]; return; }
    let i = 0, n = 0, del = false;
    const tick = () => { const s = ex[i]; n += del ? -1 : 1; input.placeholder = s.slice(0, n); let w = del ? 16 : 48; if (!del && n >= s.length) { del = true; w = 2600; } else if (del && n <= 0) { del = false; i = (i + 1) % ex.length; w = 400; } phTimer = setTimeout(tick, w); };
    tick();
  }
  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#mic"); if (!SR) return;
    mic.hidden = false; let rec = null;
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = lang === "ar" ? "ar-SA" : "en-US"; rec.interimResults = true; mic.classList.add("is-live");
      rec.onresult = (e) => { const txt = [...e.results].map((r) => r[0].transcript).join(" "); $("#q").value = txt; grow(); if (e.results[e.results.length - 1].isFinal) { $("#q").value = ""; grow(); startOrSend(txt); } };
      rec.onend = () => { mic.classList.remove("is-live"); rec = null; };
      rec.start();
    });
  }
  // From home, a new message starts a new plan; inside the studio it continues the current one.
  function startOrSend(text) { if (route().name !== "plan" && (!draft || draft.plan)) draft = freshDraft(); send(text); }

  // Preview only: switch between a first-time visitor and a returning traveler with one upcoming trip.
  function demo(as) {
    for (const k of ["user", "trips", "travelers", "draft", "checkout", "watch", "known"]) store.set(k, null);
    user = null; trips = []; saved = []; draft = null; co = {};
    if (as === "back") {
      user = { name: lang === "ar" ? "فيصل" : "Faisal", phone: "512345678", email: "faisal@example.com" }; store.set("user", user);
      const dep = addDays(todayIso(), 5), ret = addDays(todayIso(), 8), pax = { a: 2, c: 0, i: 0 };
      const opt = pick(D.options("RUH", "DXB", dep, pax)), back = pick(D.options("DXB", "RUH", ret, pax)), h = D.hotels("DXB")[2];
      const items = [
        { k: "flight", icon: "flights", title: `${D.AIRLINES[opt.al].name} ${opt.no}`, sub: `${D.hm(opt.dep)} → ${D.hm(opt.arr)} · ${t("direct")}`, price: opt.total + back.total, on: true },
        { k: "stay", icon: "stays", title: t("stay")(h.stars, h.area[lang === "ar" ? 1 : 0], 3), sub: t("rooms")(1, paxText(pax)), price: h.rate * 3, on: true },
        { k: "pickup", icon: "pickup", title: t("pickup"), sub: t("pickupSub"), price: D.PICKUP.DXB, on: true },
        { k: "visa", icon: "visa", title: t("visa"), sub: t("visaNo"), price: null, info: true },
      ];
      trips = [{ ref: "M7Q2KD", status: "confirmed", created: new Date().toISOString(), from: "RUH", to: "DXB", dep, ret, pax, flightNo: opt.no, depTime: D.hm(opt.dep), backNo: back.no, backTime: D.hm(back.dep), seat: "14A", plan: { items }, total: items.reduce((s, i) => s + (i.on ? i.price : 0), 0), travelers: [{ k: "a", title: "mr", first: "FAISAL", last: "ALOTAIBI", nat: "SA" }, { k: "a", title: "ms", first: "NOURA", last: "ALOTAIBI", nat: "SA" }], contact: { phone: user.phone, email: user.email }, method: "apple" }];
      saved = trips[0].travelers.map((x) => ({ kind: "a", ...x }));
      store.set("trips", trips); store.set("travelers", saved); store.set("watch", { to: "IST", drop: 210 }); store.set("pax", pax);
    } else store.set("pax", null);
    if (location.hash === "#/" || location.hash === "") render(); else location.hash = "#/";
  }

  // ---------- wire ----------
  function onAction(b) {
    const a = b.dataset.a, v = b.dataset.v;
    if (a === "say") return route().name === "plan" ? send(v) : startOrSend(v);
    if (a === "open") return (location.hash = "#/plan");
    if (a === "tab") return setTab(v);
    if (a === "go" || a === "goWk") {
      if (!draft || (draft.plan && route().name !== "plan")) draft = freshDraft();
      const d = draft;
      if (d.to !== v) { d.to = v; d.umrah = false; d.tier = 1; d.items = {}; d.flightsOnly = false; d.outId = d.backId = d.hotelId = null; d.backPicked = false; d.plan = false; }
      if (a === "goWk") { const w = weekend(); d.dep = w.dep; d.ret = w.ret; return send(`${city(v)}, ${range(w.dep, w.ret)}`, true); }
      return send(city(v), true);
    }
    if (a === "wk") { const w = weekend(+v); draft.dep = w.dep; draft.ret = w.ret; return send(range(w.dep, w.ret), true); }
    if (a === "in2") { const x = addDays(todayIso(), 14); draft.dep = x; draft.ret = addDays(x, 3); return send(range(draft.dep, draft.ret), true); }
    if (a === "cal") { popFromChat = true; return openPop("when", b); }
    if (a === "pp") {
      const to = draft.visa.to, c = country(D.byCode[to].country), saudi = +v === 0, gcc = D.GCC.has(D.byCode[to].country);
      you(b.textContent); say(esc(saudi && gcc ? t("visaFree")(c) : t("visaDo")(c)), saudi && gcc ? chips([{ a: "go", v: to, l: city(to) }]) : "");
      draft.visa = null; saveDraft(); renderThread(false); return;
    }
    if (a === "share") { const pl = buildPlan(draft); window.open("https://wa.me/?text=" + encodeURIComponent(t("shareText")(placeName(draft), range(draft.dep, draft.ret), paxText(draft.pax), money(pl.total)) + " " + location.origin + "/book"), "_blank", "noopener"); return; }
    if (a === "addEsim") { const x = trips.find((y) => y.ref === v), cc = D.byCode[x.to].country, people = x.pax.a + x.pax.c; x.plan.items.push({ k: "esim", icon: "esim", title: t("esim")(country(cc)), sub: t("esimSub"), price: D.ESIM[cc] * people, on: true }); x.total += D.ESIM[cc] * people; saveTrips(); toast("✓ " + t("esim")(country(cc))); renderMine(); }
  }

  function init() {
    const q = $("#q");
    q.addEventListener("input", grow);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ask").requestSubmit(); } });
    $("#ask").addEventListener("submit", (e) => { e.preventDefault(); const v = q.value; if (!v.trim()) return q.focus(); q.value = ""; grow(); startOrSend(v); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#acctWrap")) $("#acctMenu").hidden = true;
      const tool = e.target.closest("[data-tool]"); if (tool) { q.value = t("starts")[tool.dataset.tool]; grow(); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
      const tg = e.target.closest("[data-tog]"); if (tg && draft) { const k = tg.dataset.tog, on = tg.getAttribute("aria-pressed") === "true"; if (k === "flight" || !on) draft.flightsOnly = false; draft.items[k] = !on; if (k === "flight" && !on) draft.items.flight = true; afterPlanEdit(); return; }
      const pp = e.target.closest(".plan [data-pop]"); if (pp) { popFromChat = false; return openPop(pp.dataset.pop, pp); }
      const tb = e.target.closest("#tabs [data-tab]"); if (tb) return setTab(tb.dataset.tab);
      const b = e.target.closest("[data-a]"); if (b && !b.closest("#pop")) return onAction(b);
    });
    $("#pop").addEventListener("click", onPop);
    addEventListener("keydown", (e) => { if (e.key === "Escape") { finishPop(); $("#acctMenu").hidden = true; } });
    $("#track").addEventListener("scroll", railArrows, { passive: true });
    $$(".rail__arrow").forEach((b) => b.addEventListener("click", () => { const tr = $("#track"); tr.scrollBy({ left: +b.dataset.dir * (lang === "ar" ? -1 : 1) * tr.clientWidth * 0.8, behavior: "smooth" }); }));
    $("#langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("lang", lang); render(); });
    $("#acct").addEventListener("click", () => { if (!user) { location.hash = "#/signin"; return; } $("#acctMenu").hidden = !$("#acctMenu").hidden; });
    $("#signOut").addEventListener("click", signOut);
    $("#newTrip").addEventListener("click", () => { draft = null; store.set("draft", null); tab = "chat"; location.hash = "#/"; });
    $$(".demo button").forEach((b) => b.addEventListener("click", () => demo(b.dataset.as)));
    addEventListener("hashchange", render);
    setupMic(); render();
    if (params.get("q")) startOrSend(params.get("q"));
  }
  document.addEventListener("DOMContentLoaded", init);
})();
