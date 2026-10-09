# Mada Trips app: research findings

The evidence behind [SCOPE.md](SCOPE.md). Gathered October 2026 from five research tracks:

1. Competitors
2. What travellers say
3. The Saudi and GCC market
4. Technical feasibility
5. UX case studies

Items marked **[unverified]** rest on a single secondary source, or the sources disagree. Check them before they go into an investor deck or a contract.

> **Gap: Reddit could not be read directly.** Automated access to reddit.com was blocked. Traveller voices therefore come from:
>
> - Trustpilot, fetched directly
> - Hacker News
> - Frequent-flyer, Tripadvisor and Fodor's forums
> - 2026 traveller surveys from Expedia, Greetwell and Travelport
> - Press coverage
>
> Someone should still read r/saudiarabia, r/dubai and r/Flights by hand, especially the threads from the March 2026 Gulf airspace closures.

---

## 1. The one-paragraph version

Travellers don't hate booking. They hate being alone once something goes wrong.

Every major complaint about booking sites (OTAs) comes back to the same moment: the flight changes, the hotel has no record, the refund stalls. The airline then says "ask your agent", and the agent says "airline policy". Trackers like Flighty spot the problem early but can't fix it. Booking sites can fix it but bury the human. AI planners write itineraries but don't own anything that happens afterwards.

Nobody combines all three: **early warning, a fix already prepared, and a named, licensed human who takes responsibility.** That gap matters most in Saudi Arabia, where families travel as a unit, WhatsApp is the default support channel, and Almosafer's TrustScore is 1.7.

Mada already has the hardest piece to copy: IATA ticketing authority and an issuance desk (Mada Ops).

---

## 2. Competitors

| Product | What it does well | Where it fails | Lesson for Mada |
|---|---|---|---|
| **Flighty** (4.8★, ~148k ratings, 2023 Apple Design Award) | Warns about delays early by tracking the inbound aircraft. Live Activities. A "boringly obvious" design modelled on airport departure boards. Connection Assistant (2026) | Can't book or rebook, has no human. Best features need a paid subscription. Some missed delays | The bar for proactive UX. It tells you about a problem but can't fix it, and fixing it is where Mada comes in |
| **TripIt / Pro** ($49/yr) | Forward an email and get an itinerary. Passport scanning. Safety scores | Parsing errors (one user found 4 of 8 itineraries wrong). Login loops. Surprise auto-renewals. Complex packages need typing in by hand | Users love zero-effort capture, but wrong data is worse than no data |
| **App in the Air** (shut down Sep 2024) | Was the original "travel assistant" | Ads and subscriptions only, with thin margins. Ownership passed through opaque hands with millions of users' travel data. Users got a 30-day export notice | You have to own the transaction. Trust in how data is handled is part of the brand |
| **Hopper** | Fare prediction and paid extras (Price Freeze, Cancel For Any Reason) | **$35M FTC settlement (2026)** over pre-ticked fees and a "VIP Support" that buyers couldn't reach. Refunds paid as credit. Downloads collapsing **[unverified]** | Treat the FTC case as a design spec: no pre-ticked fees, and no paid support you can't deliver |
| **Booking.com** | AI Trip Planner, AI Voice Support that hands over to a human with context (2026), "connected trip" | Still a marketplace that doesn't stay with you through the trip | Handing over to a human with full context is now the expected standard |
| **Expedia** | Romie (an assistant inside group chats), Reel-to-trip, bought Layla (Jul 2026), ChatGPT app | Romie seems to have stalled **[unverified]** | The big players are buying AI planners. Standalone AI planners don't survive |
| **Airbnb** (2025 redesign) | Add-on services offered inside the trip. Its AI support agent cut contacts needing a human by about 15% | n/a | Show recommendations inside the trip timeline, not in a separate store |
| **Google AI Mode / Gemini** | Natural-language flight deals in 200+ countries. Agentic hotel checkout (US test) | The partner handles everything after booking. No flight booking. English and US only | Platforms take the discovery step, and service after booking is left to whoever sold the trip |
| **ChatGPT apps** | Expedia, Booking and **Almosafer (Apr 2026, a Saudi first)** and **Wego** are all inside ChatGPT | Reportedly pulled in-chat travel checkout in Mar 2026 **[unverified]** | Almosafer is the direct local AI competitor. Mada can win on what happens after booking |
| **Navan** | Booking that feels like a consumer app, travel and expenses in one place, internal NPS 43 | 45-minute holds, nobody "with the authority to resolve" | Even the leaders fail on whether a human can actually fix the problem |
| **Fora** ($1B valuation, Jul 2026) | Human advisers with AI support ("Via") | n/a | **The strongest proof of the model:** AI makes the human faster, the human owns the outcome |
| **Mindtrip / Layla / Odessia** | Card-based itineraries, group chat, agentic flight booking | Acquired, or moving to B2B2C (selling through tourism boards) | Skift (Jul 2026): consumer travel start-ups pivot, get bought, or die unless they sit on real supply |
| **Airalo** | eSIM unicorn, ~20M users | eSIMs that won't activate. Support that relies too heavily on a chatbot | eSIM is an easy, high-margin add-on to the trip |

