import type { Wire, WireResponse } from './api';

/*
 * What './mock-api' resolves to in a live build (metro.config.js): the mock's code and its fixtures never ship in a
 * build that talks to the real Core API. Never called there (api.ts only uses the mock in mock mode).
 */
export async function mockTransport(_w: Wire): Promise<WireResponse> {
  return { status: 503, json: { error: { code: 'NOT_CONFIGURED', message: 'Mock mode is not in this build.' } } };
}
