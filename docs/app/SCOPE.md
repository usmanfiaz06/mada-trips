# Mada Trips app: product scope

**Status:** Draft v2. Adds the community, prediction and loyalty layers and records the decisions made so far. This is the plan before any code is written. Design references come next.
**Platforms:** iOS and Android. **Saudi first, made for the world.**
**Integrations to start with:** [INTEGRATIONS.md](INTEGRATIONS.md).
**Experience design, psychology and layout rules:** [EXPERIENCE.md](EXPERIENCE.md).
**Words and typography:** [COPY.md](COPY.md).
**Evidence:** [RESEARCH.md](RESEARCH.md), covering competitors, traveller reviews, the Saudi market, technical feasibility and UX case studies.
**Built on:** the existing Mada Ops platform ([platform/](../../platform), [docs/ops-platform/PLAN.md](../ops-platform/PLAN.md)).

---

## 1. The idea in one line

**A travel partner that sees problems coming, has the fix ready, and puts a named human behind every commitment. It knows your next move, makes paying a single tap, and keeps the people you travel with close.**

Most travel apps stop being useful once you have paid. Mada's app becomes useful from that point on.

The app rests on four ideas:

| Layer | What it means | Where it is specified |
|---|---|---|
| **Partner** | Sees problems in advance. A named human fixes them, 24/7. | §4, §5.2 |
| **Next move** | Predicts what you need before you ask and offers it as one tap. | §5.6 |
| **Circles** | A private travel social network: your household, your trip groups, your friends. "I'm in Amsterdam, who's around?" | §5.5 |
| **Rewards** | Rewards exploring and travelling well, not spending. | §5.7 |

| | Booking apps (Almosafer, Wego, Booking) | Trackers (Flighty, TripIt) | AI planners (Mindtrip, ChatGPT) | **Mada** |
|---|---|---|---|---|
| Finds and books | ✓ | – | partly | ✓ AI searches, a human confirms and issues |
| Knows your trip | Only what was bought there | ✓ | – | ✓ Every trip, wherever it was bought |
| Warns you early | Rarely | ✓ | – | ✓ |
| **Fixes it** | Slowly, through a call centre | ✗ | ✗ | **✓ Fix prepared, human owns it** |
| Your documents | – | Basic | – | ✓ Whole household, with entry-rule checks |
| Fully bilingual, family-first | Partly | ✗ | ✗ | ✓ English first, fully Arabic |
| Your people (groups, friends nearby, shared saves) | ✗ | ✗ | Group planning only | ✓ Private circles |
| Predicts your next move, one-tap pay | ✗ | ✗ | ✗ | ✓ |

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
10. **Saudi by default, fully bilingual.** English first with complete Arabic, right-to-left done properly, Hijri dates, Gulf-dialect voice, WhatsApp as a channel, mada cards, Tabby and Tamara.

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
8. **English first, fully Arabic, mixed text that never scrambles.** Every screen ships in both languages. Flight numbers, PNRs (airline booking codes), times and prices are isolated so mixed-language text never scrambles.
9. **Works offline and on the lock screen.** Documents, the timeline and next steps all work in airplane mode. Live Activities, widgets and Wallet passes are first-class surfaces.
10. **Calm and premium.** No banners, no upsell carousels, no fake urgency. The app feels like a quiet five-star concierge, not a marketplace.
11. **It breathes with the real world.** Every movement has a real cause, either your touch or the world (light, weather, the flight, the sun). Every haptic is a consistent word. See [EXPERIENCE.md §4.5–4.6](EXPERIENCE.md).
12. **Measured, not guessed.** Every flow is a funnel, with heatmaps and friction signals from the first beta ([EXPERIENCE.md §10.2](EXPERIENCE.md)).

---

## 4. What the app looks like

### 4.1 Four tabs, the concierge everywhere, and help that is always there

