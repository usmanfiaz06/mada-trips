/*
 * What must never reach a traveller (docs/app/SUPPLIER-PRIVACY.md): Mada's partners by name or host, and what Mada
 * pays (net, cost, markup, margin, commission) or the partner's own keys and references. Used by
 *   - platform/test/app/supplier-leaks.test.ts  (Core API answers in mock and partner-mock modes)
 *   - apps/mobile/test/unit/supplier-leaks.test.ts and `npm run leak:scan` (the web export, after every export:web)
 * Partner names are matched in any case except the three-letter ones, which are also airport codes (TBO Tabora, HBX
 * Hubballi, HBG Hattiesburg): those count only in lower case or as "HBX Group" / "TBO Holidays".
 */

export const PARTNERS = [
  /tboholidays/i, /\btbo[ .-]?(?:holidays|air|tek)\b/i, /tboair/i, /\btbo\b/, /\btbo_/i,
  /hotel[ -]?beds/i, /\bhbx[ -]?group\b/i, /\bhbx\b/, /\bhbg\b/, /activitiesbank/i, /giata/i,
  /esim[ -]?access/i, /airalo/i,
  /aero[ -]?data[ -]?box/i, /aviation[ -]?stack/i, /flight[ -]?aware/i,
  /worldota/i, /rate[ -]?hawk/i, /emerging[ -]?travel/i,
  /duffel/i, /cartrawler/i, /klook/i, /\bsherpa\b|joinsherpa/i, /xcover|cover[ -]?genius/i,
  /viator/i, /get[ -]?your[ -]?guide/i, /webbeds|dotwconnect/i,
];

/** Field names that carry Mada's cost, markup or margin, or a partner's own key or reference. */
export const COST_FIELDS = [
  'net', 'netUsd', 'netPrice', 'net_price', 'netCost', 'net_cost', 'netTotal', 'netAmount', 'netHalalas', 'costUsd', 'costHalalas', 'costPrice', 'costE4',
  'markup', 'markupBps', 'markupPct', 'margin', 'marginBps', 'marginPct', 'marginHalalas', 'profit', 'commission', 'commissionBps', 'wholesale',
  'supplier', 'supplierName', 'supplierCode', 'supplierRef', 'supplierReference', 'supplierOfferId', 'supplierFee', 'rateKey', 'rateCommentsId', 'modality', 'traceId',
];

/** Text (a bundle file, an HTML page) as it ships: partner names and hosts, and cost fields as identifiers. */
export function scanText(text, { costFields = true } = {}) {
  const hits = [];
  for (const re of PARTNERS) {
    const m = re.exec(text);
    if (m) hits.push({ kind: 'partner', match: m[0], near: text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40) });
  }
  if (costFields) {
    // As a property in code or JSON: `netUsd:`, `"markupBps":`, `.marginPct`. Plain words in prose don't count.
    // Plain words and generic names (OpenTelemetry's traceId, a UI prop's supplierName) count in JSON answers only.
    const fields = COST_FIELDS.filter((f) => !['net', 'margin', 'supplier', 'profit', 'modality', 'traceId', 'supplierName'].includes(f));
    const re = new RegExp(`(?:["'.]|\\b)(${fields.join('|')})["']?\\s*[:=(]|\\.(${fields.join('|')})\\b`, 'g');
    const m = re.exec(text);
    if (m) hits.push({ kind: 'cost', match: m[1] ?? m[2], near: text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40) });
  }
  return hits;
}

/**
 * A JSON answer: every key against COST_FIELDS (exact; a ride's `supplier: "mock" | "none"` and an invoice line's VAT
 * `net` are not partners), and every string against PARTNERS (except the voucher's contract line, `payableThrough`).
 */
export function scanJson(value, path = '$') {
  const hits = [];
  const walk = (v, p, key) => {
    if (typeof v === 'string') {
      // The voucher's contract line stays; tokens and sealed ids (long, no spaces, base64url) are random letters.
      if (key === 'payableThrough' || /^[\w.~+/=-]{40,}$/.test(v)) return;
      for (const re of PARTNERS) if (re.test(v)) hits.push({ kind: 'partner', path: p, match: v.slice(0, 160) });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, key)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const allowed = (k === 'supplier' && (x === 'mock' || x === 'none')) || (k === 'net' && p.includes('lines'));
        if (COST_FIELDS.includes(k) && !allowed) hits.push({ kind: 'cost', path: `${p}.${k}`, match: k });
        walk(x, `${p}.${k}`, k);
      }
    }
  };
  walk(value, path, null);
  return hits;
}
