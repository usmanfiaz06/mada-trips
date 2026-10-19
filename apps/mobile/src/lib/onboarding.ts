import { create } from 'zustand';

/** What the onboarding screens share while the traveller moves through them. Nothing here is persisted. */
type Onboarding = {
  phone: string;
  email: string;
  /** Signed in with Apple or Google first: the phone step then adds a number to that account. */
  social: 'apple' | 'google' | null;
  /** How this sign-in started. */
  via: 'apple' | 'google' | 'email' | 'phone' | null;
  /** Prefilled from Apple/Google. */
  suggestedName: string;
  returning: { name: string } | null;
  /** Which welcome button brought them: "Get started" (new) or "I have an account" (back). Only the words change. */
  intent: 'new' | 'back' | null;
  /** Where Verify your phone goes when it's done (or skipped) during onboarding. */
  afterPhone: '/name' | '/welcome-back';
  set: (p: Partial<Omit<Onboarding, 'set' | 'reset'>>) => void;
  reset: () => void;
};

const initial = { phone: '', email: '', social: null, via: null, suggestedName: '', returning: null, intent: null, afterPhone: '/name' as const };

export const useOnboarding = create<Onboarding>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set(initial),
}));
