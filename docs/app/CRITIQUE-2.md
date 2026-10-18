# Mada Trips: the second hard-nosed critique

Date: 2026-10-18. Branch `claude/nice-pasteur-qmk758` at 4b410da. Same method and benchmarks as [CRITIQUE-1](CRITIQUE-1.md) (16 Oct, 5.1/10).

- **Live staging** https://mada-app-staging.vercel.app (API https://mada-staging.vercel.app/api/app/v1). 390×844, iPhone user agent, Asia/Riyadh time zone, English and Arabic. Signed in by injecting tokens into `mada.session.v1` as +966 50 000 0103 (Noura) and +966 50 000 0102 ("You"/Test). Guests had no session.
- **Local mock export** of this branch (`EXPO_PUBLIC_API_MODE=mock`) for what staging cannot reach: travel-day phases, cancelled and delayed flights, price change, hold ended, 3-D Secure, refusals, eSIM purchase. The repo's own e2e drivers (`e2e-trips`, `-booking`, `-now`, `-esim`, `-offline`) walked those flows on my export. I looked at every screenshot they took and judged them myself. All five passed (booking: 126 screenshots).
- **Network.** I ran a slow 3G profile (CDP: 400 ms latency, 400 kbit/s) and went offline with a reload.
- **Safety.** I did not buy, top up or order an eSIM on staging, and did not slide to book. The car I asked for on staging was test mode, and I cancelled it.
- **Side effects on staging.** The family-stepper runs saved four household members (Khalid, Sara, Omar, Lina on 0103; Omar, Sara, Lina on 0102). Each "Renew it first" tap filed one more passport-renewal request. 0102 got one urgent support message. At the end 0102 was left in Arabic.
- Screenshots are in `docs/app/critique-2/` (56 JPGs, all under 50 KB). In the text, **[nn]** means the file numbered nn. File names starting `m-` come from the mock build; everything else comes from staging.

## What changed since 16 Oct, in one paragraph

The app no longer drops the family. "2 adults and 3 kids aged 2, 6 and 13" now opens a traveller stepper with ages, and the results price each person. Night flights are pushed down when a small child is travelling. Seats-together is promised and connecting rooms are named [05, 07]. Guests can search and see prices, and the sign-in step is deferred to "Review" with the search kept [02, 03]. Guest Discover has a real city [01]. The Umrah flow is now built around the permit, with the slot time, a last-ten-nights warning, Makkah hotels sorted by walking distance, Madinah and the Haramain train [16, 17]. "Urgent" no longer gets an ambulance number [21]. The disruption screen tells the truth when nothing is wrong [22]. The offline reload works [26]. Switching language offers to resume the search [29, 30]. On the mock build, travel day, cancellation and rebooking are close to Flighty quality [39–42].

What did not move:
- A passport problem is still a dead end [09].
- The app keeps asking questions the person has already answered [14, 18, 35].
- Offline Ask still pretends to work [27].
- The web bundle takes 42 s to start on 3G [25].
- The card lists still disagree with each other.
- The pay-sheet overlap is still there [11, 48].

## Part 1: the twelve scenarios, walked again

### Scenario 1: first open, no account, just curious

What I did: opened / → Look around → Today, Trips, Circles, Wallet → searched "Flights to Istanbul next month" → Review → opened /plan/alula2, /support and /city as a guest.

**Fixed:**
- Guests see real prices: three options, a hotel bundle that names Bereketzade, and entry rules [02].
- Review opens "Sign in to book this. Your search and the option you picked stay just as they are." [03].
- Discover shows "On this week in Riyadh" with bookable events [01].
- /plan/alula2 renders the full two-day plan with "Book it all · SAR 3,465".
- /support shows "Sign in to talk to Mada" and the desk number.

**Still wrong:**
- **"next month" is ignored.** The date question offers "This weekend · Next weekend · Eid · School break", but no November.
- **Welcome still has no credentials line** (licence, IATA, who Mada is).
- **Staging's sign-in offers only "Continue with email" [04].** A Saudi user expects a phone number. This needs the owner (Supabase phone provider).
- Guest Trips opens on a "Past · Every trip leaves a stamp" card. That is pleasant but does nothing for a guest.

Speed: 1.8 s from first paint to idle, and 1.8 s from picking a date to prices.

**Verdict: 7/10** (was 4).

### Scenario 2: a mother books Eid in Istanbul, 2 adults + 3 children aged 2, 6 and 13

