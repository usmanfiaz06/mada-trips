# Mada Trips app: experience design

**Status:** Draft v1. The visual direction (§9) is based on the first four references and will be finalised once the rest arrive.
**Goal:** booking and travelling should feel so effortless that every other travel app starts to feel like paperwork.
**Builds on:** [SCOPE.md](SCOPE.md) (what we build), [RESEARCH.md](RESEARCH.md) (why).

---

## 1. The single idea

> **The traveller never fills anything in. They only say yes.**

Every other travel app makes the traveller do the work: fill the search form, scan 200 results, pick a fare family, type four passports, choose seats, decline six extras, enter a card. Mada moves that work to itself and to the agent, and leaves the traveller with three moves:

1. **Say what you want**, any way you like: a few words, your voice, a screenshot, a link, a tap on a suggestion.
2. **Pick one of three.** Mada has already done the comparing.
3. **Slide to confirm.** A named human makes it real.

Design calls this **Tesler's law**: every task has a fixed amount of complexity, and someone has to carry it. In every other travel app the traveller carries it. In Mada, the AI, the agent and the stored profile carry it.

---

## 2. How people really behave when they travel

Each principle below is a known finding about human behaviour, followed by what it means for Mada. These are the rules design and engineering will be held to.

### 2.1 Attention is scarce, and stress shrinks it further

