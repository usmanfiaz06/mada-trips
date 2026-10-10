import { useEffect, useState } from 'react';

/*
 * The server's clock. Phones are often minutes out (set by hand, a dead battery, a time zone dance), and a countdown
 * to a hold expiring or check-in closing must not lie. Every Core API response carries X-Server-Time (ms); we keep
 * the offset, corrected by half the round trip, and smooth out jitter. `serverNow()` is Date.now() on our clock.
 */

let offset = 0;
let samples = 0;

/** Record one response's X-Server-Time. `sentAt`/`receivedAt` are the phone's clock around the request. */
export function noteServerTime(serverMs: number, sentAt: number, receivedAt: number) {
  if (!Number.isFinite(serverMs) || serverMs <= 0) return;
  const rtt = Math.max(0, receivedAt - sentAt);
  if (rtt > 10_000) return; // too slow to say anything precise
  const sample = serverMs + rtt / 2 - receivedAt;
  offset = samples === 0 ? sample : Math.round(offset * 0.75 + sample * 0.25);
  samples += 1;
}

/** Milliseconds the phone is behind (+) or ahead (−) of the server. */
export const clockOffset = () => offset;

/** Now, on the server's clock. Use for countdowns and "expires in"; not for "Updated 3 min ago" (both sides are ours). */
export const serverNow = () => Date.now() + offset;

/** Tests. */
export const resetClock = () => { offset = 0; samples = 0; };

/** Re-renders every `everyMs` with the server's now (countdowns). */
export function useServerNow(everyMs = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