**What wins:**
- Owning the transaction
- Zero-effort capture
- Fast, early alerts with great design
- AI triage that hands over to a human who already has the context
- Connected trips across services
- Planning together as a group

**What fails:**
- Paid add-ons the service can't honour
- Support you can't reach during a disruption
- Parsing errors and data that lags behind the airline
- Subscription traps
- AI planners with no supply behind them
- Unclear ownership of user data

---

## 3. What travellers say

**TrustScores, Sep–Oct 2026:** Almosafer **1.7** (85% one-star), Hopper 1.3, Wego 3.1, Expedia 3.3.

1. **The blame ping-pong.** "Expedia will say it's Cathay's problem, and Cathay … tell you it's Expedia's problem" (HN). An Almosafer reviewer: "Even the airlines asked me to go to them for a refund." **Requirement:** Mada never says "contact the airline".
2. **Schedule changes that never reach the traveller.** "The flight was changed from 11 am to 10 am about which we weren't informed" (Almosafer). OTAs often give airlines placeholder emails. **Requirement:** pass on schedule changes within minutes, with accept and reject options. Give the traveller the real PNR (airline booking code).
3. **Names.** A shortened name went to the airline and didn't match the ticket (Almosafer). **[Unverified]:** a family was denied boarding because Trip.com couldn't handle names that include the father's and grandfather's names. **Requirement:** the name must match the passport character for character, including multi-part Arabic names.
4. **Refunds take months.** One Wego refund was still pending 55+ days after the airline had paid it. Hopper lost a customer ~$150 on currency conversion. **Requirement:** a refund tracker with stages, dates and the original currency.
5. **Price jumps.** A Wego change quote went from AED 1,000 to AED 5,000 the next day. A Hopper price rose $57 in 4 minutes. **Requirement:** an all-in price held for a stated time.
6. **Disruption.** In Mar 2026 about 30,000 of 51,000 Middle East flights were cancelled, and Emirates told people who booked through agents to "contact their agents". 65% of travellers want "a real person they can call or message" for rebooking (Greetwell 2026). Claims firms keep 30–50% of compensation. **Requirement:** a prepared plan, 2–3 rebooking options, a human working on it in parallel, and a claims helper.
7. **Documents.** People keep screenshots in their photo gallery and folders on Google Drive. Expiry rules ruin trips: the 6-month passport rule, children's passports, and for expats the residence permit (iqama) and exit/re-entry visa. **Requirement:** an encrypted family wallet that knows expiry dates and checks entry rules for every traveller on every trip.
8. **AI trust.** About two-thirds won't let AI book for them (Expedia, Apr 2026). 68% have little trust in AI choosing a flight. 55% of AI users have been sent to a wrong or closed place. In a test, 90% of ChatGPT itineraries had errors. **Requirement:** AI drafts, a human confirms, and every suggestion is checked against live data.
9. **Chat fatigue.** For fixed tasks like rebooking, users preferred regular screens to chat (Amadeus usability test, 2026). NN/g (Apr 2026): "less chat, more answer". **Requirement:** answers come as cards with buttons, and chat is the way you ask, not the way you get answers.
10. **Inbox access.** People forward emails or create a separate travel Gmail rather than give an app full access. **Requirement:** forwarding first, with inbox sync as an optional, scoped extra.
11. **Notifications.** People love alerts like "your inbound plane is late". People hate marketing pushes, and status that contradicts the airport board. **Requirement:** a notification budget, no promotions while a trip is underway, and every status labelled with its source.
12. **Families.** One person ends up as the trip manager. WhatsApp threads, Splitwise, and the wrong child's passport (as happened to Chris Hemsworth's family). **Requirement:** household profiles, a shared live trip, per-person payment links, and a document checklist for each child.

