# Mada Trips app: integrations

What we connect to, in the order we need it. The vendor research is in [RESEARCH.md](RESEARCH.md) §5 and §8, and the features each integration serves are in [SCOPE.md](SCOPE.md).

**How to read this**
- **Start now.** Accounts and contracts with long lead times. Open them this week, even though coding starts later.
- **Day one.** Needed for the MVP (Phase 1).
- **V1.** Needed for the public launch (Phase 2).
- **Later.** V2 and beyond.

Prices are list prices or third-party figures from October 2026. Confirm each one on the vendor's own page or in the quote.

---

## 1. Start now: long lead times

The engineering on these is quick. The paperwork is slow, so open them before design is finished.

| # | What | Why it can't wait | Who does it |
|---|---|---|---|
| 0.1 | **Apple Developer Program, as an organisation** | Needs a D-U-N-S number for Mada's legal entity, which can take days to weeks. We also need it for Live Activities, Wallet passes, Apple Pay merchant ID and Sign in with Apple. | Mada (legal entity documents) |
| 0.2 | **Google Play Console, as an organisation** | Organisation verification. New personal accounts also have to run a closed test before they can publish. | Mada |
| 0.3 | **GDS Enterprise API access** (Amadeus, Sabre or Travelport, whichever Mada ticketed through) | The core flight supply. The self-service Amadeus APIs closed in July 2026, so access now goes through the agency contract. **We need to know which GDS Mada uses (decision D15).** | Bader, with the GDS account manager |
| 0.4 | **WhatsApp Business Platform** (Meta Cloud API, or a provider such as Unifonic or 360dialog) | Business verification plus approval of every message template. It is needed day one for the 24/7 agent channel and confirmations. | Mada |
| 0.5 | **Payment gateway merchant account: MyFatoorah** (mada cards, Visa and Mastercard, Apple Pay, Google Pay, STC Pay, tokenised cards) | Merchant onboarding and KYC. Apple Pay on mada needs gateway support plus an Apple merchant ID. | Mada (finance) |
| 0.6 | **Tabby and Tamara merchant onboarding** | Each provider must approve selling **airline tickets and travel packages**, and agree how and when money settles. | Mada (finance) |
| 0.7 | **SMS sender ID in Saudi Arabia** (Unifonic, Taqnyat or Msegat) | Login codes by text. The sender ID "MadaTrips" must be registered with the telecoms regulator (CST), which takes days. | Mada |
| 0.8 | **ZATCA e-invoicing (Fatoora, phase 2)** | App sales are simplified tax invoices, and they must be cleared or reported to ZATCA, the tax authority. **Mada Ops records VAT amounts but has no ZATCA integration today**, so this is a gap for the shop and the app alike. | Abdulaziz, plus an e-invoicing provider or the accounting system |
| 0.9 | **Umrah licence route** | Selling Umrah trips, and later to pilgrims abroad, goes through the Ministry of Hajj and Umrah's platforms (Nusuk) under Mada's Umrah licence. Confirm what system access that licence gives. **[Unverified: details depend on the licence type]** | Bader |
| 0.10 | **Legal opinions** | (a) Whether the rewards points stay outside SAMA's e-money rules. (b) User-generated content and photos under the Anti-Cyber Crime Law. (c) Location as sensitive data under the Saudi data law (PDPL). (d) Consent for storing data outside Saudi Arabia while we use the current database. | Saudi counsel |

---

## 2. Day one (MVP)

### Booking and supply

| Need | Recommended | Alternative | Notes |
|---|---|---|---|
| Flight search, pricing, PNR | **Mada's GDS (Enterprise API)** | — | The agent issues the ticket in Ops, exactly as today. |
| NDC fares and low-cost carriers (flynas, flyadeal and others) | **Duffel** | Direct airline APIs | $3 per order + 1% + $2 per ancillary. There is an **excess-search fee**, and AI chat searches a lot, so we cache results. Check which airlines support holds. |
| Hotels | **RateHawk** + **WebBeds** | Hotelbeds (next); apply for Expedia Rapid in parallel | WebBeds is strong in the Middle East. Photos and descriptions come with the hotel content. |
| Visa rules by nationality | **IATA Timatic** through the GDS | Sherpa (more consumer-friendly display) | Used for the entry check and for agents' answers. |
| Visas, cars, activities, restaurants, packages, Umrah | **No API at MVP.** These are concierge requests handled by agents in the Ops inbox. | — | Moved to live APIs in V1 and V2 (see below). |

