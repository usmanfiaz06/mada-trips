/** The Core API: plain JSON over HTTPS, versioned in the path. Served by platform/ under /api/app/v1. */
export const API_PREFIX = '/api/app/v1';

export const ROUTES = {
  health: '/health',
  otpStart: '/auth/otp/start',
  otpVerify: '/auth/otp/verify',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  apple: '/auth/apple',
  google: '/auth/google',
  me: '/me',
  people: '/people',
  /** GET, with the flight number in place of :flightNo (e.g. /flights/SV263/position). */
  flightPosition: '/flights/:flightNo/position',
} as const;

export const flightPositionPath = (flightNo: string) => ROUTES.flightPosition.replace(':flightNo', encodeURIComponent(flightNo.replace(/\s+/g, '').toUpperCase()));

export type RouteName = keyof typeof ROUTES;

/** Access tokens are short-lived; refresh tokens rotate on every use. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 60;
