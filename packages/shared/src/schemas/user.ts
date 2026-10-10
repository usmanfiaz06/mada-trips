import { z } from 'zod';
import { AuthTokens } from './auth';
import { Id, IsoDateTime, Locale, PhoneE164 } from './common';

/** Quiet or Everything (SCOPE.md §7). */
export const AlertsLevel = z.enum(['quiet', 'everything']);
/** What the traveller said on the alerts pre-prompt. 'unknown' until they've seen it. */
export const NotificationsChoice = z.enum(['allowed', 'declined', 'unknown']);

export const User = z.object({
  id: Id,
  /** What we call them: a first name, or empty if they skipped. */
  name: z.string(),
  phone: PhoneE164.nullable(),
  email: z.email().nullable(),
  /** Apple's private relay address. */
  emailRelay: z.boolean(),
  locale: Locale,
  alerts: AlertsLevel,
  notifications: NotificationsChoice,
  /** Ways in. `email` (a code by email, through Supabase Auth) is absent from older servers. */
  methods: z.object({ apple: z.boolean(), google: z.boolean(), phone: z.boolean(), email: z.boolean().optional() }),
  /** The email was proven (a code, or Apple/Google said so). Absent from older servers. */
  emailVerified: z.boolean().optional(),
  /** Set once the traveller has finished onboarding (name and alerts asked). */
  onboardedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

export const UpdateMeRequest = z
  .object({
    name: z.string().trim().max(30),
    locale: Locale,
    alerts: AlertsLevel,
    notifications: NotificationsChoice,
    onboarded: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** What every successful sign-in returns. `isNew` tells the app whether to ask for a name, or say welcome back. */
export const SignInResponse = z.object({ tokens: AuthTokens, user: User, isNew: z.boolean() });
export type SignInResponse = z.infer<typeof SignInResponse>;

export const MeResponse = z.object({ user: User });
export type MeResponse = z.infer<typeof MeResponse>;
