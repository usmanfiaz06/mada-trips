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
  'auth.code.resendIn': 'New code in 0:{seconds}',

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

  // ───────────── errors from the Core API ─────────────
  'auth.error.phoneRequired': 'Verify your phone number to book. It takes a minute.',
  'auth.error.identityTaken': 'That sign-in is already on another account.',
  'auth.error.signInAgain': 'Please sign in again to carry on.',
} as const;
