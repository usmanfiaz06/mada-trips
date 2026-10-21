# Ask Mada as a conversation

**Status:** built, off by default. It comes on with `ASK_CHAT=on` and `ANTHROPIC_API_KEY`. Until both are set, Ask works exactly as before (the flows from `/ask/parse`).

**What the owner asked for:** "Make Ask Mada conversational like a real assistant, not automated replies suggesting Today / next week."

**What this builds:** Ask talks back like a warm, brief Saudi travel host (the persona and its rules: [ASSISTANT.md](ASSISTANT.md)). It answers in 1 to 3 short sentences and then shows the cards the app already draws. It acts through tools that run on the server as the signed-in traveller. It never makes up a price.

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
     │                         lib/app/ask-chat/tools.ts  13 tools over the same functions the app's routes call (remember: §7)
     │                         lib/app/ask-chat/guard.ts  redact · screen · unbacked · banned words · tidy
     └── on error / off / no key / offline / guest: the app's own flows (POST /ask/parse), as before
```

### Server pieces

| File | What it does |
|---|---|
| `platform/src/app/api/app/v1/ask/chat/route.ts` | The SSE endpoint. It checks everything that can fail before it opens a stream, so the app gets an ordinary error. Once the stream is open, any failure arrives as `error {code, fallback: true}`. |
| `ask-chat/config.ts` | Switches, models, limits, prices and cost in micro-dollars. |
| `ask-chat/prompt.ts` | The **frozen** system prompt and the strict tool list. They are the same for everyone and in a fixed order, so they cache. The prompt opens with `persona.ts`, which is ASSISTANT.md §1 word for word (`npm run ask:persona`). |
| `ask-chat/next.ts` | The next step: the model's `<next>` choices, checked, or chips filled from the turn when it gave none (ASSISTANT.md §3). |
| `ask-chat/engine.ts` | One turn: a streamed message in a manual tool loop, the sentence gate, refusal and `max_tokens` handling. |
| `ask-chat/providers.ts` | Who answers, behind one interface (§6). Claude through the official SDK (`client.beta.messages.stream`) by default. |
| `ask-chat/providers-openai.ts` | A thin adapter for any OpenAI-compatible `/chat/completions` endpoint, for comparing cheaper models. |
| `ask-chat/slots.ts` | Reads the sentence into slots. The deterministic rules run first. Haiku runs only when the rules leave something open, with a 4 s timeout. |
| `ask-chat/tools.ts` | The tools. Each one returns a short text for the model and the cards, pay sheet or handoff for the app. |
| `ask-chat/store.ts` | Threads (`app_ask_threads`, with the folded `summary`) and daily spend (`app_ask_spend`). Migrations: `drizzle/0034_ask_chat.sql`, `0035_ask_memory.sql`. |
| `ask-chat/memory.ts` | What Mada remembers across conversations (`app_ask_memory`), consent for sensitive facts, and the "What Mada knows" block (§7). |
| `ask-chat/fold.ts` | Long threads folded into a rolling summary (§7). |
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
   - what Mada knows from before (§7), once per thread
   - the slots read from the sentence

   Because the context sits inside the turn, the cached prefix (tools and system) never changes. The thread is append-only: every assistant message is stored exactly as the API returned it, thinking blocks included, so preserved thinking stays valid.
5. Engine:
   - `stream` call settings: model `claude-sonnet-5-5`, `output_config.effort: "low"`, `thinking: {type: "adaptive"}`, `max_tokens` 4096, `cache_control` on the system block, and top-level automatic caching so the conversation's own history caches as it grows.
   - Refusal fallbacks are on (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
   - Tool calls in one step run in parallel, and all their results go back in one message. A failed tool returns `is_error` with a plain sentence. The prompt tells the model to say so and offer the next step.
   - `stop_reason: "refusal"` ends the turn with the fixed line `chat.refusal`.
   - `max_tokens` on a step that holds a tool call never runs the tool.
6. Sentence gate: words stream as they arrive. A sentence that contains a digit is held until it ends. It is shown only if every price and clock time in it appears in a tool result from this turn, and it has no banned word (COPY.md §3.2, English and Arabic). The same check holds every flight number ("SV 263"), star rating or score ("5-star", "rated 9.1"), airline and hotel it names (brands, and "<Name> Hotel / Resort / Suites"): Mada answers only from its own tools, never from general knowledge or the web (there is no web search tool).
   Closers are dropped too: a sentence that hands the next step back without giving one ("Let us know which you prefer or if you'd like other dates.", "Tell us which one suits you.", "Feel free to…", "If you'd like other dates, just ask.", "Just say the word.", «خبرنا إذا تبي…», «قول لنا وش تفضل»). A closing clause after real content is cut and the content kept ("Three ways for Eid, let us know which you prefer." → "Three ways for Eid."). A sentence that names something ("If you'd like a sea view, the Address Sky View has one.") stays (`guard.ts` isCloser, trimCloser). A sentence that fails is dropped. If part of it had already been shown, a `replace` event sends the cleaned text. If nothing is left, the fixed line is `chat.found` (when there are cards) or `chat.cant`. Exclamation marks, em dashes and emoji are tidied away as the words stream.
7. Append the turn, add the spend, and write one log line (with a chain of providers, one more line per call says which provider answered). The line holds thread id, turn number, model, input/output/cache tokens, USD, tools used, the stop reason and how many items were redacted. **Message bodies are never logged.**

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
| `create_request` | `createRequest` (the desk), once the traveller has said how to reach them; stores `contactPreference` (call, whatsapp, in_app) and `contactWindow` (a call's best time) on the request | `request` card: what, when and who, "The team gets back to you by 18:40", and how |
| `price_quote_for_pay` | `priceDraft`: prices the offer again, **never charges** | `pay` event with an `OrderDraft`; the app opens its own pay sheet |
| `remember` | `saveFact` (memory.ts): a lasting preference or need; sensitive ones only after a yes (§7) | — (the reply ends with "We'll remember that for next time.") |
| `talk_to_human` | `openThread` + `sendMessage` (summary, redacted) + `presenceFor` | `handoff` event. The app says the duty person's name ("Noura at Mada can take it from here") only when the desk names someone online; otherwise "The team at Mada…" (COPY.md §1) |

What the model reads is kept short, because free tiers count tokens per minute: at most 3 options, each with only what a reply says (a flight is id, label, airline and number, times, duration, stops, refundable and the total; dates and who are in the header). The cards carry the rest.

Every tool goes through the same checks as the app's own routes.

### Honest results

- **Sample fares.** When flights come from the mock catalogue (`SUPPLIER_MODE_FLIGHTS=mock`: outside production, or a staging copy with `APP_ALLOW_MOCKS=yes`; production refuses mock flights otherwise), every `FlightOption` carries `demo: true` and the pay sheet's preview `demoFare: true`. The chat cards, the FlightFlow cards and the pay sheet show "Demo fare · not bookable" («سعر تجريبي · ما ينحجز», `search.demoFare`). The tool result starts with `demo: true (sample fares from a test catalogue: not real, not bookable)` and the prompt tells the model to say they are sample fares for testing and never call them real or available.
- **Flights by request** (`APP_FLIGHTS_MODE=request`, the default in production until TBO is certified). `search_flights` returns `{"mode":"request"}` with no fares, prices, times or flight numbers, the same as the app's own flows. The model confirms the trip back, says the team at Mada gets back within 2 hours (`REQUEST_PROMISE_MIN`, booking/requests.ts), and asks how to reach them. If it leaves no choices, the app fills in "WhatsApp · Call me · Here in the app" (`chat.next.reach*`).
- **Found by hand.** The same goes for anything no tool sells: a cruise, a train, a visa we don't handle, a group or company trip, a city not sold live. The model:
  1. gets only what the team needs (where, when, who, must-haves), one question at a time, with defaults;
  2. confirms it back in one line and asks how to reach them (WhatsApp, a call and its best time, or here in the app);
  3. calls `create_request` with `contact_preference` and says "We've noted it and the team will get back to you by 18:40", with the time the tool returned (Riyadh time).

  The desk request page and the desk inbox show how to reach them ("Reach on WhatsApp", "Reach by call · evenings after 7").
- **Status lines** name the place in the reader's language («نشوف الرحلات لـإسطنبول», via `nameIn`). Offers must belong to the caller. Person ids the model gives are filtered to the household, and an empty list means the account holder. Days in the past are refused.

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
   - or a chain of free and paid providers in place of the Claude key (see "A chain of providers" below)
   - optional: `ASK_CHAT_MODEL`, `ASK_FAST_MODEL`, `ASK_CHAT_PER_MINUTE` (8), `ASK_CHAT_PER_DAY` (120), `ASK_CHAT_USER_DAILY_USD` (1), `ASK_CHAT_DAILY_USD` (50)
2. Redeploy. Migration `0034_ask_chat` must be applied on the staging database (`npm --prefix platform run db:migrate` against it). Preview builds skip migrations.
3. Check that GET `/api/app/v1/config` shows `features.askChat: true`. The app picks it up on its next config refresh (at most 10 minutes, or on reopen).
4. To turn it off, set `ASK_CHAT=off` (or remove the key). `askChat` goes false and the app goes back to the flows on its next config read. Any stream already open finishes, or falls back.

### A chain of providers (staging recipe)

`ASK_CHAT_PROVIDERS` is an ordered list. Each call goes to the first provider that isn't resting. A provider that answers with a rate limit (429, or Groq's 413 for tokens per minute), a 5xx, a timeout or a quota error (some say so with a 400, 402 or 403) rests for its `Retry-After` (or Gemini's `retryDelay`), else 60 seconds. The same call then goes to the next one, inside the same turn. Every provider reads and writes the same Messages-shaped thread, so a switch mid-conversation, even mid-turn after a tool ran, needs nothing else. The app's own flows answer only when every provider is resting (`RATE_LIMITED`). Once words have streamed from one provider, a failure is the turn's error, as with one provider.

Rest times are kept in memory, per server instance; a cold instance tries a resting provider once more. Each call logs `provider=… model=… call=stream|create` (and `after=groq` when it moved on), never message bodies.

For staging:
- `ASK_CHAT` = `on`
- `ASK_CHAT_PROVIDERS` = `groq,gemini` (the keys are already set as `GROQ_API_KEY` and `GEMINI_API_KEY`)
- optional: `ASK_CHAT_MODEL_GEMINI` (default `gemini-2.5-flash`), `ASK_CHAT_MODEL_GROQ` (default `openai/gpt-oss-120b`), `ASK_FAST_MODEL_<NAME>` (default: that provider's chat model)

Names: `anthropic` (ANTHROPIC_API_KEY, default `claude-sonnet-5-5` / `claude-haiku-5-5`), `groq`, `gemini`, `zai` (their preset keys), `openai-compatible` (ASK_CHAT_BASE_URL, ASK_CHAT_API_KEY, ASK_CHAT_MODEL). A provider without its key is left out. Ask is on while one is left. When `ASK_CHAT_PROVIDERS` is unset, `ASK_CHAT_PROVIDER` works as before.

**Fewer tokens on free tiers.** Once the sentence is read (slots), an openai-compatible provider is sent only the tools such a turn can need (`prompt.ts` toolsFor: a flight turn gets the flight, stay, entry, request, pay, trips and desk tools; an eSIM turn four tools). The full set is sent when the kind is unknown. Claude always gets every tool, so its cached prefix never changes. Mocked eval, estimated tokens per turn (all calls, chars/4 of the request): 6,811 before, 6,386 after on average. The second call of a turn: 3,949 before, 3,650 after. A known kind drops further, e.g. an eSIM turn goes from 3,677 + 3,806 to 2,587 + 2,715.

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
- `platform/test/app/ask-chat-honest.test.ts` covers sample fares (`demo: true` on cards and in the tool result), flights by request (no price, chips for how to reach them, then a request with the contact preference and the promise), the closer seen live in both languages, Arabic status lines, the tool subset, and the provider chain (Groq 429 → Gemini answers, cooldown expiry returns to Groq, both down → fallback).
- `apps/mobile/test/unit/ask-chat.test.ts` covers frames split mid-way, the turn reducer, the thread id carried across turns, and every fallback path.

**Live (needs a key, costs about $0.10 for the set on Claude):**

```
ANTHROPIC_API_KEY=… npm run ask:eval              # all 41
ANTHROPIC_API_KEY=… npm run ask:eval -- visa-uk ar-esim
```

There are 41 conversations, 28 in English and 13 in Arabic. They cover:
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
- a thank-you that must still end with a next step, a trip with no dates (a default, not a question), a refund, a delay and its rights
- found by hand: flights by request (English and Arabic), a Red Sea cruise, a train from Riyadh to Dammam, a company trip for 25. Each must ask how to reach them, then make the request with that preference, with no invented facts

Each one runs through the real engine, with fixture tool results and no database. Every turn is checked for:
- **prices**: no price or time in the model's raw words that no tool returned
- **one**: at most one question
- **lang**: reply language matches the traveller's
- **tools**: the right tools were used, or one question where that is allowed, and no forbidden tool
- **words**: no banned words
- **next**: the reply ends with Mada's own 2 or 3 choices, or choices said in its last sentence (chips the app had to fill in count as a fail)
- **open**: no open-ended closer ("Anything else?", "How can I help", "Let me know", «أي خدمة ثانية»)
- **first**: the answer first: no preamble, and no question first unless the turn may be one needed question
- **reach**: found by hand, it asks how to reach them (WhatsApp, a call, the app) as its own choices, then calls `create_request` with `contact_preference`

The script exits 1 on any failure and prints the tokens and cost of each turn.

**Comparing providers.** The same 41 conversations, fixtures and checks run against any number of profiles in one go, followed by a table. The quickest way uses the presets (§6), with keys taken from the environment:

```
ANTHROPIC_API_KEY=… GROQ_API_KEY=… ZAI_API_KEY=… GEMINI_API_KEY=… npm run ask:eval -- --provider anthropic,groq,zai,gemini
npm run ask:eval -- --provider groq --model llama-3.3-70b-versatile visa-uk ar-esim     # one model, two cases
npm run ask:eval -- --provider openai-compatible --model deepseek-chat --price 0.27,1.10,0.07
```

Without `--model`, each preset runs its listed models. Gemini runs the Flash models its own `GET /models` lists for that key, at most 4, so no Gemini model id is hard-coded. A provider whose key isn't set is skipped.

A 429 waits for `Retry-After`, or 5, 10 then 20 s, up to 3 tries, and then counts as a failed turn ("rate"). Any other error also counts as a failed turn ("error"), and the run carries on.

Cost per conversation shows "free tier" for the Z.ai Flash models. For a non-Claude model with no `--price` it shows "n/a", because no price is guessed.

For profiles that need more control (several base URLs, different fast models), use a profiles file:

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
| `groq` | Preset: `https://api.groq.com/openai/v1`, key `GROQ_API_KEY`. Models `openai/gpt-oss-120b` (default), `llama-3.3-70b-versatile`, `qwen/qwen3.8-27b` | `GROQ_API_KEY`; `ASK_CHAT_MODEL` picks one |
| `zai` | Preset: `https://api.z.ai/api/paas/v4` (docs.z.ai quick start), key `ZAI_API_KEY`. Free: `glm-4.7-flash` (default), `glm-4.5-flash`; paid: `glm-5.3-flash` | `ZAI_API_KEY`; `ASK_CHAT_MODEL` |
| `gemini` | Preset: Google's OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`, key `GEMINI_API_KEY`. No default model: the evals read the ids from `GET /models`, and the app needs `ASK_CHAT_MODEL`. Tool schemas are sent as the OpenAPI subset Gemini reads (`nullable` instead of null types, no `additionalProperties`). | `GEMINI_API_KEY`, `ASK_CHAT_MODEL` |
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

