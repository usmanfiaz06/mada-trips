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
  const D = window.MadaData, P = window.MadaParse, W = window.MadaWords, A = window.MadaAPI;
  // Live: the Core API is next to us (the platform serves /book), so answers, prices and bookings are real and the same
  // as the app's. Otherwise the page runs on its preview data (js/book-data.js).
  let LIVE = false;
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
    phone: '<path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a2 2 0 0 1-2.1 2A16.4 16.4 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1z"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.8"/>',
    view: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 15l4.5-4 3.5 3 3-2.5 6 4.5"/>',
    cup: '<path d="M5 9h12v4a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H16.5M8 3.5v2.5M12 3.5v2.5"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    access: '<circle cx="12" cy="4.8" r="1.8"/><path d="M6 8.5l6 1 6-1M12 9.5v4.5l-3 6M12 14l3 6"/>',
    smoke: '<path d="M3 15h13v3H3zM18 15v3M21 15v3M18 12c0-2 2-2 2-4M21 12c0-2-1.5-3-1.5-5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
  };
  const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[k] || ""}</svg>`;
  const SUN = '<svg viewBox="0 0 132 89"><path d="M73.3 0 68.4 41.7a17 17 0 0 0-4.5 0L59 0zM74.1 43.4a17 17 0 0 1 4.2 2.8l25.4-23.5-10.2-8.5zM114.3 35.4 81.8 50.4c.6 1.1 1.2 2.2 1.6 3.4l37.7-6.4zM84.4 60.2l47.9 9.3-4.8-11.4-43.2.5zM58.2 43.4a17 17 0 0 0-4.2 2.8L28.6 22.7l10.2-8.5zM18.1 35.4l32.4 15c-.6 1.1-1.2 2.2-1.6 3.4L11.2 47.4zM48 60.2 0 69.5l4.8-11.4 43.2.5z"/></svg>';
  // The ways to pay, as people know them from the card in their wallet: drawn small, in each scheme's own colours.
  const LOGO = {
    visa: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="Visa"><rect width="48" height="30" rx="5" fill="#fff"/><path d="M19.6 20.3h-2.9l1.8-10.6h2.9zm10.6-10.3a7.4 7.4 0 0 0-2.6-.5c-2.9 0-4.9 1.5-4.9 3.6 0 1.6 1.5 2.4 2.6 3 1.1.5 1.5.9 1.5 1.4 0 .7-.9 1.1-1.8 1.1a6 6 0 0 1-2.8-.6l-.4-.2-.4 2.4c.7.3 2 .6 3.3.6 3.1 0 5-1.5 5-3.8 0-1.3-.8-2.2-2.5-3-1-.5-1.7-.9-1.7-1.4s.6-1 1.7-1a5.5 5.5 0 0 1 2.3.4l.3.1zm7.4-.3h-2.2c-.7 0-1.2.2-1.5.9l-4.3 9.7h3l.6-1.6h3.7l.4 1.6h2.7zm-3.6 6.8 1.1-3 .4-1 .2 1 .7 3zM15.3 9.7l-2.8 7.2-.3-1.5a8.6 8.6 0 0 0-4-4.6l2.6 9.4h3.1l4.6-10.5z" fill="#1a1f71"/><path d="M9.8 9.7H5.1L5 10c3.7.9 6.1 3 7.1 5.5l-1-4.9c-.2-.7-.7-.9-1.3-.9z" fill="#f7a600"/></svg>',
    mc: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="Mastercard"><rect width="48" height="30" rx="5" fill="#fff"/><circle cx="19.5" cy="15" r="8" fill="#eb001b"/><circle cx="28.5" cy="15" r="8" fill="#f79e1b"/><path d="M24 8.4a8 8 0 0 1 0 13.2 8 8 0 0 1 0-13.2z" fill="#ff5f00"/></svg>',
    mada: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="mada"><rect width="48" height="30" rx="5" fill="#fff"/><rect x="6" y="10.2" width="11" height="4" rx="1" fill="#259bd6"/><rect x="6" y="15.8" width="11" height="4" rx="1" fill="#84b740"/><text x="19.5" y="19.6" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="700" fill="#0b1f3a">mada</text></svg>',
    tabby: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="Tabby"><rect width="48" height="30" rx="5" fill="#3effc0"/><text x="24" y="19.4" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11.5" font-weight="700" fill="#141414">tabby</text></svg>',
    tamara: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="Tamara"><rect width="48" height="30" rx="5" fill="#fff4ee"/><rect x="8" y="21.2" width="32" height="2" rx="1" fill="#e98ab7"/><text x="24" y="18.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10.5" font-weight="700" fill="#1d1d1b">tamara</text></svg>',
    apple: '<svg class="pl-logo" viewBox="0 0 48 30" role="img" aria-label="Apple Pay"><rect width="48" height="30" rx="5" fill="#000"/><path d="M15.6 10.6c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-.9zm.7 1.1c-1.1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2-.3 5.1.9 6.8.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.1-.5 1 0 1.3.5 2.2.5s1.4-.8 2-1.7c.6-.9.9-1.8.9-1.9 0 0-1.8-.7-1.8-2.7 0-1.7 1.4-2.5 1.4-2.5-.8-1.2-2-1.3-2.3-1.4z" fill="#fff"/><text x="20.5" y="19.6" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="10.5" font-weight="600" fill="#fff">Pay</text></svg>',
  };
  const acceptRow = (cls = "") => `<span class="accept ${cls}">${LOGO.mada}${LOGO.visa}${LOGO.mc}${LOGO.tabby}${LOGO.tamara}</span>`;
  // Where to reach a person, the same everywhere: the number on the website, WhatsApp, email, and the hours.
  const PHONE = "+966566682662", PHONE_TXT = "+966 56 668 2662", MAIL = "support@madatrips.sa";
  const helpLine = (ctx) => `<div class="box helpbox"><b>${esc(t("hlp").stuck)}</b><p>${esc(t("hlp").hours)}</p>
    <div class="helpbox__go"><a class="hb" href="tel:${PHONE}">${ico("phone")}<span><small>${esc(t("hlp").call)}</small><b dir="ltr">${PHONE_TXT}</b></span></a><a class="hb" href="${wa(ctx || t("hlp").waHi)}" target="_blank" rel="noopener">${ico("chat")}<span><small>WhatsApp</small><b>${esc(t("hlp").waShort)}</b></span></a></div></div>`;

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
    if (LIVE && d.live) return buildLivePlan(d);
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

  // ---------- live: the Core API's searches turned into the plan ----------
  // Our airport codes ↔ the API's destination keys (packages/shared/src/schemas/booking-data.ts DESTINATIONS).
  const KEY = { DXB: "dubai", IST: "istanbul", CAI: "cairo", LHR: "london", GYD: "baku", JED: "jeddah", ULH: "alula", AHB: "abha", TBS: "tbilisi", CDG: "paris", DPS: "bali", MLE: "maldives" };
  const FROM_KEY = Object.fromEntries(Object.entries(KEY).map(([c, k]) => [k, c]));
  const HOME = new Set(["RUH", "JED", "DMM"]);
  const sar = (m) => (m ? m.amount / 100 : 0);
  const searchSig = (d) => [d.from, d.to, d.dep, d.ret, d.pax.a, d.pax.c, d.pax.i, A.signedIn ? 1 : 0].join("|");

  // What the API understood (/ask/parse), in the shape the conversation already reads.
  function fromIntent(intent, p) {
    if (!intent) return p;
    const out = { ...p };
    let to = intent.destination && intent.destination !== "other" ? FROM_KEY[intent.destination] : null;
    if (!to && intent.destinationName) to = P.parse(intent.destinationName).to;
    if (intent.kind === "umrah") { to = "JED"; out.makkah = true; }
    if (to) out.to = to;
    if (intent.from) out.from = intent.from;
    if (intent.depart) { out.dates = [intent.depart, ...(intent.return ? [intent.return] : [])]; out.oneWay = intent.tripType === "oneway"; }
    const party = intent.party;
    if (party && (party.adults != null || party.childAges.length || party.total)) {
      const kids = party.childAges.filter((a) => a == null || a >= 2).length, babies = party.infants + party.childAges.filter((a) => a != null && a < 2).length;
      const adults = party.adults ?? Math.max(1, (party.total || 1) - kids - babies);
      out.pax = { a: Math.min(9, adults), c: kids, i: Math.min(adults, babies) };
    } else if (intent.travellerCount) out.pax = { a: intent.travellerCount, c: 0, i: intent.infants || 0 };
    out.askWho = intent.ask === "who" && !out.pax;
    out.kind = intent.kind;
    return out;
  }

  // Flights, rooms and eSIMs for the plan, searched together. Searched again only when the trip itself changed.
  async function liveSearch(d) {
    const sig = searchSig(d);
    if (d.live && d.live.sig === sig) return;
    const key = KEY[d.to], cc = D.byCode[d.to].country, nights = d.ret ? nightsOf(d.dep, d.ret) : 3;
    const live = { sig, key, flights: null, stays: null, esim: null, err: {}, outId: null, stayId: null, esimId: null, stayPick: null };
    const jobs = [];
    if (key && HOME.has(d.from) && d.from !== d.to) {
      jobs.push(A.flights({ from: d.from, destination: key, depart: d.dep, return: d.ret, infants: d.pax.i, cabin: "economy", flexibleDays: 0 }, d.pax)
        .then((r) => { live.flights = r; }).catch((e) => { live.err.flights = e.code; }));
    }
    jobs.push(A.stays({ destination: key || "other", place: key ? null : { name: `${D.byCode[d.to].city}` }, checkIn: d.dep, nights }, d.pax)
      .then((r) => { live.stays = r; }).catch((e) => { live.err.stays = e.code; }));
    if (A.signedIn && cc !== "SA") {
      jobs.push(A.esimPlans(cc, Math.max(1, nights + 1)).then((r) => { live.esim = r; }).catch((e) => { live.err.esim = e.code; }));
    }
    await Promise.all(jobs);
    const keepOut = d.live && d.live.flights && live.flights && live.flights.options.find((o) => sameFlight(o, d.live.flights.options.find((x) => x.id === d.live.outId)));
    live.outId = keepOut ? keepOut.id : live.flights && live.flights.options[0] ? live.flights.options[0].id : null;
    const st = live.stays ? live.stays.options.filter((o) => !(o.facts && o.facts.shared)) : [];
    live.stayId = (st.find((o) => o.badge === "best") || st[0] || {}).id || null;
    const plans = live.esim ? live.esim.plans : [];
    live.esimId = (plans.find((x) => x.fits && x.size === "regular") || plans.find((x) => x.fits) || plans[0] || {}).id || null;
    d.live = live;
  }
  const sameFlight = (a, b) => !!(a && b && a.out.flightNumber === b.out.flightNumber && a.out.date === b.out.date && (a.back ? a.back.flightNumber : "") === (b.back ? b.back.flightNumber : ""));
  const liveOut = (d) => d.live && d.live.flights ? d.live.flights.options.find((o) => o.id === d.live.outId) || null : null;
  const liveStay = (d) => d.live && (d.live.stayPick && d.live.stayPick.id === d.live.stayId ? d.live.stayPick : d.live.stays ? d.live.stays.options.find((o) => o.id === d.live.stayId) : null) || null;
  const liveEsim = (d) => d.live && d.live.esim ? d.live.esim.plans.find((x) => x.id === d.live.esimId) || null : null;
  const BOARD = { RO: ["Room only", "بدون وجبات"], BB: ["Breakfast included", "الإفطار مشمول"], HB: ["Breakfast and dinner", "إفطار وعشاء"], FB: ["All meals", "كل الوجبات"], AI: ["All inclusive", "شامل كليًا"] };

  function buildLivePlan(d) {
    const cc = D.byCode[d.to].country, lv = d.live, out = liveOut(d), stay = liveStay(d), esim = liveEsim(d);
    const people = d.pax.a + d.pax.c;
    const items = [];
    if (out) items.push({
      k: "flight", icon: "flights", go: "#/flights/out", demo: !!out.demo,
      title: `${out.airline} ${out.out.flightNumber}${out.back && out.back.flightNumber.slice(0, 2) !== out.out.flightNumber.slice(0, 2) ? " · " + out.back.flightNumber : ""}`,
      sub: `${day(out.out.date)} ${out.out.dep} → ${out.out.arr} · ${hrs(out.out.durationMin)} ${out.stop ? out.stop : t("direct")}${out.back ? ` · ${t("ret")} ${day(out.back.date)} ${out.back.dep}` : ""} · ${out.bags}`,
      price: sar(out.total),
    });
    else if (lv.key && HOME.has(d.from)) items.push({ k: "flight", icon: "flights", title: t("flight"), sub: t(lv.err.flights ? "liveFlightsDown" : "liveFlightsNone"), price: null, info: true });
    else items.push({ k: "flight", icon: "flights", title: t("flight"), sub: t("liveByHand"), price: null, info: true });
    if (stay) {
      const f = stay.facts || {};
      items.push({ k: "stay", icon: "stays", go: "#/stay", title: stay.name, sub: [f.stars ? `${f.stars}★` : "", stay.roomsLabel, f.board && BOARD[f.board] ? L(BOARD[f.board]) : "", stay.freeCancelUntil ? t("cancelBy")(fmt(stay.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRef")].filter(Boolean).join(" · "), price: sar(stay.total) });
    } else if (!d.flightsOnly) items.push({ k: "stay", icon: "stays", title: lang === "ar" ? "الفندق" : "Hotel", sub: t(lv.err.stays ? "liveStaysDown" : "liveStaysNone"), price: null, info: true });
    if (cc !== "SA") {
      if (esim) items.push({ k: "esim", icon: "esim", title: t("esimLive")(esim.coverage.name, esim.gb, esim.days), sub: `${esim.operator || ""}${esim.operator ? " · " : ""}${t("esimSub")}`, price: sar(esim.price) * people });
      else items.push({ k: "esim", icon: "esim", title: t("esim")(country(cc)), sub: A.signedIn ? t("liveEsimNone") : t("liveEsimSignin"), price: null, info: true });
      items.push({ k: "visa", icon: "visa", title: t("visa"), sub: D.GCC.has(cc) ? t("visaNo") : t("visaYes"), price: null, info: true });
    }
    for (const it of items) if (!it.info) it.on = d.items[it.k] !== false && !(d.flightsOnly && it.k !== "flight");
    const total = items.reduce((s, it) => s + (it.on ? it.price : 0), 0);
    return { items, total, nights: d.ret ? nightsOf(d.dep, d.ret) : 3, out: null, back: null, hotel: null, live: true, demo: items.some((i) => i.on && i.demo) };
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
  function reply(text, raw, intent) {
    const s = raw ? "" : P.norm(text), p = fromIntent(intent, P.parse(raw ? "" : text)), d = draft;
    const has = (re) => re.test(s);
    let changed = false, note = "";
    if (has(/visa|تاشير/) && !d.visa) {
      d.visa = { to: p.to || d.to };
      if (d.visa.to) return say(esc(t("visaAsk")(country(D.byCode[d.visa.to].country))), chips(t("passports").map((x, i) => ({ a: "pp", v: i, l: x }))));
      return say(esc(t("askWhere")), destChips());
    }
    if (d.plan) {
      if (has(/cheap|less|lower|ارخص|رخيص/) && LIVE && d.live) {
        // Live: a cheaper room of the ones found (the flight already leads with the best fare).
        const cur = liveStay(d), list = (d.live.stays ? d.live.stays.options : []).filter((o) => cur && o.total.amount < cur.total.amount).sort((a, b) => b.total.amount - a.total.amount);
        if (list[0]) { d.live.stayId = list[0].id; d.live.stayPick = null; } else note = t("liveCheapest");
        changed = true;
      } else if (has(/cheap|less|lower|ارخص|رخيص/)) {
        if (d.tier > 0) { d.tier--; d.hotelId = null; }
        else { const ctx = D.priceContext(d.from, d.to, d.dep, d.pax); if (ctx && ctx.cheaper) { const n = d.ret ? nightsOf(d.dep, d.ret) : 0; d.dep = ctx.cheaper.date; if (n) d.ret = addDays(d.dep, n); d.outId = d.backId = null; note = t("cheapest")(day(d.dep)); } }
        changed = true;
      }
      if (has(/earlier|day before|قبلها|قبل بيوم/)) { d.dep = addDays(d.dep, -1); if (d.ret) d.ret = addDays(d.ret, -1); if (d.dep < todayIso()) d.dep = todayIso(); d.outId = d.backId = null; changed = true; }
      if (has(/later|day after|بعدها بيوم/)) { d.dep = addDays(d.dep, 1); if (d.ret) d.ret = addDays(d.ret, 1); d.outId = d.backId = null; changed = true; }
      if (has(/5 ?★|5 ?star|five star|luxury|فخم|5 نجوم/)) {
        d.tier = 2; d.hotelId = null; d.items.stay = true; d.flightsOnly = false; changed = true;
        if (LIVE && d.live && d.live.stays) { const five = d.live.stays.options.filter((o) => o.facts && o.facts.stars === 5).sort((a, b) => (b.score || 0) - (a.score || 0))[0]; if (five) { d.live.stayId = five.id; d.live.stayPick = null; } }
      }
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
    if (p.pax) { d.pax = p.pax; store.set("pax", p.pax); d.paxSaid = true; changed = true; }
    if (!d.plan && has(/^flights? to|طيران الى/)) d.flightsOnly = true;
    if (!d.plan && has(/hotel|\bstay\b|فندق/) && !has(/flight|طيران/)) d.items = { ...d.items, flight: false };
    if (!d.plan && has(/esim|شريحه/)) d.items = { ...d.items, flight: false, stay: false, pickup: false };

    if (!d.to) {
      if (p.budget) return budgetAnswer(p.budget);
      return say(esc(t("askWhere")), destChips());
    }
    if (!d.dep) return say(esc(d.umrah ? t("askWhenUmrah") : t("askWhen")(city(d.to))), chips([{ a: "wk", v: 0, l: t("wkThis") }, { a: "wk", v: 1, l: t("wkNext") }, { a: "in2", l: t("in2") }, { a: "cal", l: t("pickDates") }]));
    if (d.ret && d.ret <= d.dep) d.ret = null;
    // Who's going changes every price: ask once, unless they said it or have searched before (the server asks the same).
    if (LIVE && !d.paxSaid && !store.get("pax") && (p.askWho || !p.pax)) { d.paxSaid = true; return say(esc(t("askWho")), chips([{ a: "who", v: "1,0", l: t("whoMe") }, { a: "who", v: "2,0", l: t("whoTwo") }, { a: "who", v: "2,2", l: t("whoFamily") }, { a: "whoPick", l: t("whoOther") }])); }
    const first = !d.plan;
    d.plan = true;
    d.pendingSay = note ? esc(note) : first || !changed ? t("planIntro")(esc(placeName(d)), esc(range(d.dep, d.ret)), esc(paxText(d.pax))) : esc(t("updated"));
    if (!LIVE) { say(d.pendingSay, "plan"); d.pendingSay = null; }
  }
  function budgetAnswer(budget) {
    const w = weekend(), d = draft;
    const list = D.POPULAR.filter((c) => c !== d.from).map((c) => ({ c, total: tripTotal(d.from, c, w.dep, w.ret, d.pax) })).filter((x) => x.total && x.total <= budget).sort((a, b) => a.total - b.total).slice(0, 4);
    if (!list.length) return say(esc(t("budgetNone")), chips([{ a: "wk", v: 1, l: t("wkNext") }]));
    say(esc(t("budgetIntro")(money(budget), paxText(d.pax))), chips(list.map((x) => ({ a: "goWk", v: x.c, l: `${city(x.c)} · ${money(x.total)}` }))));
  }

  let busy = false, prevSig = {};
  // raw: the trip was already changed by a tap (a chip, a card, the calendar); the text is only what the bubble shows.
  async function send(text, raw) {
    text = String(text).trim(); if (!text || busy) return;
    if (!draft) draft = freshDraft();
    you(text); busy = true; saveDraft();
    if (route().name !== "plan") location.hash = "#/plan"; else renderThread(true);
    if (!LIVE) await new Promise((r) => setTimeout(r, reduce ? 0 : 650));
    // Live: the same understanding as the app (/ask/parse), then real searches before Mada says anything about prices.
    let intent = null;
    if (LIVE && !raw) { try { intent = (await A.parse(text, null)).intent; } catch { /* the rules here still read it */ } }
    reply(text, raw, intent);
    if (LIVE && draft.pendingSay) {
      setWork(t("liveChecking")); renderThread(true);
      try { await liveSearch(draft); } catch { /* each part says for itself what failed */ }
      const pl = buildPlan(draft);
      say(pl.items.some((i) => !i.info) ? draft.pendingSay : esc(t("liveNothing")), "plan");
      draft.pendingSay = null;
    }
    busy = false; setWork(null); saveDraft();
    if (route().name === "plan") { renderThread(false); renderPlanPane(true); }
  }
  let workText = null;
  const setWork = (txt) => { workText = txt; };

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
    if (working || busy) html += `<div class="say"><span class="say__mark">${SUN}</span><div class="say__body"><span class="say__work">${esc(workText || t("working"))} <i></i><i></i><i></i></span></div></div>`;
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
    const plan = buildPlan(d), dd = D.DEST[d.to], ls = LIVE && d.live ? liveStay(d) : null;
    const img = dd ? `<img src="${D.photo(d.to)}" alt="" style="object-position:${dd.pos}" />${dd.credit !== "Mada Trips" ? `<small>${esc(dd.credit)}</small>` : ""}` : ls && ls.hotel && ls.hotel.imageUrl ? `<img src="${esc(ls.hotel.imageUrl)}" alt="" />` : "";
    return `<div class="plan">
      <div class="plan__hero${dd ? "" : " plan__hero--plain"}">${img}<b>${esc(placeName(d))}</b></div>
      <div class="plan__meta">
        <button type="button" data-pop="when">${ico("cal")}<span>${esc(range(d.dep, d.ret))}</span></button>
        <button type="button" data-pop="who">${ico("ppl")}<span>${esc(paxText(d.pax))}</span></button>
        <button type="button" data-pop="from">${ico("pin")}<span>${esc(city(d.from))}</span></button>
      </div>
      ${plan.items.map((it) => `<div class="item${it.info ? " info" : it.on ? "" : " off"}" data-k="${it.k}">${ico(it.icon)}<div class="item__t"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span>${it.go && it.on ? `<a class="item__chg" href="${it.go}">${esc(t("change"))}</a>` : ""}</div><span class="item__p">${it.info ? (it.k === "visa" ? esc(t("visaChk")) : "") : esc(money(it.price))}${it.demo ? `<small class="demo-tag">${esc(t("demoFare"))}</small>` : ""}</span><button type="button" class="tog" data-tog="${it.k}" ${it.info ? "disabled" : ""} aria-pressed="${!!it.on}" aria-label="${esc(it.title)}"></button></div>`).join("")}
      <div class="plan__foot"><div class="plan__total"><small>${esc(t("totalFor")(paxText(d.pax)))}</small><b>${esc(money(plan.total))}</b></div>
        <div class="plan__go"><button type="button" class="btn btn--plain" data-a="share">${esc(t("share"))}</button><a class="btn btn--main" href="#/travelers">${esc(t("cont"))}</a></div><div class="plan__trust">${acceptRow("accept--sm")}<span>${esc(t("hlp").planTrust)}</span></div></div>
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
    setTimeout(placeFab, 0);
    closePop(); $("#acctMenu").hidden = true;
    renderHeader();
    if (r.name === "home") return viewHome();
    if (r.name === "plan") return viewStudio();
    if (LIVE) {
      // The live pages: same API as the app. Trips booked in this browser before going live still open from #/trip.
      if (r.name === "flights") return needPlan() && (draft.live ? viewFlightsLive() : location.replace("#/plan"));
      if (r.name === "stay") return needPlan() && (draft.live ? viewStayLive() : location.replace("#/plan"));
      if (r.name === "hotel") return needPlan() && (draft.live ? viewHotelLive(decodeURIComponent(r.a || "")) : location.replace("#/plan"));
      if (r.name === "travelers") return needPlan() && viewTravelersLive();
      if (r.name === "pay") return needPlan() && viewPayLive();
      if (r.name === "wait") return viewWait(r.a);
      if (r.name === "t") return viewTripLive(r.a);
      if (r.name === "trips") return viewTripsLive();
      if (r.name === "signin") return viewSigninLive();
      if (r.name === "discover") return viewDiscover();
      if (r.name === "circles") return r.a === "new" ? viewNewCircle() : viewCircles();
      if (r.name === "circle") return viewCircle(r.a);
      if (r.name === "people") return viewPeople();
      if (r.name === "friend") return viewFriend(r.a);
      if (r.name === "join") return viewJoin(r.a);
    }
    if (r.name === "app") return viewApp();
    if (["discover", "circles", "circle", "people", "friend", "join"].includes(r.name)) { page(needIn(r.name, S().circlesOutH, S().previewOnly)); return wireCommon(); }
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
    if ($("#footAccept")) $("#footAccept").innerHTML = acceptRow();
    if ($(".fab__mark")) $(".fab__mark").innerHTML = SUN;
    const acct = $("#acct");
    acct.classList.toggle("is-in", !!user);
    acct.innerHTML = user ? `<i>${esc((user.name || "?")[0])}</i><span>${esc(user.name)}</span>` : esc(t("signIn"));
    $$(".demo button").forEach((b) => b.classList.toggle("on", b.dataset.as === (user ? "back" : "new")));
    $("#credits").innerHTML = Object.entries(D.DEST).filter(([, x]) => x.src).map(([c, x]) => `<li>${esc(city(c))}: <a href="${x.src}" target="_blank" rel="noopener">${esc(x.credit)}</a></li>`).join("") + `<li>${esc(D.HOTEL_CREDIT)}</li>` + Object.values((window.MadaCover || {}).COVER_PHOTOS || {}).filter((x) => x.credit).map((x) => `<li>${esc(x.city)}: <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.credit)}</a></li>`).join("");
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
  // With `only` (the parts in this payment), a part left out of it isn't listed or counted.
  function sumCard(d, total, only) {
    const pl = buildPlan(d), dd = D.DEST[d.to];
    if (only) pl.items = pl.items.filter((i) => only.includes(i.k));
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
      </form><aside class="pg__side">${sumCard(d)}${helpLine(helpContextFor("travelers", d))}</aside></div></div>`);

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
    const m = (k, b, small, badge, dis) => `<label class="${co.method === k ? "on" : ""}${dis ? " dis" : ""}"><input type="radio" name="pm" value="${k}" ${co.method === k ? "checked" : ""} ${dis ? "disabled" : ""} /><div><b>${esc(b)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>${badge ? (/^</.test(badge) ? `<i class="pmlogo">${badge}</i>` : `<i>${esc(badge)}</i>`) : "<span></span>"}</label>`;
    page(`<div class="wrap pg">
      ${backLink(held ? `#/trip/${held.ref}` : "#/travelers")}${held ? "" : steps(2)}
      <h1 class="pg__h">${esc(t("payTitle"))}</h1>
      <div class="pg__grid"><form id="payForm" novalidate>
        <div class="box"><h2 class="box__h">${esc(t("whoGoing"))}</h2><p style="margin:0">${esc(names)}</p><p class="note-s">${esc(t("contact"))}: +966 ${esc(contact.phone)}${contact.email ? " · " + esc(contact.email) : ""}</p></div>
        <div class="box"><h2 class="box__h">${esc(t("payHow"))}</h2><div class="pm" id="pm">
          ${m("apple", t("applePay"), "", LOGO.apple)}
          ${m("mada", t("mada"), "", LOGO.mada)}
          ${m("card", t("card"), "", LOGO.visa + LOGO.mc)}
          ${m("tabby", t("tabby"), t("tabbySub")(money(total / 4)), LOGO.tabby)}
          ${m("tamara", t("tamara"), t("tamaraSub")(money(total / 3)), LOGO.tamara)}
          ${held ? "" : m("hold", t("holdH"), holdIso ? t("holdSub")(when(holdIso)) : t("holdNo"), "", !holdIso)}
        </div>
        <div id="cardFields"></div>
        <p class="note-s">${esc(t("terms"))}</p>
        <p class="note-s">${esc(t("preview"))}</p></div>
        <button type="submit" class="primary" id="payBtn"></button>
        <div class="trust">${ico("lock")}<p>${esc(t("hlp").secure)}</p></div>
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
  async function signOut() { if (LIVE) await A.signOut(); user = null; store.set("user", null); location.hash = "#/"; render(); }

  // =========================================================
  // Live pages: the same API, rules and wording as the app
  // =========================================================
  const LABEL = (k) => (t("labels") || {})[k] || k;
  const AMEN_ICON = { pool: "pool", beach: "pool", kidsClub: "kids", gym: "gym", spa: "spa", parking: "parking", connecting: "ppl", accessible: "ppl", familyRooms: "ppl", wifi: "wifi" };
  const loading = (txt) => `<div class="wrap pg"><div class="empty"><span class="spin"></span><p>${esc(txt)}</p></div></div>`;
  const errBox = (txt, retry) => `<div class="wrap pg"><div class="empty"><p>${esc(txt)}</p>${retry ? `<button type="button" class="btn btn--main" onclick="location.reload()">${esc(t("tryAgain"))}</button>` : ""}</div></div>`;

  // ----- flights: the options the API found (best fit first), each with its rules in plain words -----
  function viewFlightsLive() {
    const d = draft, r = d.live && d.live.flights;
    if (!r || !r.options.length) return location.replace("#/plan");
    const leg = (l) => `<div class="fl__times"><b>${esc(l.dep)}</b><div class="fl__line">${esc(hrs(l.durationMin))}<i></i>${esc(l.from)} → ${esc(l.to)}</div><b>${esc(l.arr)}</b></div>`;
    page(`<div class="wrap pg">
      ${backLink("#/plan")}
      <h1 class="pg__h">${esc(t("flTitle")(city(d.to)))}</h1>
      <p class="pg__sub">${esc(range(d.dep, d.ret))} · ${esc(paxText(d.pax))} · ${esc(t("liveChecked")(r.checked))}</p>
      ${r.options.some((o) => o.demo) ? `<div class="nudge" style="margin-top:18px">${esc(t("demoNote"))}</div>` : ""}
      <div class="lf">${r.options.map((o) => { const on = o.id === d.live.outId; return `<article class="lfo${on ? " on" : ""}">
        <div class="lfo__top"><span class="pick__k">${esc(LABEL(o.label))}</span>${o.demo ? `<span class="demo-tag">${esc(t("demoFare"))}</span>` : ""}</div>
        <b class="lfo__al" style="--brand:${esc(o.brand)}"><i></i>${esc(o.airline)} · ${esc(o.out.flightNumber)}</b>
        <div class="lfo__legs"><div><small>${esc(day(o.out.date))}</small>${leg(o.out)}</div>${o.back ? `<div><small>${esc(day(o.back.date))}</small>${leg(o.back)}</div>` : ""}</div>
        <p class="lfo__why">${esc(o.reason)}</p>
        <ul class="lfo__rules"><li>${esc(o.stop || t("direct"))}</li><li>${esc(o.bags)}</li><li>${esc(o.changeRule)}</li><li>${esc(o.refundRule)}</li></ul>
        <div class="lfo__pr"><div><b>${esc(money(sar(o.total)))}</b><small>${esc(t("totalFor")(paxText(d.pax)))}</small></div>
          <button type="button" class="btn ${on ? "btn--plain" : "btn--main"}" data-lf="${o.id}">${esc(on ? t("selected") : t("select"))}</button></div>
      </article>`; }).join("")}</div>
    </div>`);
    $$("[data-lf]").forEach((b) => b.addEventListener("click", () => { d.live.outId = b.dataset.lf; d.items.flight = true; saveDraft(); location.hash = "#/plan"; }));
  }

  // ----- where a hotel is: distance to the places that matter in this city, and a map -----
  const marksFor = (d) => {
    const a = D.byCode[d.to];
    return [...(D.LANDMARKS[d.to] || []).map((m) => ({ name: lang === "ar" ? m[1] : m[0], ll: [m[2], m[3]] })), { name: t("airportOf")(a.code), ll: [a.lat, a.lon], airport: true }];
  };
  const hotelLL = (o) => (o.facts && o.facts.lat != null ? [o.facts.lat, o.facts.lng] : null);
  // Rough and labelled "about": walking under 1.2 km, otherwise by car through city traffic.
  function howFar(o, m) {
    const ll = hotelLL(o); if (!ll) return null;
    const k = D.kmBetween(ll, m.ll);
    const kmTxt = k < 10 ? k.toFixed(1) : Math.round(k);
    return { k, text: k < 1.2 ? t("walkMin")(Math.max(2, Math.round(k * 13)), m.name) : t("driveMin")(kmTxt, Math.round(k * 1.6 + 6), m.name) };
  }
  let mapP = null;
  // The same map as the app's web build (apps/mobile/src/components/maps/StaysMap.web.tsx): MapLibre with OpenFreeMap
  // tiles (OpenStreetMap data, no key), loaded the first time a map is opened.
  function mapLib() {
    mapP ??= new Promise((resolve, reject) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"; document.head.append(css);
      const js = document.createElement("script"); js.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
      const timer = setTimeout(() => reject(new Error("map timeout")), 12000);
      js.onload = () => { clearTimeout(timer); window.maplibregl ? resolve(window.maplibregl) : reject(new Error("no map")); };
      js.onerror = () => { clearTimeout(timer); reject(new Error("map blocked")); };
      document.head.append(js);
    }).catch((e) => { mapP = null; throw e; });
    return mapP;
  }
  const pillW = (label) => label.length * 7.4 + 22;
  /** Pins whose pills would sit on each other at this zoom become one pill ("5 · from SAR 829") that zooms in on tap. */
  function groupPins(pts, at) {
    const free = pts.filter((p) => !p.on), xy = free.map(at), up = free.map((_, i) => i);
    const root = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      if (Math.abs(xy[i].x - xy[j].x) < (pillW(free[i].label) + pillW(free[j].label)) / 2 + 2 && Math.abs(xy[i].y - xy[j].y) < 30) up[root(i)] = root(j);
    }
    const by = new Map(); free.forEach((p, i) => { const r = root(i); by.set(r, [...(by.get(r) || []), p]); });
    const out = [...by.values()].map((m) => ({ members: m, lat: m.reduce((a, p) => a + p.lat, 0) / m.length, lng: m.reduce((a, p) => a + p.lng, 0) / m.length, same: m.length > 1 && Math.max(...m.map((p) => Math.abs(p.lat - m[0].lat) + Math.abs(p.lng - m[0].lng))) < 0.0003 }));
    return [...out, ...pts.filter((p) => p.on).map((p) => ({ members: [p], lat: p.lat, lng: p.lng }))];
  }
  async function drawMap(el, hotels, marks, { selected, onPick, zoom } = {}) {
    let ml; try { ml = await mapLib(); } catch { el.innerHTML = `<p class="empty">${esc(t("mapOff"))}</p>`; return null; }
    if (!el.isConnected) return null;
    if (lang === "ar" && ml.getRTLTextPluginStatus?.() === "unavailable") { try { Promise.resolve(ml.setRTLTextPlugin("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js", true)).catch(() => {}); } catch {} }
    const single = hotels.length === 1;
    const pts = hotels.map((o) => { const ll = hotelLL(o); return ll && { o, lat: ll[0], lng: ll[1], price: o.total.amount, label: money(sar(o.total)), on: o.id === selected }; }).filter(Boolean);
    const lands = marks.filter((x) => !x.airport || single || x.on).map((m) => ({ name: m.name, lat: m.ll[0], lng: m.ll[1], on: m.on }));
    const named = lands.some((k) => k.on) ? (k) => k.on : () => true; // with a "distance from" place chosen, only it is named
    const all = [...pts, ...lands];
    if (!all.length) return null;
    const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
    const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
    const map = new ml.Map({ container: el, style: "https://tiles.openfreemap.org/styles/positron", attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, cooperativeGestures: false, scrollZoom: false,
      ...(all.length === 1 ? { center: [all[0].lng, all[0].lat], zoom: zoom || 14 } : { bounds, fitBoundsOptions: { padding: 50, maxZoom: zoom || 14 } }) });
    map.addControl(new ml.NavigationControl({ showCompass: false }), lang === "ar" ? "top-left" : "top-right");
    map.on("error", () => {});
    let markers = [];
    const pin = (cls, html, click, label) => {
      const b = document.createElement(click ? "button" : "div");
      b.className = cls; b.innerHTML = html;
      if (click) { b.type = "button"; b.setAttribute("aria-label", label); b.addEventListener("click", (e) => { e.stopPropagation(); click(); }); }
      return b;
    };
    const draw = () => {
      markers.forEach((m) => m.remove());
      const groups = single ? pts.map((p) => ({ members: [p] })) : groupPins(pts, (p) => map.project([p.lng, p.lat]));
      const add = (elx, lng, lat, offset) => markers.push(new ml.Marker({ element: elx, ...(offset ? { offset } : {}) }).setLngLat([lng, lat]).addTo(map));
      // A place's name shows where it has room; where two would sit on each other the later one is a star (its name on hover).
      const taken = [];
      lands.forEach((k) => {
        const c = map.project([k.lng, k.lat]), w = pillW(k.name) + 14;
        const room = named(k) && !taken.some((b) => Math.abs(b.x - c.x) < (b.w + w) / 2 && Math.abs(b.y - c.y) < 28);
        if (room) taken.push({ ...c, w });
        const e = pin("mk__land" + (room ? "" : " mk__land--dot"), `${ico("star")}${room ? `<b>${esc(k.name)}</b>` : ""}`); e.title = k.name; e.setAttribute("role", "img"); e.setAttribute("aria-label", k.name); add(e, k.lng, k.lat);
      });
      for (const g of groups) {
        const one = (p, off) => add(pin("mk__pin" + (p.on ? " on" : ""), esc(p.label), single ? null : () => { pts.forEach((x) => (x.on = x === p)); draw(); onPick && onPick(p.o); }, `${p.o.name}, ${p.label}`), p.lng, p.lat, off);
        if (g.members.length === 1) { one(g.members[0]); continue; }
        if (g.same) { g.members.forEach((p, i) => one(p, [0, (i - (g.members.length - 1) / 2) * 30])); continue; }
        const low = g.members.reduce((a, b) => (b.price < a.price ? b : a));
        const text = t("mapGroup")(g.members.length, low.label);
        add(pin("mk__grp", esc(text), () => {
          const la = g.members.map((p) => p.lat), ln = g.members.map((p) => p.lng);
          const cam = map.cameraForBounds([[Math.min(...ln), Math.min(...la)], [Math.max(...ln), Math.max(...la)]], { padding: 70 });
          map.easeTo({ center: cam ? cam.center : [g.lng, g.lat], zoom: Math.min(18, Math.max(cam ? cam.zoom : 0, map.getZoom() + 1.5)), duration: 450 });
        }, text), g.lng, g.lat);
      }
    };
    map.on("load", () => { el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"); if (all.length > 1) map.fitBounds(bounds, { padding: 50, maxZoom: zoom || 14, duration: 0 }); draw(); });
    map.on("zoomend", draw);
    return map;
  }

  // Why a hotel ranks where it does, in one plain line, from the reasons the API gives (stay-fit.ts).
  function whyLine(o) {
    const w = t("fitWhy"), rs = (o.fit && o.fit.reasons) || [];
    return rs.map((r) => (r.k === "near" ? null : r.k === "has" && r.what ? w.has((t("amenLive") || {})[r.what] || r.what) : w[r.k] && typeof w[r.k] === "string" ? w[r.k] : r.k === "stars" && r.n ? w.stars(r.n) : null)).filter(Boolean).slice(0, 3).join(" · ");
  }
  // ----- hotels: real rooms from the hotel supplier, with photos -----
  let lsSort = "rec", lsStars = "all", lsF = { breakfast: false, cancel: false, pool: false }, lsMore = 12, lsView = "list", lsFrom = 0;
  function viewStayLive() {
    const d = draft, r = d.live && d.live.stays;
    if (!r) return location.replace("#/plan");
    let list = r.options.filter((o) => !(o.facts && o.facts.shared));
    const f = (o) => o.facts || {};
    list = list.filter((o) => (lsStars === "all" || f(o).stars === +lsStars) && (!lsF.breakfast || ["BB", "HB", "FB", "AI"].includes(f(o).board)) && (!lsF.cancel || o.freeCancelUntil) && (!lsF.pool || (f(o).amenities || []).includes("pool")));
    const marks = marksFor(d), mark = marks[Math.min(lsFrom, marks.length - 1)];
    const dist = (o) => { const h = howFar(o, mark); return h ? h.k : 1e9; };
    list.sort(lsSort === "price" ? (a, b) => a.total.amount - b.total.amount : lsSort === "stars" ? (a, b) => (f(b).stars || 0) - (f(a).stars || 0) || a.total.amount - b.total.amount : lsSort === "near" ? (a, b) => dist(a) - dist(b) : (a, b) => (b.score || 0) - (a.score || 0));
    const nights = d.ret ? nightsOf(d.dep, d.ret) : 3, shown = list.slice(0, lsMore);
    page(`<div class="wrap pg">
      ${backLink("#/plan")}
      <h1 class="pg__h">${esc(t("stTitle")(d.umrah ? (lang === "ar" ? "مكة" : "Makkah") : city(d.to)))}</h1>
      <p class="pg__sub">${esc(range(d.dep, d.ret))} · ${esc(paxText(d.pax))} · ${esc(t("liveFound")(list.length))}</p>
      <div class="bar ht-bar">
        <div class="bar__r"><span class="seg2">${["all", "3", "4", "5"].map((k) => `<button type="button" data-st="${k}" class="${lsStars === k ? "on" : ""}">${esc(k === "all" ? t("allStars") : k + "★")}</button>`).join("")}</span>
          ${[["breakfast", "fBreakfast"], ["cancel", "fCancel"], ["pool", "fPool"]].map(([k, w]) => `<button type="button" class="fchip${lsF[k] ? " on" : ""}" data-f="${k}">${esc(t(w))}</button>`).join("")}</div>
        <div class="bar__r"><span class="seg2">${[["rec", t("stSort").rec], ["price", t("stSort").price], ["near", t("nearest")], ["stars", t("starsSort")]].map(([k, l]) => `<button type="button" data-sort="${k}" class="${lsSort === k ? "on" : ""}">${esc(l)}</button>`).join("")}</span></div>
      </div>
      <div class="bar ht-bar2">
        <div class="bar__r"><span class="ht-from">${esc(t("distFrom"))}</span>${marks.map((m, i) => `<button type="button" class="fchip${i === lsFrom ? " on" : ""}" data-from-mark="${i}">${esc(m.name)}</button>`).join("")}</div>
        <span class="seg2"><button type="button" data-view="list" class="${lsView === "list" ? "on" : ""}">${esc(t("viewList"))}</button><button type="button" data-view="map" class="${lsView === "map" ? "on" : ""}">${esc(t("viewMap"))}</button></span>
      </div>
      ${lsView === "map" ? `<div class="ht-mapwrap"><div><div id="htMap" class="ht-map"></div><p class="map-credit">${esc(t("mapCredit"))}</p></div><div id="mapCard" class="map-card"><p class="note-s">${esc(t("mapTap"))}</p></div></div>` : ""}
      ${lsView === "map" ? "" : shown.map((o) => { const on = o.id === d.live.stayId, fa = f(o), far = howFar(o, mark); return `<article class="ht${on ? " on" : ""}">
        <a class="gal" href="#/hotel/${o.id}" aria-label="${esc(o.name)}">${o.hotel && o.hotel.imageUrl ? `<div class="gal__track"><img src="${esc(o.hotel.imageUrl)}" alt="" loading="lazy" /></div>` : ""}</a>
        <a class="ht__body" href="#/hotel/${o.id}">
          <span class="ht__top">${fa.stars ? `<span class="ht__stars">${"★".repeat(fa.stars)}</span>` : ""}${o.badge ? `<span class="ht__in">${esc(o.badge === "best" ? LABEL("best") : LABEL("lowest"))}</span>` : ""}${on ? `<span class="ht__in">${esc(t("inPlan"))}</span>` : ""}</span>
          <b class="ht__t">${esc(o.name)}</b>
          <span class="ht__loc">${ico("pin")}${esc(far ? far.text : o.address || o.area)}</span>
          ${far ? `<span class="ht__addr">${esc(o.address || o.area)}</span>` : ""}
          ${(() => { const rf = roomFacts((o.hotel && o.hotel.room) || fa.room || ""); return rf.base ? `<span class="ht__room">${ico("bed")}${esc(roomName(rf.base))}${rf.beds.length ? ` · ${esc(bedText(rf.beds))}` : ""}${rf.view ? ` · ${esc(viewText(rf.view))}` : ""}</span>` : ""; })()}
          ${whyLine(o) ? `<p class="ht__why"><span>${SUN}</span>${esc(whyLine(o))}</p>` : ""}
          <span class="ht__perks"><span class="${["BB", "HB", "FB", "AI"].includes(fa.board) ? "" : "no"}">${esc(fa.board && BOARD[fa.board] ? L(BOARD[fa.board]) : t("noBfast"))}</span><span class="${o.freeCancelUntil ? "" : "no"}">${esc(o.freeCancelUntil ? t("cancelBy")(fmt(o.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRef"))}</span></span>
          ${(fa.amenities || []).length ? `<ul class="hl hl--s">${fa.amenities.filter((a) => AMEN_ICON[a]).slice(0, 5).map((a) => `<li>${ico(AMEN_ICON[a])}<span>${esc((t("amenLive") || {})[a] || a)}</span></li>`).join("")}</ul>` : ""}
        </a>
        <div class="ht__pr"><small>${esc(o.roomsLabel)}</small><b>${esc(money(sar(o.total)))}</b><span class="ht__night">${esc(t("perNight")(money(sar(o.total) / nights / Math.max(1, o.rooms))))}</span>
          <button type="button" class="btn btn--sm ${on ? "btn--plain" : "btn--main"}" data-ls="${o.id}">${esc(on ? t("selected") : t("select"))}</button>
          <a class="link ht__more" href="#/hotel/${o.id}">${esc(t("viewHotel"))} →</a></div>
      </article>`; }).join("") || `<p class="empty">${esc(t("liveStaysNone"))}</p>`}
      ${lsView === "list" && list.length > lsMore ? `<button type="button" class="btn btn--plain more" id="lsMore">${esc(t("showMore")(list.length - lsMore))}</button>` : ""}
      <div class="bar"><button type="button" class="link" id="noHotel">${esc(t("noHotel"))}</button></div>
    </div>`, true);
    $$("[data-ls]").forEach((b) => b.addEventListener("click", () => { d.live.stayId = b.dataset.ls; d.live.stayPick = null; d.items.stay = true; d.flightsOnly = false; saveDraft(); location.hash = "#/plan"; }));
    $$("[data-st]").forEach((b) => b.addEventListener("click", () => { lsStars = b.dataset.st; lsMore = 12; viewStayLive(); }));
    $$("[data-f]").forEach((b) => b.addEventListener("click", () => { lsF[b.dataset.f] = !lsF[b.dataset.f]; lsMore = 12; viewStayLive(); }));
    $$(".ht-bar [data-sort]").forEach((b) => b.addEventListener("click", () => { lsSort = b.dataset.sort; viewStayLive(); }));
    $("#lsMore")?.addEventListener("click", () => { lsMore += 12; const y = scrollY; viewStayLive(); scrollTo(0, y); });
    $$("[data-from-mark]").forEach((b) => b.addEventListener("click", () => { lsFrom = +b.dataset.fromMark; if (lsSort === "rec") lsSort = "near"; viewStayLive(); }));
    $$("[data-view]").forEach((b) => b.addEventListener("click", () => { lsView = b.dataset.view; viewStayLive(); }));
    if (lsView === "map") {
      // Every hotel that passes the filters goes on the map; a tap shows its card under it.
      const card = (o) => { const fa = f(o), far = howFar(o, mark), on = o.id === d.live.stayId; return `<article class="map-card__in">
        ${o.hotel && o.hotel.imageUrl ? `<img src="${esc(o.hotel.imageUrl)}" alt="" />` : ""}
        <div><span class="ht__stars">${"★".repeat(fa.stars || 0)}</span><b class="ht__t">${esc(o.name)}</b><span class="ht__loc">${ico("pin")}${esc(far ? far.text : o.area)}</span>
        <span class="ht__perks"><span class="${["BB", "HB", "FB", "AI"].includes(fa.board) ? "" : "no"}">${esc(fa.board && BOARD[fa.board] ? L(BOARD[fa.board]) : t("noBfast"))}</span><span class="${o.freeCancelUntil ? "" : "no"}">${esc(o.freeCancelUntil ? t("cancelBy")(fmt(o.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRef"))}</span></span></div>
        <div class="map-card__pr"><b>${esc(money(sar(o.total)))}</b><button type="button" class="btn btn--sm ${on ? "btn--plain" : "btn--main"}" data-ls="${o.id}">${esc(on ? t("selected") : t("select"))}</button><a class="link" href="#/hotel/${o.id}">${esc(t("viewHotel"))} →</a></div></article>`; };
      drawMap($("#htMap"), list, marks.map((m, i) => ({ ...m, on: i === lsFrom })), { selected: d.live.stayId, onPick: (o) => {
        $("#mapCard").innerHTML = card(o);
        $("#mapCard [data-ls]").addEventListener("click", () => { d.live.stayId = o.id; d.live.stayPick = null; d.items.stay = true; d.flightsOnly = false; saveDraft(); location.hash = "#/plan"; });
      } });
      const cur = list.find((o) => o.id === d.live.stayId);
      if (cur) { $("#mapCard").innerHTML = card(cur); $("#mapCard [data-ls]")?.addEventListener("click", () => { location.hash = "#/plan"; }); }
    }
    $("#noHotel").addEventListener("click", () => { d.items.stay = false; saveDraft(); location.hash = "#/plan"; });
  }

  // A supplier's room name ("Deluxe Room with One King Bed Sheikh Zayed Road View Smoking-Double") read into what a
  // guest chooses by: the room, its beds, its view, how many bedrooms, accessible or smoking. Nothing is invented.
  const NUM = { one: 1, two: 2, three: 3, four: 4, 1: 1, 2: 2, 3: 3, 4: 4 };
  const VIEWS = /\b(partial sea|sea|ocean|burj khalifa|burj|fountain|city|skyline|garden|pool|marina|haram|kaaba|sheikh zayed road|creek|lake|mountain|courtyard|street|river|bosphorus|landmark|golf|beach)\s+view\b/i;
  function roomFacts(raw) {
    const s = String(raw || "").replace(/\s*-\s*double\s*$/i, "").replace(/-double\s*$/i, "").trim(), low = s.toLowerCase();
    const view = (low.match(VIEWS) || [])[1] || null;
    const br = low.match(/\b(one|two|three|four|[1-4])[- ]bedrooms?\b/);
    const beds = [];
    for (const m of low.matchAll(/\b(one|two|three|four|[1-4])\s+(king|queen|single|double|twin)(?:[- ]size)?\s+beds?\b/g)) beds.push([NUM[m[1]], m[2]]);
    if (!beds.length) { const m = low.match(/\b(king|queen|twin|double)(?:[- ]size)?\s+beds?\b/); if (m) beds.push([m[1] === "twin" ? 2 : 1, m[1] === "twin" ? "single" : m[1]]); }
    let base = s.split(/\s+with\s+|,/i)[0].replace(VIEWS, "").replace(/\b(non[- ]?)?smoking\b|\baccessible\b/gi, "").replace(/\s{2,}/g, " ").trim();
    base = base ? base[0].toUpperCase() + base.slice(1).toLowerCase() : s;
    if (/^double deluxe$/i.test(base)) base = "Deluxe double";
    return { base, view, bedrooms: br ? NUM[br[1]] : null, beds, smoke: /non[- ]?smoking/.test(low) ? "no" : /smoking/.test(low) ? "yes" : null, access: /accessible/.test(low) };
  }
  // Common room words in Arabic, noun first ("Deluxe double room" → "غرفة مزدوجة ديلوكس"); anything else stays as the hotel wrote it.
  const AR_NOUN = { room: "غرفة", suite: "جناح", studio: "استوديو", apartment: "شقة", villa: "فيلا", chalet: "شاليه", king: "غرفة كينج", double: "غرفة مزدوجة", twin: "غرفة توأم", triple: "غرفة ثلاثية", quadruple: "غرفة رباعية", single: "غرفة مفردة" };
  const AR_ADJ = { deluxe: "ديلوكس", standard: "قياسية", superior: "سوبيريور", executive: "تنفيذية", classic: "كلاسيك", premium: "بريميوم", premier: "بريمير", family: "عائلية", junior: "جونيور", luxury: "فاخرة", grand: "جراند", club: "كلوب", signature: "سيغنتشر", double: "مزدوجة", twin: "توأم", triple: "ثلاثية", single: "مفردة", king: "كينج", queen: "كوين", city: "", one: "", bedroom: "", "two-bedroom": "بغرفتين", "one-bedroom": "بغرفة نوم" };
  function roomName(base) {
    if (lang !== "ar") return base;
    const w = base.toLowerCase().split(/\s+/);
    const ni = w.map((x) => x in AR_NOUN).lastIndexOf(true);
    if (ni < 0 || !w.every((x, i) => i === ni || x in AR_ADJ)) return base;
    return [AR_NOUN[w[ni]], ...w.filter((_, i) => i !== ni).map((x) => AR_ADJ[x])].filter(Boolean).join(" ");
  }
  const bedText = (beds) => beds.map(([n, k]) => t("bedN")(n, k)).join(" + ");
  const viewText = (v) => t("viewOf")(v.replace(/\b\w/g, (c) => c.toUpperCase()));
  // What a guest uses, first; the hotel's inventory and the cards it takes, never.
  const FAC_FIRST = [/pool/i, /beach/i, /kids|children|playground|babysit/i, /wi-?fi|internet/i, /parking|garage/i, /breakfast|restaurant/i, /spa|sauna|massage|hammam/i, /gym|fitness/i, /family|connecting/i, /wheelchair|accessible|adapted/i, /shuttle|transfer|metro|bus/i, /room service/i, /24-hour|reception/i, /laundry/i];
  const FAC_SKIP = /number of|^hotel$|rooms?$|suites?$|studios?$|renovation|express|jcb|diners|visa|mastercard|maestro|american express|card|built|floors?$|^city centre$|^airport$|^harbour$|area$|nearest/i;
  function rankFacilities(list) {
    const names = [...new Set((list || []).filter((x) => !FAC_SKIP.test(x.name)).map((x) => x.name + (x.paid ? ` (${t("paidExtra")})` : "")))];
    const rank = (n) => { const i = FAC_FIRST.findIndex((re) => re.test(n)); return i < 0 ? 99 : i; };
    return names.sort((a, b) => rank(a) - rank(b));
  }
  const FAC_ICON = [[/pool/i, "pool"], [/beach/i, "pool"], [/kids|children/i, "kids"], [/wi-?fi|internet/i, "wifi"], [/parking|garage|valet/i, "parking"], [/breakfast|restaurant|dining|bar|café|cafe/i, "cup"], [/spa|sauna|massage/i, "spa"], [/gym|fitness/i, "gym"], [/shuttle|transfer|bus|metro|train/i, "shuttle"], [/wheelchair|accessible|lift|elevator/i, "access"], [/prayer|mosque/i, "prayer"], [/24-hour|reception|concierge|security/i, "clock"]];
  const facIco = (n) => ico((FAC_ICON.find(([re]) => re.test(n)) || [0, "check"])[1]);
  const firstSentences = (txt, n) => { const parts = String(txt).match(/[^.!?]+[.!?]+(\s|$)/g) || [txt]; return parts.slice(0, n).join("").trim(); };

  let hdPick = null;
  async function viewHotelLive(optId) {
    const d = draft, o = (d.live.stays ? d.live.stays.options.find((x) => x.id === optId) : null) || (d.live.stayPick && d.live.stayPick.id === optId ? d.live.stayPick : null);
    if (!o || !o.hotel) return location.replace("#/stay");
    page(loading(t("liveLoadingHotel")));
    const [h, roomsR] = await Promise.all([A.hotel(o.hotel.code).then((x) => x.hotel).catch(() => null), A.rooms(o.id).then((x) => x.options).catch(() => [o])]);
    if (route().name !== "hotel") return;
    const rooms = roomsR.length ? roomsR : [o];
    const imgs = (h && h.images && h.images.length ? h.images : [o.hotel.imageUrl]).filter(Boolean);
    const fa = o.facts || {}, nights = d.ret ? nightsOf(d.dep, d.ret) : 3;
    if (!hdPick || !rooms.some((r) => r.id === hdPick)) hdPick = (rooms.find((r) => r.id === d.live.stayId) || rooms[0]).id;
    // Rooms that differ only by board, refund or smoking are one room with choices under it.
    const groups = [];
    for (const r of rooms) {
      const rf = roomFacts((r.hotel && r.hotel.room) || (r.facts || {}).room || r.name);
      const key = [rf.base, bedText(rf.beds), rf.view, rf.bedrooms, rf.access].join("|").toLowerCase();
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, rf, opts: [] }));
      g.opts.push({ r, rf });
    }
    groups.forEach((g) => g.opts.sort((a, b) => a.r.total.amount - b.r.total.amount));
    groups.sort((a, b) => a.opts[0].r.total.amount - b.opts[0].r.total.amount);
    const cheapest = Math.min(...rooms.map((r) => r.total.amount));
    const facs = rankFacilities(h && h.facilities);
    const amen = (fa.amenities || []).filter((k) => AMEN_ICON[k]);
    const near = (o.fit && o.fit.reasons || []).find((x) => x.k === "near");
    const desc = h && h.description ? h.description.replace(/\s+/g, " ").trim() : "";
    const short = desc ? firstSentences(desc, 2) : "";
    const optRow = ({ r, rf }, g) => {
      const f = r.facts || {}, on = r.id === hdPick, extra = r.total.amount - g.opts[0].r.total.amount;
      const bits = [f.board && BOARD[f.board] ? L(BOARD[f.board]) : t("noBfast"), r.freeCancelUntil ? t("cancelBy")(fmt(r.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRef")];
      if (rf.smoke === "yes") bits.push(t("smoking")); else if (rf.smoke === "no") bits.push(t("nonSmoking"));
      return `<label class="ro${on ? " on" : ""}"><input type="radio" name="room" value="${r.id}" ${on ? "checked" : ""} />
        <span class="ro__w"><span class="ro__b">${["BB", "HB", "FB", "AI"].includes(f.board) ? ico("cup") : ""}${esc(bits[0])}</span><small>${bits.slice(1).map(esc).join(" · ")}</small></span>
        <span class="ro__p"><b>${esc(money(sar(r.total)))}</b><small>${extra > 0 ? esc(t("plusAmt")(money(extra / 100))) : esc(t("perNightAmt")(money(Math.round(sar(r.total) / nights))))}</small></span></label>`;
    };
    page(`<div class="wrap pg hd">
      ${backLink("#/stay")}
      <div class="hd-gal hd-gal--${Math.min(imgs.length, 4)}" id="hdGal">${imgs.slice(0, 4).map((u, i) => `<img src="${esc(u)}" alt="" data-gi="${i}" ${i ? 'loading="lazy"' : ""} />`).join("")}${imgs.length > 4 ? `<button type="button" class="hd-gal__n" id="allPh">${esc(t("photosN")(imgs.length))}</button>` : ""}</div>
      <div class="pg__grid"><div>
        <div class="hd-top">${fa.stars ? `<span class="ht__stars">${"★".repeat(fa.stars)}</span>` : ""}${o.badge === "best" ? `<span class="pick__k">${esc(t("bestForYou"))}</span>` : ""}</div>
        <h1 class="pg__h hd-t">${esc(h ? h.name : o.name)}</h1>
        <p class="ht__loc">${ico("pin")}${esc((h && h.address) || o.address)}${near ? ` · ${esc(t("kmCentre")(near.km))}` : ""}</p>
        ${amen.length ? `<ul class="hl">${amen.map((k) => `<li>${ico(AMEN_ICON[k])}<span>${esc(t("amenLive")[k] || k)}</span></li>`).join("")}</ul>` : ""}
        ${short ? `<p class="hd-lede">${esc(short)}${desc.length > short.length + 20 ? ` <button type="button" class="link" id="moreDesc">${esc(t("readMore"))}</button>` : ""}</p><p class="hd-lede hd-lede--all" id="allDesc" hidden>${esc(desc)}</p>` : ""}

        <h2 class="hd-h" id="roomsH">${esc(t("roomsH"))}<small>${esc(t("roomsFor")(nights, paxText(d.pax)))}</small></h2>
        <div class="rgs" id="rooms">${groups.slice(0, 10).map((g, gi) => `<section class="rg">
          <div class="rg__h"><b>${esc(roomName(g.rf.base))}</b>${gi === 0 && groups.length > 1 && g.opts[0].r.total.amount === cheapest ? `<span class="tagg">${esc(t("lowestHere"))}</span>` : ""}</div>
          <ul class="rg__f">${g.rf.bedrooms ? `<li>${ico("stays")}${esc(t("bedroomsN")(g.rf.bedrooms))}</li>` : ""}${g.rf.beds.length ? `<li>${ico("bed")}${esc(bedText(g.rf.beds))}</li>` : ""}${g.rf.view ? `<li>${ico("view")}${esc(viewText(g.rf.view))}</li>` : ""}${g.rf.access ? `<li>${ico("access")}${esc(t("accessibleRoom"))}</li>` : ""}<li>${ico("ppl")}${esc(g.opts[0].r.roomsLabel)}</li></ul>
          <div class="rg__o">${g.opts.slice(0, 4).map((x) => optRow(x, g)).join("")}</div>
        </section>`).join("")}</div>
        ${groups.length > 10 ? `<p class="note-s">${esc(t("moreRooms")(groups.length - 10))}</p>` : ""}

        ${hotelLL(o) ? `<h2 class="hd-h">${esc(t("whereIs"))}</h2><div id="hdMap" class="hd-map"></div><p class="map-credit">${esc(t("mapCredit"))}</p><ul class="dists">${marksFor(d).map((m) => { const far = howFar(o, m); return far ? `<li>${ico(m.airport ? "flights" : "pin")}<span>${esc(far.text)}</span></li>` : ""; }).join("")}</ul>` : ""}
        ${facs.length ? `<h2 class="hd-h">${esc(t("amenH"))}</h2><ul class="facs2">${facs.slice(0, 12).map((x) => `<li>${facIco(x)}<span>${esc(x)}</span></li>`).join("")}</ul>${facs.length > 12 ? `<details class="fine"><summary>${esc(t("allFacs")(facs.length))}</summary><ul class="facs2 facs2--all">${facs.slice(12).map((x) => `<li>${facIco(x)}<span>${esc(x)}</span></li>`).join("")}</ul></details>` : ""}` : ""}
        <h2 class="hd-h">${esc(t("policyH"))}</h2>
        <ul class="gk">${fa.payAtHotel ? `<li>${ico("card")}<span>${esc(t("payAtHotel")(money(fa.payAtHotel / 100)))}</span></li>` : ""}<li>${ico("visa")}<span>${esc(t("idNote"))}</span></li>${h && h.phone ? `<li>${ico("chat")}<span>${esc(t("hotelPhone"))} <a class="link" href="tel:${esc(h.phone)}" dir="ltr">${esc(h.phone)}</a></span></li>` : ""}</ul>
      </div><aside class="pg__side">${sumCard(d)}${helpLine(helpContextFor("hotel", d))}</aside></div>
      <div class="choose" id="choose"></div>
    </div>
    <div class="lb" id="lb" hidden><button type="button" class="lb__x" id="lbX" aria-label="${esc(t("close"))}">×</button><button type="button" class="lb__nav" data-lb="-1" aria-label="‹">‹</button><img id="lbImg" alt="" /><button type="button" class="lb__nav" data-lb="1" aria-label="›">›</button><span id="lbN"></span></div>`);
    const bar = () => {
      const r = rooms.find((x) => x.id === hdPick), rf = roomFacts((r.hotel && r.hotel.room) || (r.facts || {}).room || r.name), f = r.facts || {};
      const same = r.id === d.live.stayId;
      $("#choose").innerHTML = `<div class="choose__in"><div><b>${esc(roomName(rf.base))}${rf.beds.length ? ` · ${esc(bedText(rf.beds))}` : ""}</b><small>${esc([f.board && BOARD[f.board] ? L(BOARD[f.board]) : t("noBfast"), r.freeCancelUntil ? t("cancelBy")(fmt(r.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRef"), t("forStay")(nights, r.rooms)].join(" · "))}</small></div>
        <div class="choose__p"><b>${esc(money(sar(r.total)))}</b><button type="button" class="btn btn--main" id="chooseGo">${esc(same ? t("keepRoom") : t("selectRoom"))}</button></div></div>`;
      $("#chooseGo").addEventListener("click", () => { d.live.stayId = r.id; d.live.stayPick = r; d.items.stay = true; d.flightsOnly = false; saveDraft(); location.hash = "#/plan"; });
    };
    bar();
    $("#rooms").addEventListener("change", (e) => { hdPick = e.target.value; $$("#rooms .ro").forEach((l) => l.classList.toggle("on", $("input", l).checked)); bar(); });
    $("#moreDesc")?.addEventListener("click", () => { $("#allDesc").hidden = false; $("#moreDesc").closest("p").hidden = true; });
    // Every photo, one at a time, with the arrows and the keyboard.
    let gi = 0;
    const show = (i) => { gi = (i + imgs.length) % imgs.length; $("#lbImg").src = imgs[gi]; $("#lbN").textContent = `${gi + 1} / ${imgs.length}`; };
    const openLb = (i) => { $("#lb").hidden = false; show(i); document.body.style.overflow = "hidden"; };
    const closeLb = () => { $("#lb").hidden = true; document.body.style.overflow = ""; };
    $$("#hdGal img").forEach((im) => im.addEventListener("click", () => openLb(+im.dataset.gi)));
    $("#allPh")?.addEventListener("click", () => openLb(0));
    $("#lbX").addEventListener("click", closeLb);
    $$("[data-lb]").forEach((b) => b.addEventListener("click", () => show(gi + +b.dataset.lb)));
    $("#lb").addEventListener("click", (e) => { if (e.target.id === "lb") closeLb(); });
    document.onkeydown = (e) => { if ($("#lb") && !$("#lb").hidden) { if (e.key === "Escape") closeLb(); if (e.key === "ArrowRight") show(gi + (lang === "ar" ? -1 : 1)); if (e.key === "ArrowLeft") show(gi + (lang === "ar" ? 1 : -1)); } };
    if ($("#hdMap")) drawMap($("#hdMap"), [o], marksFor(d), { selected: o.id, zoom: 14 });
  }

  // ----- sign in: a 6-digit code to the phone (staging and mock servers always use 123456) -----
  let lsi = { step: "phone", phone: "" };
  function viewSigninLive() {
    const next = (location.hash.split("?next=")[1] || "").replace(/[^a-z0-9/-]/gi, "");
    const done = async () => { lsi = { step: "phone", phone: "" }; await afterSignIn(); location.hash = next ? `#/${next}` : "#/"; };
    let body;
    if (lsi.step === "phone") body = `<form id="si" novalidate><label class="fld" id="fSi"><span>${esc(t("siPhone"))}</span><div class="phone"><b>+966</b><input name="phone" inputmode="tel" placeholder="5X XXX XXXX" autocomplete="tel-national" value="${esc(lsi.phone)}" /></div><em>${esc(t("errPhone"))}</em></label><button class="primary">${esc(t("siSend"))}</button></form>`;
    else if (lsi.step === "code") body = `<p class="pg__sub">${esc(t("siCode")("+966 " + lsi.phone))}</p><form id="si" novalidate><div class="otp otp--6">${[0, 1, 2, 3, 4, 5].map((i) => `<input inputmode="numeric" maxlength="1" data-o="${i}" aria-label="${i + 1}" autocomplete="one-time-code" />`).join("")}</div>${A.config && /staging|localhost/.test(location.host + (A.config.latestVersion || "")) || /staging|localhost/.test(location.host) ? `<p class="note-s" style="text-align:center">${esc(t("demoCode"))}</p>` : ""}<p class="note-s err-line" id="siErr" hidden></p><button class="primary">${esc(t("siVerify"))}</button></form><p style="text-align:center"><button type="button" class="link" id="resend">${esc(t("siResend"))}</button></p>`;
    else body = `<form id="si" novalidate><label class="fld"><span>${esc(t("siNameL"))}</span><input name="name" autocomplete="given-name" /></label><button class="primary">${esc(t("siDone"))}</button></form>`;
    page(`<div class="auth"><h1 class="pg__h">${esc(lsi.step === "name" ? t("siName") : t("siTitle"))}</h1>${lsi.step === "phone" ? `<p class="pg__sub">${esc(next === "travelers" ? t("liveSignFirst") : t("siSub"))}</p>` : ""}${body}</div>`);
    const f = $("#si");
    if (lsi.step === "code") {
      const os = $$("[data-o]"); os[0].focus();
      os.forEach((o, i) => {
        o.addEventListener("input", () => { const v = o.value.replace(/\D/g, ""); if (v.length > 1) { v.split("").slice(0, 6 - i).forEach((c, k) => { os[i + k].value = c; }); } else o.value = v; const nx = os.find((x) => !x.value); if (nx) nx.focus(); else f.requestSubmit(); });
        o.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !o.value && os[i - 1]) os[i - 1].focus(); });
      });
      $("#resend").addEventListener("click", async () => { try { await A.sendCode("+966" + lsi.phone); toast("✓"); } catch (e) { toast(e.message); } });
    } else $("input", f)?.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $(".primary", f); btn.disabled = true;
      try {
        if (lsi.step === "phone") {
          const ph = $('[name="phone"]').value.replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
          if (!/^5\d{8}$/.test(ph)) { $("#fSi").classList.add("err"); btn.disabled = false; return; }
          await A.sendCode("+966" + ph); lsi = { step: "code", phone: ph }; return viewSigninLive();
        }
        if (lsi.step === "code") {
          const code = $$("[data-o]").map((x) => x.value).join(""); if (code.length < 6) { btn.disabled = false; return; }
          const r = await A.verifyCode("+966" + lsi.phone, code);
          await afterSignIn();
          if (r.isNew || !r.user.name) { lsi.step = "name"; return viewSigninLive(); }
          return done();
        }
        const name = $('[name="name"]').value.trim(); if (!name) { btn.disabled = false; return; }
        try { await A.updateMe({ name }); await A.me(); } catch {}
        return done();
      } catch (err) {
        btn.disabled = false;
        const el = $("#siErr"); if (el) { el.hidden = false; el.textContent = err.message || t("siWrong"); } else toast(err.message || t("siWrong"));
        $$("[data-o]").forEach((x) => { x.value = ""; }); $$("[data-o]")[0]?.focus();
      }
    });
  }
  async function afterSignIn() {
    const u = A.user || {};
    user = A.signedIn ? { name: u.name || (lang === "ar" ? "مسافر" : "Traveller"), phone: (u.phone || "").replace(/^\+966/, ""), email: u.email || "" } : null;
    store.set("user", user);
    renderHeader();
  }

  // ----- travellers: the account's household (the same people as in the app) -----
  async function viewTravelersLive() {
    const d = draft;
    if (!A.signedIn) return location.replace("#/signin?next=travelers");
    page(loading(t("liveLoadingPeople")));
    let people = [];
    try { people = (await A.people()).people; } catch (e) { if (e.status === 401) { await A.signOut(); return location.replace("#/signin?next=travelers"); } return page(errBox(e.message, true)); }
    if (route().name !== "travelers") return;
    const ks = kinds(d.pax), self = people.find((p) => p.isSelf), others = people.filter((p) => !p.isSelf);
    co.lt = ks.map((k, i) => { const prev = (co.lt || [])[i]; if (prev && prev.k === k) return prev; return i === 0 && k === "a" && self ? { k, personId: self.id, first: self.givenNames || (user && user.name) || "", last: self.surname || "", dob: "" } : { k, personId: null, first: "", last: "", dob: "" }; });
    co.contact = co.contact || { phone: (A.user && A.user.phone || "").replace(/^\+966/, ""), email: (A.user && A.user.email) || "" };
    const label = { a: t("tAdult"), c: t("tChild"), i: t("tInfant") };
    page(`<div class="wrap pg">
      ${backLink("#/plan")}${steps(1)}
      <h1 class="pg__h">${esc(t("trvTitle"))}</h1><p class="pg__sub">${esc(t("trvSub"))}</p>
      <div class="pg__grid"><form id="trvForm" novalidate>
        ${others.length ? `<div class="box"><h2 class="box__h">${esc(t("savedPick"))}</h2><div class="saved">${others.map((p) => `<button type="button" class="chip" data-person="${p.id}">${esc(p.givenNames || p.firstName)} ${esc(p.surname)}</button>`).join("")}</div></div>` : ""}
        <div class="box">${co.lt.map((x, i) => `<div class="trv" data-i="${i}">
          <div class="trv__h"><b>${esc(t("travelerN")(i + 1, label[x.k]))}${x.personId && self && x.personId === self.id ? ` · ${esc(t("you"))}` : ""}</b><span class="tagname" data-tag="${i}"></span></div>
          <div class="fgrid">
            <label class="fld"><span>${esc(t("first"))}</span><input name="first" value="${esc(x.first)}" autocomplete="given-name" autocapitalize="characters" ${x.personId && x.personId !== (self && self.id) ? "readonly" : ""} /><em>${esc(t("errName"))}</em></label>
            <label class="fld"><span>${esc(t("last"))}</span><input name="last" value="${esc(x.last)}" autocomplete="family-name" autocapitalize="characters" ${x.personId && x.personId !== (self && self.id) ? "readonly" : ""} /><em>${esc(t("errName"))}</em></label>
            ${x.k !== "a" ? `<label class="fld"><span>${esc(t("dob"))}</span><input name="dob" type="date" value="${esc(x.dob)}" max="${todayIso()}" /><em>${esc(x.k === "c" ? t("errChildAge") : t("errInfAge"))}</em></label>` : ""}
          </div></div>`).join("")}<p class="note-s">${esc(t("passportLater"))}</p></div>
        <div class="box"><h2 class="box__h">${esc(t("contactH"))}</h2><div class="fgrid">
          <label class="fld" id="fPhone"><span>${esc(t("phone"))}</span><div class="phone"><b>+966</b><input name="phone" inputmode="tel" value="${esc(co.contact.phone)}" placeholder="5X XXX XXXX" /></div><em>${esc(t("errPhone"))}</em></label>
          <label class="fld" id="fEmail"><span>${esc(t("email"))}</span><input name="email" type="email" value="${esc(co.contact.email)}" /><em>${esc(t("errEmail"))}</em></label></div></div>
        <p class="note-s err-line" id="trvErr" hidden></p>
        <button type="submit" class="primary">${esc(t("toPay"))}</button>
      </form><aside class="pg__side">${sumCard(d)}${helpLine(helpContextFor("travelers", d))}</aside></div></div>`);
    const form = $("#trvForm");
    const tag = (i) => { const x = co.lt[i]; $(`[data-tag="${i}"]`).textContent = x.last || x.first ? `${(x.last || "").toUpperCase()}/${(x.first || "").toUpperCase()}` : ""; };
    co.lt.forEach((_, i) => tag(i));
    form.addEventListener("input", (e) => {
      const row = e.target.closest(".trv");
      if (row) { const i = +row.dataset.i; co.lt[i][e.target.name] = e.target.value; tag(i); } else if (e.target.name) co.contact[e.target.name] = e.target.value;
      e.target.closest(".fld")?.classList.remove("err"); store.set("checkout", co);
    });
    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-person]"); if (!b) return;
      const p = people.find((x) => x.id === b.dataset.person); if (co.lt.some((x) => x.personId === p.id)) return;
      const j = co.lt.findIndex((x, i) => i > 0 && !x.personId && !x.first); if (j < 0) return;
      co.lt[j] = { ...co.lt[j], personId: p.id, first: p.givenNames || p.firstName, last: p.surname, dob: p.dateOfBirth || "" }; store.set("checkout", co); viewTravelersLive();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let firstBad = null; const bad = (el) => { el.classList.add("err"); firstBad = firstBad || el; };
      const latin = /^[A-Za-z][A-Za-z' -]*$/;
      co.lt.forEach((x, i) => {
        const row = $(`.trv[data-i="${i}"]`);
        if (!latin.test((x.first || "").trim())) bad($('[name="first"]', row).closest(".fld"));
        if (!latin.test((x.last || "").trim())) bad($('[name="last"]', row).closest(".fld"));
        if (x.k !== "a") { const age = x.dob ? (new Date(d.dep) - new Date(x.dob)) / (365.25 * 864e5) : -1; if (x.k === "c" ? age < 2 || age >= 12 : age < 0 || age >= 2) bad($('[name="dob"]', row).closest(".fld")); }
      });
      const ph = String(co.contact.phone || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
      if (!/^5\d{8}$/.test(ph)) bad($("#fPhone")); else co.contact.phone = ph;
      if (co.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(co.contact.email)) bad($("#fEmail"));
      if (firstBad) { firstBad.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const btn = $(".primary", form); btn.disabled = true;
      try {
        // New people join the household on the account, so the app shows them too.
        for (const x of co.lt) {
          if (x.personId) continue;
          const body = { givenNames: x.first.trim().toUpperCase(), surname: x.last.trim().toUpperCase(), relation: x.k === "a" ? "family" : "child", ...(x.dob ? { dateOfBirth: x.dob } : {}) };
          x.personId = (await A.addPerson(body)).person.id;
        }
        store.set("checkout", co); location.hash = "#/pay";
      } catch (err) { btn.disabled = false; const el = $("#trvErr"); el.hidden = false; el.textContent = err.message; }
    });
  }

  // ----- pay: the same offers priced again for these travellers, the API's order sheet, then the orders -----
  async function viewPayLive() {
    const d = draft;
    if (!A.signedIn) return location.replace("#/signin?next=travelers");
    if (!co.lt || co.lt.some((x) => !x.personId)) return location.replace("#/travelers");
    const ids = co.lt.filter((x) => x.k !== "i").map((x) => x.personId);
    page(loading(t("rebinding")));
    const pl = buildPlan(d), on = (k) => pl.items.some((i) => i.k === k && i.on && !i.info);
    const nights = d.ret ? nightsOf(d.dep, d.ret) : 3;
    // The offers found while planning were priced for this party, so they book as they are; one that has expired is
    // searched again for these travellers, keeping the same flight and the same hotel and room.
    const fresh = {
      async trip() {
        const want = liveOut(d), r = await A.flights({ from: d.from, destination: d.live.key, depart: d.dep, return: d.ret, infants: d.pax.i, cabin: "economy", flexibleDays: 0 }, d.pax, ids);
        const o = r.options.find((x) => sameFlight(x, want)) || r.options[0]; if (!o) throw new A.ApiError("GONE", t("liveFlightsNone"));
        d.live.flights = r; d.live.outId = o.id; return { kind: "trip", flightOfferId: o.id, bundle: false, travellerIds: ids };
      },
      async stay() {
        const want = liveStay(d), r = await A.stays({ destination: d.live.key || "other", place: d.live.key ? null : { name: D.byCode[d.to].city }, checkIn: d.dep, nights }, d.pax, ids);
        let o = r.options.find((x) => x.hotel && want.hotel && x.hotel.code === want.hotel.code); if (!o) throw new A.ApiError("GONE", t("liveStaysNone"));
        if (want.hotel.room && o.hotel.room !== want.hotel.room) { try { const rm = (await A.rooms(o.id)).options.find((x) => x.hotel && x.hotel.room === want.hotel.room && (x.facts || {}).board === (want.facts || {}).board); if (rm) o = rm; } catch {} }
        d.live.stays = r; d.live.stayId = o.id; d.live.stayPick = o; return { kind: "stay", stayOfferId: o.id, travellerIds: ids };
      },
    };
    const drafts = [];
    if (on("flight") && liveOut(d)) drafts.push({ kind: "trip", flightOfferId: d.live.outId, bundle: false, travellerIds: ids });
    if (on("stay") && liveStay(d)) drafts.push({ kind: "stay", stayOfferId: d.live.stayId, travellerIds: ids });
    if (on("esim")) { const e = liveEsim(d); if (e) drafts.push({ kind: "esim", count: ids.length, packageId: e.id, travellerIds: ids, days: d.live.esim.days }); }
    if (!drafts.length) return page(errBox(t("liveNothing")));
    // Each part is priced on its own: one that can't be booked online (an eSIM before it's switched on, say) is left
    // out and named, and the rest still goes ahead.
    const got = await Promise.allSettled(drafts.map(async (x, i) => {
      try { return (await A.preview({ draft: x })).preview; }
      catch (e) { if (!fresh[x.kind] || e.status === 401) throw e; drafts[i] = await fresh[x.kind](); return (await A.preview({ draft: drafts[i] })).preview; }
    }));
    if (got.some((g) => g.status === "rejected" && g.reason && g.reason.status === 401)) { await A.signOut(); return location.replace("#/signin?next=travelers"); }
    const okIdx = got.map((g, i) => (g.status === "fulfilled" ? i : -1)).filter((i) => i >= 0);
    if (!okIdx.length) return page(errBox((got[0].reason && got[0].reason.message) || t("liveFlightsDown"), true));
    co.left = got.map((g, i) => (g.status === "rejected" ? { kind: drafts[i].kind, why: (g.reason && g.reason.message) || "" } : null)).filter(Boolean);
    co.previews = okIdx.map((i) => got[i].value); co.drafts = okIdx.map((i) => drafts[i]); saveDraft();
    if (route().name !== "pay") return;
    renderPayLive();
  }
  // Long notes from a hotel, one point a line.
  const pointsOf = (txt) => String(txt || "").replace(/[\u00a0\s]+/g, " ").replace(/[“”"]/g, "").split(/(?<=[.!?])\s*(?=[A-Z\u0600-\u06FF])/).map((x) => x.trim()).filter((x) => x.length > 3);
  function payCard(d, p) {
    const amt = esc(money(sar(p.total)));
    if (p.kind === "trip") {
      const o = liveOut(d);
      const leg = (l, k) => `<div class="pl"><small>${esc(k)} · ${esc(day(l.date))}</small><div class="pl__t"><b>${esc(l.dep)}</b><span>${esc(city(l.from) || l.from)}</span></div><div class="pl__m">${esc(hrs(l.durationMin))}<i></i>${esc(o.stop || t("direct"))}</div><div class="pl__t pl__t--e"><b>${esc(l.arr)}</b><span>${esc(city(l.to) || l.to)}</span></div></div>`;
      return `<section class="pc"><header class="pc__h"><span class="pc__ic">${ico("flights")}</span><div><b>${o ? `${esc(o.airline)} · ${esc(o.out.flightNumber)}${o.back ? ` / ${esc(o.back.flightNumber)}` : ""}` : esc(p.title)}</b><small>${esc(p.lines.map((l) => l.text).join(" · "))}</small></div><strong>${amt}</strong></header>
        ${o ? `<div class="pc__legs">${leg(o.out, t("outL"))}${o.back ? leg(o.back, t("retL")) : ""}</div>` : ""}
        <ul class="pc__f">${p.family && p.family.bags ? `<li>${ico("check")}${esc(t("bagsEach")(p.family.bags))}</li>` : o ? `<li>${ico("check")}${esc(o.bags)}</li>` : ""}${o ? `<li>${ico("clock")}${esc(t("changeL"))}: ${esc(o.changeRule)}</li>` : ""}<li>${ico("shield")}${esc(p.rule)}</li>${p.missingPassports && p.missingPassports.length ? `<li>${ico("visa")}${esc(t("passportLater"))}</li>` : ""}</ul></section>`;
    }
    if (p.kind === "stay") {
      const st = liveStay(d) || {}, f = (p.stay && p.stay.facts) || st.facts || {}, rf = roomFacts((st.hotel && st.hotel.room) || f.room || "");
      const notes = pointsOf(p.stay && p.stay.essentials);
      const cardAtDesk = notes.some((x) => /card/i.test(x) && /check-?in|arrival/i.test(x));
      const summary = p.stay ? (p.stay.refundable && p.stay.freeCancelUntil ? t("cancelBy")(fmt(p.stay.freeCancelUntil, { day: "numeric", month: "short" })) : t("nonRefLong")) : p.rule.split(/ From the hotel| من الفندق/)[0];
      return `<section class="pc"><header class="pc__h pc__h--img">${st.hotel && st.hotel.imageUrl ? `<img src="${esc(st.hotel.imageUrl)}" alt="" />` : `<span class="pc__ic">${ico("stays")}</span>`}<div>${f.stars ? `<span class="ht__stars">${"★".repeat(f.stars)}</span>` : ""}<b>${esc(p.title)}</b><small>${esc(p.lines.map((l) => l.text).join(" · "))}</small></div><strong>${amt}</strong></header>
        <ul class="pc__f">${rf.base ? `<li>${ico("bed")}${esc(roomName(rf.base))}${rf.beds.length ? ` · ${esc(bedText(rf.beds))}` : ""}</li>` : ""}<li>${ico("cup")}${esc(f.board && BOARD[f.board] ? L(BOARD[f.board]) : t("noBfast"))}</li><li class="${p.stay && p.stay.refundable ? "" : "warn"}">${ico("shield")}${esc(summary)}</li>${p.stay && p.stay.payAtHotel ? `<li>${ico("card")}${esc(t("payAtHotel")(money(sar(p.stay.payAtHotel))))}</li>` : ""}${cardAtDesk ? `<li>${ico("card")}${esc(t("cardAtDesk"))}</li>` : ""}</ul>
        ${notes.length ? `<details class="fine pc__notes"><summary>${esc(t("hotelNotesN")(notes.length))}</summary><ul>${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</section>`;
    }
    return `<section class="pc"><header class="pc__h"><span class="pc__ic">${ico("esim")}</span><div><b>${esc(p.title)}</b><small>${esc(p.lines.map((l) => l.text).join(" · "))}</small></div><strong>${amt}</strong></header><ul class="pc__f"><li>${ico("shield")}${esc(p.rule)}</li></ul></section>`;
  }
  function renderPayLive() {
    const d = draft, pv = co.previews, total = pv.reduce((s, p) => s + sar(p.total), 0);
    const holds = pv.map((p) => p.holdExpiresAt).filter(Boolean).sort()[0];
    const tabby = pv.every((p) => p.instalments) ? pv.reduce((s, p) => s + sar(p.instalments.tabby), 0) : null, tamara = pv.every((p) => p.instalments) ? pv.reduce((s, p) => s + sar(p.instalments.tamara), 0) : null;
    if (!co.method || co.method === "apple" || co.method === "hold") co.method = "mada";
    const m = (k, b, small, badge) => `<label class="${co.method === k ? "on" : ""}"><input type="radio" name="pm" value="${k}" ${co.method === k ? "checked" : ""} /><div><b>${esc(b)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>${badge ? (/^</.test(badge) ? `<i class="pmlogo">${badge}</i>` : `<i>${esc(badge)}</i>`) : "<span></span>"}</label>`;
    page(`<div class="wrap pg">
      ${backLink("#/travelers")}${steps(2)}
      <h1 class="pg__h">${esc(t("payTitle"))}</h1>
      ${pv.some((p) => p.demoFare) ? `<div class="nudge" style="margin-top:18px">${esc(t("demoNote"))}</div>` : ""}
      ${(co.left || []).length ? `<div class="nudge nudge--left" style="margin-top:12px"><div><b>${esc(t("hlp").leftOut(joinNames(co.left.map((x) => t("payFor")(x.kind)))))}</b><small>${esc(t("hlp").leftOutSub)}</small></div><a class="btn btn--plain btn--sm" target="_blank" rel="noopener" href="${wa(t("hlp").waLeft(co.left.map((x) => t("payFor")(x.kind)).join(", "), placeName(d)))}">WhatsApp</a></div>` : ""}
      <div class="pg__grid"><form id="payForm" novalidate>
        ${pv.map((p) => payCard(d, p)).join("")}
        <div class="box"><h2 class="box__h">${esc(t("payHow"))}</h2><div class="pm" id="pm">
          ${m("mada", t("mada"), "", LOGO.mada)}${m("card", t("card"), "", LOGO.visa + LOGO.mc)}
          ${tabby ? m("tabby", t("tabby"), t("tabbySub")(money(tabby)), LOGO.tabby) : ""}${tamara ? m("tamara", t("tamara"), t("tamaraSub")(money(tamara)), LOGO.tamara) : ""}
        </div>
        <div class="cardf"><label class="fld full" id="fCard"><span>${esc(t("cardNo"))}</span><input name="cno" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" /><em>${esc(t("errCard"))}</em></label><label class="fld"><span>${esc(t("exp"))}</span><input name="cexp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" /></label><label class="fld"><span>${esc(t("cvc"))}</span><input name="ccvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" /></label></div>
        ${holds ? `<p class="hold-line" id="holdLine"></p>` : ""}
        <p class="note-s">${esc(t("terms"))}</p></div>
        <p class="note-s err-line" id="payErr" hidden></p>
        <button type="submit" class="primary" id="payBtn">${esc(t("payBtn")(money(total)))}</button>
        <div class="trust">${ico("lock")}<p>${esc(t("hlp").secure)}</p></div>
      </form><aside class="pg__side">${sumCard(d, total, co.drafts.map((x) => (x.kind === "trip" ? "flight" : x.kind)))}${helpLine(helpContextFor("pay", d))}</aside></div></div>`);
    if (holds) { const tick = () => { const el = $("#holdLine"); if (!el) return; const mins = Math.max(0, Math.ceil((new Date(holds) - Date.now()) / 60000)); el.textContent = mins ? t("priceHeld")(mins) : t("priceGone"); if (mins) setTimeout(tick, 15000); }; tick(); }
    $("#pm").addEventListener("change", (e) => { co.method = e.target.value; $$("#pm label").forEach((l) => l.classList.toggle("on", $("input", l).checked)); });
    $("#payForm").addEventListener("input", (e) => e.target.closest(".fld")?.classList.remove("err"));
    $("#payForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const no = ($('[name="cno"]').value || "").replace(/\D/g, ""), exp = $('[name="cexp"]').value.trim(), cvc = $('[name="ccvc"]').value.trim();
      if (no.length < 15 || !/^\d{2}\/?\d{2}$/.test(exp) || !/^\d{3,4}$/.test(cvc)) { $("#fCard").classList.add("err"); $("#fCard input").focus(); return; }
      busyOn(t("processing"));
      try {
        const card = await A.tokenizeCard(no);
        const plan = co.method === "tabby" ? "tabby" : co.method === "tamara" ? "tamara" : "full";
        const orders = [];
        for (let i = 0; i < co.drafts.length; i++) {
          let r = await A.createOrder({ draft: co.drafts[i], payment: { method: "new_card", token: card.token, brand: card.brand, last4: card.last4 }, plan, expectedTotal: co.previews[i].total.amount, idempotencyKey: A.newKey(), contactPhone: undefined });
          if (r.outcome === "price_changed") {
            busyOff();
            if (!(await ask({ title: t("priceChangedH"), text: t("priceUp")(money(sar(r.previousTotal)), money(sar(r.preview.total))), ok: t("keepGoing"), cancel: t("stopIt") }))) return;
            busyOn(t("processing")); co.previews[i] = r.preview;
            r = await A.createOrder({ draft: co.drafts[i], payment: { method: "new_card", token: card.token, brand: card.brand, last4: card.last4 }, plan, expectedTotal: r.preview.total.amount, idempotencyKey: A.newKey() });
          }
          if (r.outcome === "hold_ended") { busyOff(); co.previews[i] = r.preview; toast(t("priceGone")); return renderPayLive(); }
          if (r.outcome === "declined" || r.outcome === "blocked") { busyOff(); const el = $("#payErr"); el.hidden = false; el.textContent = r.message; return; }
          if (r.outcome === "requires_action") {
            busyOff();
            const many = co.drafts.length > 1, what = t("payFor")(co.drafts[i].kind);
            const code = await ask({ title: many ? t("otpForH")(what) : t("otpTitle"), text: many ? t("otpForT")(money(sar(co.previews[i].total)), i + 1, co.drafts.length) : t("otpHint"), code: true, hint: /staging|localhost/.test(location.host) ? t("demoCode") : "", ok: t("otpGo"), cancel: t("stopIt") });
            if (!code) return;
            busyOn(t("processing")); r = { order: (await A.threeDs(r.order.id, code.trim())).order };
          }
          orders.push(r.order.id);
        }
        busyOff();
        co.orders = orders; store.set("checkout", co);
        const lo = liveOut(d), ls = liveStay(d);
        store.set("waitMeta", { ids: orders.join(","), to: d.to, dep: d.dep, ret: d.ret, pax: d.pax, flight: lo && { airline: lo.airline, out: lo.out, back: lo.back }, stay: ls && { name: ls.name, img: ls.hotel && ls.hotel.imageUrl, stars: (ls.facts || {}).stars }, passports: co.previews.some((p) => p.missingPassports && p.missingPassports.length) });
        location.hash = `#/wait/${orders.join(",")}`;
      } catch (err) { busyOff(); const el = $("#payErr"); el.hidden = false; el.textContent = err.message; }
    });
  }

  // A sheet on the page for a question in the middle of paying: big text, one clear choice, nothing hidden.
  function ask(opts) {
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "sheet";
      el.innerHTML = `<div class="sheet__card" role="dialog" aria-modal="true"><h2>${esc(opts.title)}</h2>${opts.text ? `<p>${esc(opts.text)}</p>` : ""}
        ${opts.code ? `<input class="sheet__code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" />${opts.hint ? `<small>${esc(opts.hint)}</small>` : ""}` : ""}
        <div class="sheet__go"><button type="button" class="btn btn--main" data-ok>${esc(opts.ok)}</button>${opts.cancel ? `<button type="button" class="btn btn--plain" data-no>${esc(opts.cancel)}</button>` : ""}</div></div>`;
      document.body.append(el);
      const input = $(".sheet__code", el); (input || $("[data-ok]", el)).focus();
      const close = (v) => { el.remove(); resolve(v); };
      $("[data-ok]", el).addEventListener("click", () => { if (input && input.value.replace(/\D/g, "").length !== 6) { input.focus(); return; } close(input ? input.value.replace(/\D/g, "") : true); });
      $("[data-no]", el)?.addEventListener("click", () => close(null));
      input?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("[data-ok]", el).click(); });
    });
  }

  // ----- with Mada: the desk confirms (the same screen as the app's "With Faisal") -----
  let waitTimer = null;
  async function viewWait(idsCsv) {
    clearTimeout(waitTimer);
    const ids = (idsCsv || "").split(",").filter(Boolean);
    if (!ids.length || !A.signedIn) return location.replace("#/trips");
    let orders;
    try { orders = (await Promise.all(ids.map((id) => A.order(id)))).map((r) => r.order); } catch (e) { return page(errBox(e.message, true)); }
    if (route().name !== "wait") return;
    const main = orders.find((o) => o.kind === "trip") || orders[0];
    const done = orders.every((o) => ["confirmed", "cancelled", "declined"].includes(o.status));
    const ok = orders.every((o) => o.status === "confirmed");
    const agent = (main.confirmedBy || main.agent || {}).name || "Mada";
    const q = orders.find((o) => o.question);
    const failed = orders.find((o) => o.status === "ticketing_failed" || o.status === "declined" || o.status === "cancelled");
    const wm = store.get("waitMeta"), meta = wm && wm.ids === idsCsv ? wm : {};
    const stepNow = ok ? 4 : Math.min(...orders.map((o) => (o.status === "confirmed" ? 4 : o.step)));
    const words = t("orderStatus") || {};
    const chip = (o) => o.status === "confirmed" ? `<span class="wc__st">${ico("check")}${esc(o.ref ? `${t("refL")} ${o.ref}` : t("waitDone"))}</span>` : `<span class="wc__st wc__st--on"><i></i>${esc(words[o.status] || o.status.replace(/_/g, " "))}</span>`;
    const legRow = (l) => `<div class="wl"><b>${esc(l.dep)}</b><span>${esc(city(l.from) || l.from)}</span><i></i><span>${esc(city(l.to) || l.to)}</span><b>${esc(l.arr)}</b><small>${esc(day(l.date))} · ${esc(l.flightNumber)}</small></div>`;
    const lines = (o) => `<small>${esc(o.lines.map((l) => l.text).join(" · "))}</small>`;
    const itemCard = (o) => {
      if (o.kind === "trip") { const f = meta.flight; return `<article class="wc"><span class="pc__ic">${ico("flights")}</span><div class="wc__b"><b>${esc(f ? f.airline : o.airline || o.title)}</b>${f ? legRow(f.out) + (f.back ? legRow(f.back) : "") : lines(o)}</div>${chip(o)}</article>`; }
      if (o.kind === "stay") { const h = meta.stay || {}; return `<article class="wc">${h.img ? `<img class="wc__img" src="${esc(h.img)}" alt="" />` : `<span class="pc__ic">${ico("stays")}</span>`}<div class="wc__b">${h.stars ? `<span class="ht__stars">${"★".repeat(h.stars)}</span>` : ""}<b>${esc(o.title)}</b>${lines(o)}</div>${chip(o)}</article>`; }
      return `<article class="wc"><span class="pc__ic">${ico("esim")}</span><div class="wc__b"><b>${esc(o.title)}</b>${lines(o)}</div>${chip(o)}</article>`;
    };
    const to = meta.to || Object.keys(KEY).find((c) => city(c) === main.place);
    page(`<div class="wait2">
      <header class="wh">${to && D.DEST[to] ? `<img src="${esc(D.photo(to))}" alt="" />` : ""}<div class="wrap wh__in">
        <span class="wh__pill${ok ? " ok" : ""}">${ok ? ico("check") : "<i></i>"}${esc(ok ? t("waitDone") : t("waitTitle"))}</span>
        <h1>${esc(ok ? t("waitBooked")(main.place || main.title) : main.place || main.title)}</h1>
        <p>${esc(meta.dep ? `${range(meta.dep, meta.ret)} · ${paxText(meta.pax)}` : main.title)}</p></div></header>
      <div class="wrap pg pg--narrow wait2__body">
        <section class="wbox">
          <div class="wa"><span class="wa__av">${esc((agent[0] || "M").toUpperCase())}</span><div><b>${esc(ok ? (main.confirmedBy && main.confirmedBy.name ? t("waitOkH")(main.confirmedBy.name) : t("waitOkPlain")) : t("waitOnIt")(agent))}</b><p>${esc(ok ? t("waitOkSub") : t("waitCloseOk"))}</p></div></div>
          <ol class="wsteps">${t("waitSteps").map((x, i) => `<li class="${i < stepNow ? "done" : i === stepNow ? "now" : ""}"><span>${i < stepNow ? ico("check") : i + 1}</span><b>${esc(x)}</b></li>`).join("")}</ol>
          ${orders.some((o) => o.slow) && !ok ? `<p class="note-s">${esc(t("waitSlow"))}</p>` : ""}
        </section>
        ${q ? `<section class="wbox wq"><h2 class="box__h">${esc(t("waitQuestion"))}</h2><p>${esc(q.question.text)}</p><div class="actions"><button type="button" class="btn btn--main" data-ans="yes">${esc(t("waitYes"))}</button><button type="button" class="btn btn--plain" data-ans="call">${esc(t("waitCall"))}</button></div></section>` : ""}
        ${failed && !ok ? `<div class="nudge">${esc((failed.result && failed.result.reason) || failed.problem || t("waitFailed"))}</div>` : ""}
        <h2 class="hd-h">${esc(t("waitWhat"))}</h2>
        <div class="wcs">${orders.map(itemCard).join("")}</div>
        <h2 class="hd-h">${esc(t("waitNext"))}</h2>
        <ul class="gk wn"><li>${ico("chat")}<span>${esc(t("waitNext1"))}</span></li>${meta.passports ? `<li>${ico("visa")}<span>${esc(t("passportLater"))}</span></li>` : ""}<li>${ico("cal")}<span>${esc(t("waitNext3"))}</span></li></ul>
        <div class="wgo">${main.tripId && ok ? `<a class="primary primary--link" href="#/t/${main.tripId}">${esc(t("waitOpen"))}</a>` : ""}<a class="btn btn--plain" href="${wa(t("waHi")(main.ref || main.id.slice(0, 8)))}" target="_blank" rel="noopener">${ico("chat")}${esc(t("waitTalk")(agent))}</a></div>
        <p class="note-s wcall">${esc(t("hlp").orCall)} <a class="link" href="tel:${PHONE}" dir="ltr">${PHONE_TXT}</a> · ${esc(t("hlp").hours)}</p>
      </div>
    </div>`);
    $$("[data-ans]").forEach((b) => b.addEventListener("click", async () => { try { await A.answer(q.id, b.dataset.ans); } catch (e) { toast(e.message); } viewWait(idsCsv); }));
    if (ok) { draft = null; store.set("draft", null); co = {}; store.set("checkout", null); }
    if (!done) waitTimer = setTimeout(() => { if (route().name === "wait") viewWait(idsCsv); }, 1500);
  }

  // ----- trips from the account (booked on the web or in the app) -----
  async function viewTripsLive() {
    if (!A.signedIn) return viewTrips();
    page(loading(t("tripsTitle")));
    let r;
    try { r = await A.trips(); } catch (e) { return page(errBox(e.message, true)); }
    if (route().name !== "trips") return;
    const card = (x) => `<a class="tcard" href="#/t/${x.id}">${tripImg(x) ? `<img src="${esc(tripImg(x))}" alt="" />` : `<span class="tcard__ph"></span>`}<div><b>${esc(x.city)}</b><span>${esc(range(x.startDate, x.endDate))} · ${esc(x.travellerNames.join(", "))}</span></div><span><em class="status">${esc(x.flight ? x.flight.code : (lang === "ar" ? "رحلة" : "Trip"))}</em></span></a>`;
    page(`<div class="wrap pg"><h1 class="pg__h">${esc(t("tripsTitle"))}</h1>
      ${r.upcoming.length || r.past.length ? `<div class="tlist">${r.upcoming.map(card).join("")}</div>${r.past.length ? `<div class="bar"><h2>${esc(t("past"))}</h2></div><div class="tlist tlist--past">${r.past.map(card).join("")}</div>` : ""}`
        : `<div class="empty"><p>${esc(t("tripsNone"))}</p><a class="btn btn--main" href="#/">${esc(t("tripsPlan"))}</a></div>`}</div>`);
  }
  // The API names its own photos ("dubai-skyline"); the site has the city's photo.
  const tripImg = (x) => (x.imageUrl && /^(https?:)?\//.test(x.imageUrl) ? x.imageUrl : (() => { const c = Object.keys(KEY).find((k) => D.byCode[k] && D.byCode[k].city === x.city); return c ? D.photo(c) : null; })());
  async function viewTripLive(id) {
    page(loading(t("tripsTitle")));
    let x;
    try { x = (await A.trip(id)).trip; } catch (e) { return page(errBox(e.message, true)); }
    if (route().name !== "t") return;
    const st = t("statusL"), img = tripImg(x);
    page(`<div class="wait2">
      <header class="wh">${img ? `<img src="${esc(img)}" alt="" />` : ""}<div class="wrap wh__in">
        <span class="wh__pill ok">${ico("check")}${esc(t("confirmed"))}${x.bookingRef ? ` · ${esc(x.bookingRef)}` : ""}</span>
        <h1>${esc(t("tripTo")(x.city))}</h1>
        <p>${esc(range(x.startDate, x.endDate))} · ${esc(x.travellers.map((p) => p.firstName || p.name || "").filter(Boolean).join(", "))}</p></div></header>
      <div class="wrap pg wait2__body"><div class="pg__grid" style="margin-top:0"><div>
        ${x.segments.map((s) => `<article class="wbox tseg"><div class="tseg__top"><span class="pc__ic">${ico("flights")}</span><div><b>${esc(s.carrierName)} · ${esc(s.flightNumber)}</b><small>${esc(day(s.departLocal.slice(0, 10)))}</small></div><span class="wc__st${/delay|cancel/.test(s.status) ? " wc__st--on" : ""}">${esc(st[s.status] || s.status)}</span></div>
          <div class="pl"><small>${esc(s.from)} → ${esc(s.to)}</small><div class="pl__t"><b>${esc(s.departLocal.slice(11, 16))}</b><span>${esc(city(s.from) || s.from)}</span></div><div class="pl__m">${esc(hrs(s.durationMin))}<i></i>${esc(t("direct"))}</div><div class="pl__t pl__t--e"><b>${esc(s.arriveLocal.slice(11, 16))}</b><span>${esc(city(s.to) || s.to)}</span></div></div>
          <ul class="tseg__f">${s.terminal ? `<li><small>${esc(t("terminal"))}</small><b>${esc(String(s.terminal).replace(/^Terminal\s*/i, ""))}</b></li>` : ""}<li><small>${esc(t("gate"))}</small><b>${esc(s.gate || "—")}</b></li><li><small>${esc(t("seats"))}</small><b>${esc(s.seats.length ? s.seats.join(", ") : "—")}</b></li>${s.baggage ? `<li><small>${esc(t("bagsL"))}</small><b>${esc(s.baggage)}</b></li>` : ""}</ul></article>`).join("")}
        ${x.stays.map((s) => `<article class="wc">${s.imageUrl && /^(https?:)?\//.test(s.imageUrl) ? `<img class="wc__img" src="${esc(s.imageUrl)}" alt="" />` : `<span class="pc__ic">${ico("stays")}</span>`}<div class="wc__b"><b>${esc(s.name)}</b><small>${esc(day(s.checkIn))} · ${esc(t("forStay")(s.nights, s.rooms))}${s.cancellation ? " · " + esc(s.cancellation) : ""}</small></div><span class="wc__st">${ico("check")}${esc(s.confirmation || s.status)}</span></article>`).join("")}
      </div><aside class="pg__side"><div class="box"><div class="wa"><span class="wa__av">${esc(((x.agent && x.agent.name) || "M")[0].toUpperCase())}</span><div><b>${esc(t("advIntro"))}${x.agent && x.agent.name ? ` · ${esc(x.agent.name)}` : ""}</b><p>${esc(t("advLine"))}</p></div></div>
        <div class="actions" style="margin-top:16px"><a class="btn btn--main" href="${wa(t("waHi")(x.bookingRef || x.id.slice(0, 8)))}" target="_blank" rel="noopener">${esc(t("msgAdv"))}</a><a class="btn btn--plain" href="${wa(t("waChange")(x.bookingRef || ""))}" target="_blank" rel="noopener">${esc(t("reqChange"))}</a><a class="btn btn--plain" href="${wa(t("waCancel")(x.bookingRef || ""))}" target="_blank" rel="noopener">${esc(t("reqCancel"))}</a></div></div>
        <p class="note-s">${esc(t("appSync"))}</p></aside></div></div></div>`);
  }

  // ----- Ask Mada and a person, from any page -----
  // Mada plans and changes trips in the planner; questions about a booking or a payment go to a person, with what
  // the traveller is looking at already in the message.
  function askMada(text) {
    if (draft && draft.plan) { location.hash = "#/plan"; setTimeout(() => send(text), 60); }
    else { draft = freshDraft(); send(text); }
  }
  const helpContextFor = (r, d) => { const H = t("hlp"), trip = d && d.to ? `${placeName(d)} · ${range(d.dep, d.ret)}` : ""; return ["pay", "travelers"].includes(r) && trip ? H.waPay(trip) : ["hotel", "stay", "flights"].includes(r) && trip ? H.waChoosing(trip) : H.waHi; };
  function helpContext() {
    const r = route().name, d = draft, H = t("hlp");
    const trip = d && d.to ? `${placeName(d)} · ${range(d.dep, d.ret)}` : "";
    if (["pay", "travelers"].includes(r) && trip) return H.waPay(trip);
    if (["wait", "t", "trip"].includes(r)) return H.waBooking;
    if (["hotel", "stay", "flights"].includes(r) && trip) return H.waChoosing(trip);
    return H.waHi;
  }
  function helpChips() {
    const r = route().name, H = t("hlp");
    if (draft && draft.plan && ["hotel", "stay"].includes(r)) return H.chipsStay;
    if (draft && draft.plan && r === "flights") return H.chipsFlights;
    if (draft && draft.plan && ["pay", "travelers", "plan"].includes(r)) return H.chipsPlan;
    return H.chipsNew;
  }
  function helpSheet() {
    $(".sheet--help")?.remove();
    const H = t("hlp"), el = document.createElement("div");
    el.className = "sheet sheet--help";
    el.innerHTML = `<div class="sheet__card hs" role="dialog" aria-modal="true" aria-labelledby="hsT"><button type="button" class="lb__x appsheet__x" aria-label="${esc(t("close"))}">×</button>
      <div class="hs__top"><span class="appsheet__mark">${SUN}</span><div><h2 id="hsT">${esc(H.askH)}</h2><p>${esc(draft && draft.plan ? H.askSubTrip(placeName(draft)) : H.askSub)}</p></div></div>
      <form class="hs__ask" id="hsF"><textarea id="hsQ" rows="2" placeholder="${esc(H.askPh)}"></textarea><button class="btn btn--main">${esc(H.askGo)}</button></form>
      <div class="chips hs__chips">${helpChips().map((c) => `<button type="button" class="chip" data-hs="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <p class="hs__or"><span>${esc(H.orPerson)}</span></p>
      <div class="hs__ppl">
        <a class="hb" href="tel:${PHONE}">${ico("phone")}<span><small>${esc(H.call)}</small><b dir="ltr">${PHONE_TXT}</b></span></a>
        <a class="hb" href="${wa(helpContext())}" target="_blank" rel="noopener">${ico("chat")}<span><small>WhatsApp</small><b>${esc(H.waShort)}</b></span></a>
        <a class="hb" href="mailto:${MAIL}">${ico("mail")}<span><small>${esc(H.email)}</small><b>${MAIL}</b></span></a>
      </div>
      <p class="note-s hs__hours">${esc(H.hours)}</p></div>`;
    document.body.append(el);
    const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest(".appsheet__x")) close(); });
    const q = $("#hsQ", el); setTimeout(() => q.focus(), 30);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#hsF", el).requestSubmit(); } });
    $$("[data-hs]", el).forEach((b) => b.addEventListener("click", () => { close(); askMada(b.dataset.hs); }));
    $("#hsF", el).addEventListener("submit", (e) => { e.preventDefault(); const v = q.value.trim(); if (!v) return q.focus(); close(); askMada(v); });
  }
  // The round button that is always there, except where the page already has Mada's box in view.
  function placeFab() {
    const fab = $("#fab"); if (!fab) return;
    const r = route().name;
    const hide = r === "plan" || r === "circle" || (r === "home" && heroAskVisible);
    fab.hidden = hide;
    document.body.classList.toggle("has-choose", !!$("#choose"));
  }
  let heroAskVisible = true;

  // =========================================================
  // Circles, friends and Discover: the app's Circles tab on the web (same API, same covers, same rules)
  // =========================================================
  const S = () => t("soc");
  const C = window.MadaCover;
  const av = (p, cls = "") => `<span class="av av--${esc((p && p.tone) || "default")}${cls ? " " + cls : ""}" title="${esc(p && p.name)}">${esc((p && p.initial) || "?")}</span>`;
  const PHOTO_KEYS = new Set(["istanbul", "alula", "riyadh", "dubai-skyline", "desert-camp", "maldives-overwater", "jeddah-al-balad", "abha-mountains", "baku-old-city"]);
  const photoOf = (key) => (PHOTO_KEYS.has(key) ? `/assets/img/cover/${key}.jpg` : null);
  // A cover as the app draws it: a photo, an upload once it's checked, or a drawing on a colour; nothing is plain green.
  function coverHtml(cover, layout = "banner") {
    if (cover && cover.kind === "photo" && photoOf(cover.id)) return `<img class="cv__img" src="${photoOf(cover.id)}" alt="" />`;
    if (cover && cover.kind === "upload" && cover.url) return `<img class="cv__img" src="${esc(cover.url)}" alt="" />`;
    const w = layout === "badge" ? 120 : layout === "tile" ? 320 : 900, h = layout === "badge" ? 120 : layout === "tile" ? 220 : 300;
    const art = cover && cover.kind === "icon" ? cover : { icon: "heart", color: "green" };
    try { return C.coverArtSvg(art, { width: w, height: h, layout, fill: true, side: lang === "ar" ? "left" : "right" }); } catch { return ""; }
  }
  const coverInk = (cover) => (cover && cover.kind === "icon" && C.coverTextTone(cover.color) === "ink" ? " cv--ink" : "");
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return S().now; if (m < 60) return S().mins(m); const h = Math.round(m / 60); if (h < 24) return S().hrs(h);
    return fmt(iso.slice(0, 10), { day: "numeric", month: "short" });
  };
  const needIn = (next, title, sub) => `<div class="wrap pg"><div class="soc-out"><span class="soc-out__art">${coverHtml({ kind: "icon", icon: "family", color: "sand" }, "badge")}</span><h1 class="pg__h">${esc(title)}</h1><p class="pg__sub">${esc(sub)}</p>
    <div class="soc-out__go"><a class="btn btn--main" href="#/signin?next=${next}">${esc(t("signIn"))}</a><button type="button" class="btn btn--plain" data-app>${esc(S().getApp)}</button></div>${codeBox()}</div></div>`;
  const codeBox = () => `<form class="codebox" id="codeBox"><label for="codeIn">${esc(S().haveCode)}</label><div><input id="codeIn" placeholder="madatrips.sa/join/…" autocomplete="off" /><button class="btn btn--plain">${esc(S().open)}</button></div></form>`;
  function wireCommon() {
    $$("#page [data-app]").forEach((b) => b.addEventListener("click", appSheet));
    $("#codeBox")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const m = ($("#codeIn").value || "").toLowerCase().match(/[a-z0-9]{8}-[a-z0-9]{6}/);
      if (m) location.hash = `#/join/${m[0]}`; else toast(S().badCode);
    });
  }
  const socTabs = (on) => `<nav class="soc-tabs" aria-label="${esc(S().circles)}"><a href="#/discover" class="${on === "discover" ? "on" : ""}">${esc(S().discover)}</a><a href="#/circles" class="${on === "circles" ? "on" : ""}">${esc(S().circles)}</a><a href="#/people" class="${on === "people" ? "on" : ""}">${esc(S().people)}</a></nav>`;

  // ----- Discover: what's on in a city, trips Mada planned, and tips from people who went -----
  let dsKind = "";
  async function viewDiscover() {
    const want = decodeURIComponent((location.hash.split("?city=")[1] || "").split("&")[0]);
    page(loading(S().discover));
    let r;
    try { r = await A.discover(want); } catch (e) {
      if (e.status === 404) {
        page(`<div class="wrap pg">${socTabs("discover")}<div class="empty"><p>${esc(S().notHere(want))}</p><button type="button" class="btn btn--main" id="notify">${esc(S().tellMe)}</button> <a class="btn btn--plain" href="#/discover">${esc(S().seeCovered)}</a></div></div>`);
        return $("#notify").addEventListener("click", async () => { try { await A.notifyCity(want); toast(S().willTell); } catch (x) { toast(x.message); } });
      }
      return page(errBox(e.message, true));
    }
    if (route().name !== "discover") return;
    let posts = null;
    if (A.signedIn) { try { posts = (await A.posts(r.city, dsKind)).posts; } catch { posts = []; } }
    const evCard = (e) => `<article class="ev"><img src="${esc(photoOf(e.photoKey) || D.photo("RUH"))}" alt="" loading="lazy" /><div class="ev__in"><span class="ev__tag">${esc(e.tag)}</span><b>${esc(e.title)}</b><small>${esc(e.when)} · ${esc(e.where)}</small><button type="button" class="btn btn--sm ev__go" data-ask="${esc(S().askFor(e.title, r.city))}">${esc(S().planIt)}</button></div></article>`;
    const planCard = (p) => `<article class="pc2"><img src="${esc(photoOf(p.photoKey) || D.photo("IST"))}" alt="" loading="lazy" /><div><span class="pc2__d">${esc(S().days(p.days))} · ${esc(p.city)}</span><b>${esc(p.title)}</b><small>${esc(p.sub)}</small><button type="button" class="link" data-ask="${esc(p.title)}">${esc(S().planThis)} →</button></div></article>`;
    const tip = (p) => `<article class="tip">
      <header>${av(p.author)}<div><b>${esc(p.author.short || p.author.name)}</b><small>${esc(S().rel[p.relation] || "")}${p.authorTrips ? ` · ${esc(S().trips(p.authorTrips))}` : ""}</small></div><span class="tip__k">${esc(p.kind === "food" ? S().food : S().todo)}</span></header>
      ${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" loading="lazy" />` : ""}
      <p>“${esc(p.text)}”</p>
      <footer><span>${ico("pin")}${esc(p.place)}</span>${p.status === "pending" ? `<em class="tip__p">${esc(S().pending)}</em>` : `<button type="button" class="link" data-thank="${p.id}" ${p.thanked ? "disabled" : ""}>${esc(p.thanked ? S().thanked : S().thanks)}${p.thanks ? ` · ${p.thanks}` : ""}</button>`}</footer></article>`;
    page(`<div class="wrap pg ds">
      ${socTabs("discover")}
      <header class="ds__h"><h1 class="pg__h">${esc(S().onIn)} <span class="ds__city"><select id="dsCity" aria-label="${esc(S().city)}">${r.covered.map((c) => `<option ${c.city === r.city ? "selected" : ""}>${esc(c.city)}</option>`).join("")}</select>${ico("back")}</span></h1>
        ${r.tripDates ? `<p class="pg__sub">${esc(S().whileThere(r.tripDates))}</p>` : `<p class="pg__sub">${esc(S().dsSub)}</p>`}</header>
      ${r.events.length ? `<div class="srail ev-rail">${r.events.map(evCard).join("")}</div>` : ""}
      ${r.plans.length ? `<h2 class="hd-h">${esc(S().planned)}</h2><div class="srail pc2-rail">${r.plans.map(planCard).join("")}</div>` : ""}
      <div class="ds__tips-h"><h2 class="hd-h">${esc(S().fromPeople)}</h2>${A.signedIn ? `<button type="button" class="btn btn--plain btn--sm" id="addTip">+ ${esc(S().shareTip)}</button>` : ""}</div>
      ${A.signedIn ? `<div class="seg2 ds__f">${[["", S().all], ["food", S().food], ["todo", S().todo]].map(([k, l]) => `<button type="button" data-kind="${k}" class="${dsKind === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
        <div id="tipForm"></div>
        ${posts.length ? `<div class="tips">${posts.map(tip).join("")}</div>` : `<div class="empty empty--soft"><p>${esc(S().noTips(r.city))}</p><button type="button" class="btn btn--main" id="addTip2">${esc(S().firstTip)}</button></div>`}`
        : `<div class="empty empty--soft"><p>${esc(S().tipsSignIn)}</p><a class="btn btn--main" href="#/signin?next=discover">${esc(t("signIn"))}</a></div>`}
      ${appBand()}
    </div>`);
    $("#dsCity").addEventListener("change", (e) => { location.hash = `#/discover?city=${encodeURIComponent(e.target.value)}`; });
    $$("[data-kind]").forEach((b) => b.addEventListener("click", () => { dsKind = b.dataset.kind; viewDiscover(); }));
    $$("[data-ask]").forEach((b) => b.addEventListener("click", () => askFromSocial(b.dataset.ask)));
    $$("[data-thank]").forEach((b) => b.addEventListener("click", async () => { try { await A.thank(b.dataset.thank); b.textContent = S().thanked; b.disabled = true; } catch (e) { toast(e.message); } }));
    [$("#addTip"), $("#addTip2")].forEach((b) => b && b.addEventListener("click", () => tipForm(r.city)));
    wireCommon();
  }
  // From an idea to the plan: the same one box, with the sentence already in it.
  function askFromSocial(text) { location.hash = "#/"; setTimeout(() => { const q = $("#q"); if (q) { q.value = text; q.focus(); q.dispatchEvent(new Event("input")); } }, 60); }
  function tipForm(city) {
    const el = $("#tipForm"); if (!el) return;
    el.innerHTML = `<form class="box tipf" id="tipF" novalidate><h3 class="box__h">${esc(S().tipH(city))}</h3>
      <div class="seg2" id="tipKind"><button type="button" data-k="food" class="on">${esc(S().food)}</button><button type="button" data-k="todo">${esc(S().todo)}</button></div>
      <label class="fld"><span>${esc(S().tipPlace)}</span><input name="place" maxlength="80" placeholder="${esc(S().tipPlaceEg)}" /></label>
      <label class="fld"><span>${esc(S().tipText)}</span><textarea name="text" rows="3" maxlength="600" placeholder="${esc(S().tipTextEg)}"></textarea><em>${esc(S().tipShort)}</em></label>
      <label class="chk"><input type="checkbox" name="everyone" /> ${esc(S().tipEveryone)}</label>
      <p class="note-s">${esc(S().tipChecked)}</p>
      <div class="actions"><button class="btn btn--main">${esc(S().post)}</button><button type="button" class="btn btn--plain" id="tipX">${esc(S().cancel)}</button></div></form>`;
    let kind = "food";
    $$("#tipKind button").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.k; $$("#tipKind button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#tipX").addEventListener("click", () => { el.innerHTML = ""; });
    $('[name="place"]', el).focus();
    $("#tipF").addEventListener("submit", async (e) => {
      e.preventDefault();
      const place = $('[name="place"]', el).value.trim(), text = $('[name="text"]', el).value.trim();
      if (place.length < 3 || text.length < 11) { $('[name="text"]', el).closest(".fld").classList.toggle("err", text.length < 11); $('[name="place"]', el).focus(); return; }
      try { await A.addPost({ city, place, text, kind, audience: $('[name="everyone"]', el).checked ? "everyone" : "friends" }); toast(S().tipSent); viewDiscover(); } catch (x) { toast(x.message); }
    });
  }

  // ----- Circles: your people in one place -----
  async function viewCircles() {
    if (!A.signedIn) { page(needIn("circles", S().circlesOutH, S().circlesOutSub)); return wireCommon(); }
    page(loading(S().circles));
    let r, fr;
    try { [r, fr] = await Promise.all([A.circles(), A.friends().catch(() => ({ friends: [], requests: [] }))]); } catch (e) { return page(errBox(e.message, true)); }
    if (route().name !== "circles") return;
    const list = r.circles.filter((c) => !c.dm), dms = r.circles.filter((c) => c.dm);
    const tile = (c) => `<a class="ctile${coverInk(c.cover)}" href="#/circle/${c.id}"><span class="ctile__cv">${coverHtml(c.cover, "tile")}</span>${c.unread ? `<i class="ctile__n">${c.unread}</i>` : ""}
      <span class="ctile__in"><b>${esc(c.name)}</b><small>${esc(c.trip || c.dest || S().members(c.memberCount))}</small>
      <span class="ctile__ppl">${c.preview.slice(0, 4).map((p) => av(p)).join("")}${c.memberCount > 4 ? `<em>+${c.memberCount - 4}</em>` : ""}</span>
      ${c.last ? `<span class="ctile__last">${esc(lastLine(c.last))}</span>` : ""}</span></a>`;
    page(`<div class="wrap pg soc">
      ${socTabs("circles")}
      <div class="soc__h"><h1 class="pg__h">${esc(S().circles)}</h1><a class="btn btn--main" href="#/circles/new">+ ${esc(S().newCircle)}</a></div>
      <p class="pg__sub">${esc(S().circlesSub)}</p>
      ${r.limited ? `<div class="nudge">${esc(S().limited)}</div>` : ""}
      ${r.incoming.length ? `<h2 class="hd-h">${esc(S().invitedYou)}</h2><div class="incs">${r.incoming.map((x) => `<article class="inc${coverInk(x.circle.cover)}"><span class="inc__cv">${coverHtml(x.circle.cover, "badge")}</span><div><b>${esc(x.circle.name)}</b><small>${esc(S().fromX(x.from.short || x.from.name))} · ${esc(S().members(x.circle.memberCount))}</small></div><div class="actions"><button type="button" class="btn btn--main btn--sm" data-join="${x.inviteId}">${esc(S().join)}</button><button type="button" class="btn btn--plain btn--sm" data-decline="${x.inviteId}">${esc(S().notNow)}</button></div></article>`).join("")}</div>` : ""}
      <h2 class="hd-h">${esc(S().yourCircles)}${list.length ? ` <span class="hd-n">${list.length}</span>` : ""}</h2>
      ${list.length ? `<div class="ctiles">${list.map(tile).join("")}<a class="ctile ctile--new" href="#/circles/new"><span>+</span><b>${esc(S().newCircle)}</b><small>${esc(S().newCircleSub)}</small></a></div>`
        : `<div class="soc-empty"><span class="soc-empty__art">${coverHtml({ kind: "icon", icon: "family", color: "sand" }, "badge")}</span><div><b>${esc(S().emptyH)}</b><p>${esc(S().emptySub)}</p><a class="btn btn--main" href="#/circles/new">${esc(S().startCircle)}</a></div></div>`}
      <div class="soc__row"><h2 class="hd-h">${esc(S().friends)}${fr.requests.length ? ` <i class="badge">${fr.requests.length}</i>` : ""}</h2><a class="link" href="#/people">${esc(fr.friends.length ? S().seeAll : S().addFriends)} →</a></div>
      ${fr.friends.length ? `<div class="frow">${fr.friends.slice(0, 12).map((p) => `<a href="#/friend/${p.id}" class="frow__p">${av(p, "av--lg")}<span>${esc(p.short || p.name)}</span>${p.going ? `<small>${esc(p.going)}</small>` : ""}</a>`).join("")}</div>`
        : `<div class="soc-empty soc-empty--row"><p>${esc(S().noFriends)}</p><a class="btn btn--plain" href="#/people">${esc(S().addFriends)}</a></div>`}
      ${dms.length ? `<h2 class="hd-h">${esc(S().messages)}</h2><div class="dms">${dms.map((c) => `<a class="dm" href="#/circle/${c.id}">${av(c.preview[0] || { initial: c.name[0] })}<div><b>${esc(c.name)}</b><small>${esc(c.last ? lastLine(c.last) : S().sayHi)}</small></div>${c.unread ? `<i class="badge">${c.unread}</i>` : `<small>${c.last ? esc(ago(c.last.createdAt)) : ""}</small>`}</a>`).join("")}</div>` : ""}
      ${codeBox()}
      ${appBand()}
    </div>`);
    $$("[data-join]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const x = await A.acceptInvite(b.dataset.join); location.hash = x.circleId ? `#/circle/${x.circleId}` : "#/circles"; } catch (e) { b.disabled = false; toast(e.message); } }));
    $$("[data-decline]").forEach((b) => b.addEventListener("click", async () => { try { await A.declineInvite(b.dataset.decline); viewCircles(); } catch (e) { toast(e.message); } }));
    wireCommon();
  }
  function lastLine(m) {
    const who = m.author && m.author.kind === "user" ? (m.author.id === (A.user || {}).id ? S().you : (m.author.name || "").split(" ")[0]) : "Mada";
    if (m.kind === "sys" && m.sys) return sysLine(m, (A.user || {}).id, new Map()).slice(0, 90);
    const what = m.kind === "vote" && m.vote ? `📊 ${m.vote.q}` : m.kind === "split" ? S().aSplit : m.kind === "card" ? S().aCard : m.kind === "mada" && m.mada && m.mada.kind === "welcome" ? CC("circles.mada") : m.body;
    return `${who}: ${what || ""}`.slice(0, 90);
  }

  // ----- one circle: the chat, who's in, the link -----
  let chatTimer = null, chatLast = "";
  async function viewCircle(id) {
    clearTimeout(chatTimer);
    if (!A.signedIn) return location.replace(`#/signin?next=circle/${id}`);
    page(loading(S().circles));
    let det, msgs;
    try { [det, msgs] = await Promise.all([A.circle(id), A.messages(id)]); } catch (e) { return page(e.status === 404 ? `<div class="wrap pg"><div class="empty"><p>${esc(S().noCircle)}</p><a class="btn btn--main" href="#/circles">${esc(S().circles)}</a></div></div>` : errBox(e.message, true)); }
    if (route().name !== "circle") return;
    const c = det.circle, me = (A.user || {}).id, admin = c.role === "admin";
    A.updateCircle(id, { read: true }).catch(() => {});
    page(`<div class="chat${coverInk(c.cover)}">
      <header class="chat__cv">${coverHtml(c.cover, "header")}<div class="wrap chat__cvin">${backLink("#/circles", S().circles)}<h1>${esc(c.name)}</h1><p>${esc([c.trip || c.dest, S().members(c.memberCount), det.invited.length ? S().invitedN(det.invited.length) : "", c.muted ? S().muted : ""].filter(Boolean).join(" · "))}</p></div></header>
      <div class="wrap chat__grid">
        <section class="chat__main">
          <div class="chat__log" id="log" aria-live="polite"></div>
          <form class="chat__say" id="say"><button type="button" class="chat__mada" id="askMada" title="${esc(S().askMadaT)}"><span>${SUN}</span></button><textarea id="sayIn" rows="1" maxlength="2000" placeholder="${esc(S().sayPh)}"></textarea><button class="btn btn--main" id="sayGo">${esc(S().send)}</button></form>
          <p class="note-s chat__hint">${esc(S().madaHint)}</p>
        </section>
        <aside class="chat__side">
          <div class="box"><h2 class="box__h">${esc(S().whoIn)} <span class="hd-n">${c.memberCount}</span></h2>
            <ul class="mem">${det.members.map((p) => `<li>${av(p)}<a href="${p.id === me ? "#/account" : `#/friend/${p.id}`}"><b>${esc(p.id === me ? S().you : p.short || p.name)}</b><small>${esc(p.role === "admin" ? S().admin : S().rel[p.relation] || "")}</small></a></li>`).join("")}
              ${det.invited.map((x) => `<li class="mem--inv">${av(x.person)}<span><b>${esc(x.person.short || x.person.name)}</b><small>${esc(S().invitedOn(ago(x.sentAt)))}</small></span></li>`).join("")}</ul>
            ${admin ? `<button type="button" class="btn btn--plain btn--full" id="addPpl">+ ${esc(S().addPeople)}</button>` : ""}
            <div id="addBox"></div></div>
          <div class="box"><h2 class="box__h">${esc(S().inviteLink)}</h2><p class="note-s" style="margin-top:0">${esc(S().inviteLinkSub)}</p><div id="linkBox"><button type="button" class="btn btn--plain btn--full" id="getLink">${esc(S().makeLink)}</button></div></div>
          <div class="box chat__opts"><label class="chk"><input type="checkbox" id="mute" ${c.muted ? "checked" : ""} /> ${esc(S().mute)}</label><button type="button" class="link link--warn" id="leave">${esc(S().leave)}</button></div>
        </aside>
      </div></div>`);
    const log = $("#log");
    const draw = (items, keep) => {
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      log.innerHTML = items.length ? msgsHtml(items, me, det) : `<div class="chat__empty"><b>${esc(S().startsHere(c.name))}</b><p>${esc(S().startsSub)}</p><div class="chips">${S().ideas.map((x) => `<button type="button" class="chip" data-idea="${esc(x)}">${esc(x)}</button>`).join("")}</div></div>`;
      if (!keep || near) log.scrollTop = log.scrollHeight;
      $$("[data-madaask]", log).forEach((b) => b.addEventListener("click", () => askFromSocial(b.dataset.madaask)));
      $$("[data-idea]", log).forEach((b) => b.addEventListener("click", () => { $("#sayIn").value = b.dataset.idea; $("#sayIn").focus(); }));
      $$("[data-react]", log).forEach((b) => b.addEventListener("click", async () => { const [mid, emoji, on] = b.dataset.react.split("|"); try { await A.react(id, mid, emoji, on === "1"); refresh(); } catch (e) { toast(e.message); } }));
    };
    let items = msgs.items.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    chatLast = JSON.stringify(items.map((m) => [m.id, m.reactions.length]));
    draw(items, false);
    const refresh = async () => {
      try {
        const r = await A.messages(id); if (route().name !== "circle" || route().a !== id) return;
        const next = r.items.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), sig = JSON.stringify(next.map((m) => [m.id, m.reactions.length]));
        if (sig !== chatLast) { chatLast = sig; items = next; draw(items, true); A.updateCircle(id, { read: true }).catch(() => {}); }
      } catch {}
    };
    const poll = () => { chatTimer = setTimeout(async () => { if (route().name !== "circle" || route().a !== id) return; if (!document.hidden) await refresh(); poll(); }, 5000); };
    poll();
    const ta = $("#sayIn");
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#say").requestSubmit(); } });
    $("#askMada").addEventListener("click", () => { if (!/@mada/i.test(ta.value)) ta.value = "@Mada " + ta.value; ta.focus(); });
    $("#say").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = ta.value.trim(); if (!body) return;
      $("#sayGo").disabled = true;
      ta.value = ""; ta.style.height = "auto";
      try { await A.say(id, body); await refresh(); log.scrollTop = log.scrollHeight; } catch (x) { ta.value = body; toast(x.message); }
      $("#sayGo").disabled = false; ta.focus();
    });
    $("#getLink").addEventListener("click", async () => {
      try { const l = await A.circleLink(id); $("#linkBox").innerHTML = linkHtml(l, S().waCircle(c.name)); wireLink(); } catch (x) { toast(x.message); }
    });
    $("#mute").addEventListener("change", async (e) => { try { await A.updateCircle(id, { muted: e.target.checked }); toast(e.target.checked ? S().mutedOn : S().mutedOff); } catch (x) { toast(x.message); } });
    $("#leave").addEventListener("click", async () => {
      if (!(await ask({ title: S().leaveH(c.name), text: S().leaveT, ok: S().leave, cancel: S().stay }))) return;
      try { await A.leaveCircle(id); location.hash = "#/circles"; } catch (x) { toast(x.message); }
    });
    $("#addPpl")?.addEventListener("click", async () => {
      let fr; try { fr = await A.friends(); } catch (x) { return toast(x.message); }
      const inIds = new Set([...det.members.map((p) => p.id), ...det.invited.map((x) => x.person.id)]), can = fr.friends.filter((p) => !inIds.has(p.id));
      $("#addBox").innerHTML = can.length ? `<form id="addF" class="pick">${can.map((p) => `<label>${av(p)}<span>${esc(p.short || p.name)}</span><input type="checkbox" value="${p.id}" /></label>`).join("")}<button class="btn btn--main btn--full">${esc(S().invite)}</button></form>` : `<p class="note-s">${esc(S().allFriendsIn)} <a class="link" href="#/people">${esc(S().addFriends)}</a></p>`;
      $("#addF")?.addEventListener("submit", async (e) => { e.preventDefault(); const ids = $$("#addF input:checked").map((x) => x.value); if (!ids.length) return; try { await A.inviteToCircle(id, ids); toast(S().invitesSent); viewCircle(id); } catch (x) { toast(x.message); } });
    });
  }
  // The app's own words (packages/shared/src/copy), so a line reads the same on the web and in the app.
  const CC = (k, v = {}) => { const all = window.MadaCircleCopy || {}, s = (all[lang] || {})[k] ?? (all.en || {})[k] ?? k; return String(s).replace(/\{(\w+)\}/g, (_, x) => (v[x] != null ? v[x] : "")); };
  const joinNames = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(lang === "ar" ? "، " : ", ")} ${CC("circles.and")} ${xs[xs.length - 1]}`);
  function sysLine(m, me, ppl) {
    const s = m.sys, nm = (id) => (!id ? CC("circles.someone") : id === me ? CC("circles.you") : (ppl.get(id) || {}).short || CC("circles.someone"));
    const v = { name: nm(s.actor), names: joinNames(s.users.map(nm)), text: s.text || "", amount: s.amount != null ? money(s.amount / 100) : "" }, mine = s.actor === me;
    const k = (e) => CC(`circles.sys.${e}${mine ? ".you" : ""}`, v);
    switch (s.event) {
      case "created": case "invited": case "joined": case "left": case "removed": case "renamed": case "pinned": case "cancelledInvite": case "paid": case "reminded": return k(s.event);
      case "joinedByLink": return mine ? CC("circles.sys.joinedByLink.you", { name: nm(s.users[0]) }) : CC("circles.sys.joinedByLink", v);
      case "admin": return s.users[0] === me ? CC("circles.sys.admin.you") : CC("circles.sys.admin", v);
      case "markedPaid": { const own = s.users.length === 1 && s.users[0] === s.actor; return own ? CC(mine ? "circles.sys.markedPaid.self" : "circles.sys.markedPaid.theirs", v) : k("markedPaid"); }
      case "dm": return CC("circles.sys.dm", { name: joinNames(s.users.filter((u) => u !== me).map(nm)) });
      default: return s.text || m.body;
    }
  }
  function madaWelcome(det, me) {
    const others = det.members.filter((p) => p.id !== me), inv = det.invited.map((x) => x.person.short || x.person.name), name = det.circle.name;
    return others.length ? CC("circles.mada.welcomeOthers", { name }) : inv.length ? CC(inv.length === 1 ? "circles.mada.welcomeInvited.one" : "circles.mada.welcomeInvited.other", { name, names: joinNames(inv) }) : CC("circles.mada.welcomeAlone", { name });
  }
  const REACTS = ["👍", "❤️", "😂", "🙏"];
  function msgsHtml(items, me, det) {
    const ppl = new Map([...det.members, ...det.invited.map((x) => x.person)].map((p) => [p.id, p]));
    let lastDay = "";
    return items.map((m) => {
      const d = m.createdAt.slice(0, 10), sep = d !== lastDay ? `<p class="cm-day">${esc(day(d))}</p>` : ""; lastDay = d;
      if (m.kind === "sys") return sep + `<p class="cm-sys">${esc(m.sys ? sysLine(m, me, ppl) : m.body)}</p>`;
      const mine = m.author.kind === "user" && m.author.id === me, mada = m.author.kind !== "user";
      const who = mada ? (m.author.kind === "agent" ? m.author.name : CC("circles.mada")) : m.author.name;
      const acts = m.kind === "mada" && m.mada && !m.mada.done ? (m.mada.actions || []).filter((a) => a.ask).map((a) => `<button type="button" class="chip cm-act" data-madaask="${esc(a.ask)}">${esc(a.label)}</button>`).join("") : "";
      let inner = `<p>${esc(m.kind === "mada" && m.mada && m.mada.kind === "welcome" ? madaWelcome(det, me) : m.body)}</p>`;
      if (m.kind === "vote" && m.vote) inner = `<b class="cm-q">📊 ${esc(m.vote.q)}</b><ul class="cm-vote">${m.vote.options.map((o) => `<li class="${m.vote.winner === o.id ? "win" : ""}"><span>${esc(o.label)}</span><em>${o.votes.length}</em></li>`).join("")}</ul><small class="cm-note">${esc(m.vote.closed ? S().voteClosed : S().voteInApp)}</small>`;
      else if (m.kind === "card" && m.card && m.card.kind === "place" && m.card.post) inner = `<div class="cm-card">${ico("pin")}<div><b>${esc(m.card.post.place)}</b><small>“${esc(m.card.post.text)}”</small></div></div>${m.body ? `<p>${esc(m.body)}</p>` : ""}`;
      else if (m.kind === "card") inner = `<div class="cm-card">${ico("cal")}<div><b>${esc(S().sharedPlan)}</b><small>${esc(m.body || "")}</small></div></div>`;
      else if (m.kind === "split") inner = `<div class="cm-card">${ico("card")}<div><b>${esc(S().aSplit)}</b><small>${esc(m.body || "")} · ${esc(S().splitInApp)}</small></div></div>`;
      else if (m.kind === "mada" && m.mada && m.mada.list && m.mada.list.length) inner = `<p>${esc(m.body)}</p><ul class="cm-list">${m.mada.list.map((x) => `<li>${esc(typeof x === "string" ? x : x.title || x.text || x.name || "")}</li>`).join("")}</ul>${m.mada.foot ? `<small class="cm-note">${esc(m.mada.foot)}</small>` : ""}`;
      if (acts) inner += `<div class="cm-acts">${acts}</div>`;
      const reacts = m.reactions.filter((x) => x.ids.length).map((x) => `<button type="button" class="cm-r${x.ids.includes(me) ? " on" : ""}" data-react="${m.id}|${x.emoji}|${x.ids.includes(me) ? 0 : 1}">${x.emoji} ${x.ids.length}</button>`).join("");
      return sep + `<div class="cm${mine ? " cm--me" : ""}${mada ? " cm--mada" : ""}">${mine ? "" : mada ? `<span class="av av--mada">${SUN}</span>` : av({ initial: (who || "?")[0], tone: "default", name: who })}
        <div class="cm__b">${mine ? "" : `<small class="cm__who">${esc(who)}</small>`}<div class="cm__bub">${inner}</div>
          ${m.held ? `<small class="cm-held">${esc(m.held.status === "removed" ? S().heldOff : S().held)}</small>` : ""}
          <div class="cm__meta"><small>${esc(new Date(m.createdAt).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-GB", { hour: "2-digit", minute: "2-digit" }))}</small>${reacts}<span class="cm__add">${REACTS.filter((e) => !m.reactions.some((x) => x.emoji === e && x.ids.includes(me))).map((e) => `<button type="button" data-react="${m.id}|${e}|1" aria-label="${e}">${e}</button>`).join("")}</span></div></div></div>`;
    }).join("");
  }
  const linkHtml = (l, waText) => `<div class="lnk"><input readonly value="${esc(l.url)}" id="lnkUrl" /><div class="actions"><button type="button" class="btn btn--main btn--sm" id="lnkCopy">${esc(S().copy)}</button><a class="btn btn--plain btn--sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(waText + " " + l.url)}">WhatsApp</a></div><small class="note-s">${esc(S().linkLasts(fmt(l.expiresAt.slice(0, 10), { day: "numeric", month: "short" })))}</small></div>`;
  function wireLink() { $("#lnkCopy")?.addEventListener("click", async () => { const v = $("#lnkUrl").value; try { await navigator.clipboard.writeText(v); } catch { $("#lnkUrl").select(); document.execCommand("copy"); } toast(S().copied); }); }

  // ----- a new circle: a name, a cover, who's in -----
  let nc = null;
  async function viewNewCircle() {
    if (!A.signedIn) return location.replace("#/signin?next=circles/new");
    nc = nc || { name: "", cover: { kind: "icon", icon: "plane", color: "sand" }, dest: "", invite: [] };
    let fr = { friends: [] }; try { fr = await A.friends(); } catch {}
    if (route().name !== "circles") return;
    const ICONS = ["plane", "suitcase", "palm", "camel", "tent", "beach", "mountain", "ship", "camera", "family", "kids", "cake", "heart", "football", "lantern", "sun"];
    const draw = () => {
      $("#ncPrev").className = "nc-prev" + coverInk(nc.cover);
      $("#ncPrev").innerHTML = `${coverHtml(nc.cover, "banner")}<b>${esc(nc.name || S().ncNamePh)}</b><small>${esc(S().members(1 + nc.invite.length))}</small>`;
    };
    page(`<div class="wrap pg pg--narrow nc">
      ${backLink("#/circles", S().circles)}
      <h1 class="pg__h">${esc(S().newCircle)}</h1><p class="pg__sub">${esc(S().ncSub)}</p>
      <div class="nc-prev" id="ncPrev"></div>
      <form id="ncF" novalidate>
        <label class="fld"><span>${esc(S().ncName)}</span><input name="name" maxlength="40" value="${esc(nc.name)}" placeholder="${esc(S().ncNamePh)}" /><em>${esc(S().ncNameErr)}</em></label>
        <label class="fld"><span>${esc(S().ncWhere)}</span><input name="dest" maxlength="40" value="${esc(nc.dest)}" placeholder="${esc(S().ncWherePh)}" /></label>
        <div class="fld"><span>${esc(S().ncCover)}</span>
          <div class="nc-col">${C.COVER_COLORS.map((k) => `<button type="button" data-col="${k}" style="background:${C.COVER_COLOR_INFO[k].bg}" class="${nc.cover.kind === "icon" && nc.cover.color === k ? "on" : ""}" aria-label="${k}"></button>`).join("")}</div>
          <div class="nc-ico">${ICONS.map((k) => `<button type="button" data-ico="${k}" class="${nc.cover.kind === "icon" && nc.cover.icon === k ? "on" : ""}" aria-label="${k}">${C.coverIconSvg(k, 40)}</button>`).join("")}</div>
          <div class="nc-ph">${[...PHOTO_KEYS].map((k) => `<button type="button" data-ph="${k}" class="${nc.cover.kind === "photo" && nc.cover.id === k ? "on" : ""}"><img src="${photoOf(k)}" alt="${esc(k)}" loading="lazy" /></button>`).join("")}</div></div>
        <div class="fld"><span>${esc(S().whoIn)}</span>
          ${fr.friends.length ? `<div class="pick pick--grid">${fr.friends.map((p) => `<label>${av(p)}<span>${esc(p.short || p.name)}</span><input type="checkbox" value="${p.id}" ${nc.invite.includes(p.id) ? "checked" : ""} /></label>`).join("")}</div><p class="note-s">${esc(S().ncInviteNote)}</p>`
            : `<p class="note-s">${esc(S().ncNoFriends)}</p>`}</div>
        <button class="primary">${esc(S().create)}</button>
      </form></div>`);
    draw();
    const f = $("#ncF");
    f.addEventListener("input", (e) => { if (e.target.name === "name") nc.name = e.target.value; if (e.target.name === "dest") nc.dest = e.target.value; e.target.closest(".fld")?.classList.remove("err"); draw(); });
    f.addEventListener("change", (e) => { if (e.target.type === "checkbox") { nc.invite = $$(".pick input:checked", f).map((x) => x.value); draw(); } });
    f.addEventListener("click", (e) => {
      const b = e.target.closest("[data-col],[data-ico],[data-ph]"); if (!b) return;
      if (b.dataset.ph) nc.cover = { kind: "photo", id: b.dataset.ph };
      else nc.cover = { kind: "icon", icon: b.dataset.ico || (nc.cover.icon || "plane"), color: b.dataset.col || (nc.cover.color || "sand") };
      $$("[data-col]", f).forEach((x) => x.classList.toggle("on", nc.cover.kind === "icon" && x.dataset.col === nc.cover.color));
      $$("[data-ico]", f).forEach((x) => x.classList.toggle("on", nc.cover.kind === "icon" && x.dataset.ico === nc.cover.icon));
      $$("[data-ph]", f).forEach((x) => x.classList.toggle("on", nc.cover.kind === "photo" && x.dataset.ph === nc.cover.id));
      draw();
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (nc.name.trim().length < 2) { $('[name="name"]').closest(".fld").classList.add("err"); $('[name="name"]').focus(); return; }
      const btn = $(".primary", f); btn.disabled = true;
      try { const r = await A.createCircle({ name: nc.name.trim(), cover: nc.cover, dest: nc.dest.trim() || null, invite: nc.invite }); nc = null; location.hash = `#/circle/${r.circle.id}`; } catch (x) { btn.disabled = false; toast(x.message); }
    });
  }

  // ----- people: find friends by name or number, requests, an invite link for anyone not on Mada -----
  let pplQ = "";
  async function viewPeople() {
    if (!A.signedIn) { page(needIn("people", S().peopleOutH, S().peopleOutSub)); return wireCommon(); }
    page(loading(S().people));
    let fr; try { fr = await A.friends(); } catch (e) { return page(errBox(e.message, true)); }
    if (route().name !== "people") return;
    const row = (p, act) => `<li class="prow">${av(p, "av--md")}<a href="#/friend/${p.id}"><b>${esc(p.name)}</b><small>${esc([S().rel[p.relation] || "", p.mutual ? S().mutual(p.mutual) : "", p.going || ""].filter(Boolean).join(" · "))}</small></a>${act}</li>`;
    page(`<div class="wrap pg pg--narrow ppl">
      ${socTabs("people")}
      <h1 class="pg__h">${esc(S().peopleH)}</h1><p class="pg__sub">${esc(S().peopleSub)}</p>
      <form class="srch" id="srch" role="search"><span>${ico("ppl")}</span><input id="srchIn" value="${esc(pplQ)}" placeholder="${esc(S().searchPh)}" autocomplete="off" inputmode="search" /></form>
      <ul class="plist" id="hits"></ul>
      ${fr.requests.length ? `<h2 class="hd-h">${esc(S().requests)} <i class="badge">${fr.requests.length}</i></h2><ul class="plist">${fr.requests.map((p) => row(p, `<span class="actions"><button type="button" class="btn btn--main btn--sm" data-acc="${p.id}">${esc(S().accept)}</button><button type="button" class="btn btn--plain btn--sm" data-drop="${p.id}">${esc(S().decline)}</button></span>`)).join("")}</ul>` : ""}
      <h2 class="hd-h">${esc(S().friends)} <span class="hd-n">${fr.friends.length}</span></h2>
      ${fr.friends.length ? `<ul class="plist">${fr.friends.map((p) => row(p, `<button type="button" class="btn btn--plain btn--sm" data-dm="${p.id}">${esc(S().message)}</button>`)).join("")}</ul>` : `<p class="note-s">${esc(S().noFriendsYet)}</p>`}
      <div class="box invite"><span class="invite__art">${coverHtml({ kind: "icon", icon: "gift", color: "gold" }, "badge")}</span><div><h2 class="box__h">${esc(S().inviteH)}</h2><p class="note-s" style="margin-top:0">${esc(S().inviteSub)}</p><div id="myLink"><button type="button" class="btn btn--main" id="getMyLink">${esc(S().makeLink)}</button></div></div></div>
    </div>`);
    const hits = $("#hits"); let tmr = null, seq = 0;
    const asked = new Set(fr.asked), friendIds = new Set(fr.friends.map((p) => p.id));
    const search = async () => {
      const q = pplQ.trim(), my = ++seq;
      if (q.length < 2) { hits.innerHTML = ""; return; }
      hits.innerHTML = `<li class="note-s">${esc(S().searching)}</li>`;
      let r; try { r = await A.findPeople(q); } catch (e) { hits.innerHTML = `<li class="note-s">${esc(e.message)}</li>`; return; }
      if (my !== seq) return;
      const me = (A.user || {}).id;
      hits.innerHTML = r.people.filter((p) => p.id !== me).map((p) => row(p, friendIds.has(p.id) ? `<span class="tagg">${esc(S().rel.friend)}</span>` : asked.has(p.id) ? `<span class="tagg tagg--q">${esc(S().asked)}</span>` : `<button type="button" class="btn btn--main btn--sm" data-add="${p.id}">${esc(S().add)}</button>`)).join("")
        || `<li class="note-s">${esc(r.byPhone ? S().noOneNumber : S().noOneName)} <button type="button" class="link" id="inviteInstead">${esc(S().sendLink)}</button></li>`;
      $$("[data-add]", hits).forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const x = await A.addFriend(b.dataset.add); asked.add(b.dataset.add); b.outerHTML = `<span class="tagg${x.status === "friends" ? "" : " tagg--q"}">${esc(x.status === "friends" ? S().rel.friend : S().asked)}</span>`; } catch (e) { b.disabled = false; toast(e.message); } }));
      $("#inviteInstead")?.addEventListener("click", () => $("#getMyLink")?.click());
    };
    $("#srchIn").addEventListener("input", (e) => { pplQ = e.target.value; clearTimeout(tmr); tmr = setTimeout(search, 300); });
    $("#srch").addEventListener("submit", (e) => { e.preventDefault(); search(); });
    if (pplQ) search();
    $$("[data-acc]").forEach((b) => b.addEventListener("click", async () => { try { await A.acceptFriend(b.dataset.acc); viewPeople(); } catch (e) { toast(e.message); } }));
    $$("[data-drop]").forEach((b) => b.addEventListener("click", async () => { try { await A.dropFriend(b.dataset.drop); viewPeople(); } catch (e) { toast(e.message); } }));
    $$("[data-dm]").forEach((b) => b.addEventListener("click", async () => { try { const x = await A.dm(b.dataset.dm); location.hash = `#/circle/${x.circleId}`; } catch (e) { toast(e.message); } }));
    $("#getMyLink").addEventListener("click", async () => { try { const x = await A.myLink(); $("#myLink").innerHTML = linkHtml(x.link, S().waMe); wireLink(); } catch (e) { toast(e.message); } });
  }

  // ----- a person: what you share, and one clear next step -----
  async function viewFriend(id) {
    if (!A.signedIn) return location.replace(`#/signin?next=friend/${id}`);
    page(loading(S().people));
    let r; try { r = await A.profile(id); } catch (e) { return page(errBox(e.status === 404 ? S().noPerson : e.message)); }
    if (route().name !== "friend") return;
    const p = r.person;
    const act = r.isFriend ? `<button type="button" class="btn btn--main" id="fMsg">${esc(S().message)}</button><button type="button" class="btn btn--plain" id="fPlan">${esc(S().planTogether)}</button>`
      : r.askedMe ? `<button type="button" class="btn btn--main" id="fAcc">${esc(S().accept)}</button><button type="button" class="btn btn--plain" id="fDrop">${esc(S().decline)}</button>`
      : r.asked ? `<span class="tagg tagg--q">${esc(S().asked)}</span><button type="button" class="link" id="fDrop">${esc(S().takeBack)}</button>`
      : `<button type="button" class="btn btn--main" id="fAdd">${esc(S().addFriend)}</button>`;
    page(`<div class="wrap pg pg--narrow prof">
      ${backLink("#/people", S().people)}
      <header class="prof__h">${av(p, "av--xl")}<div><h1 class="pg__h">${esc(p.name)}</h1><p class="pg__sub">${esc([p.places ? S().placesN(p.places) : "", p.trips ? S().trips(p.trips) : "", r.thanks ? S().thanksN(r.thanks) : "", p.mutual ? S().mutual(p.mutual) : ""].filter(Boolean).join(" · ") || S().rel[p.relation] || "")}</p>${p.going ? `<p class="prof__go">${ico("flights")}${esc(p.going)}</p>` : ""}</div></header>
      <div class="actions prof__act">${act}</div>
      ${r.circles.length ? `<h2 class="hd-h">${esc(S().inCommon)}</h2><ul class="plist">${r.circles.map((c) => `<li class="prow"><a href="#/circle/${c.id}"><b>${esc(c.name)}</b><small>${esc(S().members(c.memberCount))}</small></a></li>`).join("")}</ul>` : ""}
      ${r.posts.length ? `<h2 class="hd-h">${esc(S().theirTips)}</h2><div class="tips">${r.posts.map((x) => `<article class="tip"><header><span class="tip__k">${esc(x.kind === "food" ? S().food : S().todo)}</span><small>${esc(x.city)}</small></header><p>“${esc(x.text)}”</p><footer><span>${ico("pin")}${esc(x.place)}</span></footer></article>`).join("")}</div>` : ""}
    </div>`);
    $("#fMsg")?.addEventListener("click", async () => { try { const x = await A.dm(id); location.hash = `#/circle/${x.circleId}`; } catch (e) { toast(e.message); } });
    $("#fPlan")?.addEventListener("click", () => { nc = { name: "", cover: { kind: "icon", icon: "plane", color: "sand" }, dest: "", invite: [id] }; location.hash = "#/circles/new"; });
    $("#fAdd")?.addEventListener("click", async () => { try { await A.addFriend(id); viewFriend(id); } catch (e) { toast(e.message); } });
    $("#fAcc")?.addEventListener("click", async () => { try { await A.acceptFriend(id); viewFriend(id); } catch (e) { toast(e.message); } });
    $("#fDrop")?.addEventListener("click", async () => { try { await A.dropFriend(id); viewFriend(id); } catch (e) { toast(e.message); } });
  }

  // ----- an invite link: who asked, which circle, then join (signing in first if needed) -----
  async function viewJoin(code) {
    page(loading(S().join));
    let r; try { r = await A.invitePreview(code); } catch (e) { return page(`<div class="wrap pg pg--narrow"><div class="empty"><p>${esc(e.status === 404 ? S().badLink : e.message)}</p><a class="btn btn--main" href="#/circles">${esc(S().circles)}</a></div></div>`); }
    if (route().name !== "join") return;
    const c = r.circle, open = r.status === "open";
    page(`<div class="wrap pg pg--narrow join${c ? coverInk(c.cover) : ""}">
      <div class="join__cv">${c ? coverHtml(c.cover, "banner") : coverHtml({ kind: "icon", icon: "heart", color: "gold" }, "banner")}<div><small>${esc(S().invitedBy(r.from.short || r.from.name))}</small><h1>${esc(c ? c.name : S().beFriends(r.from.short || r.from.name))}</h1>${c && c.trip ? `<p>${esc(c.trip)}</p>` : ""}</div></div>
      ${c ? `<div class="join__ppl">${c.members.slice(0, 8).map((p) => av(p, "av--md")).join("")}<span>${esc(S().members(c.memberCount))}</span></div>` : `<p class="pg__sub">${esc(S().beFriendsSub)}</p>`}
      ${open ? `<button type="button" class="primary" id="joinGo">${esc(A.signedIn ? S().join : S().joinWith)}</button>${A.signedIn ? "" : `<p class="note-s" style="text-align:center">${esc(S().joinSignNote)}</p>`}`
        : `<div class="nudge">${esc(S().linkState[r.status] || S().badLink)}</div>`}
      <div class="join__app"><p>${esc(S().joinApp)}</p><button type="button" class="btn btn--plain" data-app>${esc(S().getApp)}</button></div>
    </div>`);
    $("#joinGo")?.addEventListener("click", async () => {
      if (!A.signedIn) return (location.hash = `#/signin?next=join/${code}`);
      $("#joinGo").disabled = true;
      try { const x = await A.acceptInvite(code); toast(x.already ? S().already : S().joined); location.hash = x.circleId ? `#/circle/${x.circleId}` : x.friendId ? `#/friend/${x.friendId}` : "#/circles"; } catch (e) { $("#joinGo").disabled = false; toast(e.message); }
    });
    wireCommon();
  }

  // ----- the app: store buttons from the API's config, and a code to scan from a computer -----
  const storeUrls = () => (A.config && A.config.storeUrls) || { ios: "https://apps.apple.com/app/mada-trips", android: "https://play.google.com/store/apps/details?id=sa.madatrips.app" };
  const APPLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.8v18.4c0 .3.3.5.6.4l10.6-9.6L4.6 2.4c-.3-.1-.6.1-.6.4z" opacity=".85"/><path d="M15.2 12l3.3-3-12.9-7.1 9.6 10.1z" opacity=".6"/><path d="M15.2 12l-9.6 10.1 12.9-7.1-3.3-3z" opacity=".7"/><path d="M18.5 9l-3.3 3 3.3 3 2.9-1.6c.8-.5.8-1.3 0-1.8L18.5 9z"/></svg>';
  const storeBtns = () => { const u = storeUrls(); return `<div class="stores"><a class="store" href="${esc(u.ios)}" target="_blank" rel="noopener">${APPLE}<span><small>${esc(S().dlOn)}</small><b>App Store</b></span></a><a class="store" href="${esc(u.android)}" target="_blank" rel="noopener">${PLAY}<span><small>${esc(S().getOn)}</small><b>Google Play</b></span></a></div>`; };
  const appBand = () => `<section class="appband"><div><small>${esc(S().theApp)}</small><h2>${esc(S().appH)}</h2><p>${esc(S().appSub)}</p>${storeBtns()}</div><ul>${S().appPts.map((x, i) => `<li>${ico(["flights", "chat", "ppl", "esim"][i] || "check")}<span>${esc(x)}</span></li>`).join("")}</ul></section>`;
  let qrP = null;
  const qrLib = () => (qrP ??= new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.append(s); }).catch((e) => { qrP = null; throw e; }));
  async function appSheet() {
    // On a phone, straight to its own store; the code to scan is for a computer.
    const ua = navigator.userAgent, u = storeUrls();
    if (/iPhone|iPad|iPod/.test(ua)) return void (location.href = u.ios);
    if (/Android/.test(ua)) return void (location.href = u.android);
    const el = document.createElement("div");
    el.className = "sheet";
    el.innerHTML = `<div class="sheet__card appsheet" role="dialog" aria-modal="true" aria-label="${esc(S().getApp)}"><button type="button" class="lb__x appsheet__x" aria-label="${esc(t("close"))}">×</button>
      <span class="appsheet__mark">${SUN}</span><h2>${esc(S().appH)}</h2><p>${esc(S().appSheetSub)}</p>
      <div class="appsheet__qr" id="qr"><span class="spin"></span></div><small class="note-s">${esc(S().scan)}</small>${storeBtns()}</div>`;
    document.body.append(el);
    const close = () => el.remove();
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest(".appsheet__x")) close(); });
    document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc1); } });
    try {
      const qrcode = await qrLib(), q = qrcode(0, "M");
      q.addData(`${location.origin}${location.pathname}#/app`); q.make();
      $("#qr", el).innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch { $("#qr", el).remove(); }
  }
  function viewApp() {
    page(`<div class="wrap pg pg--narrow apppg"><span class="appsheet__mark">${SUN}</span><h1 class="pg__h">${esc(S().appH)}</h1><p class="pg__sub">${esc(S().appSub)}</p>${storeBtns()}
      <ul class="gk apppg__pts">${S().appPts.map((x, i) => `<li>${ico(["flights", "chat", "ppl", "esim"][i] || "check")}<span>${esc(x)}</span></li>`).join("")}</ul><p class="note-s">${esc(t("appSync"))}</p></div>`);
  }

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
  function afterPlanEdit() {
    saveDraft();
    if (!draft.plan || route().name !== "plan") return;
    if (LIVE && draft.live && draft.live.sig !== searchSig(draft)) {
      $("#planPane").classList.add("is-loading");
      clearTimeout(afterPlanEdit.t);
      afterPlanEdit.t = setTimeout(async () => { try { await liveSearch(draft); } catch {} saveDraft(); $("#planPane").classList.remove("is-loading"); renderPlanPane(true); renderThread(false); }, 500);
      return;
    }
    renderPlanPane(true); renderThread(false);
  }
  // Dates picked from a chat chip go back to Mada as an answer, so the plan follows from the conversation.
  function finishPop() {
    const was = open; if (!was) return; closePop();
    if (!popChanged && !(popFromChat && was === "who")) return; popChanged = false;
    if (popFromChat && was === "when" && draft.dep) { popFromChat = false; return send(range(draft.dep, draft.ret), true); }
    if (popFromChat && was === "who") { popFromChat = false; return send(paxText(draft.pax), true); }
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
    if (LIVE) { toast(t("liveNoDemo")); return; }
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
    if (a === "who") { const [ad, ch] = v.split(",").map(Number); draft.pax = { a: ad, c: ch, i: 0 }; draft.paxSaid = true; store.set("pax", draft.pax); return send(paxText(draft.pax), true); }
    if (a === "whoPick") { popFromChat = true; draft.paxSaid = true; return openPop("who", b); }
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
    $$(".nav [data-app], #foot [data-app]").forEach((b) => b.addEventListener("click", appSheet));
    $$("[data-help]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); helpSheet(); }));
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => { heroAskVisible = es[0].isIntersecting; placeFab(); }, { threshold: 0.2 }).observe($("#ask"));
    $("#langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("lang", lang); A.setLang(lang); render(); });
    $("#acct").addEventListener("click", () => { if (!user) { location.hash = "#/signin"; return; } $("#acctMenu").hidden = !$("#acctMenu").hidden; });
    $("#signOut").addEventListener("click", signOut);
    $("#newTrip").addEventListener("click", () => { draft = null; store.set("draft", null); tab = "chat"; location.hash = "#/"; });
    $$(".demo button").forEach((b) => b.addEventListener("click", () => demo(b.dataset.as)));
    addEventListener("hashchange", render);
    setupMic();
    A.setLang(lang);
    // Live when the Core API answers next to us; signed-in state then comes from the API session, not this browser.
    A.detect().then(async (live) => {
      LIVE = live;
      document.documentElement.classList.toggle("is-live", live);
      if (live) {
        if (A.signedIn) { try { await A.me(); } catch { /* offline: keep what we had */ } }
        await afterSignIn();
        if (draft && draft.plan && !draft.live) draft.plan = false; // a preview plan has no real offers to book
      }
      render();
      if (params.get("q")) startOrSend(params.get("q"));
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
