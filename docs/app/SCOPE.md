# Mada Trips app: product scope

**Status:** Draft v1 for review. This is the plan before any code is written. Design direction comes next.
**Platforms:** iOS and Android.
**Evidence:** [RESEARCH.md](RESEARCH.md), covering competitors, traveller reviews, the Saudi market, technical feasibility and UX case studies.
**Built on:** the existing Mada Ops platform ([platform/](../../platform), [docs/ops-platform/PLAN.md](../ops-platform/PLAN.md)).

---

## 1. The idea in one line

**A travel partner that sees problems coming, has the fix ready, and puts a named human behind every commitment.**

Most travel apps stop being useful once you have paid. Mada's app becomes useful from that point on.

| | Booking apps (Almosafer, Wego, Booking) | Trackers (Flighty, TripIt) | AI planners (Mindtrip, ChatGPT) | **Mada** |
|---|---|---|---|---|
| Finds and books | ✓ | – | partly | ✓ AI searches, a human confirms and issues |
| Knows your trip | Only what was bought there | ✓ | – | ✓ Every trip, wherever it was bought |
| Warns you early | Rarely | ✓ | – | ✓ |
| **Fixes it** | Slowly, through a call centre | ✗ | ✗ | **✓ Fix prepared, human owns it** |
| Your documents | – | Basic | – | ✓ Whole household, with entry-rule checks |
| Arabic-first, family-first | Partly | ✗ | ✗ | ✓ |

### Why Mada can win
- **The biggest gap in the market is accountability.** The top complaint across every booking site is the blame game between airline and agent. Almosafer's TrustScore is 1.7.
- **Mada holds IATA ticketing authority and already has an issuing desk (Mada Ops).** AI start-ups and the big platforms (Google, ChatGPT) don't have this and can't fake it.
- **Fora reached a $1B valuation in July 2026 on this exact model:** AI makes the human faster, and the human owns the outcome.

---

## 2. What the research says we must get right

1. **Own the problem from start to finish.** Mada never tells a traveller to "contact the airline". One owner, one thread.
2. **Disruption is where loyalty is won.** 65% of travellers want a human for rebooking. Warn early (from inbound-aircraft data), and arrive with the fix, not just the alert.
3. **AI drafts, a human confirms.** Two-thirds of travellers won't let AI book for them. Showing the named agent's sign-off is what turns that distrust into trust.
4. **Prices and suggestions must be real.** 55% of AI-planner users have been sent to wrong or closed places. Every price comes from a supplier. Every suggestion is checked against live data and labelled with when it was checked.
5. **Answers, not chat.** Use cards and buttons for fixed tasks. Chat is how you ask; it is not the answer.
6. **The family is the unit,** including children's passports and travelling with a domestic helper. No competitor models the helper.
7. **Documents that know the rules.** Check each person on each trip: the 6-month passport rule, visas, the iqama (residence permit) and exit/re-entry visa, and that the name matches the passport character for character.
8. **Few, high-value notifications.** No promotions during a trip. Every status shows its source ("airline says", "Mada predicts").
9. **Honest money.** All-in prices, holds with a stated time limit, no pre-ticked extras, and refunds tracked in stages. Hopper's $35M FTC settlement is a design spec for what not to do.
10. **Arabic and Saudi by default.** Right-to-left done properly, Hijri dates, Gulf-dialect voice, WhatsApp as a channel, mada cards, Tabby and Tamara.

---

## 3. Experience principles

These are the rules every screen is judged against.

