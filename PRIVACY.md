# Otto — Privacy Policy

*Last updated: July 10, 2026*

Otto is a browser extension that lets you chat with an AI assistant which operates your
browser on your behalf. Otto is designed so that **the developer never receives any of
your data**. There is no Otto server.

## What Otto stores, and where

- **Your API keys** (Anthropic, Google, OpenAI, DeepSeek, Mistral, or Groq) are stored
  only in your browser's local extension storage (`chrome.storage.local`) on your
  device. They are sent only to the API endpoint of the provider you selected, solely
  to authenticate your requests. They are never sent anywhere else, never logged, and
  never leave your machine otherwise.
- **Your conversations** are held in memory for the duration of a chat session and are
  not persisted after the side panel is closed.

## What Otto sends, and to whom

When you give Otto a task, the following is sent **only to the LLM provider you chose**
(e.g. `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.openai.com`,
`api.deepseek.com`, `api.mistral.ai`, or `api.groq.com`):

- your chat messages;
- content of web pages Otto reads while performing your task (text, page structure);
- screenshots of tabs Otto is operating in, when it needs to see the page layout.

This is inherent to how the product works: the model can only help with what it can
see. Treat a conversation with Otto like a conversation with your chosen AI provider —
their privacy policy and data-retention terms apply to what is sent to them. Otto adds
no parties of its own.

## What Otto does NOT do

- No Otto/developer servers — nothing transits infrastructure we control.
- No analytics, telemetry, tracking pixels, or crash reporting.
- No advertising, and no sale or transfer of user data to anyone.
- No collection of browsing history: Otto only touches tabs while it is actively
  performing a task you asked for, and detaches when the task finishes.
- No background activity: Otto does nothing unless you send it a message.

## Permissions

Otto requests broad browser permissions (`debugger`, `tabs`, `<all_urls>`,
`downloads`, `storage`) because its single purpose is to operate your browser for you:
reading pages, clicking, typing, taking screenshots, and downloading files **at your
instruction**. Chrome displays a visible banner whenever Otto is controlling a tab, and
the banner disappears when the task finishes. Full per-permission justifications are in
the project repository (`docs/store-listing.md`).

## Open source

Otto's complete source code is public at
<https://github.com/legisus/otto-ai-sidebar> — every claim in this policy can be
verified by reading it.

## Changes & contact

Changes to this policy will appear in this file with an updated date. Questions:
open an issue at <https://github.com/legisus/otto-ai-sidebar/issues>.
