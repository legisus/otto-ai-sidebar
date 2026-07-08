# Otto — Chat Sidebar (v0.2) Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Scope:** Lightweight autonomous browser control via a self-contained Chrome side-panel chat.

## Context

v0.1 of Otto is a local relay + CLI + MV3 extension that lets a terminal
agent drive the user's logged-in Chrome (trusted input, CSP-proof eval, authenticated
downloads, print-to-PDF), verified by `test/integration.sh` (15/15) and `protocol.test.js`.

The user wants to talk to an AI **from inside the browser** and have it drive tabs
autonomously — without the terminal, server, or token in the loop. This adds a chat UI
and a self-contained, provider-agnostic agent loop to the existing extension, with
**Claude and Gemini** as the launch brains behind a swappable provider adapter. The v0.1
server/CLI path remains as an advanced, optional mode; a chat user never touches it.

Goal: **install → pick a provider → paste API key → chat.** No Node, no server, no JSON.

## Decisions (locked)

| Question | Decision |
|---|---|
| Who is on the other end | Standalone assistant calling a hosted LLM API through a **provider adapter**. Three adapters at launch: **Claude** (native), **Gemini** (native), **OpenAI-compatible** (one adapter, many endpoints: OpenAI, DeepSeek, Mistral, Groq, …). |
| Where the agent loop + key live | In the extension; **the background service worker owns all provider API calls** (host_permissions bypass website CORS — see Provider Abstraction). Keys in `chrome.storage.local`. |
| UI surface | Chrome **side panel** (`chrome.sidePanel`) |
| Autonomy | **Fully autonomous** — no per-tool confirmation |
| Billing | **API key** (pay-per-token) per provider. NOT a consumer subscription — no provider's API authenticates against ChatGPT Plus / Gemini Advanced / Claude Pro-Max. Gemini has a **free API tier** (Flash / Flash-Lite via AI Studio) — the closest thing to "free." |
| Provider + model | Provider picker + model dropdown (onboarding + Options) **and** a header switcher. Default **Claude Sonnet 5**; **Gemini** available at launch; see Providers & Models. |
| Skills / plugins | **Deferred** to a later version (see Future Extensions) |

## Architecture

```
┌─ side panel (chat UI) ─┐   long-lived port (chrome.runtime.connect)
│  message list + input  │◀──────────────────────────────────────────┐
│  provider + model      │   user turn ──▶                            │ streamed
│  switcher               │                                            │ tokens +
└─────────┬───────────────┘                                            │ tool events
          │                                                            │
          ▼                                                            │
   background.js  ── agent loop (agent.js) ── provider adapter ──▶  provider API
   │  ├─ onMessage/onConnect router                     │            (Claude / Gemini)
   │  ├─ owns ALL network fetches (host_permissions      │            key from storage
   │  │   → cross-origin allowed, no website CORS)       │
   │  └─ handle(cmd, params) ──────────────────────────▶ Chrome tabs / debugger
   │      (EXISTING v0.1 function, shared with WS/CLI)   (navigate, eval, click, …)
   └──────────────────────── tool result (screenshots as image blocks) ──┘
```

Two structural changes to existing code, both in `background.js`:
1. A `chrome.runtime` router (onMessage + a long-lived onConnect port) — the side panel
   talks to the worker; the worker runs the agent loop, streams tokens/tool-events back.
2. The existing `handle(cmd, params)` is reused verbatim for tool execution — the v0.1
   WebSocket/CLI path and the side panel share it, no duplication.

**Why the network calls live in the service worker (not the side-panel page):** most
provider APIs (Gemini, OpenAI, DeepSeek) do **not** send CORS headers for direct browser
calls, so a normal web page can't reach them. A Chrome extension's **background service
worker with `host_permissions`** for the API host is exempt from that restriction — its
`fetch` is treated as first-party. Routing every provider call through the worker is what
lets Otto support any provider from a pure client-side extension with no proxy server.
(Anthropic additionally needs its `anthropic-dangerous-direct-browser-access` header; the
worker sends it in the Claude adapter.)

