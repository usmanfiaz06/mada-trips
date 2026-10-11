# Supabase email templates

Paste each file into Supabase → Authentication → Emails → Templates. Every one shows the 6-digit code (`{{ .Token }}`), never a link. The logo loads from https://www.madatrips.sa/Assets/PNG/ (keep that file in place). Sans-serif only.

Email can't run a copy button (mail apps block scripts). Instead: the code is one selectable block (tap and hold to copy), and the subject starts with the code, so Gmail shows its own "Copy code" button and iPhones offer the code above the keyboard (AutoFill from Mail).

| Supabase template | File | Subject |
|---|---|---|
| Confirm sign up | `confirm-signup.html` | `{{ .Token }} is your Mada Trips code · رمزك في مادا` |
| Magic link or OTP | `magic-link.html` | `{{ .Token }} is your Mada Trips code · رمزك في مادا` |
| Change email address | `change-email.html` | `{{ .Token }} confirms your new email · أكّد بريدك الجديد` |
| Reset password | `reset-password.html` | `{{ .Token }} resets your Mada Trips password · إعادة تعيين كلمة المرور` |
