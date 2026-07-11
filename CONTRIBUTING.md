# Contributing to Otto

Thanks for your interest in improving Otto! This guide covers running the project
locally, developing with Claude Code, and submitting changes.

## Prerequisites

- **Google Chrome** (or any Chromium browser with Manifest V3 + side panel support)
- **Node.js ≥ 18** — only for running the test suite; the extension itself has
  **zero runtime dependencies** and no build step
- An **API key** for at least one provider (Claude, Gemini, or an OpenAI-compatible
  endpoint) if you want to test live. Gemini's Flash tier has a free quota.

## Running Otto locally

1. Clone the repo:
   ```bash
   git clone https://github.com/<owner>/otto.git
   cd otto
   ```
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Click the **Otto** toolbar icon — the side panel opens.
5. Pick a provider, paste your API key, **Save & start**, and chat.

After editing code, click the **reload** (↺) button on the extension card in
`chrome://extensions`, then reopen the side panel. Changes to `sidepanel.*` only
need the panel reopened; changes to `background.js`, `agent.js`, `tools.js`, or
`providers/` need the full extension reload.

**Debugging:**
- Side panel: right-click inside the panel → **Inspect**.
- Service worker: `chrome://extensions` → Otto → **Inspect views: service worker**.

## Running the tests

```bash
npm test
```

The suite runs offline under Node's built-in test runner — no Chrome, no network,
no API keys. It covers the tool registry, adapter stream-normalization, HTTP retry
logic, and the agent loop. For manual end-to-end checks, see `test/TEST-PLAN.md`.

## Developing with Claude Code

This repo works well with [Claude Code](https://claude.com/claude-code). From the
repo root, just run:

```bash
claude
```

The root `CLAUDE.md` gives Claude the project layout, test command, and
conventions automatically. Useful prompts to get going:

- `Run the tests and fix any failures`
- `Add support for provider X — follow the pattern in extension/providers/`
- `Explain how the agent loop in extension/agent.js handles tool calls`

Claude Code can run `npm test` itself, but it cannot click through Chrome — after
any change to the extension, verify manually with the flow in `test/TEST-PLAN.md`
(load unpacked → reload → drive a real conversation).

## Making changes

1. **Branch** off `main`:
   ```bash
   git checkout -b my-feature main
   ```
2. **Keep the design constraints:**
   - No build step, no runtime dependencies — plain ES modules only.
   - Adapters and the agent loop stay pure/injected so they remain testable
     under Node without Chrome (see existing tests for the pattern).
   - New models/providers go in `extension/providers/registry.js` — it is the
     single edit-point for model lists.
   - Never log, store, or transmit API keys anywhere except
     `chrome.storage.local` and the chosen provider's endpoint.
3. **Add or update tests** in `test/` for any logic change. UI-only changes
   should update `test/TEST-PLAN.md` instead.
4. **Run** `npm test` — everything must pass.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) with the `otto`
scope, matching the existing history:

```
feat(otto): add DeepSeek reasoning models to the registry
fix(otto): Gemini rejects additionalProperties in tool schemas
docs(otto): clarify side-panel reload steps
refactor(otto): extract SSE parsing from the Claude adapter
test(otto): cover retry backoff on 429
```

- Subject line: imperative mood, no trailing period, ≤ 72 chars.
- Body (optional): explain *why*, not *what* — the diff shows the what.

## Submitting a pull request

1. Push your branch and open a PR against `main`.
2. In the description, cover: what changed, why, how you tested it
   (`npm test` + which manual TEST-PLAN steps you ran).
3. One logical change per PR — small PRs get reviewed faster.
4. PRs must not add runtime dependencies or a build step without prior
   discussion in an issue.

## Reporting bugs & proposing features

Open a GitHub issue. For bugs, include: Chrome version, provider + model,
what you asked Otto to do, what happened, and any errors from the service-worker
console. **Never paste your API key** — redact it from logs before posting.

## Security

Otto sends your API key only to the provider you configured and stores it only
in `chrome.storage.local`. If you find a vulnerability (key leakage, prompt
injection via page content, tool-escalation, etc.), please report it privately
via GitHub's **Report a vulnerability** (Security tab) rather than a public issue.