**Fixed (CM-2.1, 2.2, 2.3, 2.4, 2.7, part of 2.6):**
- The sentence is parsed exactly: "You said 2 adults and 3 children (2, 6, 13). Tell Mada who they are, so no one is left off." [05].
- Results [07] show:
  - "holding seats for 5"
  - "Daytime flights first, with a little one going."
  - "Price per person: Adult, 12 and over 3 × SAR 2,160 · Child, 2 to 11, ages 6, 2: 2 × SAR 1,620"
  - "Seats held together: every child next to an adult."
  - The 02:10 flight relabelled "Leaves at night: a short night for little ones."
- Corrections work. "we are 2 adults and 3 children, aged 2, 6 and 13", typed into a 1-adult search, searches again for 5 [12].
- "Rules" is now a visible link [51].
- The bundle reads "Add connecting rooms at Bereketzade Hotel and airport pickup? 6 nights · SAR 6,320".
- The pay sheet (0102) [10] shows:
  - line items for adults, child fares, "Bereketzade Hotel · Connecting rooms · 6 nights 5,880" and "Airport pickup both ways 440"
  - "YOUR PREFERENCES: Seats together · Halal" and an Alfursan line
  - "If you cancel, the flights come back minus SAR 400 per person. Rooms and pickups are free to cancel until 2 Mar."

That is the Booking/Airbnb standard.

**Still wrong:**
- **The passport dead end is unchanged (CM-2.5) [09].** On 0103, Noura's passport fails the 150-day Türkiye rule. Tapping "Renew it first" turns the button into a greyed "Mada is on it" chip, and the primary button stays disabled as "Sort out Noura's passport first". The screen gives no what, no by-when, no cost, and no way forward.
  - The trip is in March and the passport expires 1 Jan, so a renewal in time is realistic. "Book now; Mada renews it by 15 Dec, SAR 150" is the obvious path.
  - The mock offers "Book without Ahmed" for a companion [50], but not for the account holder.
  - The Requests list shows the same renewal as "Checking the visa rules" [37]: the wrong step.
- **Four names are required before any price [06].** "A name for each place, then Mada searches." Google Flights and Almosafer price a family first and ask for names at checkout. A curious mother sees nothing until she has typed four names.
  - The names are saved to the household, but without ages ("Family · Not scanned").
  - On one run the stepper asked for the same four names again.
- **The age bands contradict each other.** The stepper says "Adults: 12 and over" and "Children: 2 to 17, an age each". The 13-year-old is entered as a child, then billed as "3 adults" on the pay sheet with no word that the airline counts 12+ as adults [07, 10].
- **The hotel page is thin [08].** Tapping "Bereketzade Hotel" before a SAR 6,320 add shows an address, a map link and one sentence. There is no photo, room type, per-night price, rating, board basis or cancellation rule. Two-thirds of the screen is empty.
- **The pay sheet overlaps itself [10, 11].** "A person at Mada confirms it before you're charged" prints over the passport rows and over "Pay in full · Tabby". The slider sits on content with no solid footer. The tracker already listed this as found but not fixed; it is still live.
- **No bags on the pay sheet.** The fare rules sheet has "Bags 2 × 23 kg" [51], but the sheet the person pays from doesn't.
- About a quarter of the results screen is covered by the Ask bar plus the Review button, and the hotel offer sits under a fade [07].
- The household chip flickers between "You ✓" and "Noura ✓" across loads.

Speed: stepper 1.5 s after the sentence; results 1.7 s after Continue.

**Verdict: 7/10** (was 3).

### Scenario 3: Umrah in Ramadan, has a Nusuk permit

**Fixed (CM-3.1 to 3.3, mostly):**
- The flow asks the permit day, then the slot ("Before Fajr · Morning · Afternoon · Evening").
- "You check in to Makkah on 2 Mar, in good time for your slot."
- A last-ten-nights card: "Rooms near the Haram cost two to three times more… permits go within minutes of opening."
- Makkah hotels in distance bands, each named with minutes on foot ("Swissôtel Makkah · Abraj Al Bait · 2 min walk") [16].
- Madinah before or after, the Haramain train with its price, and a dated summary: "About SAR 4,865 for you · Mada confirms the price and holds the rooms within 2 hours" [17].
- The wheelchair list is gone; "Needs" is now a chip.

