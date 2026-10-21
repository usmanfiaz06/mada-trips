/*
 * The persona blocks of docs/app/ASSISTANT.md (between `<!-- persona:start -->` and `<!-- persona:end -->`, and the
 * compact one between `<!-- persona-compact:start -->` and `<!-- persona-compact:end -->`), and the persona.ts that
 * carries them into the system prompts. Pure: the script writes with it, the test compares with it.
 */

export function personaFromDoc(doc: string, block: "persona" | "persona-compact" = "persona"): string {
  const m = new RegExp(`<!-- ${block}:start -->\\n([\\s\\S]*?)\\n<!-- ${block}:end -->`).exec(doc.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`docs/app/ASSISTANT.md has no ${block} block`);
  return m[1]!.trim();
}

export function personaFile(persona: string, compact: string): string {
  for (const p of [persona, compact]) if (/[`\\]|\$\{/.test(p)) throw new Error("the persona blocks may not hold backticks, backslashes or ${");
  return `/*
 * Generated from docs/app/ASSISTANT.md §1 and §1a by \`npm run ask:persona\`. Do not edit here: edit the doc and run it
 * again. The first part of the frozen system prompts (prompt.ts): PERSONA for Claude, PERSONA_COMPACT (the same rules,
 * fewer words) for openai-compatible providers on free tiers.
 */

export const PERSONA = \`${persona}\`;

export const PERSONA_COMPACT = \`${compact}\`;
`;
}
