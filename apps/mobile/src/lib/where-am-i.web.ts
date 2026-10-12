/** Where the traveller is, once, when they ask: the browser asks them first. Null when they say no. */
export function whereAmI(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 10_000, maximumAge: 300_000 });
  });
}
