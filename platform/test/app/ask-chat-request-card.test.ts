import { describe, expect, it } from "vitest";
import type { Person } from "@mada/shared";
import { requestCard, type ToolCtx } from "@/lib/app/ask-chat/tools";

/* The request card in the Ask chat: what, where, when and who written out, each said once ("You · You" never). */

const person = (id: string, firstName: string, isSelf = false) => ({ id, firstName, isSelf }) as unknown as Person;
const ctx = { people: [person("p1", "Omar", true), person("p2", "Hessa")] } as unknown as ToolCtx;
const base = { id: "r1", kind: "food", title: "Restaurant table", promisedBy: "2026-10-21T08:06:00.000Z", contact: { preference: "whatsapp" as const } };

describe("the request card", () => {
  it("drops parts that are only the travellers' names, and says each part once", () => {
    const c = requestCard(ctx, { ...base, summary: "You", detail: "You" }, ["p1"], { where: "Istanbul", depart: "2026-11-10", return: null });
    expect(c).toMatchObject({ type: "request", detail: "", where: "Istanbul", depart: "2026-11-10", contact: "whatsapp", who: [{ name: "Omar", self: true }] });
  });
  it("keeps what was asked, and lists who goes", () => {
    const c = requestCard(ctx, { ...base, summary: "Dinner for two · Omar and Hessa", detail: "Dinner for two" }, ["p1", "p2"], { where: null, depart: null, return: null });
    expect(c).toMatchObject({ detail: "Dinner for two", who: [{ name: "Omar", self: true }, { name: "Hessa", self: false }] });
  });
});