## Provider abstraction

The agent loop is provider-agnostic. Each provider is an **adapter** implementing:

```
adapter.stream({ model, system, messages, tools, effort }) ->
    async iterator of { textDelta } | { toolCall: {id, name, input} } | { done: stopReason }
```

The adapter maps Otto's internal message/tool representation to that provider's wire
format and normalizes the stream back. Adding a provider = one adapter file + an entry in
the provider registry (host added to `host_permissions`, models listed in the picker).

- **Claude adapter** — `POST api.anthropic.com/v1/messages`, `stream:true`,
  `thinking:{type:"adaptive"}` + `effort`, tools as Anthropic tool schema, screenshots
  fed back as `image` blocks. Header: `anthropic-dangerous-direct-browser-access:true`.
- **Gemini adapter** — `POST generativelanguage.googleapis.com/.../:streamGenerateContent`,
  key via `x-goog-api-key`. Maps tools → `functionDeclarations`, tool results →
  `functionResponse` parts, screenshots → `inlineData` image parts, `tool_use` →
  `functionCall`. Multimodal + function calling + SSE are all supported.
- **OpenAI-compatible adapter** — one adapter, many endpoints. `POST {baseURL}/chat/completions`
  with `stream:true`, `Authorization: Bearer {key}`, OpenAI `tools`/`tool_calls` schema,
  vision via `image_url` parts (data URI). A small **endpoint registry** supplies
  `{name, baseURL, models[], vision:bool}` per provider — OpenAI (`api.openai.com/v1`),
  DeepSeek (`api.deepseek.com/v1`), Mistral (`api.mistral.ai/v1`), Groq
  (`api.groq.com/openai/v1`), and more are added by appending a row + a `host_permissions`
  entry. The user picks an endpoint, then a model within it.

**Vision capability is per-model.** Vision-capable brains (all Claude, all Gemini, OpenAI
GPT-4.1/5.x, Mistral Pixtral, DeepSeek-V) receive screenshots as image blocks. A
text-only model still works — the adapter advertises `vision:false`, the agent then
**skips image blocks and relies on `eval` (DOM text) instead of `screenshot`**. The panel
notes "this model can't see screenshots" so the degrade is visible, not silent.

The `tools` array is built once from the browser-command registry and translated per
adapter — the browser-control commands (`navigate, eval, click, insertText, key,
listTabs, newTab, activateTab, screenshot, pdf, download, closeTab`) are identical across
providers; only their schema serialization differs.

## Components

### New files (`extension/`)
- **`sidepanel.html` / `sidepanel.css`** — chat layout: scrollable message list, input box, header with provider+model switcher + ⚙ (reopen onboarding). Theme-aware, minimal.
- **`sidepanel.js`** — thin UI controller: renders messages, opens a long-lived port to the worker, streams assistant text, sends user turns. Holds no API keys and makes no provider calls.
- **`agent.js`** (runs in the service worker) — the provider-agnostic tool-use loop:
  - Builds the tool registry once (name, description, JSON input_schema for each browser command) and hands it to the active adapter for per-provider serialization.
  - Calls `adapter.stream(...)`; forwards text deltas to the panel over the port.
  - On a `toolCall`: runs `handle(cmd, params)` in-process → appends the result (screenshots/pdf as image blocks) → continues.
  - Loops until the adapter yields `done`; **hard cap ~25 tool turns** to prevent runaway.
- **`providers/claude.js`, `providers/gemini.js`, `providers/openai-compat.js`** — the launch adapters (interface in Provider Abstraction above). `providers/registry.js` lists providers, endpoints, models, and per-model `vision` flags — the single edit-point for adding models.
- **`onboarding.js` (+ section in `sidepanel.html`)** — first-run welcome: **provider picker**, API-key field, per-provider "Get a key" link (console.anthropic.com / aistudio.google.com), "Test key" button (one cheap validating call), model default. Re-openable via ⚙.

