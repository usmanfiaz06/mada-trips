import { z } from 'zod';

/*
 * IATA Bar Coded Boarding Pass (Resolution 792, versions 1–8): the text inside every airline boarding pass barcode,
 * whether it's printed as PDF417, Aztec or QR. We only ever READ it from the airline's own pass (a PDF, a photo, a
 * .pkpass); a barcode is never made up from booking data, because only the airline's check-in can issue one.
 *
 *   mandatory unique      M | legs (1) | passenger name (20) | e-ticket indicator (1)
 *   mandatory per leg     PNR (7) | from (3) | to (3) | carrier (3) | flight (5) | Julian date (3) | compartment (1) |
 *                         seat (4) | check-in sequence (5) | passenger status (1) | size of conditional items (2, hex)
 *   conditional, leg 1    > | version (1) | size of unique conditional (2, hex) | passenger description, check-in source,
 *                         issue source, issue date (4), document type, issuer (3), bag tags…
 *   conditional, per leg  size (2, hex) | airline numeric code (3) | document serial (10) | selectee | doc verification |
 *                         marketing carrier (3) | frequent-flyer airline (3) | number (16) | ID/AD | free bags (3) | fast track
 *   then airline use, and after the last leg optional security data (^…).
 */

export const BarcodeFormat = z.enum(['pdf417', 'aztec', 'qr']);
export type BarcodeFormat = z.infer<typeof BarcodeFormat>;

export type BcbpLeg = {
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  /** Digits only, leading zeros dropped ("263"). */
  flightNumber: string;
  /** Up to one letter after the digits ("0834A"), which some airlines use. */
  flightSuffix: string;
  /** Day of the year of departure, 1–366 (no year in the barcode). */
  julianDay: number;
  compartment: string;
  /** "014A" → "14A". Empty for a standby pass or "INF". */
  seat: string;
  /** Check-in sequence, "0025" → "25". */
  sequence: string;
  passengerStatus: string;
  marketingCarrier: string | null;
  ticketNumber: string | null;
  frequentFlyer: string | null;
  freeBaggage: string | null;
};

export type Bcbp = {
  raw: string;
  /** As printed: "ALHARBI/OMAR MR". */
  name: string;
  surname: string;
  given: string;
  eticket: boolean;
  version: number | null;
  /** Day-of-year and the year's last digit the pass was issued, when the airline included it. */
  issued: { yearDigit: number; julianDay: number } | null;
  issuer: string | null;
  legs: BcbpLeg[];
  hasSecurity: boolean;
};

const hex = (s: string) => (/^[0-9A-Fa-f]{2}$/.test(s) ? parseInt(s, 16) : NaN);
const trimZeros = (s: string) => s.trim().replace(/^0+(?=\d)/, '');
const blank = (s: string | undefined) => {
  const v = (s ?? '').trim();
  return v ? v : null;
};

/** Seat as people say it: "014A" → "14A", "INF"/"GATE" stay as they are. */
export function bcbpSeat(raw: string): string {
  const s = raw.trim();
  const m = /^0*(\d{1,3})([A-Z])$/.exec(s);
  return m ? `${m[1]}${m[2]}` : s;
}

/** Splits "ALHARBI/OMAR MR" into surname and given names, dropping the title. */
export function splitBcbpName(name: string): { surname: string; given: string } {
  const [sur = '', rest = ''] = name.trim().split('/');
  const given = rest.trim().replace(/\s+(MR|MRS|MS|MISS|MSTR|DR|CHD|INF)$/i, '').trim();
  return { surname: sur.trim(), given };
}

/**
 * Reads a BCBP string. Null when it isn't one (a URL, a ticket number, a QR from somewhere else): the caller then says
 * "That code isn't a boarding pass" rather than guessing.
 */
