# Ask Mada as a conversation

**Status:** built, off by default. It comes on with `ASK_CHAT=on` and `ANTHROPIC_API_KEY`. Until both are set, Ask works exactly as before (the flows from `/ask/parse`).

**What the owner asked for:** "Make Ask Mada conversational like a real assistant, not automated replies suggesting Today / next week."

**What this builds:** Ask talks back like a warm, brief Saudi travel host. It answers in 1 to 3 short sentences and then shows the cards the app already draws. It acts through tools that run on the server as the signed-in traveller. It never makes up a price.

---

## 1. Architecture

```
app/ask.tsx ──POST /api/app/v1/ask/chat {text, threadId?, tripId?}──▶ route.ts (signed in, idempotency off)
     ▲                                                                     │ preflight: ASK_CHAT + key, per-minute/day limits,
     │  text/event-stream (AskChatEvent, packages/shared/src/schemas/ask-chat.ts)   daily spend caps → 501/429 before any stream
     │  thread · intent · status · text… · cards · pay · handoff · replace · done | error{fallback}
     │                                                                     ▼
     │                         lib/app/ask-chat/chat.ts   moderation (screen) → redaction → thread → context
     │                                                    → slots (rules, then Haiku) → engine → append + spend + log
     │                         lib/app/ask-chat/engine.ts streaming tool loop (≤ 6 steps) + SentenceGate
     │                         lib/app/ask-chat/tools.ts  12 tools over the same functions the app's routes call
     │                         lib/app/ask-chat/guard.ts  redact · screen · unbacked · banned words · tidy
     └── on error / off / no key / offline / guest: the app's own flows (POST /ask/parse), as before
```

### Server pieces

| File | What it does |
|---|---|
| `platform/src/app/api/app/v1/ask/chat/route.ts` | The SSE endpoint. It checks everything that can fail before it opens a stream, so the app gets an ordinary error. Once the stream is open, any failure arrives as `error {code, fallback: true}`. |
| `ask-chat/config.ts` | Switches, models, limits, prices and cost in micro-dollars. |
| `ask-chat/prompt.ts` | The **frozen** system prompt and the strict tool list. They are the same for everyone and in a fixed order, so they cache. |
| `ask-chat/engine.ts` | One turn: a streamed message in a manual tool loop, the sentence gate, refusal and `max_tokens` handling. |
| `ask-chat/providers.ts` | Who answers, behind one interface (§6). Claude through the official SDK (`client.beta.messages.stream`) by default. |
| `ask-chat/providers-openai.ts` | A thin adapter for any OpenAI-compatible `/chat/completions` endpoint, for comparing cheaper models. |
| `ask-chat/slots.ts` | Reads the sentence into slots. The deterministic rules run first. Haiku runs only when the rules leave something open, with a 4 s timeout. |
| `ask-chat/tools.ts` | The tools. Each one returns a short text for the model and the cards, pay sheet or handoff for the app. |
| `ask-chat/store.ts` | Threads (`app_ask_threads`) and daily spend (`app_ask_spend`). Migration: `drizzle/0034_ask_chat.sql`. |
| `ask-chat/evals.ts` + `platform/scripts/ask-chat-eval.ts` | The eval set and its runner. |

### How a turn runs

1. Preflight checks four things, before any stream opens:
   - `ASK_CHAT=on` and the key are set (otherwise 501).
   - Turns per person: 8 a minute and 120 a day by default (otherwise 429).
   - Spend today: per person, and in total (otherwise 429 with `details.budget`).
2. Moderation: `screenText` from `packages/shared/src/moderation.ts` runs on what the traveller typed. Abuse or a scam gets the fixed line `chat.abuse` and never reaches the model. Contact details and links are allowed, because this is a private chat with Mada.
3. Redaction: passport numbers, MRZ lines, card numbers (Luhn-checked), CVVs and IBANs become words like `[passport number removed]`. This happens before anything reaches the model or the thread. Household lines carry name, relation, age and nationality only, never a passport.
4. Context: one text block goes in front of the traveller's words in the same user message. It is labelled as Mada's systems, not the traveller. It holds:
   - today
   - the reply language
   - the household, with ages
   - upcoming trips
   - the trip on screen
   - the slots read from the sentence

   Because the context sits inside the turn, the cached prefix (tools and system) never changes. The thread is append-only: every assistant message is stored exactly as the API returned it, thinking blocks included, so preserved thinking stays valid.
