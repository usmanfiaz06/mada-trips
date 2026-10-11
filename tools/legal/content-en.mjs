// English text for the app's legal and help pages on madatrips.sa (built by tools/legal/build.mjs).
// DRAFT for Saudi counsel: every page says so at the top. Facts here follow what the app and platform actually do
// (docs/app/store/PRIVACY-LABELS.md); change both together.

export const UPDATED = '11 October 2026';

const draft = 'Draft for legal review. This page describes what the Mada Trips app does today. It has not yet been approved by our lawyers and may change before the public launch.';

export const en = {
  lang: 'en',
  dir: 'ltr',
  draft,
  updatedLabel: 'Last updated',
  contents: 'On this page',
  eyebrow: 'Mada Trips app',
  pages: {
    privacy: {
      title: 'Privacy policy',
      description: 'How the Mada Trips app collects, uses, shares and protects your personal data, and the rights you have under Saudi Arabia’s Personal Data Protection Law.',
      lead: 'We keep only what we need to book and look after your trips, we never sell it, and you can download or delete it from the app at any time.',
      sections: [
        ['who', 'Who we are', `
<p>The Mada Trips app and madatrips.sa are run by <b>Mada Travel and Tourism</b> (“Mada”, “we”), a licensed travel agency in Riyadh, Kingdom of Saudi Arabia. We are the <b>controller</b> of the personal data described here under the Personal Data Protection Law (PDPL) and its Implementing Regulations.</p>
<p>Address: 7134 Prince Mohammed bin Saad bin Abdulaziz Rd, Hittin, Riyadh 13516.<br>Commercial registration: <span class="legal__todo">[CR number]</span>.<br>Privacy questions: <a href="mailto:privacy@madatrips.sa">privacy@madatrips.sa</a>.</p>`],
        ['what', 'What we collect', `
<table class="legal__table">
<thead><tr><th>What</th><th>Examples</th><th>Where it comes from</th></tr></thead>
<tbody>
<tr><td>Account</td><td>Your name, mobile number, email address, the way you sign in (code, Apple or Google), language</td><td>You, Apple or Google when you sign in with them</td></tr>
<tr><td>Household</td><td>Names, dates of birth and relationship of the people you travel with</td><td>You</td></tr>
<tr><td>Passports and IDs</td><td>Passport or ID number, nationality, dates of birth, issue and expiry, names as printed; photos or PDFs of documents you choose to add</td><td>You. Passport scanning reads the page on your phone; nothing is sent until you check the details.</td></tr>
<tr><td>Trips and bookings</td><td>Flights, hotels, transfers and requests, booking references, fare rules, receipts and refunds</td><td>You, our agents, airlines, hotels and suppliers</td></tr>
<tr><td>Payments</td><td>Amounts, the card’s brand and last four digits, payment status</td><td>Our payment provider. Full card numbers go straight to the provider and never reach Mada.</td></tr>
<tr><td>Preferences</td><td>Seat and meal preferences, loyalty programme numbers, alert settings</td><td>You</td></tr>
<tr><td>Messages</td><td>Your chats with Mada’s agents, and posts, photos and messages you share in Circles</td><td>You and the people you chat with</td></tr>
<tr><td>Contacts (only if you allow it)</td><td>Phone numbers from your address book, turned into one-way codes on your phone to show who is already on Mada</td><td>Your phone. We compare the codes and keep none of them.</td></tr>
<tr><td>Device and security</td><td>Phone model and system version, app version, push notification token, signed-in devices, a scrambled (hashed) network address for security</td><td>Your phone</td></tr>
<tr><td>Crash reports</td><td>What went wrong, the screen and the app version. Names, numbers, passport fields and message text are removed on the phone before a report is sent.</td><td>Your phone</td></tr>
</tbody></table>
<p>We do <b>not</b> collect your location today. If we add travel-day features that need it (for example, timing your drive to the airport), the app will ask first and you can say no. We do not use advertising identifiers and we do not track you across other companies’ apps or websites.</p>`],
        ['why', 'Why we use it', `
<table class="legal__table">
<thead><tr><th>Purpose</th><th>Legal basis under the PDPL</th></tr></thead>
<tbody>
<tr><td>Creating your account and signing you in</td><td>Performing our agreement with you</td></tr>
<tr><td>Booking flights, hotels, transfers and visas for you and your household, and changing or refunding them</td><td>Performing our agreement with you</td></tr>
<tr><td>Taking payment and issuing tax invoices</td><td>Performing our agreement; legal obligation (VAT and ZATCA e-invoicing)</td></tr>
<tr><td>Alerts about your trips: gate changes, delays, documents expiring</td><td>Performing our agreement; you can turn alerts off</td></tr>
<tr><td>Answering your messages and helping when something goes wrong</td><td>Performing our agreement</td></tr>
<tr><td>Keeping accounts and payments safe, preventing fraud, keeping audit records</td><td>Legitimate interest; legal obligation</td></tr>
<tr><td>Fixing crashes and slow screens</td><td>Legitimate interest</td></tr>
<tr><td>Product analytics and marketing messages</td><td>Your consent only, from Profile › Privacy. Both are off unless you turn them on.</td></tr>
</tbody></table>
<p>Some requests you type are read by an automated service to understand what you want (for example “Istanbul for four in March”) so an agent can act on it. People at Mada confirm every booking; no decision with legal or similar effect is made about you by software alone.</p>`],
        ['share', 'Who we share it with', `
<p>We never sell personal data. We share it only to provide the service:</p>
<ul>
<li><b>Airlines, hotels, transfer companies, insurers and embassies</b> we book with for you: the names, passport details and contact details each booking needs.</li>
<li><b>People you choose</b>: members of a Circle see what you post there; household members you add see shared trips.</li>
<li><b>Authorities</b>, when Saudi law requires it.</li>
<li><b>Service providers (processors)</b> who work for us under contract and only on our instructions:</li>
</ul>
<table class="legal__table">
<thead><tr><th>Provider</th><th>What they do for us</th><th>Where the data is</th></tr></thead>
<tbody>
<tr><td>Supabase</td><td>Database hosting and sign-in (identity: phone and email only)</td><td>South Korea (Seoul) today</td></tr>
<tr><td>Vercel</td><td>Runs our servers and this website</td><td>Global network; data passes through its servers</td></tr>
<tr><td>Zoho (ZeptoMail and CPaaS)</td><td>Sends emails and WhatsApp sign-in codes</td><td>Zoho’s data centres (India, European Union or United States)</td></tr>
<tr><td>Unifonic or Taqnyat</td><td>Sends text-message sign-in codes</td><td>Saudi Arabia</td></tr>
<tr><td>Sentry</td><td>Crash reports, with personal details removed</td><td>United States or European Union</td></tr>
<tr><td>Expo, Apple and Google</td><td>Deliver push notifications</td><td>United States</td></tr>
<tr><td>MyFatoorah <span class="legal__todo">[confirm payment provider]</span></td><td>Takes card, mada, Apple Pay and Google Pay payments</td><td>Kuwait and Saudi Arabia</td></tr>
<tr><td>Anthropic</td><td>Helps understand typed travel requests and draft short answers. Passport numbers are never sent.</td><td>United States</td></tr>
<tr><td>Flight data providers (FlightAware, adsb.lol)</td><td>Flight status and positions. They receive flight numbers and dates, not who is travelling.</td><td>United States</td></tr>
</tbody></table>`],
        ['transfer', 'Data stored outside Saudi Arabia', `
<p>Today our main database is hosted in South Korea and some providers above are in other countries. Transfers outside the Kingdom are made under the PDPL’s rules on cross-border transfers: only what each provider needs, under contracts that require protection at least equal to Saudi law, and recorded in our transfer assessment. Passport numbers are encrypted before they are stored, with keys we hold. We plan to move the database to a Saudi region as one becomes available to us. <span class="legal__todo">[Counsel: confirm the transfer basis under the Implementing Regulations and the SDAIA transfer rules, and whether consent is needed.]</span></p>`],
        ['keep', 'How long we keep it', `
<table class="legal__table">
<thead><tr><th>Data</th><th>How long</th></tr></thead>
<tbody>
<tr><td>Your account, household, passports and preferences</td><td>While you have an account. When you delete it, after a 30-day change-of-mind period.</td></tr>
<tr><td>Receipts, tax invoices and payment records</td><td>5 years, or longer if Saudi tax or commercial law requires <span class="legal__todo">[confirm period]</span></td></tr>
<tr><td>Booking records held by airlines and hotels</td><td>Under their own policies</td></tr>
<tr><td>Chats with our agents</td><td>While you have an account</td></tr>
<tr><td>Account recovery requests</td><td>90 days after we decide them</td></tr>
<tr><td>Security and audit records</td><td>Up to 2 years</td></tr>
<tr><td>Crash reports</td><td>90 days</td></tr>
<tr><td>Copies of your data you asked to download</td><td>The download link works for 7 days</td></tr>
</tbody></table>`],
        ['rights', 'Your rights', `
<p>Under the PDPL you can:</p>
<ul>
<li><b>Know</b> what we hold and why (this page).</li>
<li><b>Get a copy</b>: in the app, Profile › Privacy › Download everything. We email a link within 24 hours.</li>
<li><b>Correct</b> your details: in the app, or ask us.</li>
<li><b>Delete</b> your account: in the app, Profile › Privacy › Delete my account. See <a href="/delete-account">Deleting your account</a>.</li>
<li><b>Withdraw consent</b> for analytics and marketing at any time in Profile › Privacy, and for contacts or notifications in your phone’s settings.</li>
<li><b>Complain</b> to the Saudi Data and AI Authority (SDAIA) if you think we have not handled your data properly. We would like the chance to put it right first: <a href="mailto:privacy@madatrips.sa">privacy@madatrips.sa</a>.</li>
</ul>
<p>We answer requests within 30 days, usually much sooner.</p>`],
        ['safe', 'How we protect it', `
<p>Everything travels over encrypted connections (HTTPS). Passport and ID numbers are encrypted in our database (AES-256-GCM) and shown in full only when needed. Only Mada staff working on your trips can see your bookings, and every access to documents and payments is recorded. Your sign-in is stored in your phone’s secure keychain, and you can lock the Wallet and the app with Face ID or a fingerprint.</p>
<p>If a breach puts your data at risk, we will tell you and SDAIA as the law requires.</p>`],
        ['children', 'Children', `
<p>You must be 18 or older to have a Mada Trips account. Parents and guardians can add children to their household so we can book for them; the account holder is responsible for having the right to share their details.</p>`],
        ['changes', 'Changes to this policy', `
<p>When we change this policy we update the date at the top, and for important changes we tell you in the app before they take effect.</p>`],
        ['contact', 'Contact', `
<p>Email <a href="mailto:privacy@madatrips.sa">privacy@madatrips.sa</a>, write to the address above, or talk to us in the app. See also our <a href="/terms">Terms of use</a> and <a href="/support">Support</a>.</p>`],
      ],
    },
    terms: {
      title: 'Terms of use',
      description: 'The terms for using the Mada Trips app: bookings, payment, changes and refunds, your account and Circles.',
      lead: 'Plain terms for a plain service: you tell us where you want to go, people at Mada book it, and you pay what we showed you.',
      sections: [
        ['who', 'Who we are', `
<p>The Mada Trips app (“the app”) is provided by <b>Mada Travel and Tourism</b>, a licensed travel agency in Riyadh, Kingdom of Saudi Arabia (commercial registration <span class="legal__todo">[CR number]</span>, tourism licence <span class="legal__todo">[licence number]</span>, IATA <span class="legal__todo">[IATA number]</span>). By creating an account you agree to these terms and to our <a href="/privacy">Privacy policy</a>.</p>`],
        ['account', 'Your account', `
<ul>
<li>You must be 18 or older and give true details. Names must match the passports you travel on.</li>
<li>Keep your phone and sign-in to yourself. You are responsible for bookings made from your account.</li>
<li>You may add your household and book for them only with their permission, or as their parent or guardian.</li>
<li>You can close your account at any time from Profile › Privacy.</li>
</ul>`],
        ['bookings', 'Bookings', `
<ul>
<li>When you confirm, we book with the airline, hotel or supplier in your name, acting as your travel agent. Their conditions of carriage and fare rules apply, and we show the key rules before you pay.</li>
<li>During the beta, flights are booked by our agents: you send a request, we reply with a quote, and the booking is made once you accept and pay.</li>
<li>A booking is confirmed only when we say so in the app and you have a booking reference.</li>
<li>You are responsible for passports, visas, health and entry rules for every country on your trip. We tell you what we know, but the final rules are the destination’s.</li>
</ul>`],
        ['payment', 'Prices and payment', `
<ul>
<li>Prices are in Saudi riyals and include VAT and every fee we know of.</li>
<li>If a price changes before we book, we ask you first. You never pay more than you agreed.</li>
<li>Card payments are handled by our payment provider. A payment may be authorised when you request and taken when the ticket is issued; if we can’t book, it is released.</li>
<li>We issue a tax invoice for every payment.</li>
</ul>`],
        ['changes', 'Changes, cancellations and refunds', `
<ul>
<li>Changes and refunds follow the supplier’s rules. We pass on the supplier’s fees and add none of our own for changes you make in the app.</li>
<li>Refunds go back to the way you paid. Card refunds usually arrive within 14 days of the supplier refunding us; we show progress in the app.</li>
<li>If a flight is cancelled or badly delayed, we help you rebook and claim what the airline owes under Saudi and international passenger rules.</li>
</ul>`],
        ['circles', 'Circles and messages', `
<ul>
<li>Be kind and lawful. Don’t post anything illegal in Saudi Arabia, abusive, misleading, or that you don’t have the right to share.</li>
<li>You keep the rights to what you post and give us permission to show it to the people you share it with.</li>
<li>You can report or block anyone. We may remove content or limit accounts that break these rules.</li>
</ul>`],
        ['app', 'The app', `
<ul>
<li>We work hard to keep the app available and accurate, but flight times, gates and other live information come from airlines and data providers and can change without notice.</li>
<li>Don’t misuse the app: no automated access, reverse engineering or attempts to reach other people’s data.</li>
<li>Some answers in the app are written with the help of automated tools. Prices and booking confirmations always come from suppliers and our agents.</li>
</ul>`],
        ['liability', 'Our responsibility', `
<p>We are responsible for booking what you asked for with care, as a travel agent. Airlines, hotels and other suppliers are responsible for the services they provide. Nothing in these terms limits rights you have under Saudi consumer protection law. <span class="legal__todo">[Counsel: liability cap and force majeure wording.]</span></p>`],
        ['law', 'Law and disputes', `
<p>These terms are governed by the laws of the Kingdom of Saudi Arabia. Talk to us first; most problems are solved in a day. If not, disputes go to the competent courts in Riyadh.</p>`],
        ['contact', 'Changes and contact', `
<p>We may update these terms; we will tell you in the app before important changes take effect. Questions: <a href="mailto:support@madatrips.sa">support@madatrips.sa</a> or <a href="/support">Support</a>.</p>`],
      ],
    },
    support: {
      title: 'Support',
      description: 'Get help with the Mada Trips app: chat with our 24/7 desk in the app, email or call us.',
      lead: 'Real people at Mada answer, day and night.',
      sections: [
        ['app', 'In the app (fastest)', `
<p>Open Mada Trips and tap <b>Talk to Mada</b> on Today, or Profile › Help. Our desk answers around the clock, and the agent can see your trip, so you don’t have to explain twice.</p>`],
        ['contact', 'Other ways to reach us', `
<ul>
<li>Email: <a href="mailto:support@madatrips.sa">support@madatrips.sa</a>. We reply within one working day.</li>
<li>Phone: <a href="tel:+966566682662">+966 56 668 2662</a>, for anything urgent while you travel.</li>
<li>WhatsApp: coming soon.</li>
</ul>`],
        ['common', 'Common questions', `
<p><b>I didn’t get my code.</b> Wait a minute and tap <i>Didn’t get the code?</i> on the code screen to send a new one, check your spam folder for email codes, or sign in another way. If you can’t use your number or email any more, choose <i>I can’t use this number or email any more</i> there and we’ll move your account after checking it’s you.</p>
<p><b>Where is my booking?</b> Confirmed bookings are in Trips, with the booking reference. Requests waiting for an agent show their status on Today.</p>
<p><b>How do I change or cancel?</b> Open the trip and choose Change or Cancel, or message us. We show any supplier fees before anything is changed.</p>
<p><b>When will my refund arrive?</b> Refunds show their progress in the trip and usually reach your card within 14 days of the supplier refunding us.</p>
<p><b>How do I get a copy of my data or delete my account?</b> Profile › Privacy. See <a href="/delete-account">Deleting your account</a>.</p>`],
        ['legal', 'Policies', `
<p><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of use</a> · <a href="/delete-account">Deleting your account</a></p>`],
      ],
    },
    'delete-account': {
      title: 'Deleting your account',
      description: 'How to delete your Mada Trips account and data, what we delete, what we must keep, and how long it takes.',
      lead: 'You can delete your account from the app at any time. Here is how, and what happens next.',
      sections: [
        ['how', 'In the app', `
<ol>
<li>Open Mada Trips and go to <b>Profile › Privacy</b>.</li>
<li>Tap <b>Delete my account</b>.</li>
<li>Type DELETE to confirm and tap <b>Delete in 30 days</b>.</li>
</ol>
<p>Want a copy first? On the same screen, tap <b>Download everything</b> and we’ll email you a link within 24 hours.</p>`],
        ['noapp', 'Without the app', `
<p>If you can’t open the app, email <a href="mailto:privacy@madatrips.sa?subject=Delete%20my%20account">privacy@madatrips.sa</a> from the email address on your account, or message us from the phone number on it, with the subject “Delete my account”. We will check it’s you before deleting anything, and confirm within 3 working days.</p>`],
        ['what', 'What we delete', `
<p>After 30 days we delete your account, profile, household, passports and ID details, documents, preferences, saved cards (held by the payment provider), Circles posts and messages, chats, devices and your sign-in identity (phone, email, Apple or Google link). Until then you can change your mind: sign in and tap <b>Cancel deletion</b>.</p>`],
        ['keep', 'What we must keep', `
<ul>
<li><b>Receipts, tax invoices and payment records</b>: 5 years, because Saudi tax law asks us to <span class="legal__todo">[confirm period]</span>.</li>
<li><b>Bookings already made</b> stay with the airline and hotel under their own policies. Your trips still happen unless you cancel them.</li>
<li><b>Refunds in progress</b> still reach your card.</li>
<li><b>Security and audit records</b> without your details beyond an account number, for up to 2 years.</li>
</ul>`],
        ['more', 'More', `
<p>See our <a href="/privacy">Privacy policy</a> or <a href="/support">contact Support</a>.</p>`],
      ],
    },
  },
};