**Weaker tool calling.** These providers don't promise strict schemas, so the engine checks every tool call against that tool's strict JSON schema before running it (`ask-chat/schema.ts`). It checks types and nulls, enums, required fields, extra fields and array items. Names are matched tolerantly, so "Search-Flights" is search_flights when only one tool fits.

A call that fails gets an `is_error` result saying exactly what is wrong, and the model gets **one** repair per turn. If it is still wrong, the turn stops with `error {code: "TOOL_INPUT", fallback: true}` and the app's own flows answer. With Claude and `strict: true` this check never fires.

**Rate limits.** With one provider, its 429 (Groq's and Z.ai's free tiers are tight) becomes `error {code: "RATE_LIMITED", fallback: true}`. With a chain (`ASK_CHAT_PROVIDERS`, §4) the next provider takes the call first. The app answers with its own flows, so it never dead-ends and never waits. Every other HTTP failure falls back the same way.

**Free tiers are for staging and test accounts only.**
- Google's free Gemini tier may use prompts and replies to improve Google's products, for use outside the EEA, the UK and Switzerland. Saudi Arabia is outside, so free Gemini must never carry real travellers. Production needs the paid tier, with its data terms checked by counsel.
- Groq and Z.ai free tiers have their own terms and tight limits. They are for comparing in the evals and trying on test accounts.

