/* =========================================================
   MADA BOOK: the Core API, the same one the app uses (platform/src/app/api/app/v1, contract in packages/shared)
   Same origin only: /book is served by the platform next to /api/app/v1 (locally: node tools/book-dev.mjs).
   Signed-in calls carry the app's Bearer session; a 401 TOKEN_EXPIRED refreshes once, as apps/mobile/src/lib/api.ts.
   When the API isn't there (the static site on its own), MadaAPI.live is false and the page runs its preview data.
   ========================================================= */
(function () {
  const BASE = "/api/app/v1";
  const KEY = "mada.api.session";
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  class ApiError extends Error {
    constructor(code, message, status, extra = {}) { super(message || code); this.code = code; this.status = status; Object.assign(this, extra); }
  }

  let session = read(KEY); // { tokens: { accessToken, refreshToken, accessExpiresAt }, user }
  let lang = "en";
  let refreshing = null;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  async function raw(method, path, body, { auth = true, timeout = 20000, idem } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const headers = { Accept: "application/json", "Accept-Language": lang, "X-Request-Id": uuid() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && session) headers.Authorization = `Bearer ${session.tokens.accessToken}`;
    if (idem) headers["Idempotency-Key"] = idem;
    try {
      const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (!r.ok) {
        const e = (data && data.error) || {};
        // "Wait 3600 seconds" reads like a machine: say it in minutes.
        if (e.code === "RATE_LIMITED" && e.retryAfter) { const m = Math.max(1, Math.ceil(e.retryAfter / 60)); e.message = lang === "ar" ? `محاولات كثيرة ورا بعض. جرّب بعد ${m} دقيقة تقريبًا.` : `That's a lot in a row. Try again in about ${m} min.`; }
        throw new ApiError(e.code || "HTTP_" + r.status, e.message, r.status, e);
      }
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(e.name === "AbortError" ? "TIMEOUT" : "OFFLINE", e.message, 0);
    } finally { clearTimeout(timer); }
  }

  async function refresh() {
    if (!session) throw new ApiError("UNAUTHORIZED", "", 401);
    refreshing ??= raw("POST", "/auth/refresh", { refreshToken: session.tokens.refreshToken }, { auth: false })
      .then((d) => { session = { ...session, tokens: d.tokens }; write(KEY, session); })
      .catch((e) => { if (e.status === 401) signOutLocal(); throw e; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function call(method, path, body, opts = {}) {
    try { return await raw(method, path, body, opts); }
    catch (e) {
      if (e.code === "TOKEN_EXPIRED" && opts.auth !== false && session) { await refresh(); return raw(method, path, body, opts); }
      throw e;
    }
  }

  function signOutLocal() { session = null; write(KEY, null); }
  function keep(d) { session = { tokens: d.tokens, user: d.user }; write(KEY, session); return d; }

  // Without an account the people going are described here (ids made in this browser, ages when known), as the app does.
  const GKEY = "mada.api.guests";
  function guests(pax) {
    const n = pax.a + pax.c;
    let g = read(GKEY) || [];
    while (g.length < n) g.push({ id: uuid(), dateOfBirth: null, isSelf: g.length === 0 });
    g = g.slice(0, Math.max(n, 1));
    write(GKEY, g);
    // Children are priced by age: a child with no date of birth is sent as 8 years old on the travel date.
    return g.map((x, i) => (i >= pax.a ? { ...x, dateOfBirth: x.dateOfBirth || childDob(8) } : x));
  }
  const childDob = (age) => { const d = new Date(); d.setFullYear(d.getFullYear() - age); return d.toISOString().slice(0, 10); };

  const api = {
    live: false,
    config: null,
    ApiError,
    setLang(l) { lang = l; },
    get user() { return session && session.user; },
    get signedIn() { return !!session; },

    /** Is the Core API next to us? One quick look at /config, cached for the tab. */
    async detect() {
      if (/[?&]preview=1\b/.test(location.search)) return false;
      try { api.config = await raw("GET", "/config", undefined, { auth: false, timeout: 6000 }); api.live = true; } catch { api.live = false; }
      return api.live;
    },

    // ----- sign in: a code to the phone (WhatsApp or SMS, the server decides) -----
    async sendCode(phone) {
      try { await call("POST", "/auth/phone-channel", { phone, channel: api.config?.phoneChannels?.[0] || "sms" }, { auth: false }); } catch { /* a hint only */ }
      return call("POST", "/auth/otp/start", { phone, locale: lang }, { auth: false });
    },
    async verifyCode(phone, code) {
      return keep(await call("POST", "/auth/otp/verify", { phone, code, device: { platform: "web", name: "Mada web" } }, { auth: false }));
    },
    async signOut() { try { if (session) await raw("POST", "/auth/logout", { refreshToken: session.tokens.refreshToken }); } catch {} signOutLocal(); },
    async me() { const d = await call("GET", "/me"); if (session) { session.user = d.user; write(KEY, session); } return d.user; },
    updateMe: (b) => call("PATCH", "/me", b),
    people: () => call("GET", "/people"),
    addPerson: (b) => call("POST", "/people", b),
    removePerson: (id) => call("DELETE", `/people/${id}`),
    // A passport: the account holder's own (no id) or a household member's. The full number is stored encrypted.
    savePassport: (personId, b) => call("PUT", personId ? `/people/${personId}/passport` : "/passport", b),

    // ----- Ask and search (open to guests) -----
    parse: (text, tripCity) => call("POST", "/ask/parse", { text, tripCity: tripCity || null }),
    /** Is the conversation on (GET /config askChat) for this person? Signed in only, as in the app. */
    get canChat() { return !!(session && api.config && api.config.features && api.config.features.askChat); },
    // Ask Mada as a conversation, the app's own (POST /ask/chat, docs/app/ASK-CHAT.md): each Server-Sent Event to
    // onEvent as it comes. An error before the stream opens (off, limits, signed out) throws, so the page answers itself.
    async chat(b, onEvent) {
      const open = async () => {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 70000);
        const r = await fetch(BASE + "/ask/chat", { method: "POST", signal: ctl.signal, headers: { Accept: "text/event-stream", "Content-Type": "application/json", "Accept-Language": lang, "X-Request-Id": uuid(), Authorization: `Bearer ${session.tokens.accessToken}` }, body: JSON.stringify(b) });
        return { r, ctl, timer };
      };
      if (!session) throw new ApiError("UNAUTHORIZED", "", 401);
      let o;
      try {
        o = await open();
        if (o.r.status === 401) { const e = ((await o.r.json().catch(() => null)) || {}).error || {}; clearTimeout(o.timer); if (e.code !== "TOKEN_EXPIRED") throw new ApiError(e.code || "UNAUTHORIZED", e.message, 401); await refresh(); o = await open(); }
        if (!o.r.ok || !o.r.body) { const e = ((await o.r.json().catch(() => null)) || {}).error || {}; throw new ApiError(e.code || "HTTP_" + o.r.status, e.message, o.r.status, e); }
        const rd = o.r.body.getReader(), dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (data) { try { onEvent(JSON.parse(data)); } catch { /* one bad frame doesn't end the turn */ } }
          }
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(e.name === "AbortError" ? "TIMEOUT" : "OFFLINE", e.message, 0);
      } finally { if (o) clearTimeout(o.timer); }
    },
    // Planning searches go as a guest (priced for the party said); at checkout they run again for the account's travellers (ids).
    flights: (b, pax, ids) => (ids ? call("POST", "/search/flights", { ...b, travellerIds: ids }, { timeout: 40000 }) : call("POST", "/search/flights", { ...b, guests: guests(pax), travellerIds: guests(pax).map((g) => g.id) }, { auth: false, timeout: 40000 })),
    stays: (b, pax, ids) => (ids ? call("POST", "/search/stays", { ...b, travellerIds: ids }, { timeout: 60000 }) : call("POST", "/search/stays", { ...b, guests: guests(pax), travellerIds: guests(pax).map((g) => g.id) }, { auth: false, timeout: 60000 })),
    offer: (id) => call("GET", `/offers/${id}`),
    reprice: (id) => call("POST", `/offers/${id}/price`, {}),
    rooms: (id) => call("GET", `/offers/${id}/rooms`, undefined, { timeout: 40000 }),
    hotelReviews: (code) => call("GET", `/hotels/${encodeURIComponent(code)}/reviews?lang=${lang}`, undefined, { auth: false, timeout: 9000 }),
    hotel: (code) => call("GET", `/hotels/${encodeURIComponent(code)}`, undefined, { auth: false }),
    esimPlans: (countries, days) => call("GET", `/esim/plans?countries=${encodeURIComponent(countries)}&days=${days}`),

    // ----- booking (signed in) -----
    // Requests: the team books by hand and comes back (GET/POST /requests, the thread, a nudge, taking one back).
    requests: () => call("GET", "/requests"),
    request: (id) => call("GET", `/requests/${id}`),
    createRequest: (b) => call("POST", "/requests", b, { timeout: 30000 }),
    reqMessages: (id) => call("GET", `/requests/${id}/messages`),
    reqSay: (id, text) => call("POST", `/requests/${id}/messages`, { text, clientId: uuid() }),
    nudge: (id) => call("POST", `/requests/${id}/nudge`, {}),
    withdraw: (id) => call("POST", `/requests/${id}/withdraw`, {}),
    preview: (b) => call("POST", "/orders/preview", b, { timeout: 30000 }),
    createOrder: (b) => call("POST", "/orders", b, { timeout: 40000, idem: b.idempotencyKey }),
    order: (id) => call("GET", `/orders/${id}`),
    threeDs: (id, code) => call("POST", `/orders/${id}/3ds`, { code }),
    answer: (id, answer) => call("POST", `/orders/${id}/answer`, { answer }),
    trips: () => call("GET", "/trips"),
    trip: (id) => call("GET", `/trips/${id}`),
    flightStatus: (no, date) => call("GET", `/flights/${encodeURIComponent(no.replace(/\s+/g, ""))}/status?date=${date}`),
    // ----- circles, friends, discover: the same endpoints as the app's Circles tab -----
    circles: () => call("GET", "/circles"),
    circle: (id) => call("GET", `/circles/${id}`),
    createCircle: (b) => call("POST", "/circles", b),
    updateCircle: (id, b) => call("PATCH", `/circles/${id}`, b),
    leaveCircle: (id) => call("POST", `/circles/${id}/leave`, {}),
    messages: (id, q = "") => call("GET", `/circles/${id}/messages${q}`),
    say: (id, body) => call("POST", `/circles/${id}/messages`, { body }),
    react: (id, mid, emoji, on) => call("POST", `/circles/${id}/messages/${mid}/reactions`, { emoji, on }),
    circleLink: (id, opts = {}) => call("POST", `/circles/${id}/link`, opts),
    inviteToCircle: (id, userIds) => call("POST", `/circles/${id}/invites`, { userIds }),
    dm: (userId) => call("POST", "/circles/dm", { userId }),
    invitePreview: (code) => call("GET", `/invites/${encodeURIComponent(code)}`, undefined, { auth: !!session }),
    acceptInvite: (codeOrId) => call("POST", `/invites/${encodeURIComponent(codeOrId)}/accept`, {}),
    declineInvite: (id) => call("POST", `/invites/${id}/decline`, {}),
    myLink: () => call("POST", "/invites", { link: true }),
    friends: () => call("GET", "/friends"),
    findPeople: (q) => call("GET", `/friends/search?q=${encodeURIComponent(q)}`),
    addFriend: (userId) => call("POST", "/friends", { userId }),
    acceptFriend: (id) => call("POST", `/friends/${id}/accept`, {}),
    dropFriend: (id) => call("DELETE", `/friends/${id}`),
    profile: (id) => call("GET", `/friends/${id}`),
    discover: (city) => call("GET", `/discover${city ? `?city=${encodeURIComponent(city)}` : ""}`, undefined, { auth: !!session }),
    notifyCity: (city) => call("POST", "/discover/notify", { city }),
    posts: (city, kind) => call("GET", `/posts?city=${encodeURIComponent(city)}${kind ? `&kind=${kind}` : ""}`),
    knownPosts: () => call("GET", "/posts?scope=known"),
    addPost: (b) => call("POST", "/posts", b),
    thank: (id) => call("POST", `/posts/${id}/thanks`, {}),
    newKey: () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,

    /**
     * The card goes to the payment provider and comes back as a token; Mada never sees the number. Until MyFatoorah's
     * embedded session is wired (apps/mobile/src/lib/booking.ts tokenizeCard), the mock provider tokenises here.
     */
    async tokenizeCard(number) {
      const d = number.replace(/\D/g, "");
      await new Promise((r) => setTimeout(r, 400));
      const brand = /^4/.test(d) ? "visa" : /^5[1-5]|^2[2-7]/.test(d) ? "mastercard" : "mada";
      return { token: `tok_mock_${Math.random().toString(36).slice(2, 12)}${d.slice(-2)}`, last4: d.slice(-4), brand };
    },
  };
  window.MadaAPI = api;
})();