---

## 4. The Saudi and GCC market

**Size of the market**
- Saudi tourism in 2025: ~123M visits and SAR 304B in spending.
- About **17.4M Saudi trips abroad** (top-25 outbound market). Outbound spend ~$27.5B in 2025, rising to $47.8B by 2032 (industry forecast).

**Who travels and where (Visa summer data)**
- Top destinations: Manama 20%, Dubai 13%, Cairo 9%, Istanbul 8%, London 4%.
- Family trips are 20% of summer outbound travel. Families spend ~$2,060 on tickets alone.
- 69% of Eid trips are short.

**Helpers, women, students**
- Helpers need their own visas, exit/re-entry through Absher, and an iqama valid for the whole trip. **No competitor models the helper as a traveller.**
- Women over 21 have travelled without guardian permission since 2019.
- 12k+ Saudis study at top universities, and the scholarship programme targets 70k by 2030.

**Umrah and Nusuk**
- Nusuk has 26M+ downloads and now sells visas, hotels and transport directly.
- Unlicensed Umrah selling is being enforced, with fines up to SAR 1M.
- Mada can wrap flights, hotels and the Haramain train **around** the Nusuk permit, but must not resell permits without a licence.

**Visas**
- **Schengen:**
  - The five-year multi-entry "cascade" (since Apr 2024) means the first appointment is what matters.
  - Processing takes up to 45 days around Ramadan, Eid and summer.
  - The Dutch consulate wants applications 45+ days ahead.
- **UK:** an ETA (Electronic Travel Authorisation), valid 2 years and **tied to the passport**, so it is lost when the passport is renewed.
- **US:** B1/B2 interview waits swing between 0.5 and 2 months.
- **GCC unified visa:** still "soon".

**Payments**
- **mada cards:** e-commerce volume up 57% year on year. mada is the default.
- **Buy now, pay later (BNPL):** Tabby (25M+ users) and Tamara (16M).
  - Under SAMA (Saudi central bank) rules the merchant pays the fees, never the customer, and BNPL is not offered to under-18s or non-residents.
- STC Bank has ~8M monthly active users.

**Rules and regulation**
- **PDPL** (Saudi personal data law): enforced since Sep 2024.
  - Fines up to SAR 3M plus prison for disclosing sensitive data.
  - Breaches must be notified within 72 hours.
  - Transfers abroad need SDAIA's safeguards.
  - **Plan:** keep passport data inside the Kingdom.
- Ministry of Tourism licence: **check that it covers online sales and Umrah**.
- **E-Commerce Law:** a 7-day cancellation right. Whether it applies to travel is unclear.

**Identity**
- **Nafath** (national digital ID login) is used by 530+ platforms, and private apps can integrate through Elm or a licensed provider.
- Absher has no public API.