export function parseBcbp(input: string): Bcbp | null {
  const raw = input.replace(/\r?\n$/, '');
  if (raw.length < 60 || raw[0] !== 'M') return null;
  const legCount = Number(raw[1]);
  if (!Number.isInteger(legCount) || legCount < 1 || legCount > 4) return null;
  const name = raw.slice(2, 22).trim();
  if (!/^[A-Z][A-Z' -]*\//.test(name)) return null;
  const eticket = raw[22] === 'E';
  const { surname, given } = splitBcbpName(name);

  let pos = 23;
  let version: number | null = null;
  let issued: Bcbp['issued'] = null;
  let issuer: string | null = null;
  const legs: BcbpLeg[] = [];

  for (let i = 0; i < legCount; i++) {
    const m = raw.slice(pos, pos + 37);
    if (m.length < 37) return null;
    const flight = m.slice(16, 21);
    const fm = /^\s*0*(\d{1,4})([A-Z ]?)\s*$/.exec(flight);
    const julianDay = Number(m.slice(21, 24));
    const size = hex(m.slice(35, 37));
    if (!fm || !Number.isInteger(julianDay) || julianDay < 1 || julianDay > 366 || Number.isNaN(size)) return null;
    if (!/^[A-Z]{3}$/.test(m.slice(7, 10)) || !/^[A-Z]{3}$/.test(m.slice(10, 13))) return null;
    const leg: BcbpLeg = {
      pnr: m.slice(0, 7).trim(),
      from: m.slice(7, 10),
      to: m.slice(10, 13),
      carrier: m.slice(13, 16).trim(),
      flightNumber: trimZeros(fm[1]!),
      flightSuffix: (fm[2] ?? '').trim(),
      julianDay,
      compartment: m[24]!,
      seat: bcbpSeat(m.slice(25, 29)),
      sequence: trimZeros(m.slice(29, 34)),
      passengerStatus: m[34]!,
      marketingCarrier: null, ticketNumber: null, frequentFlyer: null, freeBaggage: null,
    };
    pos += 37;
    const cond = raw.slice(pos, pos + size);
    pos += size;
    let c = 0;
    // The first leg's conditional items start with the version and the items printed once per pass.
    if (i === 0 && cond[0] === '>') {
      version = Number(cond[1]) || null;
      const uSize = hex(cond.slice(2, 4));
      if (!Number.isNaN(uSize)) {
        const u = cond.slice(4, 4 + uSize);
        const d = u.slice(3, 7);
        if (/^\d{4}$/.test(d)) issued = { yearDigit: Number(d[0]), julianDay: Number(d.slice(1)) };
        issuer = blank(u.slice(8, 11));
        c = 4 + uSize;
      } else c = cond.length;
    }
    const rSize = hex(cond.slice(c, c + 2));
    if (!Number.isNaN(rSize) && rSize > 0) {
      const r = cond.slice(c + 2, c + 2 + rSize);
      const airline = r.slice(0, 3);
      const serial = r.slice(3, 13);
      leg.ticketNumber = /^\d{3}$/.test(airline) && /^\d{10}$/.test(serial) ? `${airline}${serial}` : null;
      leg.marketingCarrier = blank(r.slice(15, 18));
      const ff = [blank(r.slice(18, 21)), blank(r.slice(21, 37))];
      leg.frequentFlyer = ff[1] ? `${ff[0] ?? ''} ${ff[1]}`.trim() : null;
      leg.freeBaggage = blank(r.slice(38, 41));
    }
    legs.push(leg);
  }
  return { raw, name, surname, given, eticket, version, issued, issuer, legs, hasSecurity: raw.indexOf('^', pos) >= 0 };
}

/**
 * The barcode has a day of the year but no year: the departure is the date with that day nearest to `near` (the
 * booked flight's date, or today), so a pass for 2 January read on 30 December lands in the right year.
 */
export function bcbpDate(julianDay: number, near: string): string {
  const ref = Date.parse(`${near.slice(0, 10)}T00:00:00Z`);
  const year = new Date(ref).getUTCFullYear();
  let best = '';
  let bestGap = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const at = Date.UTC(y, 0, 1) + (julianDay - 1) * 86_400_000;
    if (new Date(at).getUTCFullYear() !== y) continue; // day 366 in a short year
    const gap = Math.abs(at - ref);
    if (gap < bestGap) { bestGap = gap; best = new Date(at).toISOString().slice(0, 10); }
  }
  return best;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Whether a pass's printed name is this traveller: the surname must match (airlines cut long names at 20 characters,
 * so a prefix counts), and the first given name must start the same.
 */
export function bcbpNameMatches(pass: Pick<Bcbp, 'surname' | 'given'>, person: { surname?: string | null; givenNames?: string | null; fullName?: string | null }): boolean {
  const ps = norm(pass.surname).replace(/ /g, '');
  const pg = norm(pass.given).split(' ')[0] ?? '';
  let sur = norm(person.surname ?? '');
  let giv = norm(person.givenNames ?? '');
  if (!sur && person.fullName) {
    const parts = norm(person.fullName).split(' ');
    sur = parts.slice(-1)[0] ?? '';
    giv = parts.slice(0, -1).join(' ');
  }
  const s = sur.replace(/ /g, '');
  if (!ps || !s) return false;
  const surnameOk = s === ps || (ps.length >= 3 && s.startsWith(ps)) || (s.length >= 3 && ps.startsWith(s));
  if (!surnameOk) return false;
  if (!pg) return true;
  const g = giv.split(' ')[0] ?? '';
  return !!g && (g.startsWith(pg) || pg.startsWith(g));
}

/** Whether a leg is this flight: carrier and number (leading zeros dropped), the airports, and the day. */
export function bcbpLegMatches(leg: BcbpLeg, seg: { flightNumber: string; from: string; to: string; departLocal: string }): boolean {
  const m = /^([A-Z0-9]{2})(\d{1,4})$/.exec(seg.flightNumber);
  if (!m) return false;
  if (leg.carrier !== m[1] || leg.flightNumber !== String(Number(m[2]))) return false;
  if (leg.from !== seg.from || leg.to !== seg.to) return false;
  return bcbpDate(leg.julianDay, seg.departLocal) === seg.departLocal.slice(0, 10);
}