### Modified files
- **`manifest.json`** — add `"sidePanel"` permission and `side_panel.default_path`; add each provider host to `host_permissions` (`https://api.anthropic.com/*`, `https://generativelanguage.googleapis.com/*`, `https://api.openai.com/*`, `https://api.deepseek.com/*`, `https://api.mistral.ai/*`, `https://api.groq.com/*`); add icons (16/32/48/128).
- **`background.js`** — add the `chrome.runtime` router (onMessage + onConnect port) and host the agent loop; open the side panel on action-icon click (`chrome.sidePanel.setPanelBehavior`). Reuses existing `handle()`.
- **`extension/options.*`** — add provider picker + per-provider API-key fields (shared storage with onboarding) + model selector (the token/port/allowlist fields for v0.1 server mode stay, visually separated as "Advanced / terminal bridge").

### Distribution
- Icon set + clean manifest → **Chrome Web Store–publishable**.
- `build.sh` → produces `dist/otto.zip` for the store and unpacked sharing.
- README rewrite: **Quick Start (chat)** at top (install → key → chat); v0.1 server/CLI setup moved to an "Advanced" section.

## Providers & models

A brain must have **tool/function calling + streaming + vision** (to read screenshots).
Prices are per 1M tokens (input/output), July 2026, and drift — treat as guidance, keep
the registry easy to edit. None of these are reachable via a consumer subscription; all
need an API key. Gemini Flash/Flash-Lite have a free API tier.

**Launch model registry** (V = vision-capable, gets screenshots; prices $/1M in·out):

| Provider · model | $ in·out | V | Adapter | Notes |
|---|---|:--:|---|---|
| **Claude Sonnet 5** *(default)* | $3 / $15 (intro $2/$10) | ✅ | claude | Best tool-use + vision balance. |
| Claude Opus 4.8 | $5 / $25 | ✅ | claude | Hardest multi-step tasks. |
| Claude Haiku 4.5 | $1 / $5 | ✅ | claude | Cheapest Claude; quick tab work. |
| Claude Fable 5 | $10 / $50 | ✅ | claude | Max capability, premium. |
| **Gemini 3.5 Flash** | $1.50 / $9 | ✅ | gemini | Cheap + capable agentic; multimodal. |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50 | ✅ | gemini | **Free API tier** — zero-cost light use. |
| Gemini 2.5 Flash | $0.15 / $0.60 | ✅ | gemini | Very cheap fallback. |
| Gemini 3.1 Pro | $2 / $12 (paid) | ✅ | gemini | 2M context; heavier jobs. |
| OpenAI GPT-5.x (flagship) | (varies) | ✅ | openai-compat | Strong agentic + vision. |
| OpenAI GPT-4.1 Nano | ~$0.10 / $0.40 | ✅ | openai-compat | Cheap OpenAI vision model. |
| DeepSeek V4 Flash | $0.14 / $0.28 | ❌ | openai-compat | **Cheapest overall**; text-only → DOM-mode. |
| DeepSeek V3 | $0.27 / $1.10 | ❌ | openai-compat | Cheap; text-only. |
| Mistral (Pixtral) | ~$0.15 / $0.60 | ✅ | openai-compat | Cheap vision-capable. |
| Mistral Small | ~$0.10 / $0.30 | ❌ | openai-compat | Ultra-cheap; text-only. |
| Groq (Llama/OSS, fast) | free tier + low | mixed | openai-compat | Fastest inference; **free tier**. |

Text-only rows (❌) still drive the browser via `eval`/DOM but can't see screenshots
(the panel says so). MiniMax M3, Z.AI GLM-5.2, and Qwen3.x are trivially addable to the
`openai-compat` registry later — same adapter, one row each.

