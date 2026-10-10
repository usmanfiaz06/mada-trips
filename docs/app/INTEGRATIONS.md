# Mada Trips app: integrations

What we connect to, in the order we need it, at the lowest possible running cost. The vendor research is in [RESEARCH.md](RESEARCH.md) §5 and §8, and the features each integration serves are in [SCOPE.md](SCOPE.md).

**How to read this**
- **Start now.** Accounts and contracts with long lead times. Open them this week, even though coding starts later.
- **Day one.** Needed for the MVP (Phase 1).
- **V1.** Needed for the public launch (Phase 2).
- **Later.** V2 and beyond.

Prices are list prices or third-party figures from October 2026. Confirm each one on the vendor's own page or in the quote.

---

## The cost rule (decided)

**No monthly subscription unless it does something we can't build cheaply, or it replaces a person.** In order of preference:

1. **Built in-house** on what we already pay for: Supabase Postgres, Vercel and the Claude API.
2. **Free or open source**, including generous free tiers.
3. **Pay per use**: we pay only when a booking, message or search actually happens, so cost grows with revenue.
4. **Fixed subscription**: only where nothing else works. Each one is named and justified in §7.

**Every free tier gets a usage alarm at 70%**, so we decide whether to upgrade before a limit decides for us.

---

## 1. Start now: long lead times

The engineering on these is quick. The paperwork is slow, so open them before design is finished.

