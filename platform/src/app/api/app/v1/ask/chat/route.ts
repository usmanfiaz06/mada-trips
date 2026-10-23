import { AskChatRequest, type AskChatEvent } from "@mada/shared";
import { body, route } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { authenticate } from "@/lib/app/tokens";
import { isProductionDeploy } from "@/lib/app/config";
import { chatTurn, errorCode, preflight } from "@/lib/app/ask-chat/chat";
import { scrubResponse } from "@/lib/app/shield";
import { pushToUser } from "@/lib/app/push";
import { after } from "next/server";

// POST /ask/chat { text, threadId?, tripId? } → text/event-stream of AskChatEvent (schemas/ask-chat.ts): thread, status,
// text (deltas), cards, intent, pay, handoff, replace, done; error { code, fallback: true } when the app should answer
// with its own flows. Signed in only. Off unless ASK_CHAT=on and ANTHROPIC_API_KEY is set (501 NOT_CONFIGURED); the
// per-person limits and the daily spend cap answer 429 before any stream opens. docs/app/ASK-CHAT.md.
// The traveller leaving (the app sent to the background, the screen closed) doesn't stop the turn: it finishes, is
// saved to the thread as usual, and the reply comes as a push ("messages" channel) that opens that chat.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const enc = new TextEncoder();
// Each event as the app may see it (shield.ts): cards carry stays, plans and photos like any JSON answer does.
const frame = (e: AskChatEvent, origin: string) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(scrubResponse(e, origin))}\n\n`);

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, AskChatRequest);
  const { ipHash } = requestContext(req);
  await preflight({ userId, ipHash });

  const origin = new URL(req.url).origin;
  const abort = new AbortController();
  let gone = false;
  let threadId: string | null = null;
  let lang = "en";
  let reply = "";
  req.signal?.addEventListener("abort", () => { gone = true; }, { once: true });
  let finished: () => void = () => {};
  // Keeps the function alive until the turn ends, even after the traveller has gone.
  const done = new Promise<void>((resolve) => { finished = resolve; });
  try { after(() => done); } catch { /* outside a request (tests): nothing to keep alive */ }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: AskChatEvent) => {
        if (e.type === "thread") { threadId = e.threadId; lang = e.lang; }
        if (e.type === "done") reply = e.text;
        if (open) { try { controller.enqueue(frame(e, origin)); } catch { open = false; gone = true; } }
      };
      try {
        await chatTurn({ userId, ipHash }, input, emit, abort.signal);
        if (gone && threadId && reply.trim()) {
          const body = reply.replace(/<next>[\s\S]*?<\/next>/g, "").replace(/\s+/g, " ").trim();
          await pushToUser(userId, { title: lang === "ar" ? "مادا" : "Mada", body: body.length > 140 ? `${body.slice(0, 139)}…` : body, data: { href: `/ask/${threadId}` }, channel: "messages" }).catch(() => {});
        }
      } catch (e) {
        if (!abort.signal.aborted) console.warn("[ask-chat] turn stopped:", e instanceof Error ? `${e.name} ${"status" in e ? String((e as { status?: number }).status) : ""}` : "");
        emit({ type: "error", code: errorCode(e), fallback: true });
        // Staging only: the provider's own words, to find why a turn stopped (never on production).
        if (!isProductionDeploy() && e instanceof Error) {
          const detail = "detail" in e ? String((e as { detail?: unknown }).detail ?? "") : "";
          controller.enqueue(enc.encode(`event: debug\ndata: ${JSON.stringify({ type: "debug", name: e.name, message: e.message.slice(0, 200), detail: detail.slice(0, 1500) })}\n\n`));
        }
      } finally {
        open = false;
        try { controller.close(); } catch { /* already closed by the client going away */ }
        finished();
      }
    },
    cancel() { gone = true; },
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
