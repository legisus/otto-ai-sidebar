# Chrome Web Store submission kit

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Build the upload zip with `npm run package`.

---

## Listing basics

- **Name:** Otto — AI browser autopilot
- **Category:** Productivity → Tools
- **Language:** English
- **Homepage:** https://github.com/legisus/otto-ai-sidebar
- **Privacy policy URL:** https://github.com/legisus/otto-ai-sidebar/blob/main/PRIVACY.md
  (or a GitHub Pages URL if you prefer a bare page)

**Summary (≤132 chars):**

> An AI assistant that drives your browser for you — reads pages, clicks, types, and
> reports back. Your API key; no middleman server.

**Description:**

> Otto is a side-panel assistant that operates your real, logged-in browser on your
> instruction. Ask it to do something — "summarize this page", "open my analytics and
> tell me how traffic is", "find the cheapest option across my open tabs" — and it
> navigates, reads pages, clicks, types, and takes screenshots on its own, then reports
> back in chat. You can stop it at any moment, and Chrome shows a visible banner
> whenever Otto is controlling a tab.
>
> Bring your own AI: Otto calls the LLM provider YOU choose — Anthropic (Claude),
> Google (Gemini), OpenAI, DeepSeek, Mistral, or Groq — directly from your browser
> with YOUR API key. There is no Otto server, no account, no subscription, no
> analytics, and no data collection by the developer. Your key is stored only in
> Chrome's local extension storage and sent only to the provider you picked.
>
> Note: Otto requires an API key from one of the supported providers (pay-per-token;
> Gemini has a free tier). A ChatGPT/Claude/Gemini consumer subscription does not
> include API access.
>
> Otto is fully open source: https://github.com/legisus/otto-ai-sidebar

## Single-purpose statement

> Otto has one purpose: to let an AI assistant operate the user's browser to complete
> tasks the user types in the side-panel chat. Every permission serves that single
> purpose. Otto has no secondary features: no new-tab page, no search-engine changes,
> no content injection into pages outside an active user-requested task, no monetization
> features of any kind.

---

## Permission justifications

Paste each into the corresponding field in the "Privacy practices" tab.

### `debugger` — the core permission (full justification)

> Otto's single purpose is to act as an autonomous browsing assistant: the user types a
> task, and the assistant operates the browser to complete it. The Chrome DevTools
> Protocol (via chrome.debugger) is the only extension API able to do this on real-world
> websites, and Otto uses it for four specific, user-visible functions:
>
> 1. TRUSTED INPUT (Input.dispatchMouseEvent, Input.dispatchKeyEvent, Input.insertText).
> To click buttons and type text for the user, events must carry isTrusted: true.
> Synthetic DOM events created by content scripts are deliberately ignored by the very
> applications users most want help with — Gmail's compose window, Google Docs, rich
> text editors, and many login/checkout flows — as an anti-bot measure. Only
> chrome.debugger input dispatch produces browser-level trusted events. Without it,
> "click send in Gmail" or "fill in this form" simply does not work, and the
> extension's advertised single purpose is impossible.
>
> 2. VISUAL CONTEXT ON BACKGROUND TABS (Page.captureScreenshot). The assistant sends
> screenshots to the user's chosen LLM so it can see the page layout and locate
> elements. Otto deliberately works in background tabs so it does not hijack the
> user's focus while they keep working; chrome.tabs.captureVisibleTab can only capture
> the active tab of a focused window, so Page.captureScreenshot is required.
>
> 3. RELIABLE PAGE READING (Runtime.evaluate). The assistant reads page text and
> element coordinates to decide what to do next. Runtime.evaluate returns values
> directly and works uniformly on all pages, including those whose Content-Security-
> Policy interferes with script-based approaches.
>
> 4. SAVE PAGE AS PDF (Page.printToPDF), which has no extension-API equivalent.
>
> Scope and transparency safeguards: Otto attaches the debugger only to tabs it is
> actively operating during a user-requested task, and detaches from all tabs as soon
> as the task finishes, so Chrome's "is debugging this browser" banner is visible
> exactly while the assistant is driving and disappears when it stops. Otto performs
> no debugger activity in the background, never attaches without a pending user
> instruction, and the user has a Stop button that aborts the task immediately. All
> code is open source and unobfuscated: https://github.com/legisus/otto-ai-sidebar