**Still wrong:**
- **He typed "I have a Nusuk permit", and the first question is "Do you have your Nusuk permit?" [14].**
- **The calendar opens on October 2026, not Ramadan [15].** He has to page five months.
- "Flying from?" offers only Riyadh, Dammam or driving. There is no Jeddah, Abha or other city.
- There is no miqat/ihram line, although every Riyadh–Jeddah flyer crosses the miqat in the air. There is no Jeddah-airport-to-Makkah transfer, and the flight is not named (only "Riyadh · 2–7 Mar SAR 1,100").
- **The prices are not believable for the last ten nights:** Raffles, 3 nights, SAR 3,960. With live suppliers this fixes itself; on staging it reads as a promise.

**Verdict: 7.5/10** (was 4).

### Scenario 4: the price changes between search and pay (mock)

- "The price went up SAR 140 while we checked. Airlines change fares minute to minute. Nothing was charged." with "Book at SAR 8,240 · See other options" [47].
- "The price hold ended · Fares move after 20 minutes. Check again and you'll see the price before anything is charged." [48].
- A recheck that shows the price "down from".
- A 3-D Secure "code didn't come" branch: "Your bank is sending a new code. Give it a minute." and "Use another card" [49].

All four gaps from CRITIQUE-1 are closed.

**Still wrong:** the hold-ended sheet shows the same footer overlap ("A person at Mada…" printed over a passport row) [48].

**Verdict: 8.5/10** (was 7, unverified).

### Scenario 5: flight cancelled the night before

**On staging (0102, SV263 on 12 Nov):**
- The disruption screen now says "Your flight is on time. SV263 · Checked at 14:32 · If anything changes, we tell you first, with a plan." [22]. CM-5.1 is fixed.

**On the mock [39–42]:**
- Today flips to "Saudia cancelled your flight. You're owed a full refund. We're already holding seats on the next flight for all 4 of you."
- "Already taken care of: The hotel knows · Pickups move with you · Or your money back SAR 8,640 to your card in about 7 days".
- The delay path predicts from the inbound plane ("The plane coming from Cairo landed late"). It offers flynas XY125 "No extra cost to you. Your pickup moves with you." Then "Done. All 4 of you are on XY125." This is the best screen in the app.

**Still wrong:**
- The agent line prints with doubled quotes: `""I've moved everything. Have a good trip.""` [42].
- After the rebook, Today shows XY125 as "May leave late · The plane coming from Cairo is late · Watching the plane from Cairo". The old flight's prediction is attached to the new flight [43]. The demo state may cause this, but it needs checking.
- None of this can be seen on staging, because there is no live flight-status feed. That needs the owner.

**Verdict: 8/10 on the mock, untestable live.**

### Scenario 6: just landed, needs a car now, phone at 8%

**Fixed (CM-6.1):**
- "need a car right now" no longer offers Tomorrow.
- The car arrives as a card: "Saad is on the way · GMC Yukon, black · Plate 2290 RNA · Meeting point · SAR 44 fixed · Call · Message · Cancel · Free to cancel until the driver is here · Test mode: no real car comes." [19].
- Cancelling works: "Car cancelled. Nothing to pay."
- Today offers "Battery at 8%. Switch to the low-battery screen?" [45].
- The low-battery screen is "Just the essentials" in black, with a desk number, "Call Mada" and "Ask Mada to call me" [20]. On the mock it also shows the hotel address in Arabic "to show the driver" [46], which is excellent.

**Still wrong:**
- **Three questions he already answered [18].** He typed "I just landed at Istanbul airport, I need a car right now to Taksim". The app asks "When should it come? Now / In 15 minutes", then "Which city?" (Istanbul not preselected), then "Where should the driver meet you?". At 8% that is three taps and a typed field too many.
- **Taksim is dropped.** There is no destination field at all, so the price can't be for this ride.
- On staging, the test driver has a Saudi-format plate in Istanbul, and the fare is SAR 44 for a 45 km ride. There is no live ride supplier, which needs the owner. The tracker says the real answer is a call-back.
- **The low-battery screen reads "Terminal Terminal 3" [20, 46].** It also gives no date for "SV263 · 09:40", so the person can't tell whether that is today. It has no boarding pass or QR code, and no hotel when none is booked.

**Verdict: 6.5/10** (was 2).

### Scenario 7: a visa is refused

What I did: "I need a UK visa for me and my wife in December" (0102), then the Requests list on 0103.