| Behaviour | What it means for Mada |
|---|---|
| **Working memory holds about 4 things** (Cowan). | No screen asks the traveller to compare more than 4 things at once. Results show **3 options**, never a list of 200. |
| **More choices mean slower decisions** (Hick's law), and too many choices lead people to give up (the "jam study" by Iyengar and Lepper). | Three curated options: **Best fit** (selected by default), **Lowest price**, **Fastest**. Each has a single-line reason ("Direct, arrives before hotel check-in"). "See all" exists, but the traveller should rarely need it. |
| **Under stress, attention narrows** (tunnel vision). Travellers at the gate are stressed, tired and holding a bag. | **Stress mode** (§6.5): during a disruption, the screen shows one card, one action and large type. Nothing else. |
| **Decisions wear people out** (decision fatigue). Mid-trip, people are tired. | Defaults everywhere. An evening digest instead of many pushes. The concierge asks at most **one** question at a time, and only when the answer changes the outcome. |
| **Responses under about 0.4 s keep people in flow** (Doherty threshold). | Every tap responds instantly: optimistic UI, skeleton loaders, haptic feedback. When the AI needs longer, it **shows what it is doing** ("Checked 14 flights · holding 2") instead of a spinner. |

### 2.2 People recognise more easily than they remember

| Behaviour | What it means for Mada |
|---|---|
| **Recognition beats recall.** | Never an empty search box on its own. Suggestions are always waiting: the next trip, places they saved, "the usual Eid trip", the last search. |
| **Defaults decide most outcomes** (Johnson and Goldstein's organ-donation study). | Smart defaults fill everything: travellers from the household, names exactly as on the passport, the usual seat and meal, the usual hotel tier, the usual payment card. **A default never adds a paid extra.** That would be a dark pattern, and Hopper paid $35M for it. |
| **People reuse habits from other apps** (Jakob's law). | Standard gestures: swipe back, pull down to close, tab bar. The new parts (Ask, slide to confirm) are layered on top of familiar ones, never in place of them. |
| **People will give any input, in any form** (be liberal in what you accept). | "Istanbul eid 4 of us under 9k", a voice note in the Najdi dialect, a TikTok link, a hotel screenshot, a forwarded PDF: all of them work. |

### 2.3 Feelings decide what people remember

| Behaviour | What it means for Mada |
|---|---|
| **People remember the peak and the end, not the average** (Kahneman's peak-end rule). | Design two moments with the most care. **The peak:** "Confirmed by Faisal" with his face, a haptic and a short sun-ray animation. **The end:** "Welcome home", with the trip on one card. |
| **Unfinished tasks stay on the mind** (Zeigarnik effect). People also speed up as they near a goal (goal-gradient effect). | Each trip has a **readiness ring**, e.g. "3 of 4 ready", where the last item is Sara's visa. It motivates without nagging, and it disappears once the trip is ready. |
| **Paying hurts, and the hurt grows with each separate payment** (Prelec and Loewenstein). | Pay once per trip, not per item. Show the all-in price. Offer instalments on large trips. **But the total is always visible**: making paying easy must never mean hiding what it costs. |
| **Beautiful things feel easier to use** (aesthetic-usability effect). | The polish is part of the function. A beautiful app is forgiven its small frictions, and it makes the product feel trustworthy. |
| **Uncertainty is the main source of travel anxiety.** People want the answer to "Am I OK?". | Today always opens with a status line: **"All set"** in green, or the single thing that needs attention. That answer comes before any other information. |
| **Faces build trust; an anonymous system does not.** | A real agent's face and name on every commitment. Groups show the faces of the people in them (as in the Homely reference). |

### 2.4 Attention goes to what stands out

| Behaviour | What it means for Mada |
|---|---|
| **The one thing that looks different gets noticed** (Von Restorff effect). | **One accent colour per screen, used on the one thing to do now.** Everything else stays neutral. If two things are highlighted, one of them is wrong. |
| **People remember the first and last items in a list** (serial-position effect). | The answer goes at the top and the action at the bottom. The middle holds detail people can skip. |
| **People trust what their circle trusts** (social proof). | "Abdullah stayed here in May" counts for more than "4.6 from 2,300 reviews". Show friends first, strangers second. |
| **Losses feel about twice as strong as gains** (loss aversion). | Phrase alerts calmly and precisely. "Your connection is at risk. We are holding two options." Never "ACT NOW OR LOSE YOUR SEAT". Fear sells once and then destroys trust. |

---

## 3. Where things go on the screen

### 3.1 Three zones on every screen

Most people hold their phone in one hand, and the thumb reaches the bottom third of the screen easily (Steven Hoober's research). The top corners are the hardest to reach, yet that is where most apps put "Back" and "Done".

```
┌─────────────────────────────┐
│  GLANCE ZONE   (top ~30%)   │  Read, don't tap. Answers the question
│  "All set ✓ · Leave in 42m" │  in the traveller's head. Status, headline.
├─────────────────────────────┤
│                             │
│  BROWSE ZONE  (middle ~45%) │  Cards to look at and scroll.
│  cards · options · timeline │  Tap targets are big cards, not small links.
│                             │
├─────────────────────────────┤
│  ACT ZONE   (bottom ~25%)   │  The one primary action, the Ask bar and
│  [ Slide to book ⟶ ]        │  the tab dock. Everything the thumb does
│  ( ◉ Ask )  dock            │  most often lives here.
└─────────────────────────────┘
```

**Placement rules**

1. **The primary action always sits in the Act zone**, full width or centred, so either hand can reach it. That covers right- and left-handers, and both Arabic and English layouts.
2. **Nothing the traveller does often sits in the top 30%.** Back is a swipe from the edge, and sheets close by pulling down. The top-corner buttons are there as backups, not as the main way.
3. **Destructive actions** (cancel a booking, leave a group) **are never placed where the thumb rests.** They sit inside a sheet, behind a second step.
4. **Decisions happen in bottom sheets**, not new pages. The traveller keeps their context (the trip is still visible behind the sheet) and the choices sit within thumb reach.
5. **At most one primary button per screen.** A secondary action is a text link. A third option means the screen has been designed wrong.
6. **Minimum touch target is 48 pt.** The main cards are much larger.

### 3.2 What the traveller is thinking on each screen

Every screen is designed by first writing down **the question in the traveller's head**. The answer goes in the Glance zone and the next step in the Act zone.

| Screen | The question in their head | Glance zone answers | Act zone offers |
|---|---|---|---|
| Today, no trip | "Where should we go?" | "Eid is in 7 weeks. Prices for Baku are rising." | Ask ("Where to?") |
| Today, before a trip | "Are we ready?" | Readiness ring: "3 of 4 ready" | Fix the 1 missing item |
| Today, travel day | "When do I leave? Where do I go?" | **Leave in 42 min** · gate · seat | Open boarding pass |
| Choice (3 options) | "Which one is right for us?" | Best fit, with the reason | Slide to book |
| Pay sheet | "What exactly am I paying for, and can I undo it?" | All-in total · cancellation rule in one line | Slide to confirm with Face ID |
| Waiting for the agent | "Is it happening?" | "With Faisal · usually 4 min" + live steps | Nothing (calm). Chat if needed |
| Disruption | "Am I stuck?" | What happened, and what we are already doing | Approve plan B |
| Wallet | "Do we have everything?" | Each person ✓ or the 1 problem | Add or scan |
| Trip group | "What's decided, and who has paid?" | The plan, plus the open poll | Vote / pay my share |
| Who's around | "Is anyone I know here?" | Friends in the same city (if they opted in) | Send request |

### 3.3 English first, fully available in Arabic

- **Decided: English is the primary design language.** Arabic is complete and first-class, not a translation layer: every screen ships in both, and every layout is checked in both directions before release.
- **The app follows the phone's language by default.** A switch in settings changes it, with no need to restart the app.
- **Some things never mirror:** clocks, progress rings, media controls, flight numbers, PNRs (booking references), times and prices. They sit in isolated left-to-right runs inside Arabic text.
- **The primary action stays centred and full width**, so mirroring never moves it away from the thumb.
- **Arabic text is set about 10–15% larger, with roomier line height.** Body text is never below 15 pt in Arabic.
- **The concierge replies in whichever language the traveller writes or speaks**, whatever the app's language is set to.

---

## 4. The interaction model

### 4.1 The dock and the Ask orb

```
        ╭───────────────────────────────────╮
        │  Today   Trips   (◉)   Circles  Wallet │   a floating glass dock
        ╰───────────────────────────────────╯
                          ↑
              the Ask orb: tap = type · hold = talk
```

- **A floating dock in Liquid Glass**, with the active tab expanded into a labelled pill (as in the Atlas and Homely references).
- **The Ask orb sits in the centre**, the easiest spot for the thumb (as in the FitBite reference). It is the brand's **sun symbol**. When the AI is working, its rays turn slowly, the same motion as the website's preloader.
- **Ask always knows the context.** On a trip, "add dinner" means *this* trip. On the Wallet, "renew" means *that* passport.
- **The dock shrinks** while the traveller scrolls through content and comes back on scroll-up or a pause.

### 4.2 Slide to confirm (money and commitments)

The FitBite reference's "Get started" slider becomes Mada's **signature commitment gesture**:

```
[ (☀)  ──────  Slide to book · SAR 8,640  ───────▸ ]
```

- A **deliberate gesture for anything that costs money** or changes the itinerary. It can't be triggered by an accidental tap in a pocket or a moving taxi. It is followed by Face ID.
- **While sliding:** the knob is the sun symbol, and light haptic ticks fire as it travels.
- **On release:** a firm haptic, then the screen hands straight over to the "With Faisal" status.
- **Never used for anything trivial.** Small add-ons the traveller pre-approved are a single tap.

### 4.3 Sheets, not pages

- **Every choice opens as a bottom sheet over its context**: travellers, dates, seats, payment, a poll. The sheet has three heights: peek, half, full.
- **The traveller never loses where they are**, and every option sits within thumb reach.

### 4.4 A shared vocabulary of feedback

**Motion**

| Moment | Motion | Haptic |
|---|---|---|
| Tap | Instant press-in, about 100 ms | Light |
| Card opens | The card itself expands into the detail view (a shared-element transition, never a cut) | — |
| AI working | The sun rays turn; each step it completes appears as a line of text | — |
| Confirmed | A short burst of sun rays, about 600 ms | Success |
| Problem | No shaking and no red flashing. A calm card slides up | Warning |

### 4.5 Living motion: an app that breathes with the real world

**The rule: every movement has a real cause.** It comes either from the traveller's touch or from something happening in the world. Nothing moves just to decorate. That is why the motion feels alive rather than busy: the app moves because the world did.

| Real-world cause | What moves | How it feels |
|---|---|---|
| **The time of day where you are** | The canvas warms and cools very slightly through the day: soft warm sand at dawn, bright at noon, golden in the late afternoon, green-black at night. The shift is only a few percent, so it registers without being noticed. | The app lives in the same day as you. |
| **The time of day at the destination** | Each trip card shows the light of its own city. Istanbul's card is at dusk while it's dusk in Istanbul. | You can feel the place before you get there. |
| **The real sun** | The sun symbol in the Today header sits at the sun's actual height in the sky where you are: low at Fajr, high at noon, set at night. | The brand symbol is literally the sun. |
| **Weather at the destination** | A faint weather layer on the hero card only: a cloud shadow drifting, light rain streaks, heat shimmer at 45°C. Rendered on the GPU, very low opacity, and it pauses when the card is off-screen. | "It's raining in London" without reading a word. |
| **A flight in the air** | An arc with the plane at its real position. Arrival-time digits roll smoothly into place. On landing the arc settles and fades. | You can see the flight progressing, not just read it. |
| **Time running down** | Countdowns roll, never jump. The "Leave in" ring empties continuously. | Calm, steady, trustworthy. |
| **Live data arriving** | A small dot pulses beside the source ("Live · airline"). When something changes, the old value **morphs** into the new one (gate B12 → C4) and stays briefly highlighted. | You notice the change without being alarmed. |
| **Mada thinking or listening** | The sun **breathes** when idle: a 10-second cycle, about the pace of calm breathing, so the cycle quietly slows the viewer down. While you speak, its rays follow your voice. While it works, the rays turn, then burst on success. | Mada is present and attentive. No face is needed. |
| **Your hand moving the phone** | 1–3 pt parallax on photography and 3D objects, using the gyroscope. Documents in the Wallet catch the light like a real card when you tilt the phone, with a subtle sheen on the passport (in the style of Apple Card). | The objects feel physical, as if they're in your hand. |
| **Your finger** | Everything follows spring physics. Motion can be interrupted mid-way, carries the speed of the swipe, and has weight. Sheets stretch slightly at their limits. | Direct and tactile. Nothing feels canned. |
| **People arriving** | A friend's face fades into the trip group as they land. "Abdullah is in Istanbul too" arrives as a soft appearance, not a ping. | The circle feels alive. |
| **Occasions** | Once per occasion, never repeated: a crescent on the sun through Ramadan nights, one quiet Eid moment, green on National Day. | The app shares your calendar. |

**Motion rules**
- **Motion never blocks a tap.** Every transition can be interrupted.
- **Interaction motion stays under 400 ms**, except the confirmation peak.
- **Ambient motion lives only in the Glance zone and on hero cards.** Nothing moves in the Act zone except what the traveller is touching.
- **Ambient motion pauses while the traveller scrolls** and resumes when they stop.
- **Stress mode is still.** During a disruption, every ambient layer stops. Stillness tells the traveller this is serious, and it keeps the screen readable.
- **Accessibility and battery:** Reduce Motion replaces movement with crossfades. Low Power Mode switches off the ambient layers.
- **Frame rate:** 120 fps on screens that support it, 60 fps minimum. Animations run off the JavaScript thread. Dropped frames are monitored in production (§10.2).
- **The website's big scroll animations stay on the website and in the onboarding story.** In the working app, the motion is quieter and more physical.

### 4.6 Haptics: a vocabulary you can feel

Each haptic is a word. The same event always feels the same, so after a week travellers know what happened without looking. iOS uses custom Core Haptics patterns; Android uses composed vibration effects, falling back to system presets.

| Event | Pattern | Why |
|---|---|---|
| Tap a card or chip | Light tick | Confirms the touch was received |
| Picker or chip snaps into place | Selection tick at each step | A feeling of precision |
| **Slide to book: dragging** | Ticks that get stronger as the knob nears the end | You feel the commitment building |
| **Slide to book: release** | One deep, solid "thunk" | The decision is made |
| Agent picks up your request | One soft "knock" | Someone is here |
| **Confirmed** | A heartbeat: soft, then strong | The peak moment (§2.3) |
| Gate change (with the app open) | Two even taps | Attention without alarm |
| Boarding opens | A gentle rising pattern | Time to move |
| **Landed** | A soft thud, then a fading rumble ("touchdown") | You feel the arrival |
| Points or a refund credited | A quick sparkle of three | A small reward |
| Something can't be done | Two soft, low taps | Never a harsh buzz |
| Pull to refresh | One detent at the threshold | Tells you when to let go |

**Haptic rules**
- **At most one haptic per action.** None while scrolling, except picker detents.
- **The haptic and the visual land together**, within about 10 ms.
- **The phone's own haptics setting is respected.**
- **Never used for marketing.**
- **Sound is off by default.** There is one optional sound: a soft chime when a booking is confirmed.

### 4.7 How motion and haptics are built

- **React Native Reanimated 4** with Gesture Handler: animations that run on the UI thread and can be interrupted.
- **Skia:** GPU shaders for light, weather and the Wallet sheen.
- **Rive:** the sun's states (idle breathing, listening, thinking, celebrating) as one interactive state machine, driven by the app.
- **Gyroscope:** read through Expo Sensors for parallax, sampled only while a screen is visible.
- **A small native haptics module** for Core Haptics and Android compositions. The standard Expo library only has presets.

---

## 5. Booking, from wish to confirmation in about 30 seconds

**What competitors make people do today:** fill in a search form, scroll through 100+ results, pick a fare family, fill in a form for each traveller, choose seats and extras, enter a card, then fix the errors.

**Mada:**

```
 1. SAY           2. PICK              3. SLIDE              4. RELAX
 ┌──────────┐    ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
 │"Istanbul,│    │ ★ Best fit    │     │ 4 travellers ✓│      │ With Faisal  │
 │ Eid, the │ ─▶ │ Direct · SV   │ ─▶  │ Window, halal ✓│ ─▶  │ ● checking   │
 │ family"  │    │ SAR 8,640     │     │ Visa card ••41 │      │ ● fare held  │
 │ 🎙 or tap │    │ Lowest price  │     │ SAR 8,640 all-in│     │ ○ issuing    │
 └──────────┘    │ Fastest       │     │ [slide to book]│      │  ~4 min      │
                 └──────────────┘     └──────────────┘      └──────────────┘
```

**Rules for this flow**
1. **Everything that can be inferred is pre-filled.** It is shown as a single summary line ("4 travellers · window seats · halal meals · Visa ••41"), and tapping the line edits it. It is never a form.
2. **The one question that changes the outcome is asked as chips, not typing.** For example: "Flexible ±2 days?" [Yes] [Exact dates].
3. **Only three options.** Each shows its reason, its all-in price, and its monthly instalment when the total is above SAR 2,000.
4. **The whole trip is offered in one go.** After the flight: "Add the hotel you liked last time + airport pickup?" The traveller ticks what they want and pays once.
5. **Waiting is designed, not dead.** The traveller sees each step happen live, with the agent's face. While they wait, Mada quietly gets the next things ready: the visa check, the readiness ring, invites to the trip group.

---

## 6. Anatomy of the key screens

Wireframe notes for design. The layout follows the zones in §3; the visual style follows §9.

### 6.1 Today, travel day
- **Glance:** "All set ✓". Then a very large **Leave in 42 min**, with the traffic reason underneath.
- **Browse:** a flight card (gate, seat, boarding time, live status with its source), the driver card, and the weather and prayer time at the destination.
- **Act:** [Boarding pass] at full width, then the dock.
- The **Live Activity** shows the same information on the lock screen, so the traveller doesn't need to open the app.

### 6.2 Today, no trip
- **Glance:** one timely prompt, e.g. "Eid in 7 weeks. Last year: Baku with 5 people."
- **Browse:** a bento grid in the style of the Atlas reference:
  - Saved collections, e.g. "8 saved places in Istanbul"
  - The next document to renew
  - Friends' recent trips
  - A Saudi destination for the season
  - At most **4 tiles**
- **Act:** Ask ("Where to?"), with chips from the user's own context. Never generic deals.

### 6.3 Pay sheet
**What the sheet shows, top to bottom:**
1. What the traveller gets, as one line per item.
2. The all-in total, in large type.
3. The cancellation rule in plain words: "Free until 3 Mar, then SAR 400".
4. The payment method, which can be changed.
5. An instalment option.
6. Slide to confirm.

**Not on the sheet:** pre-ticked extras, a countdown timer, or "only 2 left" unless the supplier actually returns that number.

### 6.4 Waiting, then confirmed
- The agent's face and name, the steps ticking off live, and an honest estimated time.
- The confirmation is the **peak moment**: sun-ray burst, success haptic, and "Confirmed by Faisal · Saudia SV263 · PNR X7K2QD".
- An optional short voice note from the agent.
- The trip appears in Trips, the documents go to the Wallet, and the flight goes on the radar, all at once.

### 6.5 Stress mode (disruption)
- **The whole screen becomes a single card.** It shows:
  - "Your flight is delayed 3 h. Your connection in Istanbul is at risk."
  - "We are holding two options."
  - Option A, shown first, with its reason
  - [Approve A] in the Act zone
  - Faisal's face with "I'm on it"
- **Everything else is hidden** until the disruption is resolved.
- **Larger type, calm colours.** Never red.

### 6.6 Trip group
- **Header:** the faces of the people in the group, overlapping, as in the Homely "At home" row.
- **Pinned:** the plan, the open poll and who has paid.
- **Chat:** the AI and Faisal post into the same thread. Each of their posts is a card that can be acted on (vote, pay my share, approve).

### 6.7 Wallet
- **One row per person:** face, name, then ✓ or the single problem ("Passport: 4 months left").
- **Tap a person** to see their documents. Each document is a card that looks like the real thing.
- **Behind Face ID, and available offline.**

---

## 7. Banned list

Things that are common in other apps and never appear in Mada:

- Pop-ups on launch.
- A rating prompt in the middle of a task.
- A "deals" carousel on the home screen.
- An empty search form as the home screen.
- More than one primary button on a screen.
- Pre-ticked paid extras.
- Confirmshaming ("No thanks, I like paying more").
- Fake scarcity or countdown timers.
- A hamburger menu.
- An infinite social feed.
- Red badges for anything that isn't an action the traveller needs to take.
- Error codes shown to travellers. Write "Saudia's system is slow. Faisal is on it." instead of "Error 502".
- Asking for something Mada already knows.
- A form with more than 3 fields.

---

## 8. Voice and tone

- **A warm, capable friend who happens to be a travel expert.** Short sentences. The answer first, then the reason.
- **Arabic:** warm, neutral Gulf Arabic in the conversation (the "white dialect" understood across the Gulf), and clear Modern Standard Arabic for legal text and fare rules.
- **Faisal, not "our team".** People, not departments.
- **Calm, especially when things go wrong.** Precise numbers and times; no exclamation marks in alerts.

---

## 9. Visual direction (draft, from the first four references)

### 9.1 What the references share

| Reference | What to take | What to leave |
|---|---|---|
| **Atlas** (travel) | A soft, airy canvas. Big rounded bento cards that mix photography with utility (a trip card next to a checklist card). Category chips with icons. The floating dock whose active tab expands into a pill. Floating progress-arc widgets. | The generic "Discover the world" header. Mada's home answers a question; it doesn't greet. |
| **FitBite** (nutrition) | One fresh accent colour used as a fill on the key card. A ring for progress (→ the readiness ring). The week-strip date picker. The "+" quick-add on each row. **The swipe-to-start control (→ slide to book).** The raised action button in the centre of the tab bar (→ the Ask orb). | Calorie-style density. Our rows stay sparse. |
| **Humwork** (store screenshots) | Huge, confident type. Gradient words. Floating glass chips showing credited amounts (→ "+120 points", "Refund SAR 640 ✓"). A 3D character. Alternating dark and light panels. **Use this energy for App Store screenshots, onboarding and reward moments.** | Gradient type inside the working app: it is too loud for the gate. |
| **Homely** (smart home) | Frosted glass on neutral greys, close to iOS Liquid Glass. A context pill ("Today 11:00–18:00 · Spring preset" → "Today · Riyadh → Istanbul · leave 06:40"). Stacked face avatars. One highlighted tile among neutral ones. A dark app icon with a soft colour gradient. Big brand type behind the phone in marketing. | Toggles everywhere. Travel is not a control panel. |

**The common thread:** a calm neutral canvas, big rounded cards, generous white space, large friendly type, people's faces, a glass dock, and **exactly one accent colour that marks "the thing to do now"**.

### 9.2 Translated into the Mada brand

| Role | Mada | Notes |
|---|---|---|
| Canvas | **Sand** `#e9e2d8`, lightened toward near-white (around `#f6f2ec`) | Warmer than the references' greys. Reads as desert light. Distinctly Saudi without being literal. |
| Ink | **Mada green** `#1e352d` | Headlines, the active dock pill (the dark pill in the references), the dark panels. |
| The "do this now" accent | **Sun-gold**, used as a fill with green text on it | Plays the role lime plays in the references. Gold text on sand fails contrast, so gold is always a background, never text. |
| Success / "All set" | A fresh oasis green, close to the references' lime but leaning green | Used only for status. Final value to be decided in the design pass. |
| Glass | Frosted surfaces for the dock, the Ask orb and the sheets only | Content cards stay solid, following Apple's Liquid Glass guidance. |
| Type | Latin: Inter Tight for the UI, Instrument Serif for display moments (the peak, welcome home, onboarding). Arabic: IBM Plex Sans Arabic for the UI, Reem Kufi for display. | Carried over from the website. The references' rounded geometric sans could replace Inter Tight in the UI if the design pass prefers it. |
| Corners | 28–32 pt on cards, fully round on chips and the dock | As in all four references. |
| Photography | Real, warm, people-first: families, Saudi destinations | The Atlas reference shows how photography and utility cards sit together. |
| App icon | The sun symbol on a deep green gradient | Taken from the Homely icon treatment. |
| Dark mode | Green-black canvas, with sun-gold as the accent | For night flights and the evening digest. |

### 9.3 Imagery: no mascot. Photography, the sun, faces and 3D objects

**Recommendation: no mascot character.** Use four layers instead, each with one job:

| Layer | Its job | Where it appears |
|---|---|---|
| **Photography: the world** | Real places in real light. Warm, people-first, including Saudi families and Saudi destinations. Hotel and activity photos come from suppliers; Circles uses travellers' own photos. **We never use AI-generated images of real places**, because a traveller who books a view and finds a different one stops trusting us. | Trip cards, destination ideas, collections, hotel choices |
| **The sun: Mada** | Mada's presence. It has personality through motion alone (breathing, listening, thinking, celebrating, §4.5) and needs no face. It is a character with no cartoon. | The Ask orb, the Today header, loading and confirmation |
| **Faces: the people** | The real characters in the app: Faisal and the other named agents, your family, your friends. | Confirmations, trip groups, the Wallet, Who's around |
| **3D objects: your things and your rewards** | A small, consistent set of tactile objects in Mada materials (matte sand ceramic, green glass, gold): passport, boarding pass, suitcase, key card, compass, camera and the Mada stamp. | Onboarding, empty states, the Wallet, rewards, the Mada Passport, App Store screenshots |

**Why not a mascot like Humwork's robot**
- **Humwork's product is AI agents, so its robot *is* the product.** Mada's promise is the opposite: AI does the work, a **real person** owns it. A cartoon helper on screen would undercut "Confirmed by Faisal" and make Mada look like the chatbots travellers already distrust ([RESEARCH.md §3](RESEARCH.md)).
- **A mascot can't stay dignified in stress mode.** Nobody wants a cartoon telling them their connection is at risk.
- **A premium brand ages better with symbols and objects** than with a cartoon. Characters also invite cultural debate about how figures are depicted.

**Where the 3D objects earn their place**
- **Rewards as passport stamps.** Every new city or country stamps a 3D page in your **Mada Passport**. Saudi destinations get special stamps (AlUla, Diriyah, the Red Sea, Abha). They are collectible, tactile and shareable, which makes them the heart of the rewards layer.
- **Floating glass chips for good news**, in the style of the Humwork reference: "+120 points", "Refund SAR 640 ✓", "Upgrade secured".
- **Empty states with one object and one line.** For example: an open suitcase with "Nothing planned yet. Where to?"
- **App Store screenshots and onboarding** borrow Humwork's energy: oversized type, the 3D objects, and dark and light panels.

**Icons:** one custom set of rounded line icons matching the dock. No mixing of icon styles.

### 9.4 Still open, for the next references
1. **Arabic typography**, for the Arabic version.
2. **Density:** whether Today stays as sparse as Homely, or gets closer to FitBite.
3. **The 3D material:** ceramic and matte, or glass and glossy. A reference for each would settle it.

---

## 10. How we'll know it's working

### 10.1 Usability rounds

**Who tests it.** Rounds of five people each (five per round finds most usability problems, per Nielsen), always including:
- a mother managing children's documents
- a parent over 55, using large text
- a first-time international traveller
- an expat travelling with an iqama
- an English-only user

**What we measure.**

| Measure | Target |
|---|---|
| Time from intent to "slide to book" | Under 30 s for a family flight |
| Taps from intent to "slide to book" | 3–5 |
| First click on the right thing | ≥ 90% |
| Single Ease Question ("how easy was that?", 1–7) | ≥ 6.5 |
| Times the traveller types a name, passport number or card number | **Zero** after onboarding |
| "Where would you tap to…?" with no hesitation | The answer is in the Act zone every time |

**The test that matters most.** After a session with Mada, give the tester the same task in Almosafer or Booking.com and watch for frustration. That reaction is the goal the founder set.

### 10.2 Instrumentation: heatmaps and friction signals in production

Every flow is measured from the first beta build, so we know **which flow, which step and which screen** is causing trouble, rather than guessing.

**Each flow is a funnel**
- Every flow (book, change, add document, join group, pay share, and so on) gets named steps.
- The same four events are used everywhere: `flow_started`, `step_viewed`, `step_completed` and `flow_abandoned`. The abandon event records the step and the reason when one is known.
- Funnels, drop-off by step, and the most common paths come from these events.

**What we capture on screen**
- **Tap heatmaps per screen:** where people tap, including taps on things that aren't buttons.
- **Scroll depth:** whether the important card is ever seen.
- **Session replay:** to watch real sessions behind a problem. Privacy rules apply (see below).

**Friction signals, detected automatically and ranked weekly**

| Signal | Detected when | Usually means |
|---|---|---|
| Rage taps | 3+ taps in the same spot within 1 s | Something looks tappable but isn't, or it's too slow |
| Dead taps | A tap on something that isn't interactive | A false signal in the design |
| Back-and-forth | Returning to the previous step within 5 s | The step didn't answer the question in the traveller's head |
| Hesitation | Time on a step above the 75th percentile | Too many choices, or something unclear |
| Abandoned typing | The keyboard opened and closed with nothing typed | We asked for something we should have known |
| **"How do I…" in Ask** | The traveller asks the concierge how to use the app itself | The interface failed. This is the most valuable signal we have. |
| Dropped frames | An animation runs below 55 fps | Motion jank, which breaks the feeling of quality |
| Stress-mode outcomes | Time from a disruption alert to the traveller's decision | Whether the hard moments work |

**The friction board.** Every week: the top 5 flows by drop-off, each linked to its replays and heatmap, with an owner and a fix. One change is tested at a time, behind a feature flag (A/B).

**Privacy rules (Saudi data law, PDPL)**
- **Session replay needs consent** and is sampled, not recorded for everyone.
- **All typed text is masked.**
- **Never recorded at all:** the Wallet, passports, payment screens and chat contents.
- Replays are kept for 30 days.
- Heatmaps and funnels contain no personal data.

**Tools.** PostHog for events, funnels, paths, feature flags, experiments and replay. Sentry for crashes and performance, including slow frames. For tap heatmaps on mobile, use PostHog if its mobile heatmaps cover React Native well enough; otherwise UXCam, which is built for mobile heatmaps. **[Confirm PostHog's mobile heatmap support in the sandbox week.]**

