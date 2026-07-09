# Otto — Test Plan

## Offline suites (`npm test`, no Chrome, no network)

- `tools.test.js` — the browser-command tool registry (names, schemas, required params).
- `adapters.test.js` — provider/model registry + Claude/Gemini/OpenAI-compat stream
  normalization to `{text|toolCall|done}`, vision-strip when `vision:false`, and Gemini's
  `additionalProperties` stripping.
- `agent.test.js` — the agent loop: tool round-trip, 25-turn cap, tool-error recovery, AbortSignal stop.
- `http.test.js` — `fetchRetry` (retry transient 5xx, not 4xx) and friendly `httpError` messages.

Last run: **19/19 PASS**. Adapters and the loop are pure/injected, so they run without a browser.

## Live-verified against real APIs

Run the adapters against the real provider APIs from Node (import the adapter, inject
`fetch`, send an "open youtube.com in a new tab" prompt with the tool set):

- **Claude Sonnet 5** — calls `newTab`, full round trip. ✅
- **Gemini 2.5 Flash** — calls `newTab`, then confirms after the tool result. ✅ (needs
  `toolConfig:AUTO`, CRLF-aware SSE parsing, and `thoughtSignature` echo — all in the adapter.)
- **OpenAI** — auth verified; full run pending an account with quota.

## Manual checklist (needs a real key; load unpacked, open the side panel)

- Onboarding appears on first run; "Test key" reports the real validation result; Save starts the chat.
- Status dot: gray (no key) → green (ready, model on hover) → amber pulse (working) → red (error).
- "list my open tabs and tell me how many" → a `checked your open tabs` action, then an answer.
- "open news.ycombinator.com and read me the top story" → `opened …` + `read the page`, then the story.
- "save this page as a PDF" → lands in Downloads (not fed to the model as an image).
- Start a long task, click **Stop** → the run halts and shows "Stopped."
- Switch the header model to Gemini (with a Gemini key) → routes to the Gemini adapter.
- Dark/light follows the browser theme; keyboard focus visible; the dot pulses only while working (and not under reduced-motion).