**Still wrong:**
- **"December" is ignored again.** The question is "When do you travel? Within a month · In 1 to 3 months · Not sure yet" [35].
- **"my wife" is never asked about.** There is no "who" step.
- Then: "Mada will find the earliest appointment, prepare the forms and reply here." [36]. But Saudi passports need a **UK ETA** (online, GBP 16, about 3 days), not a VFS appointment. The app knows this: `booking-data.ts:163` and the flight entry checks say exactly that. The visa-request flow just doesn't use it.
- **Outcomes exist but are hollow.** The list shows "Visa: Schengen · Done · It's done. SAR 450 paid." [38]. Done what: issued, or refused?
  - The mock has a generic refusal card ("Not this time · Why · Your money · Talk to Mada" [56]).
  - There is still no visa-specific refusal: no appeal deadline, no reapply, no "what about my flights and hotel". The words "appeal" and "reapply" appear nowhere in the copy.
- **Stale requests stay open.** "Istanbul · 15–17 Oct · Mada is on it · Putting the price together · Later than Mada said (Sun 11 Oct, 19:31)". The dates passed three days ago, and it is still open with a Nudge button.
- Fixed: "Take back" exists on every open request (CRITIQUE-1 noted nothing could be withdrawn). Scripted desk replies are signed "Mada" on staging.

**Verdict: 5/10** (was 4).

### Scenario 8: refund 3 days after paying

- Staging and mock: "What should we refund?" with each item and its number ("Flights +1,760 · refund minus SAR 400"). Then Why, then "Back to your Visa ending 41 · 5–10 working days" or "Mada credit · Instant". Then "You get back SAR 7,040 · Slide to ask" [54]. That is clear.
- **Still wrong:**
  - There is still no 24-hour free-cancellation or cooling-off line, and no word on the GACA rules for airline-caused changes.
  - The mock refund row reads "Flights · Saudia — flynas fare: refund minus SAR 400 per person" [54]: the wrong airline.

**Verdict: 7/10** (was about 6).

### Scenario 9: father wants family spend on this trip

- The new Money screen has "SAR 14,960 spent on this trip · Per person (You 3,740 · Hessa · Sara · Ahmed) · Who paid (Visa ending 41 9,080 · Tabby 5,880) · What was paid · Share the statement · Statement as PDF" [53]. Staging matches for one traveller [24].
- **Still wrong:**
  - There is no household total across trips.
  - **The money surfaces still disagree.** On 0102, Money says "Who paid: Visa ending 42", while Profile says "No cards saved" — the same contradiction CRITIQUE-1 found. On 0103, Wallet shows "2 saved · default Visa ending 11" (it was 4 before); I didn't confirm whether these are duplicates. The mock mixes Visa 41 and 42 across 3-D Secure, eSIM, refund and Money.

**Verdict: 7/10** (was 3).

### Scenario 10: switching to Arabic mid-flow

- Profile › Language › العربية → "Restart Mada in Arabic?" [28] → the app comes back on Profile in Arabic. Ask offers "كمّل من حيث وقفت" with the search [29]. Tapping it restores the exact search (9–12 Mar, 2 people, SAR 4,320) in Arabic [30]. CM-10.1 is fixed, though it takes two taps from where the app lands.
- An Arabic sentence ("إسطنبول في العيد أنا وزوجتي وثلاثة أطفال أعمارهم ٢ و٦ و١٣") is parsed to 5 and answered in Arabic: "رحلات النهار أول، لأن معكم صغير." [31]. CM-10.2 is fixed.
- **Still wrong:**
  - **The departures board reverses Latin text in RTL.** DUBAI shows as "I A B U D" and YOUR TRIP as "P I R T R U O Y" [33].
  - **English leaks [32]:**
    - the "You" chip
    - "لجوازات ⁦Saudi⁩"
    - "أعمارهم 6, 2" with a Latin comma
  - In Arabic, "طرق تسجيل الدخول: ولا شي" (sign-in methods: none) where English says "Phone".
  - Today in Arabic says "نتأكد من شروط التأشيرة" (checking the visa rules) for a passport renewal [34].
  - Wallet in Arabic says "ساري" (valid) for a passport that the household screen marks "Expiring" and that fails Türkiye.

**Verdict: 6.5/10** (was 4).

### Scenario 11: offline in the airport

- **Fixed (CM-11.1).** A reload with no connection now opens the app from the service worker: "You're offline. This is what we had at 14:35." with the trip, the checklist and "Low battery? Just the essentials" [26]. Support offline: "Messages you write now send the moment you're back · Call the desk · Send an SMS".
- **Still wrong: Ask after an offline reload lies [27].** The ticks read "✓ Checking flights to Dubai · ✓ Holding seats at this price · Matching seats and meals for 0", with a spinner and no offline message.
  - The mock path does say "You're offline. Searching needs a connection." [52].
  - The cold offline path on staging does not.
  - It ticks "Holding seats" while there is no network at all.

