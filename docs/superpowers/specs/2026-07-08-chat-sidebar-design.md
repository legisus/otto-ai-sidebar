# AI Browser Bridge — Chat Sidebar (v0.2) Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Scope:** Lightweight autonomous browser control via a self-contained Chrome side-panel chat.

## Context

v0.1 of AI Browser Bridge is a local relay + CLI + MV3 extension that lets a terminal
agent drive the user's logged-in Chrome (trusted input, CSP-proof eval, authenticated
downloads, print-to-PDF), verified by `test/integration.sh` (15/15) and `protocol.test.js`.

The user wants to talk to Claude **from inside the browser** and have it drive tabs
autonomously — without the terminal, server, or token in the loop. This adds a chat UI
and a self-contained agent loop to the existing extension. The v0.1 server/CLI path
remains as an advanced, optional mode; a chat user never touches it.

Goal: **install → paste API key → chat.** No Node, no server, no JSON, no extra knowledge.

## Decisions (locked)

| Question | Decision |
|---|---|
| Who is on the other end | Standalone assistant calling the Claude API directly |
| Where the agent loop + key live | In the extension (side panel → `api.anthropic.com`); key in `chrome.storage` |
| UI surface | Chrome **side panel** (`chrome.sidePanel`) |
| Autonomy | **Fully autonomous** — no per-tool confirmation |
| Billing | Anthropic **API key** (pay-per-token). NOT a Pro/Max subscription — the API cannot authenticate against one. |
| Model | Dropdown (onboarding + Options) **and** header switcher. Default `claude-sonnet-5`; `claude-opus-4-8`, `claude-fable-5` selectable. |
| Skills / plugins | **Deferred** to a later version (see Future Extensions) |

## Architecture

```
┌─ side panel (chat UI) ─┐        agent loop (agent.js)
│  message list + input  │  ──────────────────────────────▶  api.anthropic.com
│  model switcher         │  stream text; on tool_use →       (key from chrome.storage,
└─────────┬───────────────┘  chrome.runtime.sendMessage        dangerous-direct-browser
          │  {cmd,params}          │                            -access header)
          ▼                        ▼
   background.js  ──────────▶  handle(cmd, params)  ──────────▶  Chrome tabs / debugger
   (onMessage router)         (EXISTING v0.1 function,          (navigate, eval, click,
                               shared with WS/CLI path)          screenshot, download, …)
          ▲                        │
          └──────── tool result ───┘  (screenshots returned as image blocks)
```

The **only** structural change to existing code: `background.js` gains a
`chrome.runtime.onMessage` listener that routes `{cmd, params}` into the existing
`handle()`. Both the v0.1 WebSocket/CLI path and the new side panel now execute browser
actions through the same code — no duplication.

## Components

### New files (`extension/`)
- **`sidepanel.html` / `sidepanel.css`** — chat layout: scrollable message list, input box, header with model switcher + ⚙ (reopen onboarding). Theme-aware, minimal.
- **`sidepanel.js`** — UI controller: renders messages, streams assistant text, dispatches user turns to `agent.js`, persists conversation in memory for the session.
- **`agent.js`** — the tool-use loop:
  - Builds the Anthropic `tools` array from the browser-command registry (name, description, JSON input_schema for each of: `navigate, eval, click, insertText, key, listTabs, newTab, activateTab, screenshot, pdf, download, closeTab`).
  - Calls `POST https://api.anthropic.com/v1/messages` with `stream: true`, the selected model, `thinking: {type:"adaptive"}`, and an `effort` setting; header `anthropic-dangerous-direct-browser-access: true` + `anthropic-version`.
  - On a `tool_use` block: `chrome.runtime.sendMessage({cmd, params})` → background runs `handle()` → returns result. Result appended as a `tool_result`; **screenshot/pdf results are attached as `image`/document blocks** so the model can see the page.
  - Loops until `stop_reason === "end_turn"`; **hard cap ~25 tool turns** to prevent runaway.
- **`onboarding.js` (+ section in `sidepanel.html`)** — first-run welcome: API-key field, "Get a key" link to console.anthropic.com, "Test key" button (one cheap validating call), model default. Re-openable via ⚙.

### Modified files
- **`manifest.json`** — add `"sidePanel"` permission and `side_panel.default_path`; add `https://api.anthropic.com/*` to `host_permissions`; add icons (16/32/48/128).
- **`background.js`** — add the `chrome.runtime.onMessage` → `handle()` router; open the side panel on action-icon click (`chrome.sidePanel.setPanelBehavior`).
- **`extension/options.*`** — add API-key field (shared storage with onboarding) + model selector (the token/port/allowlist fields for v0.1 server mode stay, visually separated as "Advanced / terminal bridge").

### Distribution
- Icon set + clean manifest → **Chrome Web Store–publishable**.
- `build.sh` → produces `dist/ai-browser-bridge.zip` for the store and unpacked sharing.
- README rewrite: **Quick Start (chat)** at top (install → key → chat); v0.1 server/CLI setup moved to an "Advanced" section.

## Data flow (one turn)

1. User types → `sidepanel.js` appends `{role:"user"}` → calls `agent.run(messages)`.
2. `agent.js` streams the API response; text deltas render live in the panel.
3. On `tool_use`: send `{cmd,params}` to background → `handle()` executes → returns JSON (or base64 for screenshot/pdf).
4. Append `tool_result` (image block for screenshots) → next API call.
5. Repeat until `end_turn` or the 25-turn cap; final assistant text is the reply.

## Error handling

- **Missing/invalid key** → panel shows a friendly message + link to Options ("keys start with `sk-ant-`").
- **API errors** (401/429/network) → surfaced in the panel without killing the loop; 429 shows a retry hint.
- **Tool errors** → returned to the model as `tool_result` text (not thrown), so Claude can recover.
- **Runaway** → 25-turn cap ends the loop with a visible "stopped after N steps" note.
- **Side panel unsupported** (old Chrome) → onboarding shows a version note.

## Security

- Key lives in `chrome.storage.local` (browser), never leaves the machine except to
  `api.anthropic.com`. Onboarding states this in one line.
- The extension can act as the user on any logged-in site; Chrome's native
  "…is debugging this browser" banner shows when the debugger is attached (first
  eval/click/pdf), and `detach` clears it. The v0.1 host allowlist still applies to
  commands routed through `handle()`.
- Fully autonomous by explicit user choice; documented in README so it's not a surprise.

## Testing

- **`test/agent.test.js`** (new, offline): mock `fetch` to return a scripted
  `tool_use` → `end_turn` sequence; assert `agent.js` dispatches the right `{cmd,params}`,
  appends the tool_result, and terminates on `end_turn`. Also assert the 25-turn cap and
  an API-error path.
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

## Out of scope for v0.2

Per-tool confirmation UI, conversation persistence across browser restarts, multi-provider
support, the terminal-bridge changes (v0.1 path is untouched).
