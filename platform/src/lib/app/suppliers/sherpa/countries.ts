/** ISO 3166 alpha-2 → alpha-3 for the countries Mada sends people to and the passports it sees most. */
const A3: Record<string, string> = {
  SA: "SAU", AE: "ARE", BH: "BHR", QA: "QAT", KW: "KWT", OM: "OMN", JO: "JOR", EG: "EGY", LB: "LBN", MA: "MAR", TN: "TUN", TR: "TUR",
  AZ: "AZE", GE: "GEO", AM: "ARM", UZ: "UZB", KZ: "KAZ", GB: "GBR", IE: "IRL", FR: "FRA", DE: "DEU", IT: "ITA", ES: "ESP", PT: "PRT",
  NL: "NLD", BE: "BEL", CH: "CHE", AT: "AUT", GR: "GRC", CZ: "CZE", PL: "POL", HU: "HUN", SE: "SWE", NO: "NOR", DK: "DNK", FI: "FIN",
  US: "USA", CA: "CAN", MX: "MEX", BR: "BRA", AR: "ARG", AU: "AUS", NZ: "NZL", JP: "JPN", KR: "KOR", CN: "CHN", HK: "HKG", SG: "SGP",
  MY: "MYS", TH: "THA", ID: "IDN", PH: "PHL", VN: "VNM", IN: "IND", PK: "PAK", BD: "BGD", LK: "LKA", NP: "NPL", MV: "MDV", KE: "KEN",
  TZ: "TZA", ZA: "ZAF", ET: "ETH", SD: "SDN", YE: "YEM", SY: "SYR", IQ: "IRQ", IR: "IRN", RU: "RUS", BA: "BIH", AL: "ALB", ME: "MNE",
  RS: "SRB", SC: "SYC", MU: "MUS", NG: "NGA",
};
export const alpha3 = (a2: string) => A3[a2.toUpperCase()] ?? null;