**Later: voice (not built now).** Groq also hosts two models worth trying when Ask gets spoken replies (the "spoken replies" decision the owner put on hold on 18 Oct):
- `canopylabs/orpheus-arabic-saudi`: text to speech in Saudi Arabic.
- `whisper-large-v3`: speech to text.

Both sit behind Groq's OpenAI-compatible audio endpoints, so they would reuse the same key and preset. Measure them on spoken Riyadh Arabic with a native listener first.

**Privacy is the same for every provider.** Moderation and redaction run in `chat.ts` before any provider is called. Passport numbers, MRZ lines, cards, CVVs and IBANs are removed. Household lines carry first name, relation, age and nationality. Tool results drop surnames, full names, birthdays, contacts, documents, eSIM codes and links before the model reads them.

Before a provider other than Claude carries real travellers, two things need checking:
- **Data residency.** Several of the cheaper hosted models process data outside the region. A self-hosted open model through vLLM avoids that.
- **The Arabic register.** The comparison's samples and a native reader decide this.

To compare, run the evals (§5).

To try one live on a staging test account:
- **A preset:** set `ASK_CHAT_PROVIDER=groq`, `zai` or `gemini` and its key (plus `ASK_CHAT_MODEL` for Gemini), in place of the Claude key.
- **Any other provider:** set `ASK_CHAT_PROVIDER=openai-compatible` and its three settings.

