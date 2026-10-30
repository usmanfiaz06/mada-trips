import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { quietSkip } from "@/lib/app/jobs";

const at = (min: number) => new Date(Date.UTC(2026, 9, 30, 12, min));
afterEach(() => { delete process.env.APP_CRONS; delete process.env.APP_ENV; });

describe("APP_CRONS=quiet lets a free staging database sleep", () => {
  it("off by default: every job runs", () => {
    expect(quietSkip(["flights"], at(35))).toBe(false);
  });
  it("quiet: the frequent jobs run only in the first 10 minutes of the hour", () => {
    process.env.APP_CRONS = "quiet";
    expect(quietSkip(["flights"], at(5))).toBe(false);
    expect(quietSkip(["flights"], at(35))).toBe(true);
    expect(quietSkip(["desk", "finance"], at(48))).toBe(true);
  });
  it("quiet: hourly and daily jobs still run when scheduled", () => {
    process.env.APP_CRONS = "quiet";
    expect(quietSkip(["hotelbeds"], at(41))).toBe(false);
    expect(quietSkip(["deletions"], at(17))).toBe(false);
  });
  it("never on production", () => {
    process.env.APP_CRONS = "quiet"; process.env.APP_ENV = "production";
    expect(quietSkip(["flights"], at(35))).toBe(false);
  });
});