1. **Boringly obvious.** If a traveller has to think about the interface, the design failed.
2. **One next thing.** Every screen and lock-screen surface leads with one time-relevant action or number: "Leave in 42 min", "Gate B12, boarding in 18".
3. **Answers are objects.** The concierge replies with cards you can act on (a flight, a hotel, a plan), with the short answer first and detail one tap away.
4. **Show the work, then ask.** Preview what will happen, show progress ("checked 14 flights, holding 2"), and require explicit approval wherever money or the itinerary changes.
5. **A human name on every commitment.** "Confirmed by Faisal · 4 min." Handover never makes the traveller repeat themselves.
6. **Earn every interruption.** A strict notification budget (§7). Time-sensitive alerts only when the traveller must act.
7. **Design the bad day first.** Delays, missed connections, lost bags and expired passports get the most design care. Every alert carries its fix.
8. **Arabic-native and bidi-perfect.** Design in Arabic first, then English. Flight numbers, PNRs (airline booking codes), times and prices are isolated so mixed-language text never scrambles.
9. **Works offline and on the lock screen.** Documents, the timeline and next steps all work in airplane mode. Live Activities, widgets and Wallet passes are first-class surfaces.
10. **Calm and premium.** No banners, no upsell carousels, no fake urgency. The app feels like a quiet five-star concierge, not a marketplace.

---

## 4. What the app looks like

### 4.1 Four places, plus help that is always there

| Tab | What it is | It answers |
|---|---|---|
| **Today** (home) | One living card that changes with the moment (see §4.2). Below it, only what matters next. | "What do I need to know or do right now?" |
| **Trips** | Every trip as a timeline: flights, stays, transfers, plans, documents needed, a checklist per traveller. Shared with the household. | "What is the plan?" |
| **Wallet** | The household's documents (passports, IDs, iqamas, visas, insurance) plus every ticket and voucher. Encrypted, biometric lock, works offline. | "Do we have everything, and is it valid?" |
| **Ask** | The concierge, by text or voice, Arabic or English. AI and your human agent in **one thread**. Replies as cards. | "Can you find, book, change or fix this?" |

- **Help now:** during an active trip, a persistent one-tap button reaches a human with the full context already attached.
- **Outside the app:** Live Activities and Dynamic Island, Android Live Updates, home and lock-screen widgets, Apple and Google Wallet passes for Mada bookings, WhatsApp, and a read-only live trip link for family.

### 4.2 The Today card follows the trip

| Moment | What Today shows |
|---|---|
| No trip | A quiet prompt ("Where to next?"), saved ideas, and seasonal nudges tied to the Saudi calendar (Eid, summer, Riyadh Season). Never a wall of deals. |
| Planning | The open request and its live status: *Drafted → With Faisal → Confirmed*. |
| Weeks before | Countdown, anything blocking the trip ("Sara's passport has 4 months left. Turkey needs 150 days ✓, Schengen needs 3 months after return ✓"), and visa steps. |
| Day before | **Evening digest:** pickup time, bag allowance, check-in done, seats, weather, prayer times at the destination. |
| Travel day | One big number: **Leave in 42 min**, then **Gate B12 · boarding in 18**. A Live Activity starts on its own. |
| In the air | An offline pack: arrival steps, eGate eligibility, hotel address in the local script for the taxi driver. |
| Landed | "Welcome to Istanbul. Carousel 7. Ahmet is waiting at Door 3 with a sign." Driver photo and plate, eSIM ready. |
| At the destination | Today's plan, the next booking, ideas near you that fit your preferences (halal, family-friendly, open now). |
| Back home | The trip in one card, any refund or claim still in progress, and "Same hotel next time?" so preferences are saved. |

### 4.3 Signature moments

These are what make the app recognisable. Design should prototype these first.

