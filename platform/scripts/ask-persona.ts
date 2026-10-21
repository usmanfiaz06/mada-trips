/*
 * Writes the persona blocks of the Ask conversation's system prompts from docs/app/ASSISTANT.md §1 and §1a (the single
 * source for how Mada answers). Run after editing that section:
 *
 *   npm run ask:persona
 *
 * test/app/ask-chat-persona.test.ts fails while ask-chat/persona.ts and the doc differ.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personaFile, personaFromDoc } from "../src/lib/app/ask-chat/persona-doc";

const root = join(import.meta.dirname, "..");
const doc = readFileSync(join(root, "..", "docs", "app", "ASSISTANT.md"), "utf8");
writeFileSync(join(root, "src", "lib", "app", "ask-chat", "persona.ts"), personaFile(personaFromDoc(doc), personaFromDoc(doc, "persona-compact")));
console.log("ask:persona: wrote src/lib/app/ask-chat/persona.ts from docs/app/ASSISTANT.md");
