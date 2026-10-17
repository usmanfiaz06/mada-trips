import { describe, expect, it } from 'vitest';
import { BoardingPassesResponse, ImportBoardingPassResponse, ROUTES, parseBcbp } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';
import { DEMO_PASSES } from '../../src/lib/mock/boarding-fixtures';

/* Boarding passes in mock mode: when check-in opens, the demo family's PDF read into four passes, never a made-up one. */

type J = Record<string, any>;

describe('boarding passes (mock)', () => {
  it('says when check-in opens, then takes the family PDF and refuses other files', async () => {
    const call = async (w: Wire) => mockTransport(w);
    await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
    const token = ((await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } })).json as J).tokens.accessToken as string;
    const as = (method: Wire['method'], path: string, body?: unknown) => call({ method, path, body, token });
    const tripId = ((await as('GET', '/trips')).json as J).upcoming.find((t: J) => t.city === 'Istanbul').id as string;

    const before = BoardingPassesResponse.parse((await as('GET', `/trips/${tripId}/boarding-passes`)).json);
    expect(before.passes).toEqual([]);
    expect(before.checkIn[0]).toMatchObject({ airline: 'Saudia', opensLocal: '09:40', open: false });
    expect(before.appleWallet).toBe(false);

    const wrong = await as('POST', `/trips/${tripId}/boarding-passes`, { __file: { name: 'menu.png' } });
    expect(wrong.status).toBe(400);
    expect((wrong.json as J).error.message).toBe('No boarding pass barcode in that file. Try a screenshot of the barcode itself.');

    const r = await as('POST', `/trips/${tripId}/boarding-passes`, { __file: { name: 'demo-boarding-passes.pdf' } });
    expect(r.status).toBe(201);
    const added = ImportBoardingPassResponse.parse(r.json).added;
    expect(added.map((p) => p.seat)).toEqual(['14A', '14B', '14C', '14D']);
    expect(added.every((p) => p.travellerId && p.svg?.startsWith('<svg viewBox'))).toBe(true);
    // Each barcode is the airline-format text it says it is.
    for (const p of added) expect(parseBcbp(p.message)?.legs[0]?.seat).toBe(p.seat);

    const trip = ((await as('GET', `/trips/${tripId}`)).json as J).trip as J;
    expect(added.map((p) => trip.travellers.find((x: J) => x.id === p.travellerId)?.firstName)).toEqual(['Omar', 'Hessa', 'Sara', 'Ahmed']);
    expect((await as('POST', `/trips/${tripId}/wallet`, { passId: added[0]!.id })).status).toBe(501);
    expect((await as('DELETE', `/trips/${tripId}/boarding-passes/${added[0]!.id}`)).status).toBe(200);
    expect(BoardingPassesResponse.parse((await as('GET', `/trips/${tripId}/boarding-passes`)).json).passes).toHaveLength(3);
  });

  it('ships fixtures that are real boarding passes', () => {
    expect(DEMO_PASSES.map((p) => parseBcbp(p.message)?.given)).toEqual(['OMAR', 'HESSA', 'SARA', 'AHMED']);
  });
});
