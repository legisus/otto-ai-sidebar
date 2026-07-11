# Otto — your browser, on autopilot

**Otto** is a Chrome side-panel assistant that drives your real, logged-in browser for you.
Ask it to do something — "summarize this page", "open my analytics and tell me how traffic
is", "find the cheapest option across my open tabs" — and it navigates, clicks, types, reads
pages, and screenshots on its own, then reports back.

Fully in-browser: it calls the LLM provider you choose (Claude, Gemini, or an
OpenAI-compatible endpoint) directly with **your API key**. **No server, no terminal,
nothing to install beyond the extension.**

## Quick start

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
2. Click the **Otto** toolbar icon → the side panel opens.
3. Pick a provider, paste an **API key**, **Save & start**, and chat.

Otto acts on your open tabs autonomously — hit **Stop** any time. Your key is stored only
in this browser (`chrome.storage.local`) and sent only to the provider you pick.

## Why it can do things a normal web page can't

- **Trusted input.** Clicks and keystrokes go through `chrome.debugger` (`isTrusted: true`),
  so rich editors (Gmail, Grammarly, Google Docs) accept them where synthetic events fail.
- **CSP-proof page reads.** `eval` runs via the DevTools protocol, so it reads pages whose
  Content-Security-Policy blocks injected scripts.
- **Sees the page.** `screenshot` results are fed back to the model as images, so it can
  find layout and click coordinates visually.
- **Your sessions.** It runs in your normal profile — anything you're logged into just works.
- **Provider CORS handled.** All API calls run in the background service worker, whose
  `host_permissions` make cross-origin requests first-party — so Gemini/OpenAI/DeepSeek,
  which block direct browser calls, work anyway.

## Providers & models

Pick per conversation from the header dropdown. Any brain needs tool-calling + streaming +
vision (to read screenshots). Prices drift — see `extension/providers/registry.js`, the
single edit-point for models.

- **Claude** — Sonnet 5 (default), Opus 4.8, Haiku 4.5, Fable 5
- **Gemini** — 3.5 Flash, 3.1 Flash-Lite (free tier), 2.5 Flash, 2.5 Pro, 3.1 Pro (preview)
- **OpenAI-compatible** — OpenAI, DeepSeek, Mistral, Groq (one adapter, many endpoints)

All need an **API key** (pay-per-token) — a consumer subscription (ChatGPT Plus, Gemini
Advanced, Claude Pro/Max) does **not** grant API access. Gemini's Flash tier is free.

## Architecture

```
┌─ side panel (chat UI) ─┐   long-lived port (chrome.runtime.connect)
│  message list + input  │◀──────────────────────────────────────┐
│  provider + model dot   │   user turn ──▶                        │ streamed tokens
└─────────┬───────────────┘                                        │ + tool events
          ▼                                                        │
   background.js — agent loop (agent.js) — provider adapter ──▶ provider API
   │  └─ handle(cmd, params) ──────────────────────────────────▶ Chrome tabs / debugger
   └──────────────────── tool result (screenshots as images) ──────┘
```

- `extension/agent.js` — provider-agnostic tool-use loop (AbortSignal, 25-turn cap)
- `extension/providers/` — `claude.js`, `gemini.js`, `openai-compat.js`, `registry.js`, `http.js`
- `extension/tools.js` — the browser commands as tool schemas
- `extension/background.js` — runs the loop, executes tools via `handle()`
- `extension/sidepanel.*` — the chat UI + onboarding + status dot

## Test

```bash
npm test    # offline: tool registry, adapter stream-normalization, agent loop
```

No runtime dependencies. Adapters and the loop are pure/injected so they run under
Node's built-in test runner without Chrome or network.

## Looking for the terminal bridge?

Otto used to bundle a localhost bridge for driving the browser from a terminal AI agent.
That's now a separate project (**AI Browser Bridge**, not yet published). Otto itself is
browser-only — no server.

## Contributing

Bug reports, provider adapters, and improvements are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for local setup, tests, commit conventions, and
tips for developing with Claude Code.

## License

MIT © 2026 Mykola Bielousov