| # | What | Why it can't wait | Who does it | Cost |
|---|---|---|---|---|
| 0.1 | **Apple Developer Program, as an organisation** | Needs a D-U-N-S number for Mada's legal entity (free, but can take days to weeks). Also needed for Live Activities, Wallet passes, the Apple Pay merchant ID, Sign in with Apple and WeatherKit. | Mada (legal entity documents) | $99 a year |
| 0.2 | **Google Play Console, as an organisation** | Organisation verification takes time. | Mada | $25 once |
| 0.3 | **GDS Enterprise API access** (Amadeus, Sabre or Travelport, whichever Mada ticketed through) | The core flight supply. The self-service Amadeus APIs closed in July 2026, so access now goes through the agency contract. **We need to know which GDS Mada uses (decision D15).** | Bader, with the GDS account manager | Under the existing contract; ask what API access adds |
| 0.4 | **WhatsApp Business Platform** (Meta Cloud API directly, with no middleman fee) | Business verification plus approval of every message template. Needed day one for the 24/7 agent channel and confirmations. | Mada | Pay per conversation (Meta's rates) |
| 0.5 | **Payment gateway merchant account: MyFatoorah** (mada, Visa and Mastercard, Apple Pay, Google Pay, STC Pay, tokenised cards) | Merchant onboarding and KYC. Apple Pay on mada needs gateway support plus an Apple merchant ID. | Mada (finance) | A fee per transaction, no monthly fee **[confirm]** |
| 0.6 | **Tabby and Tamara merchant onboarding** | Each provider must approve selling **airline tickets and travel packages**, and agree how and when money settles. | Mada (finance) | A fee per transaction, paid by the merchant |
| 0.7 | **SMS sender ID in Saudi Arabia** (Unifonic or Taqnyat; both have live adapters) | Phone sign-in codes, sent for Supabase Auth through our SMS hook ([AUTH.md](AUTH.md)). The sender ID "MadaTrips" must be registered with CST, the telecoms regulator. | Mada | Pay per message |
| 0.8 | **ZATCA e-invoicing (Fatoora, phase 2)** | App sales are simplified tax invoices, and they must be reported to ZATCA, the tax authority. **Mada Ops records VAT amounts but has no ZATCA integration today**, so this is a gap for the shop as well as the app. | Abdulaziz | Compare building directly on ZATCA's free API with the accounting system's built-in option |
| 0.9 | **Umrah licence route** | Selling Umrah trips goes through the Ministry of Hajj and Umrah's platforms (Nusuk) under Mada's Umrah licence. Confirm what system access the licence gives. **[Unverified: depends on the licence type]** | Bader | — |
| 0.10 | **Legal opinions** | (a) Whether rewards points stay outside SAMA's e-money rules. (b) User-generated content and photos under the Anti-Cyber Crime Law. (c) Location as sensitive data under the PDPL (Saudi data protection law). (d) Consent for storing data outside Saudi Arabia while we use the current database. (e) Telling people when they are talking to software (see [COPY.md §6](COPY.md)). | Saudi counsel | One-time fee |

---

## 2. Day one (MVP)

### Booking and supply

| Need | Recommended | Alternative | Cost model |
|---|---|---|---|
| Flight search, pricing, PNR (**the core**) | **Mada's GDS through its Enterprise API** (Sabre or Amadeus, whichever the desk already uses) | — | Bookings are held as a PNR or order, and an agent issues them on **Mada's own IATA number** through BSP, exactly as today. GDSs usually **pay the agency incentives per segment** instead of charging fees, so this is the cheapest source as volume grows. Saudia's NDC fares are live on both Sabre and Amadeus, and Riyadh Air has signed with Sabre, Amadeus and Travelport. |
| flynas and flyadeal | **Travelfusion** | flyadeal is also on Amadeus (since 2025) | Neither is on Duffel. Travelfusion lists both. |
| Riyadh Air NDC-only offers (optional) | **Verteil** | — | Riyadh Air's launch NDC aggregator. Add it only if its offers are richer than what the GDS shows. |
| Fast prototyping only | Duffel | — | Fine for building and testing AI search quickly. **Not the core:** it charges $3 per order + 1%, using your own IATA number needs its Enterprise plan, and it doesn't carry flynas, flyadeal, Riyadh Air or Air Arabia. |
| Search economics | Built in-house | — | AI makes a lot of searches. Cache results for 5–15 minutes, re-price live only when the traveller picks a fare, and stay within the GDS contract's look-to-book limit. |
| Hotels | **RateHawk** + **WebBeds** | Hotelbeds next; Expedia Rapid later | Net rates with no API fee (RateHawk says so). WebBeds terms come from sales. |
| Visa rules by nationality | **IATA Timatic** through the GDS | Sherpa | Usually within the GDS contract **[confirm]**. |
| Visas, cars, activities, restaurants, packages, Umrah | **No API at MVP.** These are requests handled by agents in the Ops inbox. | — | Free. |

### Trip companion

| Need | Recommended | Alternative | Cost model |
|---|---|---|---|
| Flight status, gate, delays, inbound aircraft | **FlightAware AeroAPI** (alerts and webhooks, never polling) | AeroDataBox (cheaper, less reliable) | **The one fixed cost worth paying:** about $100 a month minimum, plus per query. Early warnings are the core promise, so data quality matters here more than anywhere else. |
| Live aircraft position (the plane on the map, the inbound aircraft, in-air progress) | **adsb.lol** open ADS-B data (no key, ODbL licence: commercial use with attribution) | OpenSky Network (free for non-commercial use; commercial needs an agreement) | Free. Position, altitude and speed only. Gates, delays and schedules still come from FlightAware. Cached 30–60 s per flight. |
| Trip import from email | **Amazon SES inbound** | — | About $0.10 per 1,000 emails. Each user gets an address like `name@trips.madatrips.sa`, and Claude reads the email. |
| Weather | **Apple WeatherKit** | Open-Meteo (free, open data) | Included with the Apple developer account (500k calls a month). |
| Maps | **Apple MapKit** on iOS, **Google Maps SDK** on Android | — | Free on iOS. Google's mobile map display is free **[confirm]**. |
| Places (saves, recommendations, share-to-Mada) | **Google Places API (New)**, within the monthly free amount | Foursquare Places | Results are cached for 30 days where Google's terms allow, and one place is looked up once, not on every view. |
| Places data: every city of 15,000+ people, regions, time zones, Arabic names | **GeoNames** dumps (`cities15000`, `countryInfo`, `admin1Codes`, `alternateNamesV2`), loaded monthly by `platform/scripts/places/ingest.ts` | Wikidata (CC0) | Free. **CC BY 4.0: attribution required** ("Places from GeoNames, CC BY 4.0" on every city page). Details: `platform/src/lib/app/places/README.md`. |
| Places data: airports and IATA codes | **OurAirports** `airports.csv` (large and medium airports with scheduled flights) | — | Free, public domain. Credited anyway. |
| Places data: city guides (summary, lead photo, Understand, Get in, See, Do, Eat, Stay safe) | **Wikipedia** page summary + **Wikivoyage** sections, matched through **Wikidata**; photo licence and author from **Wikimedia Commons** | OpenStreetMap Overpass for points of interest (ODbL), later | Free. **CC BY-SA: "From Wikivoyage, CC BY-SA" with a link beside every extract; extracts trimmed at a sentence, never reworded.** Photos only with a free licence, credited with author and licence. Cached 30 days, refreshed in the background; descriptive User-Agent with contact (`PLACES_CONTACT`). Cities we don't sell go to the desk as "destination" requests and are planned by hand. |
| Passport scan | **On-device**: Apple Vision / Google ML Kit plus an open-source parser for the machine-readable zone (MRZ) | — | Free. Nothing leaves the phone. |
| Prayer times, qibla, Hijri dates | **Built in**: the open-source `adhan` library and Umm al-Qura tables | — | Free. Works offline. |

### Payments and money

| Need | Recommended | Cost model |
|---|---|---|
| Card, mada, Apple Pay, Google Pay, STC Pay, saved cards | **MyFatoorah** | Per transaction. Payment is authorised when the request goes to an agent, captured when the ticket is issued, and voided if issuance fails. |
| Points (rewards) | **Built in**: a ledger table in Postgres | Free. |
| E-invoices | See 0.8 | — |

### People and messaging

| Need | Recommended | Alternative | Cost model |
|---|---|---|---|
| Login (identity) | **Supabase Auth** ([AUTH.md](AUTH.md)): **Sign in with Apple** (iOS), **Google Sign-In**, a 6-digit **email code** and a **phone code by SMS**. SMS goes out through Supabase's *Send SMS* hook to our Core API, which sends it with a Saudi sender (**Unifonic** or **Taqnyat**, registered sender ID). The app swaps the Supabase token for its own Core API session; only phone and email live in Supabase. Accounts that start with Apple, Google or email verify a phone before their first booking. WhatsApp authentication messages can be added to the same hook later. | Twilio Verify (poor delivery to Saudi numbers) | Supabase Auth is included in the plan we already pay for (50k monthly active users on Pro). Apple and Google sign-in are free. Phone codes are paid per message. |
| Chat: concierge thread, human agent, **trip groups** | **Built in-house** on **Supabase Realtime + Postgres**: messages, read state, attachments, polls, report and block | Stream Chat, if the build runs late | Included in the Supabase plan we already pay for. Stream would cost about $400–500 a month above 1k users. |
| WhatsApp | **WhatsApp Business Platform** (Meta Cloud API) | — | Per conversation. The app's own push notifications come first, so WhatsApp is used where it adds value: confirmations, invites, and agent replies when the traveller isn't in the app. |
| Push notifications | **APNs + FCM** through **Expo push** | — | Free. Includes Live Activity updates. |
| Transactional email | **Amazon SES** | Postmark | About $0.10 per 1,000 emails. |

### AI (behind the scenes only; see COPY.md §6)

| Need | Recommended | Cost model |
|---|---|---|
| Concierge, document extraction, predictions, moderation decisions | **Anthropic Claude API** | Per token. Each task is routed to the smallest model that can do it. Repeated prompt context is cached, and results are cached too. Prices on cards always come from suppliers. Cost per conversation is measured in the beta, with a hard monthly budget alert. |
| First-pass content moderation (text and images) | **OpenAI omni-moderation** | Free. Anything it flags goes to a Claude check against Saudi and cultural rules, then to a human queue. |

### Platform and operations

| Need | Recommended | Alternative | Cost model |
|---|---|---|---|
| App builds | **Expo EAS** free tier, plus local builds and GitHub Actions | Paid EAS plan once release cadence needs it | Free to start. |
| Over-the-air updates | **EAS Update** free tier | Self-hosted Expo updates server | Free to start. |
| Backend hosting | **Current stack: Supabase Postgres + Vercel** (decision D4) | Saudi region later | Already paid. |
| Document storage | **Supabase Storage**, a separate bucket with app-level encryption | Saudi-region object storage later | Already paid. |
| Background jobs and alert fan-out | **A queue on Postgres** (pg-boss) | — | Free. |
| Deep links, group invites, referrals | **Built in**: Universal Links and App Links, a Vercel route for links opened without the app, and referral codes in Postgres | AppsFlyer, only if Mada ever runs paid ad campaigns | Free. |
| Product analytics, funnels, feature flags, A/B tests, session replay | **PostHog Cloud free tier** | Self-hosted PostHog if we outgrow the free tier | Free up to the free-tier limits **[confirm current replay quota]**. |
| **Tap heatmaps** | **Built in-house.** Every tap is logged as a PostHog event with the screen, the element and its x/y position, and an internal page in Ops draws the heatmaps. | UXCam, only if the in-house version falls short | Free. No extra vendor. |
| Crash and performance reporting (including slow frames) | **Sentry** free developer tier | Self-hosted GlitchTip | Free to start. |
| Motion and haptics | **Reanimated 4**, **Skia**, **Rive** runtime, a small native haptics module | — | Free and open source. |

---

## 3. V1 (public launch)

| Need | Recommended | Cost model |
|---|---|---|
| Buy now, pay later | **Tabby** + **Tamara** SDKs | Per transaction. The instalment price is shown on package cards. |
| Voice | **On-device speech recognition first** (Apple Speech, Android SpeechRecognizer): free, and supports Saudi Arabic. A paid service (ElevenLabs Scribe v2, Deepgram or Azure) is added only if the Najdi, Hijazi and Gulf dialect test shows on-device recognition isn't good enough. | Free, or paid per minute if needed. |
| Activities and events | **Viator** + **GetYourGuide** | Commission only: they pay us. |
| eSIM | **Airalo Partner API** | We resell at a margin. No fee. |
| Travel insurance | **A Saudi insurer licensed by SAMA** | Commission. |
| Inbox sync | **Microsoft Graph** (Outlook) | Free. |
| NFC passport chip | **Native module** (ICAO 9303 standard) | Free. |
| Wallet passes | **Apple PassKit** + **Google Wallet API** | Free. |
| Verified people for "Who's around" | **No paid identity check at first.** Visibility is limited to mutual contacts who are verified by phone number and Apple or Google sign-in. Nafath comes in V2. | Free. |

## 4. Later (V2+)

| Need | Recommended |
|---|---|
| National login | **Nafath** (through Elm or a licensed provider) |
| Gmail sync | Gmail API, after Google's CASA security assessment (a yearly cost, so only if the data justifies it) |
| Car rental | **CarTrawler** (commission) |
| Restaurants | **Eat App** partnership (to be confirmed) |
| Partner loyalty programmes | AlFursan, stc Qitaf, Al Rajhi mokafaa, Neqaty, Shukran (commercial agreements) |
| Corporate | ZATCA B2B invoices, approval workflows (built in Ops) |
| AI-platform distribution | An MCP server for search, so other AI assistants can reach Mada. Free to build. |
| Saudi data region | GCP Dammam (via CNTXT), Oracle Jeddah, or AWS/Azure Saudi once live |

## 5. Built in-house (no vendor)

- Chat, trip groups and polls
- Tap heatmaps and the friction board
- Deep links, invites and referrals
- Points ledger, badges and passport stamps
- Group split ledger (records who owes whom; holds no money)
- Notification budget engine
- Prediction rules ("next move")
- Prayer times, qibla and Hijri dates
- Text components for Arabic that keep flight numbers and times readable
- Year-in-review "Mada Passport" cards
- The Ops app inbox and the 24/7 rota board

---

## 6. Checklist for this week

1. Get a D-U-N-S number, then open **Apple Developer** and **Google Play** organisation accounts.
2. Confirm which **GDS** Mada uses and ask for **Enterprise API** access.
3. Start **WhatsApp Business** verification on Meta's Cloud API.
4. Open **MyFatoorah**, **Tabby** and **Tamara** merchant applications. Ask each one whether they cover airline tickets, how settlement works, and their fees.
5. Register an **SMS sender ID** with a Saudi provider, and set up **Supabase Auth** with Apple, Google, email codes and the SMS hook ([AUTH.md](AUTH.md)).
6. Ask the accountant about **ZATCA e-invoicing** (phase 2).
7. Book the **legal opinions** in 0.10.
8. Ask **Travelfusion** for terms for flynas and flyadeal. Create free accounts for **RateHawk**, **FlightAware**, **PostHog**, **Sentry**, **Amazon SES** and the **Anthropic API**.

---

## 7. What it costs to run

**Fixed costs (the only subscriptions)**

| Item | Cost | Why we pay it |
|---|---|---|
| Apple Developer Program | $99 a year | Required to publish on iOS |
| Google Play Console | $25 once | Required to publish on Android |
| FlightAware AeroAPI | About $100 a month minimum, plus queries | Early-warning data is the core promise. **It tracks flights only. It sells no seats and shows no fares.** |
| Supabase + Vercel | Plans already paid for Ops | Hosting |

**Costs that grow only with use**

| Item | Charged per |
|---|---|
| Claude API | Conversation and document |
| GDS | Usually pays Mada per segment (incentives), not the other way round |
| Travelfusion | Booked order (terms to confirm) |
| WhatsApp | Conversation |
| SMS | Phone sign-in code (Unifonic or Taqnyat, through the Supabase SMS hook) |
| Amazon SES | Email |
| Payment gateway, Tabby and Tamara | Transaction |

**Everything else is free or built in-house**, until usage proves a paid upgrade is cheaper than our time.
