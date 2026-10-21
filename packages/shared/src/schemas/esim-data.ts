/*
 * eSIM fixtures and reference lists (schemas/esim.ts). The mock supplier on the server and the app's mock API both
 * read these, so a plan priced in one is the same plan in the other. Package ids, operators and net prices are shaped
 * like Airalo's (`merhaba-7days-1gb`, net price in USD); the live adapter reads the real ones from Airalo.
 */

type CoverageKind = 'local' | 'regional' | 'global';

/** A package as a supplier sells it, in our words. netUsd is what Mada pays; the traveller's price adds the markup. */
export type EsimPackage = {
  id: string;
  coverage: { kind: CoverageKind; code: string; name: string; countries: string[] };
  /** Gigabytes; null for unlimited. */
  gb: number | null;
  days: number;
  netUsd: number;
  operator: string;
  /** The operator's APN: automatic (nothing to type) or the value to type in. */
  apn: { type: 'automatic' | 'manual'; value: string | null };
  /** The eSIM roams on a partner network (data roaming must be on). */
  roaming: boolean;
  topup: boolean;
  /** The supplier's suggested retail price in USD, when it gives one (eSIM Access). */
  retailUsd?: number | null;
  /** A daily plan: `gb` a day and `netUsd` a day, bought for as many days as the trip (`days` is 1). */
  daily?: boolean;
};

/** Eurolink's countries (ISO 3166-1 alpha-2). */
export const EUROPE_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU',
  'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB', 'TR',
] as const;

/** Discover Global's countries: the places Mada's travellers go most, and more. */
export const GLOBAL_COUNTRIES = [
  ...EUROPE_COUNTRIES, 'SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'JO', 'EG', 'MA', 'AZ', 'GE', 'US', 'CA', 'MX', 'BR', 'JP', 'KR',
  'SG', 'MY', 'TH', 'ID', 'MV', 'LK', 'IN', 'PK', 'CN', 'HK', 'AU', 'NZ', 'ZA', 'KE', 'TZ',
] as const;

/** Country names Mada writes in its own words (copy keys esim.where.*); anything else keeps the supplier's title. */
export const ESIM_NAMED = ['TR', 'AE', 'GB', 'SA', 'EG', 'AZ', 'GE', 'FR', 'europe', 'world'] as const;

/** Country names to ISO codes, for trips stored with a country name. */
export const COUNTRY_CODES: Readonly<Record<string, string>> = {
  'türkiye': 'TR', turkiye: 'TR', turkey: 'TR', 'the uae': 'AE', uae: 'AE', 'united arab emirates': 'AE', 'the uk': 'GB', uk: 'GB', 'united kingdom': 'GB',
  egypt: 'EG', azerbaijan: 'AZ', georgia: 'GE', france: 'FR', indonesia: 'ID', 'the maldives': 'MV', maldives: 'MV', 'saudi arabia': 'SA', italy: 'IT',
  spain: 'ES', germany: 'DE', switzerland: 'CH', austria: 'AT', greece: 'GR', 'bosnia and herzegovina': 'BA', malaysia: 'MY', qatar: 'QA', bahrain: 'BH',
  oman: 'OM', kuwait: 'KW', jordan: 'JO', morocco: 'MA', 'the netherlands': 'NL', netherlands: 'NL', 'czechia': 'CZ', 'the czech republic': 'CZ',
};

/**
 * Phones that take an eSIM. Apple: iPhone XR, XS and every iPhone since (iPhone 14 and later in the US are eSIM only).
 * iPhones sold in mainland China, Hong Kong and Macao mostly don't (except iPhone SE, 12 mini and 13 mini). Android:
 * these families from the year shown; carrier-locked phones may not.
 */
export const ESIM_PHONES: readonly { brand: 'apple' | 'samsung' | 'google' | 'other'; name: string; match: RegExp }[] = [
  { brand: 'apple', name: 'iPhone XR, XS and newer', match: /iphone\s*(x[rs]|1[1-9]|2\d|se\s*\(?(2|3|20(20|22))|se\s*(2nd|3rd)|air|\d{2}\s*(pro|plus|mini|e))/i },
  { brand: 'samsung', name: 'Galaxy S20 and newer, Z Fold and Z Flip, Note 20', match: /galaxy\s*(s2\d|s[3-9]\d|z\s*(fold|flip)|note\s*2\d|a5[45]|a3[56])|sm-(s9[0-9][0-9]|f[79]\d\d|n98\d)/i },
  { brand: 'google', name: 'Pixel 3 and newer', match: /pixel\s*([3-9]|1\d)/i },
  { brand: 'other', name: 'Huawei P40, Oppo Find X3 and newer, Motorola Razr', match: /huawei\s*p40(?!\s*pro\+)|oppo\s*find\s*x[3-9]|razr|xperia\s*(1|5|10)\s*(iii|iv|v|vi)/i },
];

/** Phones that never took an eSIM, so "no" is as clear as "yes". */
export const NO_ESIM_PHONES = /iphone\s*(x(?![rs])|[4-8](s|\s*plus)?\b|se(?!\s*\(?(2|3|20))\b)|galaxy\s*(s(1\d|[1-9])\b|a[0-2]\d)|pixel\s*[12]\b/i;
