# Mada Trips app: flows and edge cases

The flows the clickable prototype implements end to end, including every edge case. It is the checklist for the real app as well.

- The prototype source is in [prototype-app/](prototype-app/).
- Each edge case can be triggered from the prototype's **demo panel**.

**Conventions**
- **Demo switch:** the demo-panel toggle that triggers the edge case.
- **Copy:** follows [COPY.md](COPY.md).

---

## 1. First open and onboarding

People get into the app first. The passport, the family and permissions are asked for later, at the moment they're needed.

| Step | Happy path | Edge cases |
|---|---|---|
| Welcome | "We'll take it from here." → **Start** | **Just track a flight** opens a guest mode without an account. The traveller is asked to sign in only when they try to book, and lands back where they were. **Invite link:** the invite preview comes first. |
| Sign in | Apple, Google, or phone number | **Apple:** share or hide the email. **Cancelled:** nothing shared. **Apple or Google:** a mobile number is still needed for alerts. |
| Phone number | +966 and 9 digits starting with 5 | A short, long or wrong-prefix number gets an inline explanation. **Offline:** the code is not sent. **Existing account** (demo: 50 000 4127): "Welcome back", everything restored. |
| Code | 6 digits (demo code `123456`) | **Wrong code:** "2 tries left". **After 3 wrong codes:** locked. **Resend** after 30 s. |
| Name | "What should we call you?" → straight into Today | **Skip:** fine, no name. Apple and Google prefill it. |

**Asked later, in context**

| What | When | Where |
|---|---|---|
| Passport | Today shows "Add your passport". At payment, missing passports show a gentle note: book now, add them within 48 hours. | The same scan screen (photo reading, demo passport, by hand, expired warning). |
| Family | Today's "Add your family", or "Someone else" when choosing who's going. | Account → Household. |
| Alerts | After the first booking ("Want gate changes on this phone?") or when tracking a flight. | — |
| Location | On the first travel day, for leave times. | — |

## 2. Booking a flight (and the whole trip)

| Step | Happy path | Edge cases |
|---|---|---|
| Ask | A shortcut, "Where to?", a chip, or the sun button | **Signed out (guest):** a sign-in sheet opens first. **Offline:** Ask explains that searching needs a connection, while saved trips still work. |
| Missing details | One question at a time, as chips: where, when, who | **Unknown request:** it goes to Faisal as a general request. |
| Search | Mada shows its work, then 3 options | **No flights** (demo switch): explains why, offers ±2 days or one stop. **Supplier not answering** (demo switch): Faisal searches by hand, and the request appears in Trips → Requests. |
| Choose | Best fit is preselected. Tap a card for fare rules (bags, change fee, refund). | — |
| Entry check | Each traveller's passport is checked against the destination | **Passport problem** (demo switch): Ahmed's passport expires too soon. Options: **remove Ahmed**, or **ask Faisal to book a renewal first**. Booking stays blocked until it is resolved. |
| Add the stay | Connecting rooms near Galata, plus pickup, in one tap | Can be added or removed. The total updates live. |
| Pay sheet | Lines, all-in total, cancellation rule, card, slide to book | **Edit travellers:** the price recalculates. **Change card:** saved cards, or add a new one. **Instalments:** Tabby (4 payments) or Tamara (3); the slide label shows the instalment. **Price hold:** a timer, and when it ends the price must be re-checked. **Offline at payment:** nothing is charged. **Card declined** (demo switch): nothing is charged, use another card. **Price rose** (demo switch): the new price must be accepted, or the traveller can pick again. |
| With Faisal | Live steps, then **confirmed** | **Faisal needs an answer** (demo switch): a name-on-ticket question, answered in one tap. |
| After | The trip appears in Trips and on Today, tickets go to the Wallet, the flight goes on the radar | — |

## 3. Hotels only

**Path:** Ask "a hotel in Istanbul" → 3 stays → choose rooms → the same pay sheet and the same confirmation.

**Edge cases:** the same as flights (offline, declined, price rose, hold timer).

## 4. Requests an agent completes

Visa, Umrah, car, restaurant, things to do, and anything else.

| Step | Happy path | Edge cases |
|---|---|---|
| Details | Chips: which country or service, who is going, when | **Umrah:** a note that every traveller needs their own Nusuk permit. **Helper on a visa:** asks for the iqama. |
| Send | "Sent to Faisal", and the request appears in Trips → Requests | **Offline:** it is saved and sends when the connection is back. |
| Progress | Sent → reviewing → quote or appointment → pay → done | **Faisal asks a question:** the traveller answers inside the request. |