1. **Your passport is your login.** One NFC tap (or camera scan) fills in the profile. The fields are shown back to confirm. Expiry and entry-rule checks start straight away.
2. **The itinerary arrives signed.** The concierge drafts the trip as cards. The traveller taps *Request*. A live line shows *With Faisal → Confirmed with Saudia · 4 min*, and a short voice note from Faisal confirms it.
3. **The calm digest.** One message the evening before, in Arabic, with the Hijri date, instead of ten pushes.
4. **"Leave in 12 minutes."** Based on live traffic and typical security times. The countdown is the whole home screen.
5. **The lock-screen boarding moment.** The Live Activity shows the gate and a boarding countdown. It can be shared with family, who see progress but not seat details.
6. **The rebook that is already waiting.** Mada sees the inbound aircraft running late before the airline announces it: "Your connection is at risk. We're holding two options. [Approve 21:15]". A human finishes it while the traveller is still in the queue.
7. **The quiet companion in the air.** Everything the traveller needs next is cached on the phone.
8. **Arrival in one update.** Carousel, driver, eSIM. If the bag tag (AirTag) shows the bag is still in Riyadh, Mada has already started the claim.
9. **"Dinner near the hotel, kid-friendly, halal."** Hold to speak. Three image cards on a map appear, each with one-tap request, and the agent confirms the table.
10. **The trip that remembers.** Preferences learned on this trip (window seat for Sara, connecting rooms, no red-eyes) shape the next one automatically.

---

## 5. Feature scope

**Release labels:**
- **MVP:** first public release.
- **V1:** the full "partner" release.
- **V2:** later.

**Feature IDs:** **B** = basic booking app, **P** = partner layer, **S** = Saudi-specific.

### 5.1 Basic scope: what every serious travel app must do

| # | Feature | Release | Notes |
|---|---|---|---|
| B1 | Sign up and log in | MVP | Phone number with a one-time code, Sign in with Apple and Google. Nafath (national ID login) in V2. Guest mode: ask and track a flight without an account. |
| B2 | Profile and preferences | MVP | Name exactly as on the passport, seat, meal, airlines, loyalty numbers, budget band, language, Hijri or Gregorian dates, digit style. |
| B3 | Flight search and booking | MVP | Live search through the GDS and Duffel. Results as cards. All-in price. Fare rules in plain language. The request goes to Mada Ops for a human to issue. |
| B4 | Hotel search and booking | MVP | RateHawk and WebBeds. Family room combinations (connecting rooms, suites). Halal and family filters. |
| B5 | Visas | MVP as a concierge request, V1 guided | Requirements by nationality, document checklist built from the Wallet, appointment help from an agent. |
| B6 | Car rental | MVP as a concierge request, V2 live (CarTrawler) | |
| B7 | Activities and events | MVP as a concierge request, V1 live (Viator / GetYourGuide) | Riyadh Season, AlUla and Mada Events tie-ins. |
| B8 | Restaurant booking | MVP as a concierge request | No public reservation API in Saudi Arabia. The AI gathers the request, an agent books it. Eat App partnership later. |
| B9 | Packages | MVP as a concierge request | The concierge builds the package, an agent quotes and confirms. |
| B10 | Payment | MVP | MyFatoorah (mada cards, credit cards, Apple Pay on mada, STC Pay), Google Pay on Android. Tabby and Tamara in V1. Payment is authorised at the request and charged on issuance; if issuance fails it is voided. |
| B11 | My bookings | MVP | Status, PNR, e-tickets and vouchers, invoices that comply with ZATCA (Saudi tax authority). |
| B12 | Change and cancel | MVP as a request, V1 self-serve where the supplier allows | Every change goes through the same human-confirmed flow, with the fare difference shown before approval. |
| B13 | Notifications | MVP | Push, plus email receipts. WhatsApp in V1. |
| B14 | Support | MVP | The Ask thread includes your human agent. A promised response time is shown honestly. |
| B15 | Arabic and English | MVP | Arabic-first design, full right-to-left support, language switch. |
| B16 | Account and data | MVP | Export my data, delete my account, consent controls (required by the Saudi data law, PDPL). |

### 5.2 Partner layer: what makes it a travel partner

