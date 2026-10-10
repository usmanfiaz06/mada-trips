/**
 * The English string catalogue. Every word here is held to COPY.md; most are lifted verbatim from the prototype.
 * Keys are `area.thing`. `{name}` placeholders are filled by `t()`. Plurals use `.one` / `.other` keys.
 *
 * Engineers don't write user-facing words (COPY.md §9): a new string goes in with the writer's wording,
 * and `test/copy.test.ts` fails the build on banned words, exclamation marks, em dashes, emoji,
 * notification length limits and unfilled placeholders.
 */
import { walletCopy } from './wallet';
import { enCircles } from './en-circles';
import { bookingCopy } from './booking';
import { deskCopy } from './desk';
import { enTrips } from './en-trips';
import { resilienceCopy } from './resilience';
import { placesCopy } from './places';

export const en = {
  // Wallet, passports, account, Help and support (M1): packages/shared/src/copy/wallet.ts
  ...walletCopy,
  // Circles, Discover and people (M4): packages/shared/src/copy/en-circles.ts
  ...enCircles,
  // Booking: Ask, search, requests, plans, the order sheet, payment and the wait (M2): packages/shared/src/copy/booking.ts
  ...bookingCopy,
  // The agent desk in Mada Ops, what it sends to travellers: packages/shared/src/copy/desk.ts
  ...deskCopy,
  // Trip companion (M3)
  ...enTrips,
  // When things go wrong: offline, slow, busy, maintenance, updates, crashes (FLOWS.md §12): packages/shared/src/copy/resilience.ts
  ...resilienceCopy,
  // Places: worldwide city search, city pages, Plan it with Mada: packages/shared/src/copy/places.ts
  ...placesCopy,
  // ───────────── common ─────────────
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.skip': 'Skip',
  'common.later': 'Later',
  'common.notNow': 'Not now',
  'common.okay': 'Okay',
  'common.continue': 'Continue',
  'common.tryAgain': 'Try again',
  'common.offline.banner': "You're offline. Everything for your trips is on this phone.",
  'common.agentName': 'Faisal',
  /* Mada vs Faisal (COPY.md §1): actions say Mada; the person appears as presence or as the one who acted. */
  'action.talk': 'Talk to Mada',
  'action.ask': 'Ask Mada',
  'action.send': 'Send to Mada',
  'action.call': 'Call Mada',
  'presence.title': 'Mada',
  'presence.online': '{agent} is online',
  'presence.typing': '{agent} is typing…',
  'presence.replies': 'Usually replies in {minutes} min',
  'presence.covering': '{agent} is covering for {usual} tonight. {pronoun} has your whole trip.',
  'presence.away': 'Replies within 10 minutes, any hour',
  'presence.offline': 'You’re offline. {agent} sees your messages when you’re back',
  'actor.confirmed': 'Confirmed by {agent} at Mada',
  'actor.replied': '{agent} replied',
  'actor.intro': '{agent}, your Mada agent',
  'notify.sender': 'Mada',

  // ───────────── tabs ─────────────
  'tabs.today': 'Today',
  'tabs.trips': 'Trips',
  'tabs.ask': 'Ask Mada',
  'tabs.circles': 'Circles',
  'tabs.wallet': 'Wallet',

  // ───────────── onboarding: welcome ─────────────
  'welcome.title': "We'll take it from here.",
  'welcome.body': "Tell us where you're going. We'll find it, book it, and stay with you until you're home.",
  'welcome.start': 'Start',
  'welcome.track': 'Just track a flight',
  'welcomeBack.titleNamed': 'Welcome back, {name}.',
  'welcomeBack.title': 'Welcome back.',
  'welcomeBack.line': 'Everything is where you left it.',
  'welcomeBack.open': 'Open Mada',
  'welcomeBack.notMe': 'That’s not me',

  // ───────────── onboarding: sign in ─────────────
  'signin.badge': 'Confirmed by Faisal at Mada',
  'signin.title': 'Sign in to book and keep your trips.',
  'signin.body': 'Your trips, documents and family stay on this phone and in your account.',
  'signin.apple': 'Continue with Apple',
  'signin.google': 'Continue with Google',
  'signin.phone': 'Use my phone number',
  'signin.note': 'Bookings stay private. We never sell your data.',
  'signin.sheet.title': 'Continue with {provider}?',
  'signin.sheet.shareEmail': 'Share my email',
  'signin.sheet.shareEmailSub': 'The email on your Apple ID',
  'signin.sheet.hideEmail': 'Hide my email',
  'signin.sheet.hideEmailSub': 'A private address that forwards to you',
  'signin.sheet.google': 'Google shares your name and email address. Nothing else.',
  'signin.cancelled': 'Sign-in cancelled. Nothing was shared.',
  'signin.offline.title': 'You’re offline.',
  'signin.offline.body': 'Signing in needs a connection. Your phone number works the same way once you’re back online.',

  // ───────────── onboarding: phone ─────────────
  'phone.title': 'Your mobile number',
  'phone.titleSocial': 'One more thing: your mobile',
  'phone.body': "We'll text a 6-digit code. Used for sign-in and urgent trip updates only.",
  'phone.bodySocial': 'You’re signed in with {provider}. Gate changes and Faisal’s messages come by SMS and WhatsApp, so we need a number that’s with you.',
  'phone.label': 'Mobile number',
  'phone.placeholder': '5X XXX XXXX',
  'phone.problem.prefix': 'Saudi mobile numbers start with 5 after +966.',
  'phone.problem.short': 'That number looks short. It needs 9 digits after +966 (you have {count}).',
  'phone.problem.long': 'That number looks long. It needs 9 digits after +966.',
  'phone.problem.empty': 'Your mobile number goes here. It starts with 5.',
  'phone.offline': "You're offline. We'll be able to send the code once you're connected.",
  'phone.send': 'Text me a code',
  'phone.demo': 'Demo: 50 000 4127 already has an account.',

  // ───────────── onboarding: code ─────────────
  'otp.title': 'Enter the code',
  'otp.sentTo': 'Sent to {phone}.',
  'otp.sentToFallback': 'Sent to your phone.',
  'otp.change': 'Change number',
  'otp.label': '6-digit code',
  'otp.wrong.one': "That code doesn't match. 1 try left.",
  'otp.wrong.other': "That code doesn't match. {count} tries left.",
  'otp.locked': 'Too many tries. Get a new code to carry on.',
  'otp.expired': 'That code has expired. Get a new one to carry on.',
  'otp.resendIn': 'New code in 0:{seconds}',
  'otp.resend': 'Send a new code',
  'otp.resent': 'New code sent.',
  'otp.demo': 'Demo code: 123456',

  // ───────────── onboarding: name ─────────────
  'name.title': 'What should we call you?',
  'name.body': 'Just a first name. Faisal uses it when he messages you.',
  'name.label': 'First name',
  'name.go': 'Let’s go',
  'name.goNamed': 'Let’s go, {name}',

  // ───────────── onboarding: alerts ─────────────
  'alerts.title': "We'll only interrupt you when it matters.",
  'alerts.body': 'Gate changes. Delays. The moment your driver arrives. Never offers.',
  'alerts.allow': 'Allow alerts',
  'alerts.later': 'Not now',
  'alerts.preview.day': 'Tuesday 9 March',
  'alerts.preview.time': '07:12',
  'alerts.preview.driver.body': 'Khalid is at your door in a grey Lexus.',
  'alerts.preview.leave.body': 'Traffic to King Khalid is building.',

  // ───────────── today ─────────────
  'today.nothing.title': 'Nowhere planned yet.',
  'today.eid.weeks': 'Eid is {count} weeks away.',
  'today.eid.days': 'Eid is {count} days away.',
  'today.eid.soon': 'Eid al-Fitr is coming.',
  'today.composer.title': 'Where to next?',
  'today.composer.body': "A place, a date, who's going. Any way you like.",
  'today.service.flight': 'Flights',
  'today.service.stay': 'Stays',
  'today.service.visa': 'Visas',
  'today.service.umrah': 'Umrah',
  'today.service.car': 'Cars',
  'today.service.food': 'Tables',
  'today.service.todo': 'Things to do',
  'today.passport.title': 'Add your passport',
  'today.passport.body': "One scan and we'll fill it in on every booking.",
  'today.tile.alula.title': 'AlUla',
  'today.tile.alula.body': 'Two days, planned for you. 1h 20m from Riyadh.',
  'today.tile.istanbul.title': 'Istanbul',
  'today.tile.istanbul.body': '4h 15m from Riyadh',
  'today.tile.family.title': 'Add your family',
  'today.tile.family.body': 'Book everyone at once',
  'today.a11y.notifications': 'Notifications',
  'today.a11y.profile': 'Profile and settings',

  // ───────────── trips ─────────────
  'trips.title': 'Trips',
  'trips.tab.upcoming': 'Upcoming',
  'trips.tab.requests': 'Requests',
  'trips.tab.past': 'Past',
  'trips.empty.title': 'Your name’s not on the board yet.',
  'trips.empty.body': 'Tap a city to see it, or tell us where. Faisal books it and stays with you until you’re home.',
  'trips.empty.action': 'Where to?',
  'trips.empty.board': 'Departures · {city}',
  'trips.ideas.title': 'Easy from here this winter',
  'trips.idea.istanbul.title': 'Istanbul',
  'trips.idea.istanbul.sub': '4h · cool and cosy',
  'trips.idea.alula.title': 'AlUla',
  'trips.idea.alula.sub': '1h 20 · stars and rock',
  'trips.idea.season.title': 'Riyadh Season',
  'trips.idea.season.sub': 'No flight needed',
  'trips.requests.idea.visa': 'A Schengen visa',
  'trips.requests.idea.table': 'A table for tonight',
  'trips.requests.idea.car': 'A car with a driver',
  'trips.requests.idea.umrah': 'Umrah in Ramadan',
  'trips.past.page': 'Visas · Stamps',
  'trips.past.first': 'Your first',
  'trips.requests.empty.title': 'Nothing waiting on Faisal.',
  'trips.requests.empty.body': 'Send him anything: a visa, a table tonight, a car for the day. It lands here and you watch it move.',
  'trips.requests.empty.action': 'Send Mada a request',
  'trips.past.empty.title': 'Every trip leaves a stamp.',
  'trips.past.empty.body': 'Your first one goes right there. Trips stay here with every receipt, so the next one takes a minute.',
  'trips.past.empty.action': 'Earn the first stamp',

  // ───────────── wallet ─────────────
  'wallet.title': 'Wallet',
  'wallet.locked': 'Locked with Face ID · works offline',
  'wallet.you': 'You',
  'wallet.passport.eyebrow': 'Passport',
  'wallet.passport.country': 'Kingdom of Saudi Arabia',
  'wallet.passport.notAdded': 'Not added yet',
  'wallet.passport.emptyTitle': 'Your passport isn’t here yet.',
  'wallet.passport.emptyBody': 'One scan, on this phone. We check it against every trip.',
  'wallet.passport.scan': 'Scan it now',
  'wallet.docs.eyebrow': 'Your other documents',
  'wallet.docs.emptyTitle': 'No other documents yet',
  'wallet.docs.emptyBody': 'A visa, a national ID or travel insurance. We’ll watch the dates.',
  'wallet.passes.eyebrow': 'For this trip',
  'wallet.passes.emptyTitle': 'No boarding passes yet',
  'wallet.passes.emptyBody': 'Tickets and vouchers land here the moment Faisal confirms a trip. They work offline.',
  'wallet.passes.plan': 'Plan a trip',

  // ───────────── circles ─────────────
  'circles.tab.discover': 'Discover',
  'circles.tab.circles': 'Circles',
  'circles.yours': 'Your circles',
  'circles.empty.title': 'Your people, in one place.',
  'circles.empty.body': 'Make a circle for the people you travel with. Plan together, vote on dates and split the costs.',
  'circles.empty.action': 'Make your first circle',
  'circles.idea.family': 'Family',
  'circles.idea.eid': 'Eid trip',
  'circles.idea.weekend': 'Weekend crew',
  'circles.idea.cousins': 'Cousins',
  'circles.friends': 'Friends',
  'circles.friends.emptyTitle': 'Bring your people.',
  'circles.friends.emptyBody': 'Add the friends you travel with. Only they see your trips and tips.',
  'circles.friends.add': 'Add friends',

  // ───────────── ask ─────────────
  'ask.placeholder': 'Where to?',
  'ask.placeholderTrip': 'Anything for {city}?',
  'ask.disclosure': 'Instant answers from Mada. A person at Mada confirms anything you book.',
  'ask.soon': 'Ask opens in the next build. Talk to Mada for anything in the meantime.',

  // ───────────── problems the server reports (COPY.md §5.6: calm, what happened, what we do) ─────────────
  'error.internal': 'That didn’t work, and it’s on us. Try once more, or talk to Mada.',
  'error.validation': 'A detail needs another look.',
  'error.unauthorized': 'Sign in to carry on.',
  'error.sessionExpired': 'Sign in again to carry on.',
  'error.forbidden': 'This belongs to another account.',
  'error.notFound': 'We can’t find that.',
  'error.rateLimited': 'Too many tries. Wait {seconds} seconds, then try again.',
  'error.otpRateLimited': 'That’s a lot of codes for one number. Try again in {minutes} min.',
  'error.otpCooldown': 'A code is on its way. You can ask for a new one in {seconds} seconds.',
  'error.phoneInvalid': 'That doesn’t look like a Saudi mobile number. It needs 9 digits after +966, starting with 5.',
  'error.phoneTaken': 'That number is on another account.',
  'error.notConfigured': 'This isn’t switched on yet. Talk to Mada and we’ll do it by hand.',
  'error.offline': 'You’re offline.',

  // ───────────── messages that leave the app ─────────────
  'sms.otp': '{code} is your Mada Trips code. It expires in 10 minutes. Never share it.',

  // Lock-screen notifications (COPY.md §5.8): title ≤ 32 characters, body ≤ 90.
  'notify.gateChange.title': 'Gate changed to {gate}',
  'notify.gateChange.body': "{flight} now boards from {gate}. It's a {minutes}-minute walk.",
  'notify.leave.title': 'Leave in {minutes} minutes',
  'notify.leave.body': 'Traffic to King Khalid is building. {drive} min drive.',
  'notify.driver.title': 'Your driver is here',
  'notify.driver.body': '{driver} is at {door} with your name on a sign.',
  'notify.confirmed.title': 'You’re going to {city}',
  'notify.confirmed.body': 'Confirmed by {agent}. Booking {ref}.',
  'notify.connectionRisk.title': 'Your connection is at risk',
  'notify.connectionRisk.body': "{flight} is {hours} hours late. We're holding two ways to get there.",
  'notify.refund.title': 'Refund sent',
  'notify.refund.body': '{amount} is on its way to your {card}.',
  'notify.digest.title': 'Tomorrow',
  'notify.digest.body': 'Pickup {pickup} · Check-in closes {checkin} · {temp}° in {city}',
} as const;

export type CopyKey = keyof typeof en;