5. Engine:
   - `stream` call settings: model `claude-sonnet-5-5`, `output_config.effort: "low"`, `thinking: {type: "adaptive"}`, `max_tokens` 4096, `cache_control` on the system block, and top-level automatic caching so the conversation's own history caches as it grows.
   - Refusal fallbacks are on (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
   - Tool calls in one step run in parallel, and all their results go back in one message. A failed tool returns `is_error` with a plain sentence. The prompt tells the model to say so and offer the next step.
   - `stop_reason: "refusal"` ends the turn with the fixed line `chat.refusal`.
   - `max_tokens` on a step that holds a tool call never runs the tool.
6. Sentence gate: words stream as they arrive. A sentence that contains a digit is held until it ends. It is shown only if every price and clock time in it appears in a tool result from this turn, and it has no banned word (COPY.md §3.2, English and Arabic). A sentence that fails is dropped. If part of it had already been shown, a `replace` event sends the cleaned text. If nothing is left, the fixed line is `chat.found` (when there are cards) or `chat.cant`. Exclamation marks, em dashes and emoji are tidied away as the words stream.
7. Append the turn, add the spend, and write one log line. The line holds thread id, turn number, model, input/output/cache tokens, USD, tools used, the stop reason and how many items were redacted. **Message bodies are never logged.**

### Tools (strict JSON schemas, run server-side as the traveller)

| Tool | Calls | The app gets |
|---|---|---|
| `search_flights` | `searchFlights` (booking/search.ts) | `flights` card (≤ 3 `FlightOption`s plus the search) |
| `search_stays` | `searchStays`, then `parseStayWishes` + `refineStays` for wishes and distance from a landmark | `stays` card (≤ 3 `StayOption`s, `near`) |
| `get_hotel` | `hotelContent` | — |
| `esim_plans` | `esimPlans` | `esim` card (≤ 3 `EsimPlan`s) |
| `plan_car_now` | nothing is booked: what was said becomes a card | `car` card; the app's car flow confirms the meeting point |
| `get_trips` / `get_trip` | `overview` / `tripDetail` (photos, links, passport and eSIM codes stripped, then redacted) | `trips` card |
| `get_household` | the household from the turn (name, relation, age) | — |
| `entry_rules` | `checkEntry` (visa, ETA, passport, from each person's nationality) | `entry` card |
| `create_request` | `createRequest` (the desk), only after the traveller says yes | `request` card |
| `price_quote_for_pay` | `priceDraft`: prices the offer again, **never charges** | `pay` event with an `OrderDraft`; the app opens its own pay sheet |
| `talk_to_human` | `openThread` + `sendMessage` (summary, redacted) + `presenceFor` | `handoff` event. The app says the duty person's name ("Noura at Mada can take it from here") only when the desk names someone online; otherwise "The team at Mada…" (COPY.md §1) |

Every tool goes through the same checks as the app's own routes. Offers must belong to the caller. Person ids the model gives are filtered to the household, and an empty list means the account holder. Days in the past are refused.

### In the app

| Piece | What it does |
|---|---|
| `apps/mobile/src/lib/ask-chat.ts` | `useAskChatOn()` is true only when GET `/config` has `features.askChat`, the traveller is signed in, and the API is live (not mock). `streamAskChat` uses `fetch` on web and `expo/fetch` on native, and reads frames with the shared `readSseFrames`. A 25 s silence counts as a stop. |
| `components/booking/ChatThread.tsx` | Shows the disclosure line (COPY.md §6.3), the traveller's bubble and Mada's words token by token. While Mada works it shows a typing line with what is being done ("Checking flights to Istanbul…"), then the cards. The cards reuse `StayCard` and `PlanCard`, plus a compact flight row. Tapping a card opens the full flow (FlightFlow, StayFlow, EsimFlow, the visa or car request flow) for the same search. Pay goes to `/pay` with the draft. The handoff goes to `/support`. |
| `app/ask.tsx` | A new ask goes to the conversation. Corrections to a flow that is open still run on the phone (`correctAsk`). |

**Never a dead end.** Ask falls back to its own flows whenever the conversation can't answer. That covers:
- `ASK_CHAT=off`
- no key (staging today)
- a guest
- mock mode
- offline
- a 4xx/5xx
- an `error` event
- a broken stream

In the fallback, the server's `intent` from that turn is used when it arrived; otherwise the words are read again through `/ask/parse`. A turn that said nothing is removed, as if the conversation had never been there.

**One tension with COPY.md §6.1.** That section says "Answers are not typed out word by word". The owner asked for streamed text with typing presence, so the words stream. The other §6 rules still hold: no avatar or orb with a face, no AI words, "we" and never "I", and the disclosure line on every thread. The writer may want to revisit §6.1.

## 2. Models and why

| Job | Model (env) | Why |
|---|---|---|
| The conversation | `claude-sonnet-5-5` (`ASK_CHAT_MODEL`) at effort `low`, adaptive thinking | The first words come fast. It is reliable with tools and with holding a persona and voice. It costs $2 / $10 per MTok, half of Opus 5.5. At `low` it skips thinking on most simple turns, which is the right trade for chat. |
| Reading the sentence into slots | `claude-haiku-5-5` (`ASK_FAST_MODEL`) | About a second at $0.10 / $0.50. It runs only when the deterministic rules leave something open. What it reads goes to the conversation as context (so it doesn't re-ask) and to the app as `intent` (for the fallback). |

`/ask/parse` (the flows) still uses `ANTHROPIC_MODEL`, unchanged.

## 3. What a conversation costs

The cached prefix (system prompt about 1,000 tokens, plus 12 strict tools about 2,000, plus tool-use overhead) is about **3,300 tokens**. It caches for everyone: Sonnet 5.5's minimum is 512.

| | Tokens | Cost |
|---|---|---|
| One request, warm cache | 3,300 cache read ($0.20/M) + about 600–1,200 uncached (context, words, tool results; $2/M) + about 120 out ($10/M) | about **$0.0034** |
| One turn with a search | 2 requests (tool call, then the answer), with the history caching as it grows | about **$0.007** |
| Slots (Haiku) | about 700 in, 80 out, on about half of turns | about $0.0001 |
| **A 4-turn conversation** (search, correction, a question, book) | about 8 requests | **about $0.03** (the first request after a cold cache adds a $0.008 write) |

Totals at these rates:
- 1,000 conversations a day is about $30.
- The default caps are $1 per person per day (about 30 conversations) and $50 in total per day.
- The eval run reports the measured cost of each turn and the total, so check these numbers on the first live run.

## 4. Turning it on (staging)

1. Vercel → project **mada-staging** → Settings → Environment Variables (Preview/Staging only, never Production):
   - `ANTHROPIC_API_KEY` = the staging key (set in Vercel only; never in the repo or a chat)
   - `ASK_CHAT` = `on`
   - optional: `ASK_CHAT_MODEL`, `ASK_FAST_MODEL`, `ASK_CHAT_PER_MINUTE` (8), `ASK_CHAT_PER_DAY` (120), `ASK_CHAT_USER_DAILY_USD` (1), `ASK_CHAT_DAILY_USD` (50)
2. Redeploy. Migration `0034_ask_chat` must be applied on the staging database (`npm --prefix platform run db:migrate` against it). Preview builds skip migrations.
3. Check that GET `/api/app/v1/config` shows `features.askChat: true`. The app picks it up on its next config refresh (at most 10 minutes, or on reopen).
4. To turn it off, set `ASK_CHAT=off` (or remove the key). `askChat` goes false and the app goes back to the flows on its next config read. Any stream already open finishes, or falls back.

## 5. Evals

**Deterministic (no key, every CI run):**
- `platform/test/app/ask-chat.test.ts` runs a mocked Anthropic client through the real route, database and tools. It covers:
  - the switch and `/config`
  - streaming order and caching settings
  - no unbacked price reaching the screen
  - thread memory and ownership
  - Arabic
  - redaction
  - abuse
  - refusal
  - API down → fallback
  - pay sheet and handoff
  - the spend cap
  - the guards
  - the eval checker itself
- `apps/mobile/test/unit/ask-chat.test.ts` covers frames split mid-way, the turn reducer, the thread id carried across turns, and every fallback path.

**Live (needs a key, costs about $0.10 for the set on Claude):**

```
ANTHROPIC_API_KEY=… npm run ask:eval              # all 30
ANTHROPIC_API_KEY=… npm run ask:eval -- visa-uk ar-esim
```

There are 30 conversations, 20 in English and 10 in Arabic. They cover:
- a family Eid trip and its correction
- Umrah with a permit
- a car now
- an eSIM for Pakistan for 10 days
- a UK visa for me and my wife
- prices with no dates
- a hotel with a pool
- an open question
- off-topic, rude and stranded messages
- "book the cheapest"
- a person
- trips
- Tbilisi, then business class
- Muscat by hand
- a table
- a baby on a flight

Each one runs through the real engine, with fixture tool results and no database. Every turn is checked for:
- **prices**: no price or time in the model's raw words that no tool returned
- **one**: at most one question
- **lang**: reply language matches the traveller's
- **tools**: the right tools were used, or one question where that is allowed, and no forbidden tool
- **words**: no banned words

The script exits 1 on any failure and prints the tokens and cost of each turn.

**Comparing providers.** The same 30 conversations, fixtures and checks run against any number of profiles in one go, followed by a table:

```
ASK_EVAL_PROFILES=profiles.json ANTHROPIC_API_KEY=… DEEPSEEK_API_KEY=… npm run ask:eval
```

`profiles.json` (or the same JSON inline in the variable):

```json
[
  { "label": "claude", "provider": "anthropic", "model": "claude-sonnet-5-5", "fastModel": "claude-haiku-5-5" },
  { "label": "deepseek", "provider": "openai-compatible", "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com/v1", "apiKeyEnv": "DEEPSEEK_API_KEY", "price": [0.27, 1.10, 0.07] }
]
```

Keys are read only from the environment variable each profile names, never from the file. `price` is US dollars per million tokens, as input, output and cache read; Claude models are priced from `config.ts`. The table has one row per profile:

| Column | What it shows |
|---|---|
| Pass | Turns that pass every check |
| Failures by check | One count each for prices, one question, language, tools (including asking again what was already said) and words |
| Arabic: spoken / MSA markers | A first read of the dialect: spoken words («وش، الحين، تبي، أبشر») against MSA words («ماذا، الآن، تريد، سوف») |
| Median latency | Per turn, slots included |
| Tokens / conv | Tokens per conversation |
| $ / conv | Cost per conversation |

Three Arabic replies from each profile are printed under the table for a native reader. The dialect markers only flag what to read; the native reader's judgement is the one that counts. ARABIC.md is the bar.

**Not yet run live.** No key exists in this environment yet. The first run on staging should come before switching it on for testers.

## 6. Providers: comparing cheaper models

The conversation talks to its model through one small interface, `ChatApi` in `ask-chat/providers.ts`:
- `stream(params)` yields stream events and a final message.
- `create(params)` is used for the slots.

It speaks the Messages API's shapes, so the engine, the sentence gate, the tools, the threads, the redaction and the evals are the same whichever model answers. **Claude stays the default and the production path.**

| `ASK_CHAT_PROVIDER` | Status | Settings |
|---|---|---|
| `anthropic` (default) | Done: the official SDK, with caching, refusal fallbacks and adaptive thinking | `ANTHROPIC_API_KEY`, `ASK_CHAT_MODEL`, `ASK_FAST_MODEL` |
| `openai-compatible` | Done: a thin adapter (`providers-openai.ts`) for DeepSeek, Qwen, Kimi, GLM, vLLM or Ollama, or anything that serves `/chat/completions` with streaming and function tools | `ASK_CHAT_BASE_URL`, `ASK_CHAT_API_KEY`, `ASK_CHAT_MODEL` (required), `ASK_FAST_MODEL` (default: the chat model), `ASK_CHAT_PRICE` (`in,out,cacheRead` USD per MTok, for the spend cap and the log) |
| `bedrock` | Not wired: it needs the `@anthropic-ai/bedrock-sdk` dependency, and the betas used here (server-side fallbacks) aren't on Bedrock. Adding it is one more `ChatApi` that leaves out `betas` and `fallbacks`. | — |
| anything else | Off: `askChat` is false and the app runs its flows | — |

**What the adapter does.** It translates in both directions:
- **Into `/chat/completions`:**
  - The system blocks become one system message.
  - Text blocks become content, `tool_use` becomes `tool_calls`, and `tool_result` becomes `role: "tool"`.
  - Thinking blocks and Claude-only fields (`betas`, `fallbacks`, `thinking`, `output_config`, `cache_control`) are dropped.
  - Tools become function tools with the same JSON schemas.
- **Back to the engine's shapes:**
  - Streamed content becomes text deltas, and a new tool call becomes a tool-use start.
  - `finish_reason` maps to the stop reason: `tool_calls` → `tool_use`, `length` → `max_tokens`, `content_filter` → `refusal`.
  - Cached prompt tokens count as cache reads.

These providers don't promise strict schemas, so every tool checks its own fields. An HTTP failure becomes an `error` event with `fallback: true`, so the app runs its own flows as with Claude.

**Privacy is the same for every provider.** Moderation and redaction run in `chat.ts` before any provider is called. Passport numbers, MRZ lines, cards, CVVs and IBANs are removed. Household lines carry first name, relation, age and nationality. Tool results drop surnames, full names, birthdays, contacts, documents, eSIM codes and links before the model reads them.

Before a provider other than Claude carries real travellers, two things need checking:
- **Data residency.** Several of the cheaper hosted models process data outside the region. A self-hosted open model through vLLM avoids that.
- **The Arabic register.** The comparison's samples and a native reader decide this.

To compare, run the evals with a profiles file (§5). To try one live on staging, set `ASK_CHAT_PROVIDER=openai-compatible` and its three settings in place of the Claude key.
