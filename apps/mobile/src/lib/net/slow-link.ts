/**
 * The browser says the connection is slow or metered (Network Information API: Save-Data, or an effective type of 3G
 * or worse). Browsers without the API (Safari) say nothing, and nothing is held back there. Phones: always false.
 */
export function slowLink(): boolean {
  const conn = (globalThis.navigator as { connection?: { effectiveType?: string; saveData?: boolean } } | undefined)?.connection;
  return !!conn && (!!conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType ?? ''));
}
