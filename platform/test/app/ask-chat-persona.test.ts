import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONA } from "@/lib/app/ask-chat/persona";
import { personaFile, personaFromDoc } from "@/lib/app/ask-chat/persona-doc";
import { SYSTEM_PROMPT } from "@/lib/app/ask-chat/prompt";
import { nextFromState, parseNext } from "@/lib/app/ask-chat/next";
import { firstSentence, isCloser, openEndedIn } from "@/lib/app/ask-chat/guard";
import { checkTurn } from "@/lib/app/ask-chat/evals";

/* How Mada answers (docs/app/ASSISTANT.md): one source for every model, and never an open-ended reply. */

const DOC = readFileSync(join(__dirname, "..", "..", "..", "docs", "app", "ASSISTANT.md"), "utf8");

describe("the persona", () => {
  it("is docs/app/ASSISTANT.md §1 word for word (run npm run ask:persona after editing the doc)", () => {
    expect(PERSONA).toBe(personaFromDoc(DOC));
    expect(readFileSync(join(__dirname, "..", "..", "src", "lib", "app", "ask-chat", "persona.ts"), "utf8")).toBe(personaFile(personaFromDoc(DOC)));
  });
  it("opens the frozen system prompt, which holds nothing that changes per person or turn", () => {
    expect(SYSTEM_PROMPT.startsWith(PERSONA)).toBe(true);
    expect(SYSTEM_PROMPT).toContain("<next>");
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });
});

describe("the next step", () => {
  it("reads the model's choices and holds each to the price and word checks", () => {
    expect(parseNext("<next>Book the Saudia at 09:40 | Hotels near Taksim | Change dates</next>", "SV263 RUH 09:40")).toEqual(["Book the Saudia at 09:40", "Hotels near Taksim", "Change dates"]);
    expect(parseNext("<next>Book it for SAR 999 | Our smart picks | Change dates</next>", "SAR 2,025")).toEqual(["Change dates"]);
    expect(parseNext("<next>احجز السعودية · فنادق قريبة · تواريخ ثانية</next>", "")).toHaveLength(3);
  });
  it("fills chips from the turn when the model left none", () => {
    expect(nextFromState({ cards: [], pay: false, handoff: false, lang: "en" })).toEqual(["Find flights", "Find a hotel", "Get an eSIM"]);
    expect(nextFromState({ cards: [{ type: "car", city: "Istanbul", from: "IST", to: "Taksim", when: "now" }], pay: false, handoff: false, lang: "ar" })).toEqual(["أكّد مكان الركوب", "بعد ربع ساعة", "غيّر الوجهة"]);
    expect(nextFromState({ cards: [], pay: false, handoff: true, lang: "en" })[0]).toBe("Open the chat");
  });
  it("knows a closer, an open end and a preamble in both languages", () => {
    expect(isCloser("Anything else?")).toBe(true);
    expect(isCloser("Let us know if you need anything.")).toBe(true);
    expect(isCloser("هل في أي خدمة ثانية؟")).toBe(true);
    expect(isCloser("Let's look at Thursday instead.")).toBe(false);
    expect(openEndedIn("Here are three. How can I help further?")).toEqual(["How can I help"]);
    expect(openEndedIn("هذي ثلاث خيارات. تبي شي ثاني؟")).not.toEqual([]);
    expect(firstSentence("Great question! Istanbul is lovely.").preamble).toBe(true);
    expect(firstSentence("Which dates? We can look at Eid.").question).toBe(true);
    expect(firstSentence("Three ways to get there. Which one?").question).toBe(false);
  });
  it("is checked by the evals: choices or said choices, no open end, the answer first", () => {
    const base = { raw: "", toolsUsed: [], toolText: "", dropped: 0, closers: 0 };
    expect(checkTurn({ user: "x", noTools: true }, "en", { ...base, text: "Maths is beyond us, travel isn't.", modelChoices: ["AlUla for a weekend", "Not now"] })).toEqual([]);
    expect(checkTurn({ user: "x", noTools: true }, "en", { ...base, text: "Three ways to get there. The Saudia, or the flynas for less?", modelChoices: [] })).toEqual([]);
    const bad = checkTurn({ user: "x", noTools: true }, "en", { ...base, raw: "Sure, how can I help?", text: "Sure, how can I help?", modelChoices: [] });
    expect(bad.join(" | ")).toMatch(/next: .*open: how can I help.*first: starts with a preamble/);
    expect(checkTurn({ user: "x", noTools: true }, "en", { ...base, text: "Which city? We can search.", modelChoices: ["Dubai", "Istanbul"] })).toEqual([expect.stringMatching(/^first: starts with a question/)]);
  });
});