**Channels**
- **WhatsApp** is used by 94% of men and 90% of women online. Snapchat by 88% of women.
- Almosafer runs about 2,200 WhatsApp conversations a day.

**Voice**
- Off-the-shelf speech recognition does badly on Najdi and Hijazi dialects (55% word error rate, falling to about 30% after fine-tuning).
- Every option must be tested on Saudi audio, and names, dates and cities read back to the user.

**Corporate**
- Government travel runs through the Etimad platform's ERCAB service and Seera's Elaa.
- Semi-government and private firms are open ground: they need approvals, grade-based policy, per-diems and ZATCA-compliant e-invoices.

---

## 5. Technical feasibility

**App stack:** **React Native + Expo SDK 56**, with about 15–20% native code.
- **Why:**
  - It shares TypeScript, Zod schemas and the API client with Mada Ops.
  - `expo-widgets` (stable since Jun 2026) compiles widgets and Live Activities to SwiftUI.
  - Tabby, Tamara and MyFatoorah all have React Native SDKs.
- **Native modules needed:** the Android 16 Live Updates notification, App Intents, PassKit, and NFC passport reading.
- **Risks:** switching to right-to-left needs an app reload, and Live Activities have time caps.
- **Fallback:** Flutter, if the team is Dart-heavy.

**Flight data**
- Start on **FlightAware AeroAPI** ($100/month minimum plus per-query fees). Use alerts and webhooks, not polling, and the inbound-aircraft link.
- Get Cirium or OAG quotes as volume grows.
- Test gate accuracy at RUH, JED and DMM before committing.

**Flights content**
- **Amadeus Self-Service was shut down on 17 Jul 2026.** Use Mada's own GDS contract with Enterprise access.
- Duffel for NDC fares and low-cost carriers: $3 per order + 1% + $2 per ancillary, plus an **excess-search fee**. AI chat generates a lot of searches, so cache them.
- The agent creates a PNR or hold, and a human issues the ticket.

**Hotels:** RateHawk and WebBeds first, then Hotelbeds. Apply to Expedia Rapid in parallel.

**Other services**
| Service | Plan |
|---|---|
| Cars | CarTrawler |
| Activities | Viator / GetYourGuide (~8% commission) |
| Restaurants | No public API in Saudi Arabia, so a concierge flow, with Eat App partnership talks later |
| eSIM | Airalo Partner API |
| Insurance | Probably needs a local SAMA-licensed insurer **[unverified]** |

**Importing trips**
- Forwarding address plus share sheet plus Mada's own PNRs for the MVP.
- Microsoft Graph is easy to add.
- Gmail full-read access means a yearly CASA security assessment and 2–8 weeks of review, so defer it.
- Apple Mail has no API.

**Passport capture:** read the MRZ on the device (ML Kit or Apple Vision), with an optional NFC chip read. Show the fields back to the user to confirm.

**Visa data**
- IATA Timatic through the GDS, plus Sherpa for display to consumers.
- **Do not scrape VFS or TLS appointment slots.** Their sites are protected by Cloudflare's bot management, scraping likely breaches their terms, and it may raise Anti-Cyber Crime Law exposure. Help the user book appointments themselves instead.

**AI layer**
- A Claude tool-calling agent, with tasks routed by difficulty:
  - Large model for replanning disruptions.
  - Mid-size model for chat.
  - Small model for routing and pulling details out of emails and PDFs.
- **Prices only ever come from supplier responses.** The model refers to offers by ID and never types a number that reaches checkout.
- Raw passport data never goes to the model.
- Voice: test ElevenLabs Scribe v2, Deepgram, Azure ar-SA and Google Chirp on a 2-hour set of Gulf-dialect recordings.
- Measure cost per conversation in the pilot.

**Payments**
- MyFatoorah as the main gateway: mada, cards, Apple Pay with the mada network, STC Pay.
- Plus Tabby and Tamara.
- Authorise the payment when the request is handed to an agent, and capture or void it on issuance.
- In-app purchase is not required for physical travel services (App Store guideline 3.1.3(e); check the current wording).