### Trip companion

| Need | Recommended | Alternative | Notes |
|---|---|---|---|
| Flight status, gate, delays, inbound aircraft | **FlightAware AeroAPI** (alerts and webhooks) | Cirium or OAG once we have volume | From $100 a month plus per-query fees. Test gate accuracy at RUH, JED and DMM first. |
| Trip import from email | **Inbound email**: Postmark inbound or Amazon SES | SendGrid inbound parse | Each user gets an address like `name@trips.madatrips.sa`. Claude reads the email or PDF; the user confirms. |
| Weather | **Apple WeatherKit** (500k calls a month included with the developer account) | Open-Meteo, Tomorrow.io | |
| Maps | **Google Maps SDK** | Apple MapKit on iOS, Mapbox for custom styling | Best Arabic place names and coverage of Saudi places. |
| Places (saves, recommendations, share-to-Mada) | **Google Places API (New)** | Foursquare Places | Turns a shared link or name into a real place with opening hours. |
| Passport scan | **On-device**: Apple Vision / Google ML Kit plus an open-source MRZ parser | Dynamsoft (commercial) | No vendor and no data leaves the phone. NFC chip reading comes in V1. |
| Prayer times, qibla, Hijri dates | **Built in**: the open-source `adhan` library and Umm al-Qura tables | — | No API and no cost. Works offline. |

### Payments and money

| Need | Recommended | Alternative | Notes |
|---|---|---|---|
| Card, mada, Apple Pay, Google Pay, STC Pay, saved cards | **MyFatoorah** | HyperPay, Moyasar, Checkout.com | Authorise when the request goes to an agent, capture when the ticket is issued, void if issuance fails. Tokenised cards power the one-tap **Mada Pay sheet**. |
| Points (rewards) | **Built in**: a ledger table in Postgres | Voucherify later | Earning starts at MVP. Redemption and tiers come in V1. |
| E-invoices | **ZATCA e-invoicing provider** | Through the accounting system | See 0.8. |

### People and messaging

| Need | Recommended | Alternative | Notes |
|---|---|---|---|
| Login | **Phone OTP** (Unifonic SMS) + **Sign in with Apple** + **Google Sign-In** | Twilio Verify | Nafath comes in V2. |
| Chat: concierge thread, human agent, **trip groups** | **Stream Chat** | Sendbird, or Supabase Realtime built in-house | One chat system for all three: the traveller, the AI, the agent and group members in the same thread. Built-in moderation, reactions, polls and attachments. Free up to about 1k monthly users, then about $400–500 a month **[unverified]**. Agents answer from the Ops inbox through Stream's server API. |
| WhatsApp | **WhatsApp Business Platform** | — | Confirmations, documents, group invite links, and agent replies when the traveller isn't in the app. |
| Push notifications | **APNs + FCM** (through Expo Notifications) | OneSignal | Includes Live Activity push-to-start and broadcast updates. |
| Transactional email | **Postmark** | Amazon SES | Receipts, invoices, account mail. |

### AI

| Need | Recommended | Notes |
|---|---|---|
| Concierge agent, document extraction, predictions, moderation classifier | **Anthropic Claude API** | A larger model for disruption replanning, a mid-size model for chat, a small model for routing and extraction. Prices on cards only ever come from suppliers. No raw passport data goes to the model. Cost per conversation is measured in the closed beta. |
| First-pass content moderation | **OpenAI omni-moderation** (free) or **Stream AI Moderation** | Then the Claude policy check for Saudi and cultural rules, then a human queue that clears within 24 hours. |

### Platform and operations

