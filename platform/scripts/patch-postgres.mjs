// One round trip per query instead of two, for the database pooler (runs on `npm install`, postinstall).
//
// The transaction pooler needs `prepare: false` (src/db/index.ts). postgres.js then sends every query that has
// parameters as Parse + Describe, waits for the parameter types, and only then sends Bind + Execute: two round trips
// per query. With the database ~230 ms from the functions that was ~460 ms a query, on every request.
//
// The types only change how a value is written when it is an array or an object. For plain values (text, numbers,
// booleans, dates, bytes, null) the text is the same either way, and the server infers the types from the same Parse
// as before. So for those queries this sends Parse + Describe + Bind + Execute together, as postgres.js already does for
// queries without parameters. Queries with an array or object parameter keep the Describe round trip.
//
// Idempotent; if postgres.js changes and the line isn't found, it says so and changes nothing (queries stay correct,
// just slower). test/app/db-round-trips.test.ts fails if the patch isn't in place.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "postgres");
const FROM = "q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared)";
const TO = "q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared && (q.prepare || !parameters.every(madaPlain)))";
const HELPER = `
// Mada patch (platform/scripts/patch-postgres.mjs): plain values are written the same with or without their types.
function madaPlain(x) {
  return x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'bigint' || x instanceof Date || x instanceof Uint8Array
}
`;

let patched = 0;
for (const dir of ["src", "cjs/src", "cf/src"]) {
  const file = join(root, dir, "connection.js");
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  if (src.includes("madaPlain")) { patched++; continue; }
  if (!src.includes(FROM)) { console.warn(`[patch-postgres] ${dir}/connection.js: line not found, left as is (two round trips per query)`); continue; }
  writeFileSync(file, src.replace(FROM, TO) + HELPER);
  patched++;
}
if (existsSync(root)) console.log(`[patch-postgres] one round trip per query: ${patched} build(s) patched`);
