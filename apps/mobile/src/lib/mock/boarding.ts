import {
  ERROR_CODES, arriveInstant, bcbpLegMatches, bcbpNameMatches, checkInWindow, parseBcbp, t,
  type BoardingPassView, type CopyKey, type ErrorCode, type Vars,
} from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock } from '../mock-api';
import { DEMO_PASSES, DEMO_PASS_FILE } from './boarding-fixtures';
import { mockTrip } from './trips';

/*
 * EXPO_PUBLIC_API_MODE=mock for boarding passes: GET/POST/DELETE /trips/{id}/boarding-passes and POST /trips/{id}/wallet,
 * with the Core API's words and rules (platform/src/lib/app/boarding). The mock can't read barcodes, so it knows one
 * file: test/fixtures/demo-boarding-passes.pdf, whose four real passes (the demo family's) are in boarding-fixtures.ts;
 * matching them to the trip uses the same shared functions as the server. Any other file is "no boarding pass".
 * Apple Wallet is never set up in the mock (no certificates), so the button stays hidden.
 */

const byUser = new Map<string, BoardingPassView[]>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, copy?: string, vars?: Vars): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t((copy ?? ERROR_CODES[code].copy) as CopyKey, vars) } } });
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

export const boardingMock: AreaMock = async (w: Wire, { user }) => {
  const parts = (w.path.split('?')[0] ?? '').split('/').filter(Boolean);
  if (parts[0] !== 'trips' || !parts[1] || (parts[2] !== 'boarding-passes' && parts[2] !== 'wallet')) return null;
  if (!user) return err('UNAUTHORIZED');
  const trip = mockTrip(user, parts[1], w.path);
  if (!trip) return err('NOT_FOUND');
  if (parts[2] === 'wallet') return err('NOT_CONFIGURED');
  const all = byUser.get(user.id) ?? [];
  const mine = all.filter((p) => p.tripId === trip.id);

  if (w.method === 'GET') {
    const now = Date.parse(trip.clock.now);
    const checkIn = trip.segments.filter((s) => s.status !== 'cancelled' && arriveInstant(s).getTime() > now).map((s) => checkInWindow(s, now));
    return ok({ passes: mine, checkIn, appleWallet: false });
  }
  if (w.method === 'DELETE' && parts[3]) {
    if (!mine.some((p) => p.id === parts[3])) return err('NOT_FOUND');
    byUser.set(user.id, all.filter((p) => p.id !== parts[3]));
    return ok({ deleted: true });
  }
  if (w.method !== 'POST') return null;
  const file = (w.body as { __file?: { name?: string } } | undefined)?.__file;
  if (!file?.name) return err('VALIDATION');
  if (file.name !== DEMO_PASS_FILE) return err('VALIDATION', 'bp.unreadable');
  const added: BoardingPassView[] = [];
  const unmatched: { name: string; flight: string }[] = [];
  for (const fx of DEMO_PASSES) {
    const b = parseBcbp(fx.message);
    if (!b) continue;
    for (const leg of b.legs) {
      const seg = trip.segments.find((s) => bcbpLegMatches(leg, s));
      if (!seg) { unmatched.push({ name: b.name, flight: `${leg.carrier}${leg.flightNumber}` }); continue; }
      const person = trip.travellers.find((p) => bcbpNameMatches(b, { fullName: p.fullName }));
      added.push({
        id: uuid(), tripId: trip.id, segmentId: seg.id, travellerId: person?.id ?? null, name: b.name, flightNumber: seg.flightNumber, from: seg.from, to: seg.to,
        departLocal: seg.departLocal, seat: leg.seat, sequence: leg.sequence, pnr: leg.pnr, compartment: leg.compartment, format: 'pdf417', message: b.raw, svg: fx.svg,
        source: 'traveller', addedAt: new Date().toISOString(),
      });
    }
  }
  if (!added.length) return unmatched[0] ? err('VALIDATION', 'bp.otherTrip', { flight: unmatched[0].flight }) : err('VALIDATION', 'bp.unreadable');
  // Same person and flight: the newer pass replaces the older one.
  const kept = all.filter((p) => !added.some((a) => a.segmentId === p.segmentId && a.name === p.name));
  byUser.set(user.id, [...kept, ...added]);
  return ok({ added, unmatched }, 201);
};