| Tab | What it is | It answers |
|---|---|---|
| **Today** (home) | One living card that changes with the moment (see §4.2), then your **next move** (§5.6). Below that, only what matters next. | "What do I need to know or do right now?" |
| **Trips** | Every trip as a timeline: flights, stays, transfers, plans, documents needed, a checklist per traveller. Shared with the household and the trip group. | "What is the plan?" |
| **Circles** | Your household, trip groups and friends. Saved places and collections. "Who's around." Your travel map and passport (§5.5, §5.7). | "Who am I travelling with, and who's near?" |
| **Wallet** | The household's documents (passports, IDs, iqamas, visas, insurance), every ticket and voucher, your payment methods and your rewards balance. Encrypted, biometric lock, works offline. | "Do we have everything, is it valid, how do I pay?" |

**Ask** (the concierge) is not a tab. It is a floating bar on every screen: tap to type, hold to speak, Arabic or English. AI and your human agent share **one thread**, replies come as cards, and Ask always knows which screen you are on.

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
| B5 | Visas | MVP as a concierge request, V1 guided | **In scope as a Mada service.** Requirements by nationality, a document checklist built from the Wallet, appointments booked and applications prepared by a Mada agent. |
| B6 | Car rental | MVP as a concierge request, V2 live (CarTrawler) | |
| B7 | Activities and events | MVP as a concierge request, V1 live (Viator / GetYourGuide) | Riyadh Season, AlUla and Mada Events tie-ins. |
| B8 | Restaurant booking | MVP as a concierge request | No public reservation API in Saudi Arabia. The AI gathers the request, an agent books it. Eat App partnership later. |
| B9 | Packages | MVP as a concierge request | The concierge builds the package, an agent quotes and confirms. |
| B10 | Payment | MVP | MyFatoorah (mada cards, credit cards, Apple Pay on mada, STC Pay), Google Pay on Android. Tabby and Tamara in V1. Payment is authorised at the request and charged on issuance; if issuance fails it is voided. |
| B11 | My bookings | MVP | Status, PNR, e-tickets and vouchers, invoices that comply with ZATCA (Saudi tax authority). |
| B12 | Change and cancel | MVP as a request, V1 self-serve where the supplier allows | Every change goes through the same human-confirmed flow, with the fare difference shown before approval. |
| B13 | Notifications | MVP | Push, plus email receipts. WhatsApp in V1. |
| B14 | Support | MVP | The Ask thread includes your human agent. A promised response time is shown honestly. |
| B15 | English and Arabic | MVP | English-first design, complete Arabic with full right-to-left support, follows the phone's language with an in-app switch. |
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
| S3 | **Umrah (in scope).** Full Umrah trips: flights, Makkah and Madinah hotels, Haramain train, transfers, the Nusuk permit step, and group Umrah with a trip group (C2). For Saudis and residents first, then pilgrims from abroad (made for the world) within Mada's Umrah licence. | V1 |
| S4 | Prayer times and qibla direction at the destination, halal dining, women-only spa and pool filters, connecting rooms and villas | MVP (prayer times), V1 (the rest) |
| S5 | Saudi-calendar planning: Eid and school holidays, "book by" deadlines, short GCC weekend trips | V1 |
| S6 | WhatsApp as a full second channel (confirmations, documents, the agent thread) | V1 |
| S7 | Corporate module: approvals, grade-based travel policy, per-diem, cost centres, monthly invoices (Mada Ops already has corporate clients) | V2 |

### 5.4 Out of scope (deliberately)

- Scraping VFS or TLS for visa appointment slots. It is a legal and terms-of-service risk. Visa appointments are booked by Mada agents (now in scope) or by the user.
- Reselling Hajj or Umrah permits outside what Mada's Umrah licence allows.
- Selling paid "price freeze" or "cancel for any reason" products.
- Ads, or marketing pushes during a trip.
- Full read access to Gmail at launch.
- **A public feed, open "meet strangers now" or live location maps.** Couchsurfing Hangouts drifted into dating and safety problems. Snap Map and Strava's heatmap leaked people's locations.
- **Leaderboards ranked by money spent.** They feel like showing off, sit badly with Saudi media norms, and reward the wrong behaviour.
- **A stored-money wallet** (top-ups held by Mada). It would most likely need a SAMA e-money licence; we use saved cards, Apple Pay and BNPL instead.

