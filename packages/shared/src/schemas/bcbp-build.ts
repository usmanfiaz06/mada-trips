/*
 * Writes a BCBP string in the airline format, for tests and the mock build's demo family ONLY. A real traveller's
 * barcode always comes from the airline's own pass (bcbp.ts): nothing in the app or the API calls this for a booking.
 */

export type BcbpLegInput = {
  pnr: string; from: string; to: string; carrier: string; flight: string; julianDay: number;
  compartment?: string; seat?: string; sequence?: string; status?: string;
  ticket?: string; marketing?: string; bags?: string;
};

const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, ' ');
const zpad = (s: string, n: number) => s.padStart(n, '0').slice(-n);
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

export function buildBcbp(p: { name: string; eticket?: boolean; legs: BcbpLegInput[]; version?: number; issuedJulian?: number; issuer?: string; security?: string }): string {
  let out = `M${p.legs.length}${pad(p.name, 20)}${p.eticket === false ? ' ' : 'E'}`;
  p.legs.forEach((l, i) => {
    const digits = /^(\d+)([A-Z]?)$/.exec(l.flight);
    const flight = digits ? `${zpad(digits[1]!, 4)}${digits[2] || ' '}` : pad(l.flight, 5);
    const seatM = /^(\d+)([A-Z])$/.exec(l.seat ?? '');
    const seat = seatM ? `${zpad(seatM[1]!, 3)}${seatM[2]}` : pad(l.seat ?? '', 4);
    const mandatory = `${pad(l.pnr, 7)}${l.from}${l.to}${pad(l.carrier, 3)}${flight}${zpad(String(l.julianDay), 3)}${l.compartment ?? 'Y'}${seat}${pad(zpad(l.sequence ?? '1', 4), 5)}${l.status ?? '1'}`;
    let cond = '';
    if (i === 0 && p.version) {
      const issue = p.issuedJulian ? `6${zpad(String(p.issuedJulian), 3)}` : '    ';
      const unique = `1WW${issue}B${pad(p.issuer ?? l.carrier, 3)}`;
      cond += `>${p.version}${hex2(unique.length)}${unique}`;
    }
    if (p.version) {
      const t = l.ticket ?? '';
      const rep = `${t ? t.slice(0, 3) : '   '}${t ? t.slice(3, 13) : pad('', 10)}0 ${pad(l.marketing ?? l.carrier, 3)}${pad('', 3)}${pad('', 16)} ${pad(l.bags ?? '', 3)}N`;
      cond += `${hex2(rep.length)}${rep}`;
    }
    out += `${mandatory}${hex2(cond.length)}${cond}`;
  });
  if (p.security) out += `^1${hex2(p.security.length)}${p.security}`;
  return out;
}
