import { EUROPE_COUNTRIES, GLOBAL_COUNTRIES, type EsimPackage } from './esim-data';

/*
 * The mock eSIM supplier's packages, net prices included: server-only (the shared index never exports them), read by
 * the Core API's mock and by the app's mock API in a mock build ('@mada/shared/internal').
 */

const local = (code: string, name: string, operator: string, slug: string, rows: [number | null, number, number][], apn: EsimPackage['apn'] = { type: 'automatic', value: null }, roaming = true): EsimPackage[] =>
  rows.map(([gb, days, netUsd]) => ({
    id: `${slug}-${days}days-${gb === null ? 'unlimited' : `${gb}gb`}`, coverage: { kind: 'local', code, name, countries: [code] },
    gb, days, netUsd, operator, apn, roaming, topup: true,
  }));

export const ESIM_FIXTURE_PACKAGES: readonly EsimPackage[] = [
  ...local('TR', 'Türkiye', 'Merhaba', 'merhaba', [[1, 7, 3.6], [3, 7, 6.0], [5, 7, 8.4], [3, 15, 7.2], [5, 30, 10.4], [10, 30, 17.6], [20, 30, 29.6]]),
  ...local('AE', 'United Arab Emirates', 'Burj Mobile', 'burj-mobile', [[1, 7, 6.8], [3, 15, 14.4], [5, 30, 20.8], [10, 30, 33.6]], { type: 'manual', value: 'du' }),
  ...local('GB', 'United Kingdom', 'Uki Mobile', 'uki-mobile', [[1, 7, 3.6], [3, 30, 7.2], [5, 30, 10.4], [10, 30, 16.0], [20, 30, 24.0]]),
  ...local('PK', 'Pakistan', 'Jazz', 'jazz-pk', [[1, 7, 2.4], [3, 15, 4.8], [5, 30, 7.2], [10, 30, 12.0]]),
  ...local('SA', 'Saudi Arabia', 'Red Sand', 'red-sand', [[1, 7, 4.8], [3, 15, 10.4], [5, 30, 15.2], [10, 30, 26.4]], { type: 'automatic', value: null }, false),
  ...[[1, 7, 4.0], [3, 30, 10.4], [5, 30, 15.2], [10, 30, 26.4], [20, 30, 41.6]].map(([gb, days, netUsd]): EsimPackage => ({
    id: `eurolink-${days}days-${gb}gb`, coverage: { kind: 'regional', code: 'europe', name: 'Europe', countries: [...EUROPE_COUNTRIES] },
    gb: gb!, days: days!, netUsd: netUsd!, operator: 'Eurolink', apn: { type: 'automatic', value: null }, roaming: true, topup: true,
  })),
  ...[[1, 7, 7.2], [3, 30, 17.6], [5, 30, 26.4], [10, 60, 41.6]].map(([gb, days, netUsd]): EsimPackage => ({
    id: `discover-${days}days-${gb}gb`, coverage: { kind: 'global', code: 'world', name: 'Global', countries: [...GLOBAL_COUNTRIES] },
    gb: gb!, days: days!, netUsd: netUsd!, operator: 'Discover Global', apn: { type: 'automatic', value: null }, roaming: true, topup: true,
  })),
];