| # | Feature | Release | What it does |
|---|---|---|---|
| P1 | **Concierge (Ask)** | MVP | AI agent with tools (search, hold, Wallet lookup, trip lookup). Replies as cards. Hands over to a human with a summary. Remembers preferences. Voice in V1, after a test on Saudi dialects. |
| P2 | **Trip timeline** | MVP | Every trip as a living plan. Built automatically from Mada bookings, forwarded emails and shared PDFs or screenshots. |
| P3 | **Trip import** | MVP | A personal forwarding address (`you@trips.madatrips.sa`), "Send to Mada" from the share sheet, and Mada's own bookings. Outlook sync in V1. Gmail sync in V2, because it needs a security assessment. Every import is shown back for confirmation; Mada never guesses silently. |
| P4 | **Flight radar** | MVP | Status, gate, delay and cancellation from FlightAware alerts. **Inbound-aircraft delay prediction.** Every status shows its source. |
| P5 | **Live Activity and Dynamic Island** | MVP (iOS), V1 (Android Live Updates) | The travel day on the lock screen. Shareable with family. |
| P6 | **Document wallet** | MVP | Passport scan (MRZ, with NFC in V1), IDs, iqamas, visas, insurance, tickets. Expiry tracking. Encrypted, biometric lock, offline, stored inside Saudi Arabia. |
| P7 | **Entry check** | V1 | For each traveller on each trip: passport validity rules, visa requirement, transit rules, name match. Runs at booking and again 30, 7 and 1 days before departure. Uses IATA Timatic through the GDS. |
| P8 | **Prepared fix** | V1 | On a disruption, 2–3 rebooking options that respect connections and hotel nights. One tap to approve, and a human finishes it. |
| P9 | **Schedule-change relay** | MVP | Airline changes reach the traveller within minutes, with *Accept / Ask for alternatives*. |
| P10 | **Refund and claim tracker** | V1 | Stages, dates and the original currency. A compensation helper (EU261/UK261, plus GACA rules once confirmed). |
| P11 | **Household** | MVP (members and documents), V1 (shared trips, payment links) | One person manages spouse, children and helper. Change impact across the whole group ("affects 4 travellers and 2 hotel nights"). |
| P12 | **Smart digest and notification budget** | MVP | See §7. |
| P13 | **In-context recommendations** | V1 | Ideas inside the timeline at the right moment (dinner tonight, eSIM before landing, a late checkout before a night flight). Checked against live data, labelled with when it was checked, and respecting preferences (halal, family, budget). |
| P14 | **Arrival pack** | V1 | Driver meeting point and photo, offline maps, hotel address in the local script, eSIM, eGate eligibility. |
| P15 | **Price hold** | V1 | A quote held for a stated time, where the supplier supports it. Never a paid "freeze" we can't honour. |
| P16 | **Family live link** | V1 | Read-only live trip page for parents and relatives. Opens in WhatsApp, no app needed. |
| P17 | **Wallet passes** | V1 | Apple and Google Wallet passes for Mada hotels, transfers and activities. Boarding passes stay with the airline; Mada links to them. |
| P18 | **Widgets, Siri and App Intents, Watch** | V1 (widgets), V2 (Watch, Siri) | |
| P19 | **eSIM** | V1 | Airalo partner API, offered at the right moment, not upsold at checkout. |
| P20 | **Trip memory** | V2 | Post-trip recap, preferences learned, "same again". |

### 5.3 Saudi-specific

| # | Feature | Release |
|---|---|---|
| S1 | Domestic helper as a traveller type: iqama validity, exit/re-entry reminder (link to Absher), helper-visa guidance | V1 |
| S2 | Schengen journey: prompt to apply 45+ days ahead, document checklist, aim for the 5-year multi-entry visa, then track its expiry. UK ETA tied to the passport (warn on passport renewal). | V1 |
| S3 | Umrah trips **built around** the Nusuk permit (flights, Makkah and Madinah hotels, Haramain train), never reselling permits unless licensed | V1 |
| S4 | Prayer times and qibla direction at the destination, halal dining, women-only spa and pool filters, connecting rooms and villas | MVP (prayer times), V1 (the rest) |
| S5 | Saudi-calendar planning: Eid and school holidays, "book by" deadlines, short GCC weekend trips | V1 |
| S6 | WhatsApp as a full second channel (confirmations, documents, the agent thread) | V1 |
| S7 | Corporate module: approvals, grade-based travel policy, per-diem, cost centres, monthly invoices (Mada Ops already has corporate clients) | V2 |

