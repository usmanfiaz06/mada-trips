import { create } from 'zustand';

/** What the onboarding screens share while the traveller moves through them. Nothing here is persisted. */
type Onboarding = {
  phone: string;
  /** Signed in with Apple or Google first: the phone step then adds a number to that account. */
  social: 'apple' | 'google' | null;
  /** Prefilled from Apple/Google. */
  suggestedName: string;
  returning: { name: string } | null;
  set: (p: Partial<Omit<Onboarding, 'set' | 'reset'>>) => void;
  reset: () => void;
};

export const useOnboarding = create<Onboarding>((set) => ({
  phone: '',
  social: null,
  suggestedName: '',
  returning: null,
  set: (p) => set(p),
  reset: () => set({ phone: '', social: null, suggestedName: '', returning: null }),
}));
