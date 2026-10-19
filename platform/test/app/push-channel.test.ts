import { describe, expect, it } from "vitest";
import { channelForKind } from "@/lib/app/push";

// Android notification channels: the app creates the same three (apps/mobile src/lib/notification-channels.ts).
describe("push channel", () => {
  it("people answering go to Messages, offers to Offers, everything about the trip to Trip updates", () => {
    expect(channelForKind("agent_reply")).toBe("messages");
    expect(channelForKind("agent_needs_answer")).toBe("messages");
    expect(channelForKind("circle")).toBe("messages");
    expect(channelForKind("offer_price_drop")).toBe("offers");
    for (const k of ["gate_change", "leave_now", "driver_here", "booking_confirmed", "flight_cancelled", "digest", "other"]) expect(channelForKind(k)).toBe("trip-updates");
  });
});
