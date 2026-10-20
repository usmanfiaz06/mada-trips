import { AskChatRequest, type AskChatEvent } from "@mada/shared";
import { body, route } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { authenticate } from "@/lib/app/tokens";
import { chatTurn, errorCode, preflight } from "@/lib/app/ask-chat/chat";

// POST /ask/chat { text, threadId?, tripId? } → text/event-stream of AskChatEvent (schemas/ask-chat.ts): thread, status,
// text (deltas), cards, intent, pay, handoff, replace, done; error { code, fallback: true } when the app should answer
// with its own flows. Signed in only. Off unless ASK_CHAT=on and ANTHROPIC_API_KEY is set (501 NOT_CONFIGURED); the
// per-person limits and the daily spend cap answer 429 before any stream opens. docs/app/ASK-CHAT.md.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const enc = new TextEncoder();
const frame = (e: AskChatEvent) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, AskChatRequest);
  const { ipHash } = requestContext(req);
  await preflight({ userId, ipHash });

  const abort = new AbortController();
  req.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: AskChatEvent) => { if (open) { try { controller.enqueue(frame(e)); } catch { open = false; } } };
      try {
        await chatTurn({ userId, ipHash }, input, emit, abort.signal);
      } catch (e) {
        if (!abort.signal.aborted) console.warn("[ask-chat] turn stopped:", e instanceof Error ? `${e.name} ${"status" in e ? String((e as { status?: number }).status) : ""}` : "");
        emit({ type: "error", code: errorCode(e), fallback: true });
      } finally {
        open = false;
        try { controller.close(); } catch { /* already closed by the client going away */ }
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { idempotent: false });
