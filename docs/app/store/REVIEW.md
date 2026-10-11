# App Review: notes, demo account, ratings and compliance answers

Answers to paste into App Store Connect and Google Play Console for the first submission (TestFlight external testing and Play internal testing need most of these too). Listing text is in [LISTING.md](LISTING.md); privacy forms in [PRIVACY-LABELS.md](PRIVACY-LABELS.md).

## 1. The review sign-in (demo account)

Reviewers can't receive our sign-in codes, so the platform can let **one** contact sign in with a **fixed code**:

| Platform env (Vercel, production) | Value |
|---|---|
| `APP_REVIEW_LOGIN` | `review@madatrips.sa` (a real mailbox Mada owns). Optionally `review@madatrips.sa,+9665XXXXXXXX` for one account with both. |
| `APP_REVIEW_CODE` | six random digits, different from anything used before, e.g. from `openssl rand -hex 3 \| tr -dc 0-9 \| head -c 6` |
| `SUPABASE_SERVICE_ROLE_KEY` | already needed for account recovery; the review sign-in uses it too |

How it works (`platform/src/lib/app/review-login.ts`, `POST /api/app/v1/auth/review`):
- Off (404) unless both variables are set **and** Supabase is live. Never active in a mock build.
- The reviewer types the email, taps send (Supabase really emails the review mailbox, harmless), then types `APP_REVIEW_CODE`. Supabase says the code is wrong; the app then asks the Core API, which checks the contact and the code (constant time) and answers with a real Supabase session for that user. Everything after is the ordinary sign-in.
- Anyone else gets the normal "wrong code" answer and nothing is stored about them. Every success and every wrong code for the review contact is audited (`auth.review_login`, `auth.review_login_failed`); 20 wrong codes in an hour pause it.
- **After approval**, remove `APP_REVIEW_CODE` (or change it before the next submission).

Prepare the review account once, signed in on a test phone as the review email: add a household of two with test passports (use specimen data such as `UTOERIKSSON`, never a real person's), and a confirmed sample trip made by the desk so Trips, Today and the Wallet have something to show. The beta allows email-only accounts to book (`APP_BOOKING_REQUIRES_PHONE=no`).

### Review notes (App Store Connect › App Review Information › Notes)

```
Mada Trips is the app of Mada Travel and Tourism, a licensed travel agency in Riyadh. Travellers ask for a trip; Mada's human agents book it with airlines and hotels and confirm it in the app.

Sign in:
1. Tap "Start", then "Continue with email".
2. Email: review@madatrips.sa
3. Code: <APP_REVIEW_CODE>   (our sign-in codes are sent by email or text; this account accepts a fixed code for review)

The account has a household and a sample confirmed trip to Istanbul, so Today, Trips and Wallet show real content. Booking a new flight sends a request to our 24/7 agent desk; an agent replies with a quote in the app within minutes. You can stop at the payment step; no payment is needed to review.

Passport scanning: Wallet › Add a passport › Scan. You can use any passport specimen image; nothing is uploaded until you confirm the details.

Account deletion: Profile › Privacy › Delete my account.
Support: support@madatrips.sa, +966 56 668 2662.
```

Sign-in information fields: **User name** `review@madatrips.sa`, **Password** `<APP_REVIEW_CODE>` (explain "one-time code, fixed for review" in the notes). Contact: the owner's name, phone and email.

Google Play › App content › **App access**: "All or some functionality is restricted" → add the same instructions with the email and code.

## 2. Age rating

**Apple (age rating questionnaire, 2025 version):** every content question **None/No**: no violence, sexual content, profanity, horror, drugs, gambling, contests, medical information. **User-generated content: Yes** (Circles posts and chats between people who invited each other) with moderation: report, block, desk review. **Unrestricted web access: No. Messaging and chat: Yes. Advertising: No. Age assurance / parental controls: No.** Expected result **13+** (because of messaging and user content). Made for Kids: No.

**Google Play (IARC):** category *Travel / reference / utility*; violence, fear, sexuality, language, controlled substances, crude humour: No. Users can interact or exchange content: **Yes** (Circles, chat). Shares location with other users: **No**. Digital purchases: **No** (purchases are real-world travel). Expected: **Everyone / PEGI 3 / 3+** with "Users Interact". Target audience: **18 and over** (Play › Target audience and content); not designed for children.

## 3. Export compliance

`ios.config.usesNonExemptEncryption: false` is set in `app.json`, so builds skip the question. The answer, if asked:
- Uses encryption: **Yes**, but only exempt kinds: HTTPS/TLS through the operating system, the Keychain/Keystore, and AES-256-GCM for passport numbers on our server (standard algorithms, not proprietary). Qualifies for the exemption in Category 5 Part 2 (mass-market, authentication and data protection). **No export compliance documents and no CCATS needed.**
- France distribution: not affected (no proprietary cryptography).

## 4. Content rights and other declarations

- **Content rights (Apple):** "Does your app contain, show or access third-party content?" **Yes**: airline and hotel information from suppliers, city guides from Wikipedia and Wikivoyage (CC BY-SA, credited on every page), places from GeoNames (CC BY 4.0, credited), Wikimedia Commons photos with their licences and authors, flight positions from adsb.lol (ODbL, credited). Mada has the rights or the licence terms are met.
- **Sign in with Apple:** offered on iOS beside Google (Guideline 4.8).
- **Account deletion in the app** (5.1.1(v)): Profile › Privacy › Delete my account. Web: `https://madatrips.sa/delete-account`.
- **Payments (3.1.3(e) / Play Payments policy):** physical goods and services (flights, hotels) are paid with cards, Apple Pay and Google Pay through the payment provider, not in-app purchase. Correct for both stores.
- **User-generated content (1.2):** terms forbid objectionable content; report and block in every Circle and chat; the desk reviews reports within 24 hours.
- **Play: Financial features declaration:** none of the listed (no loans, crypto, banking). **Government apps:** No. **News app:** No. **Health:** No. **Ads:** the app contains no ads.
- **Play: Permissions declarations:** none of the sensitive ones are requested (no SMS, call log, location, all-files access, `QUERY_ALL_PACKAGES`); the doctor blocks them.