**Verdict: 7/10** (was 6 native / 3 web).

### Scenario 12: talk to a human right now at 2 am

- **Fixed (CM-12.1).** "My flight tomorrow 6am got cancelled, what do I do? Urgent" gets "Mada calls you back within 10 minutes, any hour… No need to queue at the counter. We're finding seats on the next flights." with a "Mada calls you back · By 14:41" card and "Call Mada" [21]. The 997 line only appears for "hurt or unsafe".
- The mock urgent card asks "What's wrong with your Istanbul trip?" with seven choices [44].
- **Still wrong:**
  - The header still says "About: Your account". On 0102 the only booked flight is 12 Nov 09:40, not "tomorrow 6am", and the reply promises "finding seats on the next flights" without noticing that or asking which booking.
  - There is no GACA rights card in the thread.

**Verdict: 7.5/10** (was 5).

### eSIM (mock only: staging eSIM uses real money)

- A one-question start, plans with "Covers your 7 days" and "Most people" [55].
- A pay sheet with "Refundable until it's installed".
- An install ring with iPhone/Android steps.
- A refusal: "Not this time · Nothing was left for those dates · SAR 164 back to your card by Wed 28 Oct" [56].
- **Still wrong:**
  - "Nothing was left for those dates" is hotel wording on an eSIM.
  - The headline breaks into three one-word lines.

**Good: 8/10.**

### Measured speed (staging, no throttle unless noted)

| Moment | Time |
|---|---|
| Guest first paint → idle | 1.8 s |
| Signed-in cold start → trip card visible | 3.4–3.8 s (Arabic Today still a spinner at 6.9 s) |
| **Slow 3G cold start → trip visible** | **42.4 s** (entry JS 7.2 MB, 1.8 MB brotli) |
| Slow 3G warm start (service worker) | 0.6 s |
| Offline reload → trip visible | 0.4 s |
| Family sentence → stepper | ~1.5 s |
| Date or Continue → three priced options | 1.7–1.8 s |
| API cold / warm (`/config`, `/trips`, `/people`, `/account`, from a US egress) | 2.4–2.6 s cold; 0.2 / 0.83 / 0.60 / 0.62 s warm |

The 3G cold start is the web build, which is what the owner tests on. Native ships the bundle in the app, so it won't see the 42 s, but it still makes the API round trips. The server (iad1) and database (Singapore) are in different regions; that decision is the owner's.

## Part 2: scorecard

Benchmarks are unchanged: clarity = Flighty; trust = Airbnb/Booking; speed = Google Flights; family = Booking family filters + airline seating commitments; day-of-travel = Flighty; recovery = FLOWS §6; Arabic = Almosafer/Nusuk; delight = Flighty/Airbnb. 9 means best in the world and nobody is ever confused.

| Dimension | 16 Oct | 18 Oct | Evidence |
|---|---|---|---|
| Clarity (never clueless) | 5 | **7** | **Fixed:** family drop, hotel error, "From when?", "No signal", guest links [05, 12, 19, 22, 01]. **Still:** questions already answered (permit, "right now", city, December, next month) [14, 18, 35]; passport dead end [09]; offline Ask ticks "Holding seats… for 0" [27]; "It's done" with no what [38]; wrong step label [37]; itinerary invents a checkout and a room safe with no hotel booked [23]. |
| Trust before paying | 7 | **7.5** | Pay sheet names the hotel, rooms, cancel dates, applied preferences and loyalty [10]; price-rose, hold-ended and 3-D Secure branches [47–49]. Loses points for the footer overlap [11, 48], no bags on the sheet, a thin hotel page [08], card lists that disagree, email-only sign-in [04], no credentials on Welcome, unbelievable Ramadan prices. |
| Speed | 6 | **6** | Searches 1.7 s, warm and offline starts under 1 s. But the 3G cold start is 42 s [25], warm API calls are 0.6–0.8 s each, and Arabic Today was still a spinner at 6.9 s. Better warm, unacceptable cold. |
| Family | 3 | **7** | Stepper with ages, child fares, seats together, night flights demoted, connecting rooms, per-person money [05, 07, 53]. Loses points for names before price [06], the 12+/2–17 contradiction, no ages stored, no bassinet or child-meal line, the passport block with no way forward [09]. |
| Day-of-travel | 4 | **6.5** | Mock travel day is Flighty-grade ("Leave home in 42 min", gate, boards, seats, driver card) [39]; 8% prompt and screen [45, 46]; car now [19]. Loses points: none of it visible live (no flight feed, no ride supplier), Live Activity and Wallet unbuilt, "Terminal Terminal 3" with no date [20]. |
| Recovery | 6 | **7** | Honest disruption, prediction, options, "Done, all 4 of you" [22, 41, 42]; urgent call-back without 997 [21]; Take back; refund with numbers [54]. Loses points: no visa-specific refusal, stale overdue requests, the old delay shown on the new flight [43], no 24-hour or GACA line. |
| Arabic | 4 | **6.5** | Flow kept across restart [29, 30]; Arabic in, Arabic out [31]; colloquial register. Loses points: reversed departures board [33], English leaks [32], "sign-in methods: none", wrong step and "valid" passport labels [34]. |
| Delight | 6 | **7** | Cancelled and rebooked screens, "You're going to Istanbul", the eSIM ring, "Daytime flights first, with a little one going". The best of it lives only on the mock. |
| Design (new: visual craft, consistency, words) | – | **7** | Strong type, colour and voice. Loses points: footer overlaps, about 25% of results under the Ask bar, near-empty hotel page, "Terminal Terminal", doubled quotes, "for 0", "· ·" placeholders while loading, a "Changed it. Looking again." toast on brand-new searches [52]. |