### `tabs`

> The assistant must enumerate open tabs (title/URL) to work across them ("compare
> prices across my open tabs"), open and close tabs, navigate, and focus a tab when
> the user asks. Tab metadata is used only during an active user-requested task and is
> sent only to the LLM provider the user configured; it is never collected or stored.

### `downloads`

> The assistant can save a file or an exported PDF to the user's Downloads folder when
> the user asks it to ("download this report"). Only triggered as a step of a
> user-requested task.

### `storage`

> Stores the user's own API key and provider/model preferences locally
> (chrome.storage.local). Nothing is synced or transmitted anywhere except the API
> key accompanying requests to the provider the user selected.

### `sidePanel`

> The entire user interface — the chat — lives in Chrome's side panel.

### Host permission `<all_urls>`

> Two uses, both inherent to the single purpose: (1) the assistant must be able to
> operate whatever site the user's task involves — the target sites are chosen by the
> user at run time and cannot be known in advance; (2) the service worker calls the
> LLM API endpoint of the user's chosen provider (api.anthropic.com,
> generativelanguage.googleapis.com, api.openai.com, api.deepseek.com, api.mistral.ai,
> api.groq.com) directly, with the user's own key. No other network requests are made.
> The developer operates no servers and receives no data.

### Remote code

Answer: **No, I am not using remote code.** All executable code ships in the package.
(Task-related JavaScript evaluated in pages goes through the documented Debugger API,
which Chrome's remote-code policy explicitly permits; there are no remote scripts,
no eval of downloaded code, no CDN imports.)

---

## Data-use disclosures (Privacy practices tab)

Check **"Website content"** and **"Personally identifiable information"** as data the
extension handles (page text/screenshots may contain PII, and they are transmitted to
the user's chosen AI provider). Then certify:

- Data is **not** sold to third parties. ✔ true
- Data is **not** used or transferred for purposes unrelated to the single purpose. ✔ true
- Data is **not** used or transferred to determine creditworthiness or for lending. ✔ true

In the free-text disclosure, state: *"Page content, screenshots, and chat messages are
sent exclusively to the AI provider the user selects and configures with their own API
key (Anthropic, Google, OpenAI, DeepSeek, Mistral, or Groq). The developer operates no
servers and receives no user data whatsoever."*

---

## Assets needed before submitting

- [ ] 3–5 screenshots, 1280×800: onboarding, a task mid-run (with the action trace and
      the debugging banner visible — honesty here helps review), a finished result.
- [ ] Small promo tile 440×280 (required); marquee 1400×560 (optional).
- [ ] Icons already in the package (16/32/48/128).

## Submission strategy

1. Upload as **Unlisted** first — full review, no public exposure while you iterate.
2. Expect the in-depth review track (days to ~2 weeks) because of `debugger` +
   `<all_urls>`. A rejection is routine, not a penalty: fix or appeal with the
   justification above.
3. Reply to reviewer emails promptly and factually; never resubmit unchanged builds.
4. Once approved and stable, flip visibility to Public.

## Account-safety rules (read before every release)

Rejections don't endanger the account; **policy violations do**. The things that get
developer accounts suspended are deception and repeat offenses, so:

- Never let the listing overpromise ("works with your ChatGPT subscription" would be
  false — it needs an API key). Misleading metadata is the #1 listing killer.
- Keep the single purpose pure: no bundled features (new-tab pages, search defaults,
  affiliate injection, analytics SDKs) — ever.
- No obfuscated or remotely-loaded code. Keep the GitHub repo in the listing so
  reviewers can diff claims against source.
- Don't use provider trademarks in the extension NAME or icon ("Claude", "ChatGPT",
  "Gemini" in the title invites a trademark strike; naming them in the description as
  supported providers is fine).
- Never manipulate reviews/ratings or create duplicate listings.
- Each update must keep the permission justifications accurate — if a permission is
  dropped or added, update the forms the same day.