### 5.4 Out of scope (deliberately)

- Scraping VFS or TLS for visa appointment slots. It is a legal and terms-of-service risk; Mada helps users book appointments themselves instead.
- Reselling Hajj or Umrah permits.
- Selling paid "price freeze" or "cancel for any reason" products.
- Ads, or marketing pushes during a trip.
- Full read access to Gmail at launch.

---

## 6. How a booking works (AI + human)

```
 Traveller            Concierge (AI)                 Mada Ops (human)                    Supplier
 ─────────            ──────────────                 ────────────────                    ────────
 "Riyadh→Istanbul,    searches GDS/Duffel/RateHawk
  4 of us, Eid,  ───▶ shows cards (real prices only)
  under 9k"           │
 taps Request ──────▶ re-prices, creates hold/PNR ─▶ App request appears in the
 approves payment     payment authorised            issuance queue with the AI's summary,
 (Apple Pay/mada/     │                             offer snapshot and travellers
  Tabby)              │                             Agent checks: names vs passports,
                      │                             fare, rules ──────────────────────▶ issue ticket
 sees live status ◀── status: With Faisal ◀──────── Issued (ticket numbers) ◀────────── confirmed
 "Confirmed by       payment captured
  Faisal · 4 min"    tickets → Wallet, trip → timeline, flights → radar
```

**Rules**
- **The AI never issues anything and never invents a number.** Prices on cards come from the supplier response and are rendered by the app, not written by the model.
- **Every request carries a promised response time** that the agent desk has to meet. See decision D1.
- **Change, cancel and refund use the same pipe.** The traveller sees one thread and one owner.

### 6.1 What Mada Ops needs to support this

Mada Ops already has clients, bookings (`draft → pending_issue → issued`), payments, leads, issuance, delegation and an audit log. New pieces:

| New in Ops | Purpose |
|---|---|
| **App inbox** | App requests and conversations, each with an AI summary, offer snapshot and traveller documents. The agent acts in one click: quote, hold, send to issue. |
| `app_users`, `households`, `travellers` | App accounts linked to an Ops `client`, so every app user is a retail client. |
| `trips`, `trip_items` | Trip timeline items, including imported ones that Mada did not sell. |
| `documents` | Wallet items. **Stored in a Saudi-region vault**, with Ops showing a reference and audit-logging every view. |
| `requests` | Booking, change, cancel, refund and concierge requests, each with a promised response time and a live status. |
| `alerts` | Flight and trip events, and what was sent to whom. |
| Payment methods | Add `apple_pay`, `tabby`, `tamara`, `myfatoorah` to `payments.method`. Online payments settle to the Retail account. |
| Response-time board | Who is on duty, request ages, breaches of the promised response time. |

**Compliance flag:** Ops currently stores traveller passport details in `bookings.travellers` (jsonb), in a serverless Postgres database that is most likely hosted outside Saudi Arabia (confirm the region). Before the app collects passports at scale, decide whether Ops moves to a Saudi region or keeps only references (see D4).

---

## 7. Notification policy

| Level | Used for | Examples |
|---|---|---|
| **Time-sensitive** (breaks through Focus) | The traveller must act now | Gate change · cancellation · delay that threatens a connection · leave now · document problem · agent needs approval |
| **Live Activity** (no sound) | Travel-day progress | Countdown to boarding, gate, taxi, landing, carousel |
| **Active** | Something changed, no action needed | Booking confirmed · refund moved a stage · check-in done |
| **Passive / digest** | Good to know | Evening digest · weather · prayer times · tips |
| **Never** | | Promotions during a trip · "we miss you" · unchecked recommendations |

