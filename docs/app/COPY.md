# Mada Trips app: words and type

**Status:** v1. This document sets the standard. **Every string in the app is held to it, with no exceptions.**
**Builds on:** [EXPERIENCE.md](EXPERIENCE.md) for layout and motion, and [SCOPE.md](SCOPE.md) for features.

> **The bar:** every word is chosen by a person, read aloud, and could be said to a guest's face by the best concierge in the world. If it couldn't be, it doesn't ship.

---

## 1. Who is speaking

The app has exactly two voices, and the traveller must always know which one is speaking.

| Voice | Who | Pronoun | Example |
|---|---|---|---|
| **Mada** | The company: the app, the system and the team together | **"We"** | "We're holding two other ways to get there." |
| **A named person** | Faisal, Noura, or any agent who actually did something | **"I"**, with their name and face | "I've moved you to the 21:15. Same seats." *(with Faisal's face and name)* |

**The rules that follow from this**
- **Software never says "I".** There is no "I found 3 flights", no "I'd be happy to help", and no persona.
- **The app never calls itself an assistant, a bot, AI, smart or magic.** It is simply Mada.
- **A person's name appears only when that person actually acted.** "Confirmed by Faisal" is only ever shown when Faisal confirmed it. If we fake this once, the whole promise is gone.

### Mada and Faisal: one rule everywhere

**Mada is who you talk to. Faisal is the person on duty for you right now.** People must never wonder whether they are dealing with "Mada" or "Faisal".

| Where | Use | Never |
|---|---|---|
| **Buttons and actions** | Always **Mada**: "Talk to Mada", "Ask Mada", "Send to Mada", "Book with Mada", "Call Mada" | "Ask Faisal", "Send to Faisal", "Message Faisal" |
| **Presence** (who is there) | The person, small, under Mada: "**Faisal is online**", "Faisal is typing…", "Usually replies in 2 min" | A big "Faisal" title |
| **Someone acted** | The person, with Mada: "**Confirmed by Faisal at Mada**", "Faisal replied", "Faisal changed your seats" | "Mada confirmed" when a person did it |
| **Introducing him** | Once, warmly: "**Faisal, your Mada agent**" | "Your agent Faisal" without Mada |
| **Chat header** | Title **Mada**; line under it: green dot + "Faisal is online · usually replies in 2 min" | Title "Faisal at Mada" |
| **Someone else covering** | "**Noura is covering for Faisal tonight.** She has your whole trip." | Silently swapping the name |
| **Nobody online** (never at launch: 24/7) | "Mada · replies within 10 minutes, any hour" | — |
| **Notifications** | Sender **Mada**; body names the person if a person acted: "Faisal: Your seats are 3A–3D." | Sender "Faisal" |
| **Software decides** (search results, alerts) | "We" (Mada): "We're watching your flight." | A person's name |

The shared copy catalogue (`packages/shared/src/copy/en.ts`) holds these patterns as `presence.*` and `actor.*` strings; screens must use them instead of writing their own.

---

## 2. Six rules of writing

1. **Answer first.** The first words answer the question in the traveller's head ([EXPERIENCE.md §3.2](EXPERIENCE.md)). The reason comes second, if it is needed at all.
   - ✗ "We wanted to let you know that there has been a change to your flight."
   - ✓ "Gate changed to C4."
2. **One idea per line.** If a sentence has an "and", check whether it should be two sentences.
3. **Numbers beat adjectives.** Say "6-minute walk", not "a short walk". Say "SAR 1,120 less", not "great value". Say "lands 16:40", not "arrives in the afternoon".
4. **Buttons say what happens.** Use "Take the 21:15", "Pay my share" or "Send to Faisal". Never "Submit", "OK", "Continue" or "Proceed".
5. **Calm, always.** Even the worst news is stated plainly, followed by what we are doing about it. No alarm words, no exclamation marks, no capitals for emphasis.
6. **Cut until it hurts, then stop.** Remove every word that doesn't change the meaning. Then read it aloud. If it now sounds like a telegram, give back one word.

---

## 3. Words

### 3.1 Words we use

| Use | Instead of |
|---|---|
| trip | journey, booking (when talking about the whole trip) |
| booked | reserved, successfully confirmed |
| travellers | passengers, pax, guests |
| change | modify, amend |
| cancel | void, terminate |
| refund | reimbursement, credit |
| price | rate, fare (except in "fare rules") |
| your Visa ending 41 | your saved payment instrument |
| Faisal | our team, an agent, customer support |
| Leave | Depart (for the traveller); "Departs" is only for the flight |
| Lands | Arrives (shorter, and more vivid) |

### 3.2 Words we never use

| Category | Banned |
|---|---|
| **Words that sound like AI** | AI, smart, intelligent, magic, generate, generating, assistant, bot, "I'd be happy to", "Certainly", "Great question", "As an AI", delve, embark, tailored, curated, seamless, elevate, unlock, effortless, personalised for you, ✨ |
| **Words that sound like a system** | error, invalid, failed, submit, successfully, request processed, user, item, data, oops, uh-oh, "something went wrong", "please try again later" |
| **Travel clichés** | journey, adventure awaits, wanderlust, explore the world, hidden gems, unforgettable, bucket list, getaway, paradise |
| **Corporate filler** | kindly, dear customer, valued, we apologise for any inconvenience, at your earliest convenience, utilise, leverage, via, hassle-free, best-in-class |
| **Pressure** | hurry, don't miss out, only X left (unless the supplier actually returned that number), last chance, limited time, exclusive (unless it really is) |
| **Vague time** | soon, shortly, in a moment. Give a time ("about 4 minutes") or nothing. |

**A lint check in CI** fails the build if a banned word appears in any string (§9).

---

## 4. Mechanics

| Topic | Rule | Example |
|---|---|---|
| Case | Sentence case everywhere, including buttons and titles | "Pay my share", not "Pay My Share" |
| Full stops | On sentences in body text and headlines that are sentences. **None** on buttons, labels, chips or one-word titles | "All set." · button: "See the trip" |
| Exclamation marks | **Never.** Excitement comes from the motion and the haptic, not from punctuation. | — |
| Dashes | No em dashes in the interface. Use a full stop instead. En dashes only for ranges. | "14–20 Mar" |
| Separator | Middle dot with spaces | "4 travellers · Saudia, direct" |
| Numbers | Always digits, even below ten. Thousands separator. No ".00". | "3 of 4 ready" · "SAR 8,640" |
| Money (English) | "SAR" before the amount. All-in prices only. | "SAR 8,640" |
| Money (Arabic) | The new Saudi riyal symbol where the font supports it, with "ر.س" as the fallback | — |
| Time of day | Follows the phone's 12-hour or 24-hour setting. Local time of the place in question, labelled whenever two time zones are involved. | "Lands 16:40 Istanbul time" |
| Relative time | Use it within 2 hours, then switch to a clock time | "Leave in 42 min" → "Leave at 18:30" |
| Dates | Weekday, day, month. The year only if it isn't this year. | "Thu 14 Mar" |
| Durations | Hours and minutes, no spaces | "3h 40m" |
| Codes | Airport and airline codes in capitals. Booking codes are shown in full and can be copied. | "RUH → IST" · "X7K2QD" |
| Names | First names in the interface. Full passport names only on documents and tickets. | "Sara's passport", not "SARA AHMED M. ALQAHTANI's passport" |
| Possessives of people | Always the person, never their role | "Sara's visa", not "Traveller 3's visa" |
| Emoji | None in the interface. People may use them in chat. | — |

---

## 5. Strings for the key moments

Every string here was chosen deliberately. They are the reference that every new string is measured against.

### 5.1 First open

| Moment | Headline | Body | Primary | Secondary |
|---|---|---|---|---|
| Welcome | **We'll take it from here.** | Tell us where you're going. We'll find it, book it, and stay with you until you're home. | Start | Sign in |
| Passport | **Start with your passport.** | One scan fills in every trip from now on. Encrypted, and only opened to book for you. | Scan passport | Later |
| Check | **Is this right?** | *(fields shown back)* | Yes, save it | Fix something |
| Alerts | **We'll only interrupt you when it matters.** | Gate changes. Delays. The moment your driver arrives. Never offers. | Allow alerts | Not now |
| Location | **Know when to leave.** | On travel days we time your drive to the airport. That's all we use it for. | Allow | Not now |

**Tagline:** *We'll take it from here.* It is a partner's sentence: it promises a handover, not a feature. The Arabic version is to be written by a native Saudi copywriter. One starting point is "علينا الباقي" ("the rest is on us").

### 5.2 Today

| State | Glance (headline) | Line beneath |
|---|---|---|
| Nothing planned | **Nowhere planned yet.** | Eid is 7 weeks away. |
| Getting ready | **3 of 4 ready** | Sara's visa is the last thing. → *Finish Sara's visa* |
| All set | **All set.** | Nothing needs you until Thursday. |
| Leaving | **Leave in 42 min** | 31 min to King Khalid. Traffic is light. |
| At the airport | **Gate B12** | Boarding in 18 min · 6-minute walk |
| In the air | **In the air.** | Lands in Istanbul at 16:40 local time. |
| Landed | **Welcome to Istanbul.** | Bags on carousel 7. Ahmet is at Door 3 with your name. |
| Back home | **Welcome home.** | 6 nights in Istanbul. Same hotel next time? → *Yes, remember it* · *Not this one* |

### 5.3 Ask and choosing

| Moment | String |
|---|---|
| Ask placeholder (no trip) | Where to? |
| Ask placeholder (on a trip) | Anything for Istanbul? |
| Ask placeholder (in Wallet) | A visa, a renewal, a question? |
| Work in progress | Checking 14 flights → Holding 2 seats at this price → Ready |
| One clarifying question | Flexible by a day or two? → *Yes* · *Exact dates* |
| Results heading | Three ways to get there. |
| Option labels | Best for you · Lowest price · Fastest |
| Reasons | Direct. Lands before check-in. · One stop in Doha. SAR 1,120 less. · Leaves 2 hours earlier. |
| Nothing exact | Nothing direct on those dates. Here are two with one short stop. |

### 5.4 Paying

| Element | String |
|---|---|
| Title | Istanbul · 14–20 Mar |
| Lines | 4 travellers · Saudia, direct / Pera Palace · 6 nights / Airport pickup both ways |
| Total | SAR 8,640 |
| Under total | Everything included. No fees later. |
| Cancellation | Free to cancel until 3 Mar. After that, SAR 400. |
| Card | Visa ending 41 · Change |
| Instalments | Or 4 payments of SAR 2,160 with Tabby. |
| Slider | Slide to book |
| Under slider | You're only charged once it's confirmed. |

### 5.5 Waiting and confirmed

| Moment | String |
|---|---|
| Waiting headline | **With Faisal** |
| Waiting line | Faisal is confirming your seats with Saudia. Usually 4 minutes. |
| Steps | Seats held · Price checked · Issuing tickets |
| Confirmed headline (display serif) | **You're going to Istanbul.** |
| Confirmed line | Confirmed by Faisal · Saudia SV263 · X7K2QD |
| Button | See the trip |

### 5.6 When things go wrong

| Moment | Headline | Body | Primary |
|---|---|---|---|
| Delay threatens connection | **Your flight is 3 hours late.** | You'd miss the connection in Istanbul. We're holding two other ways to get there. | Take the 21:15 |
| Same, option line | — | Via Doha · Lands 06:10 · No extra cost | — |
| Same, footer | — | *(face)* Faisal is with you on this. | — |
| Airline cancels | **Saudia cancelled SV263.** | You're owed a full refund. Or take one of these instead. | Take the 07:30 |
| Supplier not answering | **Saudia's system isn't answering.** | Faisal is booking this by hand. You don't need to do anything. | — |
| Price moved | **The price went up SAR 140 while we checked.** | Fares change minute to minute. | Book at SAR 8,780 |
| Card declined | **Your bank said no.** | Nothing was charged. | Use another card |
| Offline | **You're offline.** | Everything for this trip is on your phone. | — |
| Our fault, unknown cause | **That didn't work, and it's on us.** | Try once more, or ask Faisal. | Try again |
| Refund | **Your refund is on its way.** | Requested · Approved by Saudia · Sent to your Visa. Usually there by 14 Mar. | — |

### 5.7 Documents

| Moment | Headline | Body | Primary |
|---|---|---|---|
| Fine, but watch it | **Sara's passport expires in 4 months.** | Turkey needs 150 days after arrival. Sara has 158, so this trip is fine. | Remind me in March |
| Blocking | **Ahmed's passport won't work for Schengen.** | It needs 3 months beyond your return. It has 6 weeks. | Get it renewed |
| Empty wallet | **Add a passport and we'll keep an eye on it.** | — | Scan passport |

### 5.8 Notifications and the lock screen

**Length limits:** title up to 32 characters, body up to 90, so nothing is cut off on the lock screen.

| Event | Title | Body |
|---|---|---|
| Gate change | Gate changed to C4 | SV263 now boards from C4. It's a 6-minute walk. |
| Time to leave | Leave in 15 minutes | Traffic to King Khalid is building. 38 min drive. |
| Driver | Your driver is here | Ahmet is at Door 3 with your name on a sign. |
| Confirmed | You're going to Istanbul | Confirmed by Faisal. Booking X7K2QD. |
| Connection risk | Your connection is at risk | SV263 is 3 hours late. We're holding two ways to get there. |
| Refund | Refund sent | SAR 640 is on its way to your Visa ending 41. |
| Evening digest | Tomorrow | Pickup 06:40 · Check-in closes 08:10 · 24° in Istanbul |

**Live Activity on the lock screen**

| Layout | Content |
|---|---|
| Compact | SV263 · 18m |
| Expanded | Gate B12 · Boarding in 18 min |
| Minimal | 18m |

### 5.9 Circles and rewards

| Moment | String |
|---|---|
| Group invite (WhatsApp preview) | **Join our Istanbul trip** · Plan, vote and pay your share in one place. |
| Default poll | Which hotel? |
| Split | Your share: SAR 2,160 → *Pay my share* |
| Who's around switch | **Tell friends you're in Amsterdam** · Only people you choose can see it. It turns off when you fly home. |
| Friend nearby | Abdullah is in Amsterdam too. → *Say hello* · *Not now* |
| Report sent | Thanks. A person will look at this within 24 hours. |
| New stamp | New stamp: Istanbul. |
| Empty groups | Plan with the people you travel with. → *Start a group* |
| Year in review | Your year, in places. |

### 5.10 Account and data

| Moment | String |
|---|---|
| Section | Your data |
| Export | Download everything |
| Delete headline | **Delete your account?** |
| Delete body | Your trips, documents and points will be deleted. Bookings already made stay with the airline and hotel. |
| Delete button | Delete my account |

### 5.11 Before and after

| A typical travel app | Mada |
|---|---|
| Hi there! 👋 How can I help you today? | Where to? |
| Generating your personalised itinerary… | Checking 14 flights |
| Your booking has been successfully submitted! | Faisal has it. Confirmation in about 4 minutes. |
| Oops! Something went wrong. Please try again later. | Saudia's system isn't answering. Faisal is booking this by hand. |
| Error: Invalid passport number | That number looks one digit short. It's on the photo page, under "Passport No." |
| Flight status: DELAYED | 3 hours late. Your connection is at risk. |
| Enable notifications for the best experience! | We'll only interrupt you when it matters. |
| Are you sure you want to cancel? | Cancel the hotel? You'll get SAR 1,240 back. The flight stays. |
| No results found. | Nothing direct on those dates. Here are two with one short stop. |
| Submit | Send to Faisal |

---

## 6. No AI feel, and still completely honest

The technology stays behind the curtain. What the traveller sees is a beautifully run travel desk.

### 6.1 In the design

- **No sparkles (✨), no "AI" badges, no glowing purple-and-blue gradients.**
- **No robot, orb-with-a-face or chat avatar.** The sun symbol is a brand mark, not a character.
- **Answers are not typed out word by word.** Results arrive as finished cards. While the work happens, the traveller sees what is being done ("Checking 14 flights"), which is how a great desk works too.
- **The home screen is not a chat screen.** Ask is a bar, not the app.
- **No "regenerate", "thumbs up/down", or "copy response" controls.**
- **Suggestions are actions, not prompts.** Use "Same as last Eid" or "Add dinner tonight". Never "Plan a 5-day itinerary for…".
- **Typography is editorial.** A serif display face for the emotional moments (§7) makes the app read like a travel magazine, not a tech product.

### 6.2 In the words
- No banned words (§3.2), "we" for Mada, "I" only for named people (§1).

### 6.3 Honesty, which is non-negotiable
- **We never let software pass as a person.** The opening line of every conversation thread, in small type, says:
  > *Instant answers from Mada. Faisal and the team confirm anything you book.*
- **Every message from a person carries their face and name. Nothing else does.**
- This also covers transparency laws in markets we may expand into: the EU AI Act's rule on disclosing automated conversations applies from August 2026. Counsel confirms the final wording (INTEGRATIONS.md 0.10e).

### 6.4 Conversational replies are held to the same standard

| Kind of message | How it is written |
|---|---|
| **High-stakes** (confirmations, payments, disruption, refunds, documents, legal, notifications) | **Fixed, hand-written templates from this document, with values filled in. Never generated freely.** |
| **Open answers** ("is Baku nice in June?") | Generated under strict style rules: the answer first, at most 2 sentences before a card, "we" never "I", no banned words, the user's language. A writer reviews a sample every week and tightens the rules. |
| **Every outgoing message** | Passes the banned-word check before it is sent. If it fails, it falls back to a template. |

---

## 7. Typography

### 7.1 Typefaces

All the faces below are free, which fits the cost rule, and the Latin and Arabic choices are carried over from the brand.

| Role | Latin (English) | Arabic | Why |
|---|---|---|---|
| **Display: emotional moments** | **Instrument Serif** | **Reem Kufi**, to be reviewed by a Saudi type designer | An editorial serif reads as human and premium, like a travel magazine. It is the single strongest move away from the generic tech look. |
| **Interface: everything else** | **Inter Tight** | **IBM Plex Sans Arabic** | Neutral, highly legible, with tabular figures. It does its job and steps aside. |

**When the display serif appears**
- **It appears only at moments that should be felt.** Examples: "You're going to Istanbul.", "Welcome home.", "We'll take it from here.", destination names on hero cards, and the year in review.
- **Never more than one serif line on a screen.** If it appeared everywhere, it would stop meaning anything.

### 7.2 Type scale (English; Arabic sizes in §7.4)

| Style | Face | Size / line height | Tracking | Used for |
|---|---|---|---|---|
| Hero number | Inter Tight SemiBold, tabular figures | 64 / 64 | −3% | "42 min", "B12" |
| Display | Instrument Serif | 40 / 44 | −1% | The emotional moments |
| Title | Inter Tight SemiBold | 24 / 30 | −1% | Screen titles |
| Headline | Inter Tight Medium | 19 / 24 | −0.5% | Card titles, alert headlines |
| Body | Inter Tight Regular | 16 / 23 | 0 | Sentences |
| Callout | Inter Tight Regular | 14 / 20 | 0 | Secondary lines |
| Caption | Inter Tight Medium | 12 / 16 | +1% | Metadata, sources ("Live · airline") |
| Code | Inter Tight Medium, capitals, tabular figures | 15 / 20 | +4% | RUH, SV263, X7K2QD |

### 7.3 Rules

1. **Each screen uses at most 3 sizes and 2 weights**, plus the hero number.
2. **Tabular figures for anything that changes or lines up:** times, prices, gates and countdowns. Digits must never jitter as they roll.
3. **No single word on the last line of a headline.** Headlines are balanced across lines, broken by hand if needed.
4. **Body lines run 35–45 characters on a phone.** That is the comfortable reading length.
5. **Capitals only for codes** (airport, airline and booking codes), with extra letter spacing. Never for emphasis.
6. **Hierarchy comes from size and weight, not colour.** Colour is kept for the one accent, the thing to do now ([EXPERIENCE.md §2.4](EXPERIENCE.md)).
7. **Dynamic Type is supported up to the largest accessibility sizes.** Layouts reflow; text is never truncated or shrunk to fit.
8. **Contrast:** at least 4.5:1 for body text and 3:1 for large text. Sun-gold is never used as a text colour on sand.

### 7.4 Arabic

- **Arabic is transcreated by a native Saudi writer, not translated.** The rules here still apply: answer first, numbers over adjectives, calm.
- **Sizes:** Arabic is set about 2 pt larger than English at every style, with line height about 15% taller. Body text is never below 16 pt.
- **Register:** Modern Standard Arabic for documents, fare rules and legal text. Warm, light-touch Gulf phrasing in Today, alerts and greetings, written by the native writer.
- **Numerals:** Western digits by default, matching what Saudi airlines and banks show. Arabic-Indic digits are available in settings.
- **Codes and times stay left-to-right** inside right-to-left sentences, isolated so the text never scrambles.
- **Length:** Arabic strings run 20–30% longer, so every layout is tested at Arabic length, and at the largest text size.

---

## 8. Checking a string before it ships

Every string is checked against these five tests:

1. **The concierge test:** would the best concierge in the world say this, out loud, to a guest?
2. **The read-aloud test:** read it aloud. If you stumble, rewrite it.
3. **The glance test:** can it be understood in 2 seconds, at the gate, with a bag in one hand?
4. **The fear test:** if this is bad news, does the traveller feel informed rather than frightened?
5. **The truth test:** is every claim exactly true? That covers names, times, "no extra cost" and "usually 4 minutes", which must be measured, not hoped for.

---

## 9. How strings are made

1. **Every string lives in a single catalogue.** Each entry records:
   - an ID and the screen it appears on
   - its context, with a screenshot
   - the maximum length in English and in Arabic
   - its tone (calm, warm or neutral)
   - the writer and the reviewer
   - its status
2. **Engineers never write user-facing words.** Placeholders in the code look obviously unfinished (`⟦gate_change.title⟧`), so they can't ship by accident.
3. **One writer owns the English voice, and one native Saudi writer owns the Arabic.** Each reviews the other's work for meaning.
4. **Every string is reviewed in context:** on screenshots in both languages, at the default and the largest text size, and in light and dark mode.
5. **The CI pipeline fails the build** if a banned word appears, if a string is over its length limit, or if a placeholder is left in.
6. **Strings are watched in production.** The friction board ([EXPERIENCE.md §10.2](EXPERIENCE.md)) shows where people hesitate. Often the fix is a better word, not a new feature.
