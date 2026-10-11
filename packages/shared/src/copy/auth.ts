/*
 * Sign-in: Apple, Google, email code and phone code (identity through Supabase Auth, see docs/app/AUTH.md), the
 * "Verify your phone" step for accounts that started with Apple, Google or email, and Profile › Sign-in methods.
 * Spread into the catalogue in en.ts; held to the same COPY.md lint. Arabic: auth.ar.ts (same keys).
 */
export const authCopy = {
  // ───────────── sign-in choices ─────────────
  'auth.signin.email': 'Continue with email',
  'auth.signin.phone': 'Continue with phone number',
  'auth.signin.busy': 'Signing you in',
  'auth.signin.cancelled': 'Sign-in cancelled. Nothing was shared.',
  'auth.signin.unavailable': 'That way in isn’t ready on this phone. Use your email or phone number instead.',

  // ───────────── email code ─────────────
  'auth.email.title': 'Your email',
  'auth.email.body': 'We’ll email a 6-digit code. No password to remember.',
  'auth.email.label': 'Email address',
  'auth.email.placeholder': 'you@example.com',
  'auth.email.problem': 'That address looks incomplete. It needs an @ and a domain.',
  'auth.email.send': 'Email me a code',
  'auth.email.codeTitle': 'Check your email',
  'auth.email.sentTo': 'Sent to {email}.',
  'auth.email.change': 'Change email',
  'auth.email.demo': 'Demo code: 123456',

  // ───────────── codes (phone and email) ─────────────
  'auth.code.wrong': 'That code doesn’t match. Check the latest one we sent.',
  'auth.code.expired': 'That code has expired. Get a new one to carry on.',
  'auth.code.wait': 'You can ask for a new code in {seconds} seconds.',
  'auth.code.tooMany': 'Too many codes for now. Try again in an hour, or talk to Mada.',
  'auth.code.resendIn': 'New code in {time}',

  // ───────────── verify your phone ─────────────
  'auth.verifyPhone.title': 'Verify your phone',
  'auth.verifyPhone.body': 'You’re signed in with {provider}. Before your first booking we need a mobile number that’s with you, for gate changes and Faisal’s messages.',
  'auth.verifyPhone.bodyPlain': 'Before your first booking we need a mobile number that’s with you, for gate changes and Faisal’s messages.',
  'auth.verifyPhone.later': 'Later',
  'auth.verifyPhone.done': 'Your number is verified.',
  'auth.verifyPhone.needed': 'Verify your phone to book.',
  'auth.verifyPhone.neededBody': 'Saudi airlines and our desk need a number that reaches you. It takes a minute.',
  'auth.verifyPhone.go': 'Verify my phone',
  'auth.verifyPhone.row': 'Verify your phone',
  'auth.verifyPhone.rowSub': 'Needed before your first booking',
  'auth.provider.apple': 'Apple',
  'auth.provider.google': 'Google',
  'auth.provider.email': 'your email',

  // ───────────── sign-in methods (Profile) ─────────────
  'auth.methods.email': 'Email',
  'auth.methods.emailSub': 'A code by email',
  'auth.methods.addEmail': 'Add your email as a way in?',
  'auth.methods.addEmailBody': 'We’ll email a code to check it’s yours.',
  'auth.methods.addPhoneBody': 'We’ll text a code to check it’s yours.',
  'auth.methods.addEmailGo': 'Add my email',
  'auth.methods.addPhoneGo': 'Add my number',
  'auth.methods.emailManage': 'You can sign in with a code sent to {email}.',
  'auth.methods.phoneKept': 'Your number stays. It’s how Faisal reaches you on a trip.',
  'auth.methods.changePhone': 'Use a different number',
  'auth.methods.changeEmail': 'Use a different email',
  'auth.methods.confirmFirst': 'Sign in again to change this.',
  'auth.methods.confirmFirstBody': 'For your safety, we check it’s you before adding a way in. Sign out, then sign back in the usual way.',
  'auth.methods.taken': 'That {name} account is already on another Mada account.',
  'auth.methods.emailAdded': 'Email added. You can sign in with it now.',

  // ───────────── didn't get the code? (every code screen) ─────────────
  'auth.help.link': 'Didn’t get the code?',
  'auth.help.title': 'Didn’t get the code?',
  'auth.help.body': 'Codes can take a minute to arrive. Here’s what else you can do.',
  'auth.help.resend': 'Send a new code',
  'auth.help.resendIn': 'Send a new code in {time}',
  'auth.help.spamTitle': 'Check your spam or junk folder',
  'auth.help.spamBody': 'It comes from Mada Trips, {address}.',
  'auth.help.changePhone': 'Wrong number? Change it',
  'auth.help.changeEmail': 'Wrong email? Change it',
  'auth.help.otherWay': 'Try another way',
  'auth.help.useEmail': 'Get a code by email',
  'auth.help.usePhone': 'Get a code by text',
  'auth.help.lost': 'I can’t use this number or email any more',
  'auth.help.lostSub': 'We’ll check it’s you and move your account.',
  'auth.code.resentTo': 'New code sent to {contact}.',
  'auth.email.openMail': 'Open Mail',

  // ───────────── a short pause after too many wrong codes ─────────────
  'auth.pause.title': 'Let’s take a short pause.',
  'auth.pause.body': 'There were a lot of tries in a row, so we’ve paused codes for a moment. It keeps your account safe. Nothing is locked.',
  'auth.pause.wait': 'You can try again in',
  'auth.pause.ready': 'Ready when you are',
  'auth.pause.call': 'Call Mada',

  // ───────────── the way in this phone used last time ─────────────
  'auth.signin.continueAs': 'Continue as {contact}',
  'auth.signin.another': 'Use another way',
  'auth.signin.last': 'You used this last time on this phone.',

  // ───────────── account recovery (signed out) ─────────────
  'recover.title': 'Can’t use your old number or email?',
  'recover.body': 'Tell us who you are and how to reach you now. A person at Mada checks it’s you, then moves your account.',
  'recover.name': 'Your full name',
  'recover.nameNeeded': 'Your name helps us find your account.',
  'recover.oldKind': 'You signed in with',
  'recover.newKind': 'How we can reach you now',
  'recover.kind.phone': 'Phone number',
  'recover.kind.email': 'Email',
  'recover.oldPhone': 'Your old number',
  'recover.oldEmail': 'Your old email',
  'recover.newPhone': 'Your new number',
  'recover.newEmail': 'Your new email',
  'recover.note': 'Anything that helps (optional)',
  'recover.notePlaceholder': 'For example, your last trip with us',
  'recover.same': 'The new one needs to be different from the old one.',
  'recover.privacy': 'We only use these details to check it’s you.',
  'recover.send': 'Send to Mada',
  'recover.tooMany': 'We’ve had a few of these from here today. Try again tomorrow, or call Mada.',
  'recover.sent.title': 'We have your request.',
  'recover.sent.body': 'A person at Mada will check it’s you, using the passport details on file and your last booking, then move your account. Usually within a day.',
  'recover.sent.reach': 'We’ll reach you at {contact}.',
  'recover.sent.done': 'Back to sign-in',
  // Sent by text or email to the new contact when the desk decides.
  'recover.done.subject': 'Your Mada account has moved',
  'recover.done.body': 'Mada: your account is now on this {kind}. Open Mada Trips and sign in with a code.',
  'recover.done.phone': 'number',
  'recover.done.email': 'email address',
  'recover.declined.subject': 'About your Mada account',
  'recover.declined.body': 'Mada: we couldn’t confirm it’s you, so your account stays as it was. Call us on {phone} and we’ll sort it out together.',

  // ───────────── errors from the Core API ─────────────
  'auth.error.phoneRequired': 'Verify your phone number to book. It takes a minute.',
  'auth.error.identityTaken': 'That sign-in is already on another account.',
  'auth.error.signInAgain': 'Please sign in again to carry on.',
} as const;
