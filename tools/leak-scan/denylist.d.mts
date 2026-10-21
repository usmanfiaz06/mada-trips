export type LeakHit = { kind: 'partner' | 'cost'; match: string; path?: string; near?: string };
export const PARTNERS: RegExp[];
export const COST_FIELDS: string[];
export function scanText(text: string, opts?: { costFields?: boolean }): LeakHit[];
export function scanJson(value: unknown, path?: string): LeakHit[];