- Each traveller chooses **Quiet** or **Everything**.
- Repeated updates are grouped together.
- Every flight status says where it came from.

---

## 8. Technology (recommended)

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **React Native + Expo SDK 56** (new architecture, Reanimated, Skia, Expo Router). About 15–20% native modules: Live Activity, Android Live Updates, App Intents, PassKit, NFC passport. | One codebase. Shares TypeScript and schemas with Mada Ops. Live Activities through `expo-widgets`. Tabby, Tamara and MyFatoorah all have React Native SDKs. Flutter is the fallback. |
| Backend | A new **Mada Core API** (TypeScript) next to Mada Ops, sharing Postgres for bookings and clients. Queue for alerts. | Keeps the consumer traffic away from the Ops back office. |
| PII vault | **GCP Dammam (via CNTXT) or Oracle Jeddah.** Envelope encryption with per-user keys. Move to AWS or Azure Saudi regions when they are live. | Required by the Saudi data law (PDPL). Also a trust message for marketing. |
| AI | Claude agent with strict tool schemas. A larger model for disruption replanning, a mid model for chat, a small model for routing and document extraction. No raw passport data goes to the model. | Strong in Arabic and English, reliable at calling tools. Cost per conversation is measured in the pilot. |
| Voice | Choose after a 2-hour test on Najdi, Hijazi and Gulf recordings (ElevenLabs Scribe v2, Deepgram, Azure ar-SA, Google Chirp). | Off-the-shelf models do badly on Saudi dialects. |
| Flight data | FlightAware AeroAPI (alerts, webhooks, inbound aircraft). Cirium or OAG as volume grows. | |
| Flights | Mada's GDS with Enterprise access, plus Duffel for NDC fares and low-cost carriers. | The Amadeus self-service APIs shut down in July 2026. |
| Hotels | RateHawk and WebBeds, then Hotelbeds. Apply for Expedia Rapid. | |
| Visa rules | IATA Timatic through the GDS, plus Sherpa for display. | |
| Payments | MyFatoorah (main), Tabby, Tamara, Apple Pay on mada, Google Pay. | |
| Push | APNs (including Live Activity broadcast channels) and FCM. WhatsApp Business API. | |
| Offline | On-device SQLite. Wallet and timeline cached and encrypted. | |

---

## 9. Business model

1. **Margin and service fees on bookings.** The core revenue, same as Ops today.
2. **Ancillaries at the right moment:** eSIM, insurance (through a licensed Saudi insurer), seats, lounges, transfers.
3. **Visa and document services:** agent-assisted applications.
4. **Mada Plus (V2, optional):** priority human response, disruption handling for trips not booked with Mada, waived change fees. Only if the service is real; we will not repeat Hopper's mistake.
5. **Corporate (V2):** the same app for employees, with Mada Ops invoicing.

**Free for everyone:** the radar, the Wallet and the alerts. They are how people start relying on Mada. Flighty puts these behind a paywall; we don't.

---

## 10. Phases

| Phase | What ships | Done when |
|---|---|---|
| **0. Foundations and design** | Your design direction · clickable prototype of the 10 signature moments · supplier contracts (GDS Enterprise, Duffel, RateHawk/WebBeds, FlightAware, MyFatoorah) · legal checks (licence scope, PDPL, insurance) · Saudi-dialect voice test · agent-desk staffing plan | Prototype tested with 8–10 Saudi travellers (families included). Contracts signed. |
| **1. MVP: companion + booking** | B1–B4, B10, B11, B13–B16 · B5–B9 and B12 as concierge requests · P1 (text), P2, P3, P4, P5 (iOS), P6 (MRZ), P9, P11 (basics), P12 · Ops app inbox · prayer times | Closed beta with existing Mada clients. Real bookings issued through Ops. Every promised response time met. |
| **2. V1: travel partner** | P7 entry check · P8 prepared fix · P10 refunds and claims · P13 recommendations · P14 arrival pack · P15–P17 · Android Live Updates · NFC passport · voice · Tabby and Tamara · WhatsApp · S1–S6 · activities bookable live (Viator / GetYourGuide) | Public launch. |
| **3. V2: scale** | Nafath · Gmail sync · Watch and Siri · cars live · corporate module · Mada Plus · trip memory · ChatGPT / AI-platform distribution (search in, service stays in the app) | |

