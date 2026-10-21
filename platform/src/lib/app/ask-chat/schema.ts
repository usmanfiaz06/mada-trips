/*
 * Tool arguments checked against the tools' own strict JSON schemas (prompt.ts), for providers that don't promise
 * them (openai-compatible): types (with null), enums, required, no extra keys, arrays of strings. Claude with
 * strict: true always passes; the check costs nothing there. Also the tolerant name match a model sometimes needs
 * ("Search_Flights" for search_flights). And the schemas rewritten for providers that read the OpenAPI subset
 * (Gemini): ["string", "null"] becomes type: "string", nullable: true.
 */

type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema };

const typeOk = (t: string, v: unknown) =>
  t === "null" ? v === null
    : t === "integer" ? typeof v === "number" && Number.isInteger(v)
      : t === "number" ? typeof v === "number" && Number.isFinite(v)
        : t === "array" ? Array.isArray(v)
          : t === "object" ? !!v && typeof v === "object" && !Array.isArray(v)
            : typeof v === t;

/** What is wrong with `value` for `schema`, as short lines the model can act on. Empty when it fits. */
export function schemaProblems(schema: Schema, value: unknown, path = "input"): string[] {
  const out: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => typeOk(t, value))) return [`${path} must be ${types.join(" or ")}`];
  if (schema.enum && !schema.enum.includes(value as never)) return [`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`];
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) out.push(`${path}.${k} is required (use null when unknown)`);
    if (schema.additionalProperties === false) for (const k of Object.keys(obj)) if (!(k in schema.properties)) out.push(`${path}.${k} is not a field`);
    for (const [k, s] of Object.entries(schema.properties)) if (k in obj) out.push(...schemaProblems(s, obj[k], `${path}.${k}`));
  }
  if (Array.isArray(value) && schema.items) value.forEach((x, i) => out.push(...schemaProblems(schema.items!, x, `${path}[${i}]`)));
  return out.slice(0, 6);
}

/** The declared name a call meant: exact, or the one name that matches ignoring case and separators. */
export function toolNameFor(name: string, names: readonly string[]): string | null {
  if (names.includes(name)) return name;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hits = names.filter((n) => norm(n) === norm(name));
  return hits.length === 1 ? hits[0]! : null;
}

/** A JSON schema as the OpenAPI subset (Gemini): nullable instead of a null type, no additionalProperties. */
export function toOpenApiSchema(s: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  const real = types.filter((t) => t !== "null");
  if (real.length) out.type = real[0];
  if (types.includes("null")) out.nullable = true;
  if (s.enum) out.enum = s.enum.filter((e) => e !== null);
  for (const [k, v] of Object.entries(s)) {
    if (k === "type" || k === "enum" || k === "additionalProperties" || k === "properties" || k === "items") continue;
    out[k] = v;
  }
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toOpenApiSchema(v)]));
  if (s.items) out.items = toOpenApiSchema(s.items);
  return out;
}