**Not a brain:** Perplexity (Sonar) is search/answer-oriented — tool-calling + vision
support is thin and its OpenAI-compatible endpoint tends to CORS-block; unsuitable as the
controller. Better as an optional *search tool* the brain calls (a future MCP/tool add).

**Subscriptions:** consumer plans (Claude Pro/Max, Gemini Advanced/Ultra, ChatGPT Plus,
Perplexity Pro) do **not** grant API access. The only "free-ish" path is Gemini's free
API tier via Google AI Studio.

## Data flow (one turn)

1. User types → `sidepanel.js` sends the turn to the worker over the port.
2. `agent.js` (worker) calls `adapter.stream(...)`; text deltas are forwarded to the panel and render live.
3. On a `toolCall`: `handle(cmd, params)` executes in-worker → returns JSON (or base64 for screenshot/pdf).
4. Result appended (image block for screenshots) → adapter continues the stream.
5. Repeat until `done` or the 25-turn cap; final assistant text is the reply.

## Error handling

- **Missing/invalid key** → panel shows a friendly, provider-specific message + link to Options (Claude keys start with `sk-ant-`; Gemini keys via AI Studio).
- **API errors** (401/429/network) → surfaced in the panel without killing the loop; 429 shows a retry hint.
- **Tool errors** → returned to the model as a tool-result error (not thrown), so the model can recover.
- **Runaway** → 25-turn cap ends the loop with a visible "stopped after N steps" note.
- **Side panel unsupported** (old Chrome) → onboarding shows a version note.

## Security

- Keys live in `chrome.storage.local` (browser), never leave the machine except to the
  selected provider's API host. Onboarding states this in one line.
- The extension can act as the user on any logged-in site; Chrome's native
  "…is debugging this browser" banner shows when the debugger is attached (first
  eval/click/pdf), and `detach` clears it. The v0.1 host allowlist still applies to
  commands routed through `handle()`.
- Fully autonomous by explicit user choice; documented in README so it's not a surprise.

## Testing

- **`test/agent.test.js`** (new, offline): mock each adapter to yield a scripted
  `toolCall` → `done` sequence; assert `agent.js` dispatches the right `handle(cmd,params)`,
  appends the tool result, and terminates. Assert the 25-turn cap and an API-error path.
- **`test/adapters.test.js`** (new, offline): feed each of the three adapters (claude,
  gemini, openai-compat) a canned provider stream and assert it normalizes to Otto's
  `{textDelta|toolCall|done}` shape, that a tool call round-trips into the provider's
  tool-result format, and that a `vision:false` model gets image blocks stripped. No network.
- **Tool execution** is already covered by `test/integration.sh` (15/15) — unchanged,
  since the side panel reuses `handle()`.
- **Manual checklist** (in TEST-PLAN.md): "list my tabs", "open YouTube and play X",
  "read this page and summarize", "screenshot this tab" — verify autonomous multi-step.

## Future extensions (deferred, architecture leaves room)

- **MCP-server plugins** — user adds a remote MCP server URL (+ token) in Options;
  requests gain `mcp_servers` + `mcp_toolset` with the `mcp-client-2025-11-20` beta.
  Remote/hosted servers only (the API connects, not the browser). Additive: the tool
  list is already dynamic.
- **Anthropic Agent Skills** (pptx/xlsx/docx/pdf) — server-side code-execution container
  + `code-execution` / `skills` betas. Additive as an opt-in.
- **More OpenAI-compatible endpoints** — MiniMax, Z.AI GLM, Qwen, and others are one
  registry row + one `host_permissions` entry each; no new adapter code.
- **Perplexity as a search *tool*** (not a brain) — surfaced to the active brain as a
  callable tool once the tool registry supports remote tools.

## Out of scope for v0.2

Per-tool confirmation UI, conversation persistence across browser restarts, adapter
*types* beyond the three (claude / gemini / openai-compat), and the terminal-bridge
changes (v0.1 path is untouched). Adding more OpenAI-compatible *endpoints* is in-scope
(registry rows), just not exhaustively enumerated.