**Overall: 6.8/10** (the eight original dimensions, mean 6.81; 6.8 with Design included). That is up from 5.1. No dimension reaches the 9 target.

### Regressions

Nothing that worked on 16 Oct is broken now. Three things **did not move** even though the tracker marks them done or known:
- "Mada is on it" with no what, when or cost in the booking flow (the tracker's O unit fixed it in request threads only).
- Money surfaces that disagree.
- The pay-sheet overlap.

Two things are **new and measured for the first time**, so I can't call them regressions:
- The 42 s cold start on 3G.
- The reversed Latin flaps in Arabic.

## Part 3: every remaining issue, ranked by impact

### Fixable in code

| # | Scenario | What happened | Shot | Why it hurts | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | 2 | "Renew it first" → greyed "Mada is on it"; primary button disabled "Sort out Noura's passport first"; nothing else | [09] | The most common booking (family at Eid) stops dead with no time, cost or next step | Replace the chip with the outcome card (step · answer by · cost) and enable "Book now, Mada renews it by {date} · SAR 150". Offer "Book without {name}" for the account holder too. Hold seats while the renewal runs | M |
| 2 | 3, 6, 7, 1 | Asks what was already said: "Do you have your Nusuk permit?" after "I have a Nusuk permit"; "When should it come?" after "right now"; "Which city?" after "Istanbul airport"; "When do you travel?" after "December"; "When in December?" after "first week of December"; "next month" ignored | [14, 18, 35, 13] | Feels deaf; costs taps at the worst moments | Fill the flow's slots from the sentence before asking (permit = yes, when = now, city and destination from "airport … to Taksim", month and week to a range), and skip filled questions | M |
| 3 | 11 | Offline reload → Ask ticks "Checking flights ✓ Holding seats at this price ✓ Matching seats and meals for 0" | [27] | Lies about holding seats while there is no network | Use the same offline check as the mock path ("You're offline. Searching needs a connection.") before any progress ticks; never print "for 0" | S |
| 4 | 2, 4 | "A person at Mada confirms it before you're charged" prints over passport rows and "Pay in full · Tabby"; same on hold-ended | [10, 11, 48] | The money screen looks broken at the moment of paying | Put the slider and footnote in a solid footer with safe-area padding, and add bottom padding to the scroll content equal to the footer height | S |
| 5 | Speed | 3G cold start 42 s; entry bundle 7.2 MB | [25] | First open on a weak airport connection is a 40-second spinner | Lazy-load routes and heavy modules (OCR, maps, circles, eSIM, passport camera) out of the entry chunk; inline a shell skeleton; aim for < 2 MB raw entry and < 8 s on 3G | M–L |
| 6 | 7 | "UK visa for me and my wife in December" → no who step, no date, promises a VFS appointment | [35, 36] | Wrong product for Saudi passports (UK ETA, GBP 16, online), and the wife is dropped | Run the entry-rules table first ("Saudi passports need a UK ETA, not a visa: online, GBP 16, about 3 days. Mada applies for both: SAR x"); ask who; take the month from the sentence | S |
| 7 | 7 | "Done · It's done. SAR 450 paid." with no what; a request for 15–17 Oct still "Putting the price together", a week late; passport renewal labelled "Checking the visa rules" | [38, 37] | The person can't tell whether the visa was issued; past-dated work looks abandoned | Make `outcome.what` mandatory on done; add a visa refusal with appeal deadline, reapply, and "your flights and hotel: change or refund"; auto-close or escalate requests whose dates have passed; use the step labels for renewals | M |
| 8 | 10 | Departures board shows "IABUD", "PIRT RUOY" in Arabic; "You", "Saudi" and "6, 2" leak; "Sign-in methods: none" in Arabic; Wallet "valid" vs household "Expiring" | [33, 32, 34] | Arabic reads as a translation, with visible bugs on the first Trips screen | Force LTR on Latin flap text (`direction: ltr`), use Arabic names for nationality and "أنت", use "،" as the separator; fix the Arabic sign-in-methods value; use one passport-status source | S |
| 9 | 2 | Hotel page before a SAR 6,320 add: address, map link, one line | [08] | A blind decision on the biggest line of the trip | Photo, room type × rooms, per-night price, board, rating, cancellation date and what's included; show the same lines on the bundle card | M |
| 10 | 2 | Names required before any price; "Adults 12+" vs "Children 2–17"; household stores no ages; no bassinet or child meals; no bags on the pay sheet | [06, 07, 10] | Friction before value, and a 13-year-old billed as an adult with no word why | Search on counts and ages and ask names at pay; say "Omar, 13: airlines charge 12+ as adults"; save ages to the household; add "Bags 2 × 23 kg each · bassinet requested · child meals × 2" to the pay sheet | M |
| 11 | 6 | Low-battery screen: "Terminal Terminal 3", no date on SV263, no boarding pass | [20, 46] | The one screen meant to be enough at 8% has a typo and is missing the when | Fix the label join; show the date and "leave in"; add the pass or QR when there is one | S |
| 12 | 5 | Itinerary "Pack tonight · Check-out is at 12:00 tomorrow" and "Originals stay in the room safe" with no hotel booked; trip page "Rain today. Indoor ideas first." for a trip 4 weeks away | [23] | Invented facts erode trust in the facts that are real | Gate hotel lines on a stay existing; show weather only within about 5 days of the trip | S |
| 13 | 8, 9 | Money "Visa ending 42" vs Profile "No cards saved" (0102); Visa 41 and 42 mixed on mock; refund row "Saudia — flynas fare" | [24, 54] | Money inconsistencies are the fastest way to lose a payer | One payment-method source for Wallet, Profile, Money and Refund (cards on past payments shown as "used on this trip", not "saved"); take the fare-rule airline from the segment | S |
| 14 | 2 | A new search in the same session stacks under every old one, with a "Changed it. Looking again." toast; a correction says nothing about what changed | [52, 12] | The person can't tell a new trip from an edit | Start a fresh thread when the destination changes; on a correction, write a line such as "Now 5 people: 2 adults, 3 children (2, 6, 13)." | S–M |
| 15 | 5, 12 | After the rebook Today keeps "plane from Cairo is late" on XY125; doubled quotes in the agent line; urgent thread "About: Your account" without matching the typed flight | [43, 42, 21] | The recovery story contradicts itself right after it worked | Clear the prediction on rebook; strip the copy quotes; scope urgent threads to the trip within 24 h, or ask "Which flight: SV263 on 12 Nov?" | S |
| 16 | 3 | Umrah calendar opens on Oct 2026; "Flying from" only Riyadh or Dammam; no miqat/ihram; no Jeddah→Makkah transfer; flight not named | [15, 17] | Avoidable paging and missing rituals in the one flow Saudis judge hardest | Open the calendar on Ramadan with the last ten nights shaded; any home airport; add "Wear ihram before you board (miqat in the air)", a transfer line, and the named flight | S–M |
| 17 | 6 | Car-now has no destination; "Taksim" dropped | [18] | The price can't be for this ride | Add "To" (prefilled from the sentence), show distance and fare | S |
| 18 | 1 | Welcome: no licence, IATA or named-agent line | [01] | The curious visitor still can't tell who Mada is | One credentials line under "We'll take it from here" | S (needs the owner's facts) |
| 19 | 8 | No 24-hour cooling-off or GACA line on refund | – | Saudi travellers are owed specific things the app doesn't state | A "What the rules give you" card (GACA, airline 24-hour rules where they apply) on refund and change | S |
| 20 | eSIM | Refusal says "Nothing was left for those dates"; the headline wraps to three one-word lines | [56] | Hotel wording on an eSIM | An eSIM-specific reason; a wider headline box | S |

### Needs the owner or credentials

| Issue | Evidence | What's needed |
|---|---|---|
| Staging sign-in is email only | [04] | Supabase phone provider + SMS/WhatsApp hook (Saudi users expect phone) |
| Car now is test mode (Saudi plate in Istanbul, SAR 44) | [19] | An on-demand ride supplier, or the call-back as the production answer |
| Travel day, delay, cancel and rebook exist only on the mock | [39–43] | A live flight-status feed (airline/ATC data) and supplier rebooking |
| Live Activity, Apple Wallet passes, real boarding passes (`appleWallet:false`, `liveActivityPush:false` in /config) | – | Apple Developer account, a signed iPhone build, airline check-in or pass APIs |
| Makkah last-ten-nights prices are not believable | [16] | Hotelbeds live keys or a Makkah wholesaler; per-night Ramadan rates |
| API 0.6–0.8 s warm per call, 2.4 s cold | timing table | Server region `sin1` next to the Singapore database (pending decision) |
| eSIM live purchase not retested (real balance) | – | Supplier balance top-up; a test order by the owner |
| Credentials on Welcome | – | Licence and IATA numbers to print |

## Part 4: the 15 highest-leverage fixes, in order

1. Unblock the passport-problem booking: outcome card + "Book now, Mada renews by {date}" + "Book without {name}" (#1). **M**
2. Never ask what was already said: slot-fill permit, now, city, destination, month and week from the sentence (#2). **M**
3. Offline Ask: the offline card before any progress ticks; no "Holding seats", no "for 0" (#3). **S**
4. Pay sheet and hold-ended footer overlap (#4). **S**
5. Cut the web entry bundle and cold start on 3G from 42 s to under 8 s (#5). **M–L**
6. UK ETA instead of a VFS visa for Saudi passports, ask who, take the month from the sentence (#6). **S**
7. Outcomes that say what: mandatory `what`, visa refusal with appeal and reapply, auto-close past-dated requests, correct step labels (#7). **M**
8. Arabic fixes: LTR flaps, English leaks, sign-in methods value, one passport status (#8). **S**
9. A real hotel page and bundle card: photo, room, per-night, board, rating, cancellation date (#9). **M**
10. Family polish: price before names, the 12+ explanation, ages saved, bags, bassinet and child meals on the pay sheet (#10). **M**
11. Low-battery screen: the "Terminal" label, the date, leave-in, the pass (#11). **S**
12. Stop inventing hotel facts and far-off weather (#12). **S**
13. One money truth across Wallet, Profile, Money and Refund; the right airline on fare rules (#13). **S**
14. Ask thread hygiene and "what changed" lines on corrections (#14). **S–M**
15. Recovery aftercare: clear old predictions after a rebook, doubled quotes, urgent threads scoped to the trip (#15). **S**

Next in line: Umrah calendar, home airports, miqat and transfer (#16, S–M); car-now destination (#17, S); credentials line (#18, S); GACA and 24-hour card (#19, S).

## The five worst remaining moments

1. **The mother can't book and isn't told why or when.** "Renew it first" turns into a greyed "Mada is on it", and the main button stays "Sort out Noura's passport first" [09].
2. **Offline, Ask says it is holding seats.** "✓ Holding seats at this price · Matching seats and meals for 0" with no network [27].
3. **A 42-second spinner** on the first open over 3G [25].
4. **"UK visa for me and my wife in December"** → "When do you travel?" with no wife, then a promise to book a VFS appointment for what Saudis do online as an ETA [35, 36].
5. **Asked what he just said.** "I have a Nusuk permit" → "Do you have your Nusuk permit?" [14]; "car right now … Istanbul airport … to Taksim" → "When should it come? Which city?" and Taksim dropped [18].

Runners-up:
- The pay-sheet text over the payment options [11].
- The Arabic departures board reading "IABUD" [33].
- "Done · It's done" with no word on whether the visa was issued [38].
- The itinerary promising a 12:00 checkout at a hotel that isn't booked [23].

## What was not verifiable

- Live flight disruption, live travel-day states, a live car, Live Activity, Wallet passes, live eSIM purchase and a real visa refusal.
- Voice, native-only haptics and widgets.
- Whether "You ✓"/"Noura ✓" and the re-asked names on one stepper run are a flicker or a caching bug: I saw them once each and did not chase them.
