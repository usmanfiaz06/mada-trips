#!/usr/bin/env node
/*
 * How many aircraft adsb.lol sees right now around our airports. Run it before and after a Mada receiver goes up
 * (docs/app/ADSB-RECEIVER.md) to see the difference:
 *
 *   ADSB_CONTACT=ops@madatrips.sa node platform/scripts/check-adsb-coverage.mjs [radiusNm=60] [AIRPORT …]
 *   npm run adsb:coverage
 *
 * Uses https://api.adsb.lol/v2/point/{lat}/{lon}/{radius} (radius in nautical miles, 250 max). adsb.lol asks for a
 * User-Agent with contact details, so set ADSB_CONTACT to a monitored address. "low" means fewer than 2 aircraft
 * below 10,000 ft: nothing near the airport is being heard, so departures only show once they reach covered airspace.
 */

const AIRPORTS = {
  RUH: [24.957, 46.698, "Riyadh"], JED: [21.679, 39.156, "Jeddah"], DMM: [26.471, 49.798, "Dammam"], MED: [24.553, 39.705, "Madinah"],
  IST: [41.275, 28.752, "Istanbul"], DXB: [25.253, 55.365, "Dubai"],
};

const args = process.argv.slice(2);
const radius = Math.min(250, Math.max(5, Number(args.find((a) => /^\d+$/.test(a)) ?? 60)));
const wanted = args.filter((a) => /^[A-Za-z]{3}$/.test(a)).map((a) => a.toUpperCase());
const codes = wanted.length ? wanted.filter((c) => AIRPORTS[c]) : Object.keys(AIRPORTS);
const contact = process.env.ADSB_CONTACT ?? "contact via https://madatrips.sa/contact";
const ua = `MadaTrips-coverage/0.1 (+https://madatrips.sa; ${contact})`;

async function count(code) {
  const [lat, lon] = AIRPORTS[code];
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`, { headers: { Accept: "application/json", "User-Agent": ua }, signal: AbortSignal.timeout(15_000) });
    // adsb.lol rate-limits bursts: wait as asked (or a few seconds) and try again, three times at most.
    if (res.status !== 429 || attempt >= 3) break;
    await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5 * (attempt + 1)) * 1000));
  }
  if (!res.ok) throw new Error(`adsb.lol answered ${res.status}`);
  const ac = (await res.json()).ac ?? [];
  const withPos = ac.filter((a) => typeof a.lat === "number");
  const low = withPos.filter((a) => a.alt_baro === "ground" || (typeof a.alt_baro === "number" && a.alt_baro < 10_000));
  const mlat = ac.filter((a) => Array.isArray(a.mlat) && a.mlat.length > 0);
  return { total: ac.length, positioned: withPos.length, low: low.length, mlat: mlat.length };
}

console.log(`adsb.lol coverage, ${radius} nm around each airport, ${new Date().toISOString()}`);
console.log("airport            aircraft  with position  below 10k ft  mlat  verdict");
let failed = false;
for (const code of codes) {
  try {
    const r = await count(code);
    const verdict = r.positioned === 0 ? "none" : r.low < 2 ? "low" : "ok";
    console.log(`${`${code} ${AIRPORTS[code][2]}`.padEnd(18)} ${String(r.total).padStart(8)}  ${String(r.positioned).padStart(13)}  ${String(r.low).padStart(12)}  ${String(r.mlat).padStart(4)}  ${verdict}`);
  } catch (e) {
    failed = true;
    console.log(`${`${code} ${AIRPORTS[code][2]}`.padEnd(18)} failed: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 3000)); // be gentle: adsb.lol limits bursts
}
process.exit(failed ? 1 : 0);
