import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { pushOutbox } from "@/lib/app/push";
import { db } from "@/db";
import { appDevices } from "@/db/app-schema";
import { fakeApi } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { signIn } from "./wallet-helpers";

/* A reply that finishes after the traveller has left the app comes as a push that opens that chat. */

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; pushOutbox.length = 0; });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; });

const post = (token: string, signal?: AbortSignal) => chatPost(new Request("http://localhost/api/app/v1/ask/chat", {
  method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify({ text: "Any ideas for a weekend away?" }),
}));

describe("Ask reply push", () => {
  it("the traveller gone: the turn finishes and the reply is pushed with a link to the chat", async () => {
    const { token, user } = await signIn();
    const userId = user.id;
    await db.insert(appDevices).values({ userId, platform: "ios", pushToken: `ExponentPushToken[askreply${Date.now()}]` } as never);
    setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "AlUla in the cool months is lovely.\n<next>Plan AlUla | Other ideas</next>" }] })));
    const abort = new AbortController();
    const res = await post(token, abort.signal);
    abort.abort();
    await res.text().catch(() => "");
    await new Promise((r) => setTimeout(r, 50));
    const sent = pushOutbox[0];
    expect(sent?.title).toBe("Mada");
    expect(sent?.body).toContain("AlUla in the cool months");
    expect(sent?.body).not.toContain("<next>");
    expect(sent?.channel).toBe("messages");
  });

  it("the traveller still there: no push", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "AlUla is lovely." }] })));
    await (await post(token)).text();
    expect(pushOutbox.length).toBe(0);
  });
});
