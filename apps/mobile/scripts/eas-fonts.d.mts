export function zipBytes(value: string | undefined | null): Buffer | null;
export function fontEntries(zip: Buffer): { name: string; data: Buffer }[];
export function installFonts(value: string | undefined | null, dir: string): string[];
