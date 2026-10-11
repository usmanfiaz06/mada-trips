import { z } from "zod";
import { json, resilient } from "@/lib/app/http";
import { ticketStatus } from "@/lib/app/phone-channel";

// GET /api/app/v1/auth/phone-channel/{ticket} → { sentVia: "whatsapp" | "sms" | null }.
// How the code for this ticket actually went (WhatsApp can fall back to SMS), so the code screen says the right one.
// The ticket is an unguessable id only the app that left the hint holds; unknown or old tickets read as null.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticket: string }> }) {
  return resilient(req, async () => {
    const ticket = (await ctx.params).ticket;
    const body = z.uuid().safeParse(ticket).success ? await ticketStatus(ticket) : { sentVia: null };
    return json(body, 200, { "Cache-Control": "no-store" });
  });
}
