import type { SavedCard } from './wallet';

/*
 * One money truth for saved cards: Wallet › Cards, Profile › Paying, the pay sheet and the refund line all name a
 * card the same way (cardLabel in booking-logic), and the same card saved twice (paid with it again, "save"
 * ticked) is still one card.
 */

/** The same physical card: brand, last four and expiry match. */
export const cardKey = (c: { brand: string; last4: string; exp: string }) => `${c.brand}:${c.last4}:${c.exp}`;

/** One per card, in the order first saved; the default's row wins when a card was saved more than once. */
export function uniqueCards<C extends Pick<SavedCard, 'id' | 'last4' | 'exp'> & { brand: string }>(cards: C[], defaultId?: string | null): C[] {
  const kept = new Map<string, C>();
  for (const c of cards) {
    const k = cardKey(c);
    const had = kept.get(k);
    if (!had || c.id === defaultId) kept.set(k, c);
  }
  return [...kept.values()];
}
