/*
 * Mock mode: the server's beta switches (platform/src/lib/app/switches.ts and limits.ts), so the app's beta paths can
 * be shown and tested without a server. Set once from the page address and kept for the session:
 *
 *   ?beta=flights      flights go by request to the desk (GET /config features.flightsByRequest)
 *   ?beta=nophone      booking doesn't need a verified phone (features.bookingNeedsPhone off): a contact number instead
 *   ?beta=limited      the desk paused Circles for this account (ACCOUNT_LIMITED, GET /circles `limited`)
 *   ?beta=flights,nophone,limited   any together; ?beta=off clears them
 */
export type MockBeta = { flightsByRequest: boolean; bookingNeedsPhone: boolean; limited: boolean };

const KEY = 'mada.mockBeta';
const fromList = (raw: string): MockBeta => {
  const on = new Set(raw.split(',').map((s) => s.trim()));
  return { flightsByRequest: on.has('flights'), bookingNeedsPhone: !on.has('nophone'), limited: on.has('limited') };
};

let cached: MockBeta | null = null;

export function mockBeta(): MockBeta {
  if (cached) return cached;
  let raw = '';
  try {
    const g = globalThis as { location?: { search?: string }; sessionStorage?: Storage };
    const fromUrl = new URLSearchParams(g.location?.search ?? '').get('beta');
    if (fromUrl !== null) { raw = fromUrl === 'off' ? '' : fromUrl; g.sessionStorage?.setItem(KEY, raw); }
    else raw = g.sessionStorage?.getItem(KEY) ?? '';
  } catch { /* no storage: defaults */ }
  cached = fromList(raw);
  return cached;
}

/** Tests: set the switches directly. */
export function setMockBeta(b: Partial<MockBeta>) { cached = { ...mockBeta(), ...b }; }
