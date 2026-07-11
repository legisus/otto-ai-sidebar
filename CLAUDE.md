# Otto — project guide for Claude Code

Chrome MV3 side-panel extension: an LLM agent (Claude / Gemini / OpenAI-compatible)
that autonomously drives the user's logged-in browser via `chrome.debugger`.
Browser-only — no server, no build step, no runtime dependencies.

## Commands

- `npm test` — full offline suite (Node ≥ 18 built-in test runner; no Chrome or
  network needed). Run it after every logic change.
- There is no build, lint, or dev-server step. The extension loads unpacked from
  `extension/` via `chrome://extensions`.

## Layout

- `extension/agent.js` — provider-agnostic tool-use loop (AbortSignal, 25-turn cap)
- `extension/providers/` — `claude.js`, `gemini.js`, `openai-compat.js` adapters;
  `registry.js` is the **single edit-point** for provider/model lists; `http.js`
  has fetch + retry/backoff
- `extension/tools.js` — browser commands exposed to the model as tool schemas
- `extension/background.js` — service worker: runs the loop, executes tools via
  `handle(cmd, params)`, owns all provider network calls (CORS)
- `extension/sidepanel.*` — chat UI, onboarding, status dot
- `test/` — unit tests + `TEST-PLAN.md` (manual end-to-end checklist)

## Hard constraints

- Plain ES modules only; **never** add a build step or runtime dependency.
- Adapters and the agent loop must stay pure/injected (no direct `chrome.*` or
  `fetch` inside them) so they stay testable under Node — follow the existing
  dependency-injection pattern in the tests.
- API keys live only in `chrome.storage.local` and go only to the configured
  provider endpoint. Never log or persist them anywhere else.
- New models/providers: edit `extension/providers/registry.js` only, unless the
  wire protocol is genuinely new (then add an adapter next to the others).

## Verification

`npm test` covers the logic, but cannot exercise Chrome. After changing anything
under `extension/`, tell the user to reload the unpacked extension and run the
relevant steps from `test/TEST-PLAN.md` — do not claim end-to-end success from
unit tests alone.

## Commits

Conventional Commits with the `otto` scope: `feat(otto): …`, `fix(otto): …`,
`docs(otto): …`. Imperative subject, ≤ 72 chars. See CONTRIBUTING.md.
