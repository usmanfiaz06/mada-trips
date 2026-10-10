import { addDays } from "@mada/shared";
import type { AiSupplier, Intent } from "../types";

/* A rule-based stand-in for the concierge: enough to drive the Ask flow in development without an API key. */

const CITIES: Record<string, string> = { istanbul: "IST", dubai: "DXB", london: "LHR", cairo: "CAI", baku: "GYD", alula: "ULH", jeddah: "JED", riyadh: "RUH", doha: "DOH", tbilisi: "TBS", abha: "AHB" };

export const mockAi: AiSupplier = {
  name: "mock-ai",
  async parseIntent(text, ctx): Promise<Intent> {
    const s = text.toLowerCase();
    const kind: Intent["kind"] = /visa|schengen/.test(s) ? "visa" : /umrah/.test(s) ? "umrah" : /hotel|stay|room/.test(s) ? "stay"
      : /car|driver/.test(s) ? "car" : /table|dinner|restaurant/.test(s) ? "restaurant" : /flight|fly|ticket/.test(s) || Object.keys(CITIES).some((c) => s.includes(c)) ? "flight" : "general";
    const to = Object.entries(CITIES).find(([c]) => s.includes(c))?.[1] ?? null;
    const n = /(\d+)\s*(of us|people|travellers|adults)/.exec(s)?.[1] ?? (/family/.test(s) ? "4" : null);
    const eid = /\beid\b/.test(s);
    const depart = eid ? "2027-03-09" : /tomorrow/.test(s) ? addDays(ctx.today, 1) : null;
    const ask: Intent["ask"] = kind === "general" ? null : !to && kind !== "visa" ? "where" : !depart ? "when" : !n ? "who" : null;
    return { kind, to, from: to ? ctx.home : null, depart, return: depart && eid ? addDays(depart, 6) : null, travellers: n ? Number(n) : null, ask };
  },
  async answer(question) {
    return `We'll check that and come back with an answer. Faisal can also help: ${question.slice(0, 60)}`;
  },
};