## 5. Trips

| Flow | Edge cases |
|---|---|
| **Upcoming / Requests / Past** | Empty state for each tab |
| **Trip detail:** timeline of flight, stay, pickup and return | — |
| **Change a flight** | The fare difference is shown before confirming. Faisal confirms. |
| **Cancel the stay** | The refund amount and rule are shown in a sheet. A cancellation inside the paid window shows the fee. After cancelling, a **refund tracker** shows Requested → Approved → Sent to card. |
| **Past trip** | Its stamp, and "Same again" |

## 6. Travel day and disruption

The demo panel can jump to any of these moments.

| Moment | What happens | Edge cases |
|---|---|---|
| Weeks before | Readiness ring, next-move cards (eSIM, dinner) | A missing document lowers the ring and shows how to fix it |
| Day before | Evening digest: pickup, check-in done, seats, weather | — |
| Travel day | Leave countdown, flight card, driver, weather. The gate changes a few seconds in (B12 → C4) with a banner. | **Offline:** the banner shows the last known status and its time |
| Delay predicted | The status changes, then **See the plan**. Options: an earlier flynas flight, or stay | Choose either. Faisal confirms. Today updates. |
| Cancelled | "Saudia cancelled SV263". Options: the next flight, or **refund instead** | The refund path opens the refund tracker |
| In the air | Offline pack: arrival steps, hotel address for the taxi | — |
| Landed | Carousel, driver at the door, eSIM | — |
| Back home | Recap, "Same hotel next time?", new passport stamp | — |

## 7. Wallet

| Flow | Edge cases |
|---|---|
| **Unlock with Face ID** | **Face ID fails** (demo switch): "Use passcode" |
| **Household:** passport card per person, validity check against the next trip | No trip yet: shows the plain expiry instead |
| **Add a document:** scan or upload, choose its type | The scan can fail, as in onboarding |
| **Boarding passes** | Shown only after check-in opens. Before that: "Opens at check-in". |

## 8. Circles

| Flow | Edge cases |
|---|---|
| **Who's around:** off by default; choose who can see you | Turning it on asks who can see you. It turns off automatically when you fly home. |
| **Friend nearby:** Say hello / Not now / ⋯ | ⋯ → **hide this person** or **report**. A report is reviewed by a person within 24 hours. |
| **Groups:** open a group, vote, book with Faisal, pay my share | — |
| **Invite:** copy an invite link | Clipboard refused: the link is shown so it can be selected by hand |

## 8b. Discover and curated trips

| Flow | Edge cases |
|---|---|
| **Discover:** your city or your trip's city. Shows what's on this week, trips we've planned, and tips from people (friends first). | **No tips yet:** empty state, with a prompt to post one. |
| **Post a tip:** place, tip, type, optional photo, who sees it (friends or everyone) | **Photo with people in it:** you must confirm they agreed before it can post. Every tip is checked before it shows. |
| **Planned trip** (e.g. "Two days in AlUla"): a day-by-day timeline. Save it, change something, or book it all. Booking goes through the same pay sheet and confirmation by Faisal. | **Change something:** opens Ask with the plan already filled in. |

## 8c. Uploading documents and bookings

| Flow | Edge cases |
|---|---|
| **Wallet → Add:** pick the type, then **scan with the camera** or **upload a photo or PDF**. The fields read from it are shown back before saving. | **Wrong file type:** explained. **Over 10 MB:** explained. **Can't read it** (demo switch): tips, then try again. **Something's wrong:** back to the start. |
| **Trips → "Booked somewhere else?":** forward the email, or upload the booking PDF. Mada then tracks the flight. | Same checks as uploading a document. |

## 9. Profile and settings

| Flow | Edge cases |
|---|---|
| **Notifications:** Quiet or Everything | — |
| **Payment methods:** add, remove, choose the default | Removing the default asks which card becomes the new default |
| **Your data:** download everything | — |
| **Delete account** | Confirmed in a sheet. Bookings already made stay with the airline and hotel. Afterwards the app returns to the welcome screen. |
| **Sign out** | Returns to the welcome screen |

## 10. Everywhere

- **Offline banner:** "You're offline. Everything for your trips is on this phone."
- **Toasts and lock-screen-style banners** for events: gate change, driver arrived, refund sent.
- **Haptics:** vibration on Android browsers only in the prototype. The real app uses native patterns ([EXPERIENCE.md §4.6](EXPERIENCE.md)).
