// The business runs on Riyadh time. Pakistan is two hours ahead.
export const TZ = "Asia/Riyadh";
export const PK_TZ = "Asia/Karachi";

function parts(d: Date, tz = TZ) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** Riyadh calendar date (YYYY-MM-DD). Anything after the 22:00 cut-off belongs to the next business day. */
export function businessDate(now = new Date(), closeHour = 22): string {
  const p = parts(now);
  return p.hour >= closeHour ? addDays(p.date, 1) : p.date;
}

export const riyadhDate = (d = new Date()) => parts(d).date;
export const riyadhTime = (d = new Date(), tz = TZ) => {
  const p = parts(d, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Minutes until the next 22:00 Riyadh cut-off. */
export function minutesToClose(now = new Date(), closeHour = 22): number {
  const p = parts(now);
  const m = p.hour * 60 + p.minute;
  const c = closeHour * 60;
  return m < c ? c - m : 24 * 60 - m + c;
}

/** The settlement cycle containing a date: 26th of previous month → 25th. */
export function cycleFor(iso: string, cutoffDay = 25) {
  const [y, m, d] = iso.split("-").map(Number);
  let ey = y, em = m;
  if (d > cutoffDay) { em += 1; if (em > 12) { em = 1; ey += 1; } }
  const end = `${ey}-${String(em).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;
  let sy = ey, sm = em - 1;
  if (sm < 1) { sm = 12; sy -= 1; }
  const start = `${sy}-${String(sm).padStart(2, "0")}-${String(cutoffDay + 1).padStart(2, "0")}`;
  return { start, end };
}

export function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

export function fmtDate(iso: string | Date | null | undefined, locale = "en", withTime = false) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: TZ, day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(d);
}

export function timeAgo(d: Date | string, locale = "en") {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtDate(new Date(d), locale);
}