**Notifications**
- iOS: push-to-start Live Activities, and broadcast channels so one update reaches everyone tracking the same flight.
- Android 16 Live Updates.
- AeroAPI webhook → queue → APNs / FCM / WhatsApp.
- Offline: SQLite, with a cache of the wallet and the trip.

**Hosting for PII**
| Region | Status |
|---|---|
| GCP Dammam (bought via CNTXT) | Live |
| Oracle Jeddah | Live |
| AWS Saudi Arabia | Targeted Dec 2026 |
| Azure Saudi Arabia | Q4 2026 |

Use envelope encryption, a biometric lock, and audit every time an agent views a document.

---

## 6. UX case studies

**Flighty**
- "Work so well that it feels almost boringly obvious."
- Modelled on the airport departure board.
- Information that is always on screen, so nobody has to keep checking.
- Designs the disruption first. Assumes the user is offline from takeoff to landing.

**Uber Live Activity**
- Strict priorities: P0 is the ETA, P1 the car and plate, P2 the progress bar.
- Updates are pushed and debounced.
- About 2% fewer cancellations.

**Apple, iOS 26**
- Wallet boarding passes come with Live Activities, sharing, airport maps, and Find My bag tracking (36 airlines; Apple, citing SITA, says 90% fewer bags truly lost).
- Liquid Glass: use glass only for navigation and controls, never for content.

**NN/g on chat (2026)**
- "Less chat, more answer": put the essential answer first, then follow-up chips.
- Say what the bot can't do.
- Offer voice.
- Expand content in place.
- Let users maximise the chat to see maps.

**Agent UX patterns**
- Show what the agent intends to do before it does it, and its reasons while it works.
- After acting, keep a record of what it did, with undo where possible.
- The higher the stakes, the stricter the confirmation step.

**Notifications**
- Use "Time Sensitive" only when the user must act.
- Live Activities instead of a stream of pushes.
- Calm Technology principles.
- Travel has high push opt-in rates; protect that.

**Premium service**
- Amex Centurion: a preference profile and a named manager.
- Black Tomato: information revealed in stages, with a guide in the background as a safety net.
- Fora: travellers linked to the household.

**Arabic and right-to-left**
- Design in Arabic first.
- Keep flight numbers, PNRs and times inside their own left-to-right segments, because mixed-direction strings are the hardest case.
- Never mirror clocks or numbers.
- Hijri dates from the Umm al-Qura calendar, with Eid dates marked as expected.
- Let the user choose Western or Arabic-Indic digits.
- The new Saudi Riyal sign is going into Unicode 17 **[confirm the code point]**.

**Onboarding**
- Value before signup.
- Scan the passport by NFC first, with the camera as a fallback.
- **Always show the extracted fields to confirm.** easyJet's autofill turned "Catherine" into "Cathy".
- First value within 30 seconds.

---

## 7. Open items to verify

**Licences**
1. Mada's Ministry of Tourism licence scope: online sales, Umrah packages, inbound visas.

**Supplier contracts**
2. GDS contract: Enterprise API access and Timatic.
3. Which airlines Duffel can hold orders for (Saudia, flynas, flyadeal).
4. Whether Tabby and Tamara allow airline tickets, and their settlement terms.
5. Saudi licensing for travel insurance sold inside the app.
6. Eat App (restaurant bookings) partnership and API.

**Data, identity and compliance**
7. Whether passport data counts as "sensitive" under the PDPL, and SDAIA's adequacy list.
8. Nafath onboarding terms (Elm or a licensed provider).
9. Current wording of App Store guideline 3.1.3(e).
10. GACA passenger-rights rules for the compensation helper.

**Technical tests**
11. Benchmark speech recognition on Saudi dialect audio.
12. Gate-data accuracy at Saudi airports.