### 5.5 Circles: a private travel social network

**Principle:** private circles, not a public network. Every social object belongs to a **household**, a **trip** or a **booked experience**. Nothing is public by default, and a person only ever sees what someone chose to show them.

**What works elsewhere** (details in [RESEARCH.md §8](RESEARCH.md#8-community-loyalty-and-prediction)):
- **Polarsteps** grew to about 20M users on private trip journals for friends and family, not by connecting strangers.
- **Mindtrip** puts an AI into the group chat to merge everyone's preferences into one plan.
- **Airbnb (2025)** shows "who's going" on a booked experience, opt-in only, with connections made after the event.

| # | Feature | Release | What it does |
|---|---|---|---|
| C1 | **Household** | MVP | Family members, their documents, shared trips. The organiser manages everyone (already P11). |
| C2 | **Trip groups** | MVP | Every trip can become a group: shared timeline, group chat **with the AI concierge and the named Mada agent inside it**, polls ("which hotel?"), a shared checklist, and who-has-paid. Invite by link, so friends join from WhatsApp in one tap. |
| C3 | **Save and collections** | MVP | Save anything (a hotel, a restaurant, a reel, a link, a tip from a friend) into collections like "Istanbul with the kids" or "Honeymoon ideas". Share a collection by private link. The concierge plans from what you saved: "Book the 3 places I saved in Baku." |
| C4 | **Share to Mada** | MVP | From Instagram, TikTok, Snapchat, Safari or Google Maps, share into Mada. It recognises the place and drops it into a collection or trip. |
| C5 | **Friends** | V1 | Mutual connections only: contacts who are on Mada, people met in a trip group, people from a booked event. No follower counts. |
| C6 | **Trip journal and posts** | V1 | A private journal with photos and an automatic route map, shared with chosen circles (household, a trip group, close friends). Before posting, Mada asks to confirm that people in the photo agreed and offers a face blur (the Saudi Anti-Cyber Crime Law covers publishing people's photos without consent). |
| C7 | **Who's around** | V1, behind a feature flag, after a safety review | "I'm in Amsterdam, 12–15 Oct." **Off by default**, switched on per trip, ends automatically when the trip ends. **City only**: never a pin, a hotel or a live map. Visible only to friends and circles you choose. Visibility options include women only, family only, or hidden from everyone except contacts. People send a **request** and the other person must accept before any chat. Requires a verified identity. |
| C8 | **Who's going** | V2 | On Mada-booked tours, Umrah groups, concerts and Riyadh Season events: opt in to show your first name and city, then connect after the event. |
| C9 | **Hosted meetups** | V2 | Small meetups run by Mada agents in big destinations (London in summer, Istanbul, Baku), instead of open hangouts. |
| C10 | **Tips from people you trust** | V2 | "Abdullah went to this restaurant in Tbilisi in May and loved it." Recommendations from your own circles are given more weight than anonymous reviews. |

**Safety rules, applied from day one** (App Store 1.2, Google Play UGC policy, the Saudi data law PDPL, the Anti-Cyber Crime Law):
- Report, block and filter on every user, post and message. Reports reach a human queue and are resolved within **24 hours**.
- Moderation runs in Arabic (including Gulf dialect) and English: an automatic first pass, then a policy classifier for Saudi and cultural rules, then a person.
- Location gets its **own separate consent**, is never sold (written into the privacy policy), and is used only for the trip it was given for.
- No dating framing anywhere. Women have full visibility control.
- A panic button during a trip shares your live trip with your household and alerts the Mada agent on duty.

### 5.6 Next move: prediction and one-tap spending

**Principle:** predict logistics, not private life. Every prediction says **why** you are seeing it, and offers **"don't suggest this again"**. Predictions use only what the traveller gave Mada for a trip: bookings, saves, preferences and documents. Never background location tracking.

**What Mada can predict**

| The moment | What Mada already has ready |
|---|---|
| A flight is booked | "Hotel near the venue like last time? Airport pickup at 14:20? eSIM for Türkiye?" One card, tick what you want, pay once. |
| Eid or the school holidays are 10 weeks away | "Last Eid you went to Baku with 5 people. Prices for the same week are rising. Want the usual?" |
| A passport or visa is about to expire | "Sara's passport expires before your summer trip. An agent can book the renewal." |
| You saved 4 places in Istanbul | "These 3 are open on Thursday, near your hotel. Book a table at 9?" |
| You land | Driver, eSIM, hotel check-in and today's plan, already arranged. |
| A delay is predicted | Rebooking options are prepared before you even open the app (P8). |
| The trip ends | "Same hotel next time? Save Sara's window seat?" |

**One-tap spending**
- **Mada Pay sheet.** A single confirmation sheet: what you get, the all-in price, the cancellation rule and the payment method, then pay with Face ID. One sheet whatever the service.
- **Saved household payment method.** A tokenised card, Apple Pay or Google Pay. The organiser pays, and family members can request an item for the organiser to approve.
- **Smart default plan.** Trip packages above about SAR 2,000 show the Tabby or Tamara instalment price on the card.
- **Small add-ons inside a booked trip** (seats, bags, eSIM, transfers, lounge) can be set to **"approve automatically up to SAR X"**. Flights and hotels always ask for one-tap confirmation.
- **Group split.** Each member's share appears in the trip group with a pay link (Apple Pay, mada, STC Pay). Mada keeps a who-owes-whom ledger but never holds the money.
- **No pre-ticked extras, ever** (the Hopper lesson).

### 5.7 Rewards: loyalty that rewards travelling well

**Principle:** reward exploring, preparing and helping, not spending. Rank only among friends, and only if they opt in.

| Element | Design |
|---|---|
| **Points** | A Mada currency (name to choose: see D10). Spent only on Mada services, best value on hotels, upgrades and agent services. No cash-out, no transfers between users, no fixed riyal value in the terms, expiry after 18–24 months that activity extends. This keeps it out of SAMA's e-money rules; counsel to confirm. Earn more on hotels and packages and less on flights, because flight margins can't fund cashback. |
| **Tiers** | Based on **trips completed**, not riyals, and kept for life (as Booking Genius does). Perks are about service: faster human response, delay care (lounge access or credit when a flight is delayed), a document concierge, upgrades on request. |
| **Mada Passport** | A personal travel map with countries, cities, flights, distance and Saudi destinations explored. A shareable year-in-review card for Instagram and Snapchat, in the style of Flighty's Passport. |
| **Badges** | Exploration ("Discover Saudi": AlUla, Abha, the Red Sea; first trip to Europe; ten countries). Preparation ("documents complete", "visa done early"). Helpfulness (tips saved by others, friends referred). |
| **Leaderboards** | Friends and circles only, opt-in, on **countries and cities explored**. Never on money. |
| **Referrals** | Invite a friend: both get points once the friend completes a trip. Links work through the trip group invite. |
| **Partner programmes** | Earn AlFursan miles on Saudia (pass-through). Later, pay with or earn stc Qitaf, Al Rajhi mokafaa, Neqaty and Shukran through partner agreements, as Almosafer does. **Integrate with existing programmes rather than building a rival coalition.** |

There are no daily streaks, because people travel 2–6 times a year. Trip-readiness checklists do that job instead.

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
| Circles and rewards (app side, not Ops) | `groups`, `group_members`, `saves`, `collections`, `posts`, `connections`, `reports` (moderation queue), `points_ledger`, `badges`. Ops sees only the moderation queue and the points liability. |
| 24/7 desk | A rota, on-call paging for disruptions at night, and handover notes between Riyadh and Pakistan. |

**Data location (decided, D4):** start on the current Ops stack (Supabase Postgres + Vercel) to move fast. Move to a Saudi region later.

To keep that move cheap:
- Keep documents in a separate storage bucket with their own encryption keys and a `documents` service boundary, so the vault can move to a Saudi region without touching the rest.
- Collect explicit consent for storage outside the Kingdom in the meantime, as the Saudi data law (PDPL) requires.
- Set a trigger for the move: before the public launch, or before 10,000 stored passports, whichever comes first.

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

The vendor-by-vendor list, including what to open and sign first, is in [INTEGRATIONS.md](INTEGRATIONS.md).

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **React Native + Expo SDK 56** (new architecture, Reanimated, Skia, Expo Router). About 15–20% native modules: Live Activity, Android Live Updates, App Intents, PassKit, NFC passport. | One codebase. Shares TypeScript and schemas with Mada Ops. Live Activities through `expo-widgets`. Tabby, Tamara and MyFatoorah all have React Native SDKs. Flutter is the fallback. |
| Backend | A new **Mada Core API** (TypeScript) next to Mada Ops, sharing Postgres for bookings and clients. Queue for alerts. | Keeps the consumer traffic away from the Ops back office. |
| PII vault | **GCP Dammam (via CNTXT) or Oracle Jeddah.** Envelope encryption with per-user keys. Move to AWS or Azure Saudi regions when they are live. | Required by the Saudi data law (PDPL). Also a trust message for marketing. |
| AI | Claude agent with strict tool schemas. A larger model for disruption replanning, a mid model for chat, a small model for routing and document extraction. No raw passport data goes to the model. | Strong in Arabic and English, reliable at calling tools. Cost per conversation is measured in the pilot. |
| Voice | **On-device speech recognition first** (free). Only if a 2-hour test on Najdi, Hijazi and Gulf recordings shows it falls short do we add a paid service (ElevenLabs Scribe v2, Deepgram, Azure ar-SA). | Follows the cost rule. Off-the-shelf models can struggle with Saudi dialects. |
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
| **0. Foundations and design** | Your design references · clickable prototype of the 10 signature moments · day-one integrations signed and in sandbox ([INTEGRATIONS.md](INTEGRATIONS.md)) · legal checks (PDPL, points under SAMA rules, user-generated content and the Anti-Cyber Crime Law, insurance) · Saudi-dialect voice test · 24/7 agent-desk rota | Prototype tested with 8–10 Saudi travellers (families included). Contracts signed. |
| **1. MVP: companion + booking + groups** | B1–B4, B10, B11, B13–B16 · B5–B9 and B12 as concierge requests · P1 (text), P2, P3, P4, P5 (iOS), P6 (MRZ), P9, P11 (basics), P12 · **C1–C4** (household, trip groups with the agent inside, save and collections, share to Mada) · **Mada Pay sheet** with saved cards and Apple Pay · **points earned from day one** (simple ledger) · Ops app inbox · prayer times · 24/7 disruption desk | Closed beta with existing Mada clients. Real bookings issued through Ops. Every promised response time met. |
| **2. V1: travel partner** | P7 entry check · P8 prepared fix · P10 refunds and claims · P13 recommendations · P14 arrival pack · P15–P17 · Android Live Updates · NFC passport · voice · Tabby and Tamara · WhatsApp · S1–S6 (Umrah and visas) · activities bookable live (Viator / GetYourGuide) · **C5–C7** (friends, journal, Who's around behind a flag) · **Next move** predictions · group split · tiers, badges, Mada Passport, friends leaderboard, referrals | Public launch. |
| **3. V2: scale and the world** | Nafath · Gmail sync · Watch and Siri · cars live · corporate module · Mada Plus · trip memory · **C8–C10** (who's going, hosted meetups, tips from your circles) · partner loyalty programmes (AlFursan, Qitaf, mokafaa) · Saudi-region data move · inbound pilgrims and visitors (more languages) · ChatGPT / AI-platform distribution | |

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
| Trips with a group (2+ members) | Shows Circles is working |
| Next-move cards accepted | Acceptance rate per type. Turn off types people dismiss. |
| Time from "I want this" to paid | Median under 30 seconds for add-ons |
| Safety reports resolved | 100% within 24 hours |

---

## 12. Decisions

### Decided

| # | Decision | Answer |
|---|---|---|
| D1 | Human coverage hours | **24/7.** Bookings and disruptions, with a rota across Riyadh and Pakistan plus on-call cover. |
| D4 | Where data lives | **Current database (Supabase + Vercel) first, Saudi region later.** See §6.1 for how we keep the move cheap. |
| D7 | Umrah and visas | **In scope** as Mada services (B5, S3). |
| D11 | Positioning | **Saudi first, made for the world.** |
| D12 | Brand | **Carry over the Mada brand.** Design references are coming. |
| D13 | Community, prediction and loyalty | **In scope, phased** (§5.5–5.7, §10). |
| D16 | Language | **English first, fully available in Arabic.** |
| D17 | Analytics | **Heatmaps, funnels and friction signals from the first beta**, with privacy masking ([EXPERIENCE.md §10.2](EXPERIENCE.md)). Tap heatmaps built in-house. |
| D18 | Running costs | **Minimum spend.** Build in-house or use free tiers first, then pay per use. A fixed subscription only where nothing else works ([INTEGRATIONS.md](INTEGRATIONS.md#the-cost-rule-decided)). |
| D19 | Imagery | **No mascot.** Photography for the world, the sun for Mada, real faces for people, matte 3D objects for things and rewards. |
| D20 | AI in the experience | **No AI feel in design or copy.** It stays honest: software never passes as a person ([COPY.md §6](COPY.md)). |
| D21 | Copy and typography | **Every string is written by a person** and reviewed against [COPY.md](COPY.md). Engineers never write user-facing words. |
| D22 | Design references | **Complete.** |

### Still open

| # | Decision | Our recommendation |
|---|---|---|
| D2 | **Response-time promise** shown in the app (e.g. booking ≤ 15 min, disruption ≤ 10 min, any hour) | Start conservative and tighten as data comes in. |
| D3 | **Named agents:** show first name, photo and voice note? | Yes to first name and photo. Voice notes optional per agent. |
| D5 | **Live search at MVP** only for flights and hotels; everything else as concierge requests? | Yes. |
| D6 | **AI persona name** | Call it "Mada". Humans are "your Mada agent". |
| D8 | **Tech stack** | React Native + Expo. |
| D9 | **Mada Plus** membership | Decide after V1. Radar, Wallet and Circles stay free regardless. |
| D10 | **Name of the points currency** | Avoid "Mada Points" or "Mada Pay" on their own: **mada** is also Saudi Arabia's national debit network, and users will confuse the two. Pick a travel-flavoured name, for example *Miles*, *Stars* or *Suns* after the brand's sun symbol. |
| D14 | **Who's around: who can see whom by default** | Contacts only. Same-gender and family-only circles available. Strangers only through a booked event (V2). |
| D15 | **Which GDS Mada uses** (Amadeus, Sabre or Travelport) | Needed to start the flight integration; see INTEGRATIONS.md. |

---

## 13. What we need for design direction

When you send the design direction, these are the things that shape everything else:

1. **Mood and references:** apps, hotels, brands or objects whose feel you want, and what you don't want.
2. **Brand (decided: carry it over):** brand green `#1e352d`, sand `#e9e2d8`, sun-gold, the sun symbol, Instrument Serif and Inter Tight; IBM Plex Sans Arabic and Reem Kufi for Arabic. The references will tell us how far to push it in the app.
3. **Tone of voice** in Arabic and English: formal, warm, playful? Gulf dialect in copy, or Modern Standard Arabic?
4. **Motion:** the website is motion-heavy (GSAP, the sun-ray preloader). How much of that energy belongs in an app people use at the gate under stress?
5. **iOS Liquid Glass and Android Material 3 Expressive:** follow each platform natively (recommended), or one custom look on both?
6. **Photography and illustration** for destinations and empty states.
7. **The first screens to design:** we suggest Today on travel day, the concierge's "request → confirmed by Faisal" moment, the household Wallet, a trip group with the agent inside it, and the Mada Pay sheet.