---

## 11. How we measure it

| Metric | Target (to agree) |
|---|---|
| App Store / Play rating | ≥ 4.8 |
| Request → confirmed (median) | Within the promised response time, 95% of the time |
| Disruptions where Mada alerted **before** the airline | Track. Aim for a majority. |
| Disruptions with a prepared fix offered | ≥ 90% (V1) |
| Notification opt-out rate | Below the industry average. No promo pushes during trips. |
| Repeat booking within 12 months | Track by household |
| Trips imported vs booked with Mada | Shows the companion is useful beyond Mada's own sales |
| Entry-check catches (problems found before travel) | Track. This is the "saved my trip" metric. |

---

## 12. Decisions we need from you

| # | Decision | Why it matters | Our recommendation |
|---|---|---|---|
| D1 | **Human coverage hours.** The Riyadh counter runs 12 PM–10 PM and Pakistan is 2 hours ahead. Do we promise 24/7 for disruptions? | The promise of a human who fixes it is the product. | 24/7 for active-trip disruptions (on-call rota) from day one. Bookings within working hours, with an honest response time shown. |
| D2 | **Response-time promise.** E.g. booking confirmed in ≤ 15 minutes during working hours, disruption answered in ≤ 10 minutes, any time. | It is shown in the app, so it has to be true. | Start conservative and tighten as data comes in. |
| D3 | **Named agents.** Show the agent's first name, photo and voice note? | Biggest trust signal in the research. | Yes. First name and photo. Voice notes optional per agent. |
| D4 | **Where passport data lives.** Saudi-region vault, with Ops keeping only references, or move Ops to a Saudi region as well? | PDPL, and a marketing message. | Vault in a Saudi region now. Move Ops when AWS or Azure Saudi regions are live. |
| D5 | **Launch services.** Live search only for flights and hotels at MVP, everything else as concierge requests? | Scope and time to launch. | Yes. |
| D6 | **App name and AI persona.** Is the assistant simply "Mada", or does it get its own name? | Brand and voice. | Call it "Mada". Humans are "your Mada agent". |
| D7 | **Licence scope.** Does the current Ministry of Tourism licence cover online sales, Umrah packages and visa services? | Rules what we can sell in the app. | Confirm before Phase 1. |
| D8 | **Tech stack.** React Native + Expo (recommended) or Flutter? | Hiring and code sharing with Ops. | React Native + Expo. |
| D9 | **Mada Plus.** Plan a membership at all? | Pricing page and how we design the free tier. | Decide after V1 data. Keep the radar and Wallet free regardless. |

---

## 13. What we need for design direction

When you send the design direction, these are the things that shape everything else:

1. **Mood and references:** apps, hotels, brands or objects whose feel you want, and what you don't want.
2. **Brand:** do we carry the website's identity into the app (brand green `#1e352d`, sand `#e9e2d8`, sun-gold, the sun symbol, Instrument Serif and Inter Tight; IBM Plex Sans Arabic and Reem Kufi for Arabic), or evolve it?
3. **Tone of voice** in Arabic and English: formal, warm, playful? Gulf dialect in copy, or Modern Standard Arabic?
4. **Motion:** the website is motion-heavy (GSAP, the sun-ray preloader). How much of that energy belongs in an app people use at the gate under stress?
5. **iOS Liquid Glass and Android Material 3 Expressive:** follow each platform natively (recommended), or one custom look on both?
6. **Photography and illustration** for destinations and empty states.
7. **The first three screens to design:** we suggest Today on travel day, the concierge's "request → confirmed by Faisal" moment, and the household Wallet.
