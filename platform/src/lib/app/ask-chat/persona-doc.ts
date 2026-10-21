/*
 * The persona block of docs/app/ASSISTANT.md (between `<!-- persona:start -->` and `<!-- persona:end -->`), and the
 * persona.ts that carries it into the system prompt. Pure: the script writes with it, the test compares with it.
 */

export function personaFromDoc(doc: string): string {
  const m = /<!-- persona:start -->\n([\s\S]*?)\n<!-- persona:end -->/.exec(doc.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("docs/app/ASSISTANT.md has no persona block");
  return m[1]!.trim();
}

export function personaFile(persona: string): string {
  if (/[`\\]|\$\{/.test(persona)) throw new Error("the persona block may not hold backticks, backslashes or ${");
  return `/*
 * Generated from docs/app/ASSISTANT.md §1 by \`npm run ask:persona\`. Do not edit here: edit the doc and run it again.
 * The first part of the frozen system prompt (prompt.ts), the same for every provider.
 */

export const PERSONA = \`${persona}\`;
`;
}
