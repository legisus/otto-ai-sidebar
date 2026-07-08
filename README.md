# Otto — your browser, on autopilot

**Otto** is a Claude-powered Chrome extension that drives your real, logged-in browser.
Two ways to use it:

- **Chat sidebar** *(v0.2, in design)* — talk to Claude in a side panel; it navigates,
  clicks, fills forms, and reads pages for you, autonomously. Just an API key — no server.
- **Terminal bridge** *(v0.1, shipping)* — a minimal, open-source bridge that lets an
  **AI coding agent** (Claude Code, or any local tool that can run a shell command) drive
  your browser — safely, on localhost, with no cloud in the loop.

The rest of this README documents the terminal bridge. See
`docs/superpowers/` for the chat-sidebar spec and plan.

---

## Quick start (chat sidebar)

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select the `extension/` folder.
2. Click the **Otto** toolbar icon → the side panel opens.
3. Pick a provider (Claude, Gemini, or an OpenAI-compatible endpoint), paste an **API key**, **Save & start**, and chat. Otto drives your tabs; hit **Stop** any time.

That's it — no server, no terminal. Your key is stored locally in the browser and sent
only to the provider you pick. (Gemini's Flash-Lite has a free API tier if you want
zero-cost use.) The terminal bridge below is a separate, advanced mode.

---

Born from a practical problem: an AI agent working in a terminal needed to download email
attachments, fill review forms, and drive web editors on sites the user was logged into.
OS-level scripting (AppleScript/xdotool) is platform-bound, steals window focus, and its
synthetic events are rejected by CSP-strict editors like Gmail or Grammarly. This bridge
fixes all of that with three small pieces:

```
AI agent / your scripts          bridge server               Chrome extension
   `bridge <cmd>` CLI  ⇄  ws://127.0.0.1:8765 (token)  ⇄  service worker (MV3)
                                                             │ chrome.tabs / scripting
                                                             │ chrome.debugger  → trusted input, CSP-proof eval
                                                             │ chrome.downloads → authenticated downloads
```

## Why the `chrome.debugger` route matters

- **Trusted input.** `Input.dispatchMouseEvent` / `Input.insertText` produce events with
  `isTrusted: true` — rich editors (Google Docs, Grammarly, Slate/ProseMirror apps) accept
  them where synthetic DOM events are ignored.
- **CSP-proof eval.** `Runtime.evaluate` works on pages whose Content-Security-Policy
  blocks injected `eval`.
- **No focus stealing.** Everything runs in background tabs (`newTab` opens with
  `active:false`); your work is never interrupted.
- **Your sessions, no re-login.** The extension lives in your normal profile, so Gmail,
  journals, dashboards — anything you're logged into — just work. This also sidesteps
  Chrome 136+'s restriction on `--remote-debugging-port` with the default profile.
- **Cross-platform.** macOS, Windows, Linux — no osascript, no xdotool.

## Install

1. **Server** (Node ≥ 18):
   ```bash
   npm install
   npm start          # generates ~/.otto/token on first run (chmod 600)
   ```
2. **Extension:** open `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
   select the `extension/` folder.
3. **Provision:** open the extension's *Options* page, paste the token from
   `~/.otto/token`, save. The service worker connects within ~30 s
   (or immediately after you press *Save*).
4. **Smoke test:**
   ```bash
   node server/cli.js ping
   # {"pong":true,"version":"0.1.0"}
   ```

## Usage

```bash
otto() { node /path/to/otto/server/cli.js "$@"; }

otto listTabs
otto newTab   '{"url":"https://mail.google.com"}'          # opens in background
otto eval     '{"tabId":123,"code":"document.title"}'
otto eval     '{"tabId":123}' --file scrape.js              # long scripts from a file
otto click    '{"tabId":123,"x":420,"y":310}'               # trusted click
otto insertText '{"tabId":123,"text":"Hello"}'              # trusted "paste" at caret
otto key      '{"tabId":123,"key":"Enter"}'
otto download '{"url":"https://.../file.pdf","filename":"file.pdf"}'   # uses your cookies
otto pdf      '{"tabId":123}' --out page.pdf
otto screenshot '{"tabId":123}' --out page.png
otto closeTab '{"tabId":123}'
otto detach   '{"tabId":123}'                               # remove the debugger banner
```

For an AI agent, the contract is simple: every command is one shell invocation that
prints JSON to stdout and exits non-zero on failure.

## Security model

Read this before installing — the extension can act as *you* on any site you're logged into.

- The server binds **127.0.0.1 only**; nothing is reachable from the network.
- Every client must present the **token** from `~/.otto/token`
  (created `chmod 600`). Without it, sockets are dropped.
- Optional **host allowlist** (extension Options): restrict commands to named domains
  and their subdomains. Empty list = allow all — set it if you want defense in depth.
- Every command is **logged** to `~/.otto/bridge.log`.
- Chrome shows its native **"… is debugging this browser"** banner whenever the
  debugger is attached — you always see when trusted-input mode is active. Use
  `detach` to clear it.
- No analytics, no telemetry, no external requests of any kind.

## Test

```bash
npm test    # spins up the server, a simulated extension, and the real CLI; asserts round-trips
```

## Project layout

```
extension/    Manifest V3 extension (service worker + options page)
server/       relay server (server.js) and CLI client (cli.js)
test/         protocol round-trip test with a simulated extension
```

## License

MIT © 2026 [Mykola Bielousov](https://scholar.google.com/citations?user=dOwVd0sAAAAJ)