## 7. Memory and long conversations

**What the owner asked for:** "we need to add context in chats, and for models to have memory".

### What Mada remembers (across conversations)

| | |
|---|---|
| **Store** | `app_ask_memory` (migration `0035_ask_memory`): per account, `kind` (home_airport, airline, cabin, seat, budget, food, mobility, health, family, contact, other), `text` (≤ 120 characters), `source` (chat or booking), `created_at`, `last_used_at`. At most 30 per account; the oldest go. A kind with one value (home airport, cabin, seat, budget, contact) replaces the old one; the same words again only refresh it. |
| **The `remember` tool** | The model calls it only when the traveller states something lasting about themselves or their family (persona rules, [ASSISTANT.md](ASSISTANT.md) §1 "Memory"). Not for one-off details of a trip. |
| **Consent** | Health, mobility and religion (the kind, the model's `sensitive` flag, or the words: wheelchair, diabetic, pregnant, «كرسي متحرك»…) are saved only when Mada's last reply asked about remembering ("Shall we remember that for next time?", «نتذكرها للمرة الجاية؟») and the traveller's message now says yes. The server reads both from the thread (`consentOf`), so a model that skips the question saves nothing: the tool tells it to use the fact for this trip and ask. |
| **Never kept** | Anything redaction removes (passport, MRZ, card, CVV, IBAN), a long number (a phone, a booking code), an email or a link, abuse. |
| **Said once** | The turn that saves something ends with "We'll remember that for next time." («بنتذكر هذا للمرة الجاية.», `chat.remembered`), added by the server unless the model already said it. |
| **Derived, not stored** | The last 3 searches (`app_offers` grouped by search, last 60 days), up to 3 saved places (`app_saved`), trips taken (the overview the turn already reads). |

**In the context.** A new thread (and a thread right after a fold) gets one compact block in the turn's context, at most 600 characters, whole lines only, most relevant first: needs first (mobility, health), then what fits this kind of ask (a flight puts the home airport, seat and cabin up), then the recent ones, then the derived signals. The facts that made it in get `last_used_at`. Later turns of the same thread don't repeat it: the history already has it. Every provider in the chain reads the same thread, so every model gets it. Example:

```
What Mada knows about this traveller (from earlier chats and bookings; use it when it fits, say it back naturally, never list it):
- home airport: Flies from Jeddah
- mobility: Mother uses a wheelchair
- seat: Aisle seat
- food: Halal food only
- Recent searches: flight Istanbul 03-09 to 03-15, 4 people; stay Makkah 03-20, 3 nights, 3 people
- Saved places: Tbilisi
- Trips taken: Dubai 2026-03
```

**Visible and deletable.** GET `/ask/memory` → `{facts}`; DELETE `/ask/memory/{id}` (only the owner's; anything else is 404); DELETE `/ask/memory` forgets everything (audited as `ask.memory_forgotten`). In the app: Account → What Mada remembers (`app/account/memory.tsx`, also from Privacy → What we keep), each item with Remove, and Forget everything behind a sheet. Deleting the account (`anonymiseAccount`) removes the memory and every Ask thread; the copy of everything (`buildExport`) includes the memory.

### Long conversations stay cheap

- Every turn replays the thread. Once the thread passes `ASK_CHAT_HISTORY_TOKENS` (default **6,000** estimated tokens, characters ÷ 4) and has more than **6 turns**, the turns before the last 6 are folded, at the start of the next turn (`fold.ts`).
- The fast model (`ASK_FAST_MODEL`, 4 s, at most 90 words) writes the summary from the folded turns' gists, on top of the summary so far. If it doesn't answer, the gists themselves become the summary (≤ 900 characters): a fold never fails a turn.
- The summary is stored on the thread (`summary`, `folded_turns`) and read in front of the first kept message as `[Earlier in this conversation, summarised by Mada's systems: …]`.
- Of the 6 kept turns, all but the last 2 are lightened once, at the fold: tool results become their gist (≤ 200 characters), thinking and the old context block go. Tool call ids stay paired. Between folds the history doesn't change, so the prompt cache holds.
- A thread now ends at 60 turns (was 30).

### On the phone

- The thread id and the last 8 finished turns are kept on the device (`lib/net/kv`, key `mada.ask.chat.v1`, per account). Opening Ask within 24 hours of the last turn continues the same conversation (`restoreAskChat`); after that it starts fresh.
- "New chat" in Ask's top bar (`chat.newChat`) starts fresh and clears what was kept.
- When the conversation can't answer, the app's own flows still get the earlier messages of this thread as context (`ask.tsx` runFlows), restored turns included.

### Tests

- `platform/test/app/ask-chat-memory.test.ts`: the tool saves and says so once; a sensitive fact is not saved without the question and a yes (even when the model says it isn't sensitive); passports, cards, phones and emails are never kept; the block in a new thread (needs and fit first, searches after, ≤ 600 characters, not repeated in the same thread); folding (thresholds, gists, the fast model's summary, the fallback, a real thread through the route); delete one, delete all, only the owner's; account deletion.
- `apps/mobile/test/unit/ask-chat-continuity.test.ts`: kept for 24 hours per account, restored, cleared by New chat.