| Need | Recommended | Alternative | Notes |
|---|---|---|---|
| App build and over-the-air updates | **Expo EAS** | — | |
| Backend hosting | **Current stack: Supabase Postgres + Vercel** (decision D4) | Move to a Saudi region later | The new Mada Core API sits next to Ops. |
| Document storage | **Supabase Storage**, a separate bucket with app-level encryption | Saudi-region object storage later | Designed to be moved on its own. |
| Background jobs and alert fan-out | **A queue on Postgres** (pg-boss) or **Upstash QStash** | Redis + BullMQ | FlightAware webhook → queue → push, WhatsApp, email. |
| Deep links, invites, referrals, install attribution | **AppsFlyer OneLink** | Branch | Firebase Dynamic Links shut down in Aug 2025. Group invites and referrals depend on this. |
| Product analytics, feature flags, A/B tests, session replay | **PostHog** | Amplitude, Mixpanel | One tool, generous free tier. The flags gate Who's around and every prediction type. |
| Crash and error reporting | **Sentry** | Crashlytics | |

---

## 3. V1 (public launch)

| Need | Recommended | Notes |
|---|---|---|
| Buy now, pay later | **Tabby** + **Tamara** SDKs | Show the instalment price on package cards. Tabby's 12-month plans cover SAR 2k–50k. |
| Voice (Gulf Arabic) | **ElevenLabs Scribe v2**, **Deepgram** or **Azure ar-SA**, whichever wins the dialect test | 2-hour Najdi, Hijazi and Gulf test set. |
| Activities and events | **Viator** + **GetYourGuide** | About 8% commission. Riyadh Season and Mada Events are handled in-house. |
| eSIM | **Airalo Partner API** | Offered before landing, never pushed at checkout. |
| Travel insurance | **A SAMA-licensed Saudi insurer** (e.g. Tawuniya, Bupa Arabia) | Licensing must be confirmed before choosing. |
| Inbox sync | **Microsoft Graph** (Outlook) | Gmail comes later because of Google's security review. |
| NFC passport chip | **Native module** (ICAO 9303) | |
| Wallet passes | **Apple PassKit** + **Google Wallet API** | For Mada hotels, transfers and activities. |
| Identity check for Who's around | **Passport KYC vendor** (Sumsub or Onfido) | **[Not compared in depth]** Nafath replaces it for Saudis in V2. |
| Image moderation | **Hive** | For photos in journals and posts. |

## 4. Later (V2+)

| Need | Recommended |
|---|---|
| National login | **Nafath** (through Elm or a licensed provider) |
| Gmail sync | Gmail API, after Google's CASA security assessment |
| Car rental | **CarTrawler** |
| Restaurants | **Eat App** partnership (to be confirmed) |
| Partner loyalty programmes | AlFursan (Saudia), stc Qitaf, Al Rajhi mokafaa, Neqaty, Shukran: commercial agreements first, then each partner's API |
| Loyalty and promotions engine | **Voucherify** or **Talon.One**, once in-house rules get complex |
| Corporate | ZATCA B2B invoices, approval workflows (built in Ops) |
| AI-platform distribution | ChatGPT app or MCP server for search. Service stays in the Mada app. |
| Saudi data region | GCP Dammam (via CNTXT), Oracle Jeddah, or AWS/Azure Saudi once live |

## 5. Built in-house (no vendor)

- Points ledger and badges
- Group split ledger (records who owes whom; never holds money)
- Notification budget engine
- Prediction rules ("next move")
- Prayer times, qibla and Hijri dates
- Bidi-safe text components for Arabic with flight numbers and times
- Year-in-review "Mada Passport" cards
- The Ops app inbox and 24/7 rota board

---

## 6. Checklist for this week

1. Get a D-U-N-S number, then open **Apple Developer** and **Google Play** organisation accounts.
2. Confirm which **GDS** Mada uses and ask for **Enterprise API** access.
3. Start **WhatsApp Business** verification.
4. Open **MyFatoorah**, **Tabby** and **Tamara** merchant applications, and ask each whether they cover airline tickets and how settlement works.
5. Register an **SMS sender ID** with a Saudi provider.
6. Ask the accountant about **ZATCA e-invoicing** (phase 2): Ops doesn't issue e-invoices yet.
7. Book the **legal opinions** in 0.10.
8. Create sandbox accounts (free) for **Duffel**, **RateHawk**, **FlightAware**, **Stream**, **PostHog**, **Sentry** and the **Anthropic API**.
