# Otto Chat Sidebar (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome side-panel chat to the Otto extension where an LLM (Claude, Gemini, or an OpenAI-compatible model) autonomously drives the user's logged-in browser using the existing browser-control commands.

**Architecture:** The side panel is a thin UI that talks to the background service worker over a long-lived port. The worker hosts a provider-agnostic agent loop (`agent.js`) that calls the selected provider through a swappable adapter, and executes tool calls via the existing v0.1 `handle(cmd, params)`. All network calls live in the worker so `host_permissions` bypass website CORS. Keys live in `chrome.storage.local`.

**Tech Stack:** Manifest V3 Chrome extension, vanilla JS (no build step for the extension), Node's built-in `node:test` for offline unit tests, `ws` (already a dep) for the untouched v0.1 server.

## Global Constraints

- Manifest V3; extension code is plain ES modules loaded by Chrome — **no bundler/transpiler**.
- **No new npm runtime dependencies.** Tests use Node's built-in `node:test` + `node:assert`.
- Keys stored in `chrome.storage.local` only; never logged, never sent anywhere except the selected provider's API host.
- All provider network `fetch` calls happen in the **background service worker** (host_permissions bypass CORS); the side-panel page makes none.
- Reuse the existing `handle(cmd, params)` in `extension/background.js` for tool execution — do not duplicate browser-control logic.
- Agent loop hard cap: **25 tool turns**.
- Default provider/model: **Claude / `claude-sonnet-5`**.
- Tool set (identical across providers): `navigate, eval, click, insertText, key, listTabs, newTab, activateTab, screenshot, pdf, download, closeTab`.
- Provider hosts for `host_permissions`: `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.openai.com`, `api.deepseek.com`, `api.mistral.ai`, `api.groq.com`.
- Commit after every task. Branch: work on `v0.2-chat-sidebar` (not `main`).

---

## File structure

**New (extension, all ES modules):**
- `extension/tools.js` — the tool registry: metadata + JSON schema for each browser command. Pure data + one helper. Imported by the worker and adapters.
- `extension/providers/registry.js` — provider + endpoint + model catalog (name, adapter id, baseURL, models, per-model `vision`).
- `extension/providers/claude.js` — Claude adapter.
- `extension/providers/gemini.js` — Gemini adapter.
- `extension/providers/openai-compat.js` — OpenAI-compatible adapter (OpenAI/DeepSeek/Mistral/Groq via baseURL).
- `extension/agent.js` — provider-agnostic agent loop (runs in the worker).
- `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js` — chat UI + onboarding view.
- `extension/config.js` — small shared helpers for reading/writing settings in `chrome.storage.local`.

**New (tests, Node):**
- `test/tools.test.js`, `test/adapters.test.js`, `test/agent.test.js`.

**Modified:**
- `extension/manifest.json` — sidePanel permission, side_panel path, host_permissions, action, icons.
- `extension/background.js` — add the `chrome.runtime.onConnect` port router + host the agent loop; add `chrome.sidePanel.setPanelBehavior`.
- `package.json` — extend the `test` script to run all `test/*.test.js`.

**Design note for testability:** adapters and the agent loop must be importable in plain Node (no `chrome.*` at import time). Achieve this by (a) keeping `chrome.*` access out of module top-level, and (b) having `agent.js` take its tool-executor and provider-adapter as **injected parameters** rather than importing `background.js`. Tests inject fakes; the worker injects the real `handle` and the real adapter.

---

### Task 1: Tool registry (`extension/tools.js`)

**Files:**
- Create: `extension/tools.js`
- Test: `test/tools.test.js`

**Interfaces:**
- Produces: `export const TOOLS` — array of `{name, description, input_schema}` (JSON Schema, `type:"object"`), one per browser command. `export function toolNames()` → `string[]`.

- [ ] **Step 1: Write the failing test**

```js
// test/tools.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, toolNames } from "../extension/tools.js";

const EXPECTED = ["navigate","eval","click","insertText","key","listTabs","newTab","activateTab","screenshot","pdf","download","closeTab"];

test("registry lists exactly the browser commands", () => {
  assert.deepEqual(toolNames().sort(), [...EXPECTED].sort());
});

test("every tool has a description and an object input_schema", () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 0, `${t.name} needs a description`);
    assert.equal(t.input_schema.type, "object", `${t.name} schema must be object`);
    assert.ok(t.input_schema.properties, `${t.name} needs properties`);
  }
});

test("navigate/eval/click declare their required params", () => {
  const by = Object.fromEntries(TOOLS.map(t => [t.name, t]));
  assert.deepEqual(by.navigate.input_schema.required, ["tabId","url"]);
  assert.deepEqual(by.eval.input_schema.required, ["tabId","code"]);
  assert.deepEqual(by.click.input_schema.required.sort(), ["tabId","x","y"].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tools.test.js`
Expected: FAIL — cannot find module `../extension/tools.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/tools.js
// Tool registry: one entry per browser-control command handled by background.js `handle()`.
// Pure data — safe to import in Node (no chrome.* here).
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const S = { string: { type: "string" }, int: { type: "integer" }, bool: { type: "boolean" } };

export const TOOLS = [
  { name: "listTabs", description: "List all open browser tabs with their id, url, title, and active flag.",
    input_schema: obj({}) },
  { name: "newTab", description: "Open a new tab. Set active=false to open in the background without stealing focus.",
    input_schema: obj({ url: S.string, active: S.bool }, ["url"]) },
  { name: "activateTab", description: "Focus a tab and bring its window to the front.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "navigate", description: "Navigate a tab to a URL.",
    input_schema: obj({ tabId: S.int, url: S.string }, ["tabId","url"]) },
  { name: "closeTab", description: "Close a tab by id.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "eval", description: "Run JavaScript in a tab and return its value (CSP-proof, via the DevTools protocol). Use this to read page text/DOM and scrape.",
    input_schema: obj({ tabId: S.int, code: S.string }, ["tabId","code"]) },
  { name: "click", description: "Trusted mouse click at viewport coordinates (CSS px). Use for buttons that reject synthetic clicks.",
    input_schema: obj({ tabId: S.int, x: S.int, y: S.int }, ["tabId","x","y"]) },
  { name: "insertText", description: "Trusted text insertion at the current caret (equivalent to a real paste).",
    input_schema: obj({ tabId: S.int, text: S.string }, ["tabId","text"]) },
  { name: "key", description: "Trusted key press, e.g. Enter or Tab.",
    input_schema: obj({ tabId: S.int, key: S.string, code: S.string, modifiers: S.int }, ["tabId","key"]) },
  { name: "screenshot", description: "Capture a PNG screenshot of the tab. Returns base64. Use to SEE the page.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "pdf", description: "Render the tab to PDF. Returns base64.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "download", description: "Download a URL to the user's Downloads folder using the browser's cookies.",
    input_schema: obj({ url: S.string, filename: S.string }, ["url","filename"]) },
];

export function toolNames() { return TOOLS.map(t => t.name); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tools.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/tools.js test/tools.test.js
git commit -m "feat(otto): tool registry for the chat agent"
```

---

### Task 2: Provider registry (`extension/providers/registry.js`)

**Files:**
- Create: `extension/providers/registry.js`
- Test: `test/adapters.test.js` (registry portion)

**Interfaces:**
- Produces: `export const PROVIDERS` — array of `{id, label, adapter, keyPrefixHint, keyUrl, endpoints}`. Each endpoint: `{id, label, baseURL, models}`. Each model: `{id, label, vision:boolean, priceHint}`. `export function findModel(providerId, endpointId, modelId)` → `{provider, endpoint, model}` or `null`. `export const DEFAULT = {provider:"claude", endpoint:"anthropic", model:"claude-sonnet-5"}`.

- [ ] **Step 1: Write the failing test**

```js
// test/adapters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, findModel, DEFAULT } from "../extension/providers/registry.js";

test("default resolves to a real vision-capable model", () => {
  const hit = findModel(DEFAULT.provider, DEFAULT.endpoint, DEFAULT.model);
  assert.ok(hit, "default model must exist in the registry");
  assert.equal(hit.model.vision, true);
});

test("adapter ids are one of the three known adapters", () => {
  const ok = new Set(["claude","gemini","openai-compat"]);
  for (const p of PROVIDERS) assert.ok(ok.has(p.adapter), `${p.id} → unknown adapter ${p.adapter}`);
});

test("every model declares a boolean vision flag", () => {
  for (const p of PROVIDERS)
    for (const e of p.endpoints)
      for (const m of e.models)
        assert.equal(typeof m.vision, "boolean", `${p.id}/${e.id}/${m.id} vision must be boolean`);
});

test("gemini and openai-compat providers are present at launch", () => {
  const ids = PROVIDERS.map(p => p.id);
  for (const need of ["claude","gemini","openai"]) assert.ok(ids.includes(need), `missing provider ${need}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adapters.test.js`
Expected: FAIL — cannot find module `../extension/providers/registry.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/providers/registry.js
// Single edit-point for providers/endpoints/models. Pure data (no chrome.*).
export const PROVIDERS = [
  {
    id: "claude", label: "Claude (Anthropic)", adapter: "claude",
    keyPrefixHint: "sk-ant-", keyUrl: "https://console.anthropic.com/settings/keys",
    endpoints: [{
      id: "anthropic", label: "Anthropic API", baseURL: "https://api.anthropic.com/v1",
      models: [
        { id: "claude-sonnet-5", label: "Sonnet 5 (default)", vision: true, priceHint: "$3/$15" },
        { id: "claude-opus-4-8", label: "Opus 4.8", vision: true, priceHint: "$5/$25" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5 (cheap)", vision: true, priceHint: "$1/$5" },
        { id: "claude-fable-5", label: "Fable 5 (max)", vision: true, priceHint: "$10/$50" },
      ],
    }],
  },
  {
    id: "gemini", label: "Gemini (Google)", adapter: "gemini",
    keyPrefixHint: "AIza", keyUrl: "https://aistudio.google.com/apikey",
    endpoints: [{
      id: "gemini", label: "Gemini API", baseURL: "https://generativelanguage.googleapis.com/v1beta",
      models: [
        { id: "gemini-3.5-flash", label: "3.5 Flash", vision: true, priceHint: "$1.50/$9" },
        { id: "gemini-3.1-flash-lite", label: "3.1 Flash-Lite (free tier)", vision: true, priceHint: "$0.25/$1.50" },
        { id: "gemini-2.5-flash", label: "2.5 Flash (cheap)", vision: true, priceHint: "$0.15/$0.60" },
        { id: "gemini-3.1-pro", label: "3.1 Pro", vision: true, priceHint: "$2/$12" },
      ],
    }],
  },
  {
    id: "openai", label: "OpenAI-compatible", adapter: "openai-compat",
    keyPrefixHint: "", keyUrl: "https://platform.openai.com/api-keys",
    endpoints: [
      { id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1",
        models: [
          { id: "gpt-5.1", label: "GPT-5.1", vision: true, priceHint: "varies" },
          { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (cheap)", vision: true, priceHint: "~$0.10/$0.40" },
        ] },
      { id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com/v1",
        models: [
          { id: "deepseek-chat", label: "DeepSeek V4 Flash (cheapest, text-only)", vision: false, priceHint: "$0.14/$0.28" },
        ] },
      { id: "mistral", label: "Mistral", baseURL: "https://api.mistral.ai/v1",
        models: [
          { id: "pixtral-large-latest", label: "Pixtral (vision, cheap)", vision: true, priceHint: "~$0.15/$0.60" },
          { id: "mistral-small-latest", label: "Mistral Small (text-only)", vision: false, priceHint: "~$0.10/$0.30" },
        ] },
      { id: "groq", label: "Groq (fast, free tier)", baseURL: "https://api.groq.com/openai/v1",
        models: [
          { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (text-only)", vision: false, priceHint: "free tier" },
        ] },
    ],
  },
];

export const DEFAULT = { provider: "claude", endpoint: "anthropic", model: "claude-sonnet-5" };

export function findModel(providerId, endpointId, modelId) {
  const provider = PROVIDERS.find(p => p.id === providerId);
  const endpoint = provider?.endpoints.find(e => e.id === endpointId);
  const model = endpoint?.models.find(m => m.id === modelId);
  return model ? { provider, endpoint, model } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/adapters.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/providers/registry.js test/adapters.test.js
git commit -m "feat(otto): provider/model registry"
```

---

### Task 3: Claude adapter (`extension/providers/claude.js`)

**Files:**
- Create: `extension/providers/claude.js`
- Test: `test/adapters.test.js` (append)

**Interfaces:**
- Consumes: `TOOLS` from `tools.js`.
- Produces: `export function claudeAdapter({ apiKey, baseURL })` → object with `async *stream({ model, system, messages, tools, vision, fetchImpl })`. Yields events `{type:"text", text}`, `{type:"toolCall", id, name, input}`, `{type:"done", stopReason}`. `messages` is Otto's internal format: `[{role:"user"|"assistant"|"tool", ...}]` where a tool message is `{role:"tool", toolCallId, name, content, image?}` (image = base64 PNG or null). `fetchImpl` defaults to global `fetch` (injected in tests).
- Internal-format contract (shared by all adapters): user/assistant messages are `{role, text}`; assistant tool calls are `{role:"assistant", toolCalls:[{id,name,input}]}`; tool results are `{role:"tool", toolCallId, name, content, image}`.

- [ ] **Step 1: Write the failing test** (append to `test/adapters.test.js`)

```js
import { claudeAdapter } from "../extension/providers/claude.js";

// Build a fake fetch returning an Anthropic SSE stream body.
function sseResponse(lines) {
  const body = lines.map(l => `event: ${l.event}\ndata: ${JSON.stringify(l.data)}\n\n`).join("");
  return {
    ok: true, status: 200,
    body: { getReader() {
      const bytes = new TextEncoder().encode(body); let done = false;
      return { read() { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: bytes, done: false }); } };
    } },
  };
}

test("claude adapter normalizes text + tool_use + stop", async () => {
  const fakeFetch = async () => sseResponse([
    { event: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
    { event: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "Hello" } } },
    { event: "content_block_start", data: { index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "listTabs", input: {} } } },
    { event: "content_block_delta", data: { index: 1, delta: { type: "input_json_delta", partial_json: "{}" } } },
    { event: "message_delta", data: { delta: { stop_reason: "tool_use" } } },
  ]);
  const ad = claudeAdapter({ apiKey: "sk-ant-x", baseURL: "https://api.anthropic.com/v1" });
  const events = [];
  for await (const ev of ad.stream({ model: "claude-sonnet-5", system: "", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: true, fetchImpl: fakeFetch }))
    events.push(ev);
  assert.deepEqual(events.filter(e => e.type === "text").map(e => e.text).join(""), "Hello");
  const call = events.find(e => e.type === "toolCall");
  assert.equal(call.name, "listTabs");
  assert.deepEqual(call.input, {});
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).stopReason, "tool_use");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adapters.test.js`
Expected: FAIL — cannot find module `../extension/providers/claude.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/providers/claude.js
// Maps Otto's internal message/tool format to the Anthropic Messages API and
// normalizes the SSE stream back to Otto events. No chrome.* — fetch is injected.

function toAnthropicMessages(messages) {
  // Collapse Otto internal format into Anthropic's content-block messages.
  const out = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: [{ type: "text", text: m.text }] });
    else if (m.role === "assistant" && m.toolCalls)
      out.push({ role: "assistant", content: m.toolCalls.map(tc => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input })) });
    else if (m.role === "assistant") out.push({ role: "assistant", content: [{ type: "text", text: m.text }] });
    else if (m.role === "tool") {
      const content = [{ type: "text", text: m.content ?? "" }];
      if (m.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: m.image } });
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content }] });
    }
  }
  return out;
}

async function* parseSSE(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
      if (dataLine) { try { yield JSON.parse(dataLine.slice(5).trim()); } catch {} }
    }
  }
}

export function claudeAdapter({ apiKey, baseURL }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch }) {
      const body = {
        model, max_tokens: 8000, stream: true,
        thinking: { type: "adaptive" }, output_config: { effort: "high" },
        system: system || undefined,
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages: toAnthropicMessages(messages),
      };
      const res = await fetchImpl(`${baseURL}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const txt = await (res.text?.() ?? Promise.resolve("")); throw new Error(`claude ${res.status}: ${txt}`); }

      const toolAcc = {}; // index -> {id,name,json}
      for await (const ev of parseSSE(res)) {
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use")
          toolAcc[ev.index] = { id: ev.content_block.id, name: ev.content_block.name, json: "" };
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta")
          yield { type: "text", text: ev.delta.text };
        else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta")
          toolAcc[ev.index] && (toolAcc[ev.index].json += ev.delta.partial_json);
        else if (ev.type === "content_block_stop" && toolAcc[ev.index]) {
          const a = toolAcc[ev.index]; let input = {}; try { input = a.json ? JSON.parse(a.json) : {}; } catch {}
          yield { type: "toolCall", id: a.id, name: a.name, input };
        } else if (ev.type === "message_delta" && ev.delta?.stop_reason)
          yield { type: "done", stopReason: ev.delta.stop_reason };
      }
    },
  };
}
```

Note: the test's fake stream fires `toolCall` from a `content_block_stop`; add that event to the fake if your run shows the tool call missing — the test above includes the deltas but relies on `content_block_stop`. **Add** `{ event: "content_block_stop", data: { index: 1 } }` before `message_delta` in the test fixture.

- [ ] **Step 4: Update the test fixture and run**

Add `{ event: "content_block_stop", data: { index: 1 } }` to the `sseResponse([...])` array (before the `message_delta` line), then:
Run: `node --test test/adapters.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/providers/claude.js test/adapters.test.js
git commit -m "feat(otto): Claude provider adapter"
```

---

### Task 4: OpenAI-compatible adapter (`extension/providers/openai-compat.js`)

**Files:**
- Create: `extension/providers/openai-compat.js`
- Test: `test/adapters.test.js` (append)

**Interfaces:**
- Produces: `export function openaiCompatAdapter({ apiKey, baseURL })` → `{ async *stream({model,system,messages,tools,vision,fetchImpl}) }` yielding the same `{text|toolCall|done}` events. When `vision===false`, tool-result images are dropped (not sent).

- [ ] **Step 1: Write the failing test** (append)

```js
import { openaiCompatAdapter } from "../extension/providers/openai-compat.js";

function openaiSSE(chunks) {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return { ok: true, status: 200, body: { getReader() {
    const bytes = new TextEncoder().encode(body); let done = false;
    return { read() { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: bytes, done: false }); } };
  } } };
}

test("openai-compat normalizes text + tool_calls + finish", async () => {
  const fakeFetch = async () => openaiSSE([
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "listTabs", arguments: "{}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls" }] },
  ]);
  const ad = openaiCompatAdapter({ apiKey: "x", baseURL: "https://api.deepseek.com/v1" });
  const events = [];
  for await (const ev of ad.stream({ model: "deepseek-chat", system: "s", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: false, fetchImpl: fakeFetch }))
    events.push(ev);
  assert.equal(events.find(e => e.type === "text").text, "Hi");
  assert.equal(events.find(e => e.type === "toolCall").name, "listTabs");
  assert.equal(events.at(-1).type, "done");
});

test("openai-compat drops tool images when vision=false", async () => {
  let sentBody;
  const fakeFetch = async (_url, opts) => { sentBody = JSON.parse(opts.body); return openaiSSE([{ choices: [{ finish_reason: "stop" }] }]); };
  const ad = openaiCompatAdapter({ apiKey: "x", baseURL: "https://api.deepseek.com/v1" });
  const msgs = [{ role: "user", text: "hi" }, { role: "tool", toolCallId: "call_1", name: "screenshot", content: "shot taken", image: "BASE64PNG" }];
  for await (const _ of ad.stream({ model: "deepseek-chat", system: "", messages: msgs, tools: TOOLS, vision: false, fetchImpl: fakeFetch })) {}
  const serialized = JSON.stringify(sentBody);
  assert.ok(!serialized.includes("BASE64PNG"), "image data must not be sent when vision=false");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adapters.test.js`
Expected: FAIL — cannot find module `../extension/providers/openai-compat.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/providers/openai-compat.js
// One adapter for any OpenAI-compatible chat-completions endpoint (OpenAI, DeepSeek,
// Mistral, Groq). Vision via image_url data-URI parts; dropped when vision=false.

function toOpenAIMessages(messages, vision) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant" && m.toolCalls)
      out.push({ role: "assistant", content: null, tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.text });
    else if (m.role === "tool") {
      if (vision && m.image)
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: [
          { type: "text", text: m.content ?? "" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${m.image}` } },
        ] });
      else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" });
    }
  }
  return out;
}

async function* parseSSE(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try { yield JSON.parse(payload); } catch {}
    }
  }
}

export function openaiCompatAdapter({ apiKey, baseURL }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch }) {
      const msgs = [];
      if (system) msgs.push({ role: "system", content: system });
      msgs.push(...toOpenAIMessages(messages, vision));
      const body = {
        model, stream: true, messages: msgs,
        tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      };
      const res = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const txt = await (res.text?.() ?? Promise.resolve("")); throw new Error(`openai-compat ${res.status}: ${txt}`); }

      const acc = {}; // index -> {id,name,args}
      let stop = "stop";
      for await (const ev of parseSSE(res)) {
        const ch = ev.choices?.[0]; if (!ch) continue;
        if (ch.delta?.content) yield { type: "text", text: ch.delta.content };
        for (const tc of ch.delta?.tool_calls ?? []) {
          acc[tc.index] ??= { id: tc.id, name: "", args: "" };
          if (tc.id) acc[tc.index].id = tc.id;
          if (tc.function?.name) acc[tc.index].name = tc.function.name;
          if (tc.function?.arguments) acc[tc.index].args += tc.function.arguments;
        }
        if (ch.finish_reason) stop = ch.finish_reason;
      }
      for (const a of Object.values(acc)) {
        let input = {}; try { input = a.args ? JSON.parse(a.args) : {}; } catch {}
        yield { type: "toolCall", id: a.id, name: a.name, input };
      }
      yield { type: "done", stopReason: stop };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/adapters.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/providers/openai-compat.js test/adapters.test.js
git commit -m "feat(otto): OpenAI-compatible provider adapter"
```

---

### Task 5: Gemini adapter (`extension/providers/gemini.js`)

**Files:**
- Create: `extension/providers/gemini.js`
- Test: `test/adapters.test.js` (append)

**Interfaces:**
- Produces: `export function geminiAdapter({ apiKey, baseURL })` → `{ async *stream(...) }` yielding the same `{text|toolCall|done}` events. Uses `:streamGenerateContent?alt=sse`.

- [ ] **Step 1: Write the failing test** (append)

```js
import { geminiAdapter } from "../extension/providers/gemini.js";

function geminiSSE(objs) {
  const body = objs.map(o => `data: ${JSON.stringify(o)}\n\n`).join("");
  return { ok: true, status: 200, body: { getReader() {
    const bytes = new TextEncoder().encode(body); let done = false;
    return { read() { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: bytes, done: false }); } };
  } } };
}

test("gemini normalizes text + functionCall + finish", async () => {
  const fakeFetch = async () => geminiSSE([
    { candidates: [{ content: { parts: [{ text: "Yo" }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "listTabs", args: {} } }] } }] },
    { candidates: [{ finishReason: "STOP" }] },
  ]);
  const ad = geminiAdapter({ apiKey: "AIza-x", baseURL: "https://generativelanguage.googleapis.com/v1beta" });
  const events = [];
  for await (const ev of ad.stream({ model: "gemini-3.5-flash", system: "s", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: true, fetchImpl: fakeFetch }))
    events.push(ev);
  assert.equal(events.find(e => e.type === "text").text, "Yo");
  assert.equal(events.find(e => e.type === "toolCall").name, "listTabs");
  assert.equal(events.at(-1).type, "done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adapters.test.js`
Expected: FAIL — cannot find module `../extension/providers/gemini.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/providers/gemini.js
// Maps Otto internal format to Gemini generateContent and normalizes the SSE stream.

function toGeminiContents(messages, vision) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.text }] });
    else if (m.role === "assistant" && m.toolCalls)
      contents.push({ role: "model", parts: m.toolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.input } })) });
    else if (m.role === "assistant") contents.push({ role: "model", parts: [{ text: m.text }] });
    else if (m.role === "tool") {
      const parts = [{ functionResponse: { name: m.name, response: { result: m.content ?? "" } } }];
      if (vision && m.image) parts.push({ inlineData: { mimeType: "image/png", data: m.image } });
      contents.push({ role: "user", parts });
    }
  }
  return contents;
}

async function* parseSSE(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find(l => l.startsWith("data:"));
      if (line) { try { yield JSON.parse(line.slice(5).trim()); } catch {} }
    }
  }
}

export function geminiAdapter({ apiKey, baseURL }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch }) {
      const body = {
        contents: toGeminiContents(messages, vision),
        tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }],
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const url = `${baseURL}/models/${model}:streamGenerateContent?alt=sse`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const txt = await (res.text?.() ?? Promise.resolve("")); throw new Error(`gemini ${res.status}: ${txt}`); }

      let stop = "STOP";
      for await (const ev of parseSSE(res)) {
        const cand = ev.candidates?.[0]; if (!cand) continue;
        for (const part of cand.content?.parts ?? []) {
          if (part.text) yield { type: "text", text: part.text };
          else if (part.functionCall) yield { type: "toolCall", id: `gem_${part.functionCall.name}_${Math.round(performance.now())}`, name: part.functionCall.name, input: part.functionCall.args ?? {} };
        }
        if (cand.finishReason) stop = cand.finishReason;
      }
      yield { type: "done", stopReason: stop };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/adapters.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/providers/gemini.js test/adapters.test.js
git commit -m "feat(otto): Gemini provider adapter"
```

---

### Task 6: Agent loop (`extension/agent.js`)

**Files:**
- Create: `extension/agent.js`
- Test: `test/agent.test.js`

**Interfaces:**
- Consumes: an adapter (`{stream}`) and a tool executor, both injected.
- Produces: `export async function runAgent({ adapter, model, system, tools, vision, history, execTool, onText, onToolStart, onToolResult, maxTurns = 25 })`. `history` is the internal-format message array (mutated/returned). `execTool(name, input)` → `{content:string, image?:string}` (image = base64 PNG for screenshot/pdf, else undefined). Returns `{ history, stopReason }`. A "turn" is one adapter round; if a round yields tool calls, they are executed and the loop continues; otherwise it ends.

- [ ] **Step 1: Write the failing test**

```js
// test/agent.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../extension/agent.js";
import { TOOLS } from "../extension/tools.js";

// Fake adapter: round 1 emits a listTabs tool call; round 2 emits text + done.
function scriptedAdapter() {
  let round = 0;
  return { async *stream() {
    round++;
    if (round === 1) { yield { type: "toolCall", id: "t1", name: "listTabs", input: {} }; yield { type: "done", stopReason: "tool_use" }; }
    else { yield { type: "text", text: "You have 2 tabs." }; yield { type: "done", stopReason: "end_turn" }; }
  } };
}

test("runAgent executes a tool call then finishes with text", async () => {
  const calls = []; const texts = [];
  const res = await runAgent({
    adapter: scriptedAdapter(), model: "m", system: "", tools: TOOLS, vision: true,
    history: [{ role: "user", text: "how many tabs?" }],
    execTool: async (name, input) => { calls.push([name, input]); return { content: JSON.stringify([{ id: 1 }, { id: 2 }]) }; },
    onText: (t) => texts.push(t),
    onToolStart: () => {}, onToolResult: () => {},
  });
  assert.deepEqual(calls, [["listTabs", {}]]);
  assert.equal(texts.join(""), "You have 2 tabs.");
  assert.equal(res.stopReason, "end_turn");
  // history should contain: user, assistant(toolCalls), tool, assistant(text)
  assert.equal(res.history[1].toolCalls[0].name, "listTabs");
  assert.equal(res.history[2].role, "tool");
});

test("runAgent stops at maxTurns", async () => {
  const loopingAdapter = { async *stream() { yield { type: "toolCall", id: "x", name: "listTabs", input: {} }; yield { type: "done", stopReason: "tool_use" }; } };
  const res = await runAgent({
    adapter: loopingAdapter, model: "m", system: "", tools: TOOLS, vision: true,
    history: [{ role: "user", text: "loop" }],
    execTool: async () => ({ content: "[]" }),
    onText: () => {}, onToolStart: () => {}, onToolResult: () => {}, maxTurns: 3,
  });
  assert.equal(res.stopReason, "max_turns");
  const toolMsgs = res.history.filter(m => m.role === "tool").length;
  assert.equal(toolMsgs, 3);
});

test("runAgent surfaces a tool error as a tool result and keeps going", async () => {
  let round = 0;
  const ad = { async *stream() { round++; if (round === 1) { yield { type: "toolCall", id: "t1", name: "eval", input: { tabId: 1, code: "x" } }; yield { type: "done", stopReason: "tool_use" }; } else { yield { type: "text", text: "ok" }; yield { type: "done", stopReason: "end_turn" }; } } };
  const res = await runAgent({
    adapter: ad, model: "m", system: "", tools: TOOLS, vision: true,
    history: [{ role: "user", text: "run" }],
    execTool: async () => { throw new Error("boom"); },
    onText: () => {}, onToolStart: () => {}, onToolResult: () => {},
  });
  const toolMsg = res.history.find(m => m.role === "tool");
  assert.match(toolMsg.content, /boom/);
  assert.equal(res.stopReason, "end_turn");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agent.test.js`
Expected: FAIL — cannot find module `../extension/agent.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// extension/agent.js
// Provider-agnostic tool-use loop. No chrome.* — adapter and execTool are injected.

export async function runAgent({ adapter, model, system, tools, vision, history, execTool, onText, onToolStart, onToolResult, maxTurns = 25 }) {
  let turns = 0;
  for (;;) {
    const toolCalls = [];
    let stopReason = "end_turn";
    for await (const ev of adapter.stream({ model, system, messages: history, tools, vision })) {
      if (ev.type === "text") onText(ev.text);
      else if (ev.type === "toolCall") toolCalls.push(ev);
      else if (ev.type === "done") stopReason = ev.stopReason;
    }

    if (toolCalls.length === 0) return { history, stopReason };

    history.push({ role: "assistant", toolCalls: toolCalls.map(tc => ({ id: tc.id, name: tc.name, input: tc.input })) });

    for (const tc of toolCalls) {
      onToolStart(tc);
      let result;
      try { result = await execTool(tc.name, tc.input); }
      catch (e) { result = { content: `ERROR: ${e.message}` }; }
      history.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: result.content ?? "", image: result.image });
      onToolResult(tc, result);
    }

    if (++turns >= maxTurns) return { history, stopReason: "max_turns" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/agent.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/agent.js test/agent.test.js
git commit -m "feat(otto): provider-agnostic agent loop"
```

---

### Task 7: Settings helper + package test script

**Files:**
- Create: `extension/config.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `export const KEYS = {settings:"otto.settings"}`. `export async function getSettings()` → `{provider, endpoint, model, apiKeys:{[providerId]:string}}` merged over `DEFAULT`. `export async function setSettings(patch)`. Both use `chrome.storage.local`; guard for absence of `chrome` so imports don't throw in Node.

- [ ] **Step 1: Write `extension/config.js`**

```js
// extension/config.js
import { DEFAULT } from "./providers/registry.js";
export const KEYS = { settings: "otto.settings" };
const hasChrome = typeof chrome !== "undefined" && chrome.storage?.local;

export async function getSettings() {
  const base = { provider: DEFAULT.provider, endpoint: DEFAULT.endpoint, model: DEFAULT.model, apiKeys: {} };
  if (!hasChrome) return base;
  const got = await chrome.storage.local.get(KEYS.settings);
  return { ...base, ...(got[KEYS.settings] || {}), apiKeys: { ...base.apiKeys, ...((got[KEYS.settings] || {}).apiKeys || {}) } };
}

export async function setSettings(patch) {
  if (!hasChrome) return;
  const cur = await getSettings();
  const next = { ...cur, ...patch, apiKeys: { ...cur.apiKeys, ...(patch.apiKeys || {}) } };
  await chrome.storage.local.set({ [KEYS.settings]: next });
}
```

- [ ] **Step 2: Update `package.json` test script**

Change the `"test"` line to run every test file:

```json
"test": "node --test test/tools.test.js test/adapters.test.js test/agent.test.js test/protocol.test.js"
```

- [ ] **Step 3: Run the full offline suite**

Run: `npm test`
Expected: PASS across tools, adapters, agent, and the existing protocol test.

- [ ] **Step 4: Commit**

```bash
git add extension/config.js package.json
git commit -m "feat(otto): settings helper + unified test script"
```

---

### Task 8: Background wiring — tool router, agent host, side-panel open

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `runAgent` (agent.js), the three adapters, `TOOLS` (tools.js), `PROVIDERS`/`findModel` (registry.js), `getSettings` (config.js), and the existing `handle(cmd, params)`.
- Produces: a `chrome.runtime.onConnect` handler on port name `"otto-chat"` that accepts `{type:"user", text}` and streams back `{type:"text"}`, `{type:"toolStart"}`, `{type:"toolResult"}`, `{type:"done"}`, `{type:"error"}`. Side panel opens on action click.

- [ ] **Step 1: Convert background.js to a module + add imports**

At the top of `extension/background.js` add:

```js
import { TOOLS } from "./tools.js";
import { PROVIDERS, findModel } from "./providers/registry.js";
import { getSettings } from "./config.js";
import { runAgent } from "./agent.js";
import { claudeAdapter } from "./providers/claude.js";
import { geminiAdapter } from "./providers/gemini.js";
import { openaiCompatAdapter } from "./providers/openai-compat.js";
```

And in `manifest.json` mark the worker as a module (done in Task 9). `handle(cmd, params)` already exists in this file — reuse it.

- [ ] **Step 2: Add the adapter factory + tool executor**

```js
function makeAdapter(providerId, endpoint, apiKey) {
  const p = PROVIDERS.find(x => x.id === providerId);
  const args = { apiKey, baseURL: endpoint.baseURL };
  if (p.adapter === "claude") return claudeAdapter(args);
  if (p.adapter === "gemini") return geminiAdapter(args);
  return openaiCompatAdapter(args);
}

// Tool executor: reuse the existing handle(); screenshots/pdf return base64 as an image.
async function execTool(name, input) {
  const r = await handle(name, input);
  if ((name === "screenshot" || name === "pdf") && r?.base64) return { content: `[${name} captured]`, image: r.base64 };
  return { content: typeof r === "string" ? r : JSON.stringify(r) };
}
```

- [ ] **Step 3: Add the chat port handler**

```js
const SYSTEM = "You are Otto, an assistant that controls the user's web browser to complete tasks. " +
  "Use the tools to read pages (eval returns DOM text), click, type, navigate, and screenshot. " +
  "Prefer eval to read a page's text; use screenshot when you need to SEE layout or find click coordinates. " +
  "Work autonomously to completion; be concise in your replies to the user.";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "otto-chat") return;
  const history = [];
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "user") return;
    try {
      const s = await getSettings();
      const hit = findModel(s.provider, s.endpoint, s.model);
      if (!hit) { port.postMessage({ type: "error", error: "No model selected." }); return; }
      const apiKey = s.apiKeys[s.provider];
      if (!apiKey) { port.postMessage({ type: "error", error: `No API key for ${s.provider}. Open settings.` }); return; }
      const adapter = makeAdapter(s.provider, hit.endpoint, apiKey);
      history.push({ role: "user", text: msg.text });
      const res = await runAgent({
        adapter, model: s.model, system: SYSTEM, tools: TOOLS, vision: hit.model.vision, history,
        execTool,
        onText: (t) => port.postMessage({ type: "text", text: t }),
        onToolStart: (tc) => port.postMessage({ type: "toolStart", name: tc.name, input: tc.input }),
        onToolResult: (tc) => port.postMessage({ type: "toolResult", name: tc.name }),
      });
      port.postMessage({ type: "done", stopReason: res.stopReason });
    } catch (e) {
      port.postMessage({ type: "error", error: String(e.message || e) });
    }
  });
});
```

- [ ] **Step 4: Open side panel on action click**

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
```

- [ ] **Step 5: Verify syntax loads in Node (import smoke)**

Run: `node -e "import('./extension/agent.js').then(()=>console.log('agent ok'))"`
Expected: prints `agent ok` (confirms no top-level `chrome.*` crash in the shared modules).

- [ ] **Step 6: Commit**

```bash
git add extension/background.js
git commit -m "feat(otto): background chat port, agent host, tool executor"
```

---

### Task 9: Manifest — side panel, permissions, hosts, module worker, icons

**Files:**
- Modify: `extension/manifest.json`
- Create: `extension/icons/` (16/32/48/128 png — a simple solid-color square with "O" is fine for v0.2)

- [ ] **Step 1: Update manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Otto",
  "version": "0.2.0",
  "description": "Otto — your browser, on autopilot. A Claude/Gemini/OpenAI-powered side-panel assistant that drives your logged-in browser. Also exposes a local bridge for terminal agents.",
  "author": "Mykola Bielousov",
  "permissions": ["tabs", "scripting", "debugger", "downloads", "storage", "alarms", "sidePanel"],
  "host_permissions": [
    "<all_urls>",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://api.mistral.ai/*",
    "https://api.groq.com/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Open Otto" },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```

- [ ] **Step 2: Generate placeholder icons**

Run (creates four solid indigo PNGs with no external deps, via a tiny Node script):

```bash
node -e '
const fs=require("fs");const zlib=require("zlib");
function png(size){const w=size,h=size;const bpp=4;const raw=Buffer.alloc((w*bpp+1)*h);
for(let y=0;y<h;y++){raw[y*(w*bpp+1)]=0;for(let x=0;x<w;x++){const o=y*(w*bpp+1)+1+x*bpp;raw[o]=79;raw[o+1]=70;raw[o+2]=229;raw[o+3]=255;}}
const idat=zlib.deflateSync(raw);
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type);const crc=Buffer.alloc(4);
let c=~0;const buf=Buffer.concat([t,data]);for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}crc.writeUInt32BE((~c)>>>0);return Buffer.concat([len,t,data,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);}
fs.mkdirSync("extension/icons",{recursive:true});
for(const s of [16,32,48,128])fs.writeFileSync(`extension/icons/${s}.png`,png(s));
console.log("icons written");
'
```

Expected: `icons written`; four files in `extension/icons/`.

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json extension/icons
git commit -m "feat(otto): manifest v0.2 — side panel, provider hosts, module worker, icons"
```

---

### Task 10: Side-panel UI + onboarding (`sidepanel.html/.css/.js`)

**Files:**
- Create: `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js`

**Interfaces:**
- Consumes: `getSettings`/`setSettings` (config.js), `PROVIDERS`/`findModel` (registry.js). Connects to the worker via `chrome.runtime.connect({name:"otto-chat"})`.

- [ ] **Step 1: Write `sidepanel.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="sidepanel.css"></head>
<body>
  <header id="bar">
    <select id="model"></select>
    <button id="gear" title="Settings">⚙</button>
  </header>
  <section id="onboarding" hidden>
    <h2>Welcome to Otto</h2>
    <p>Pick a provider and paste an API key. <a id="getkey" target="_blank">Get a key ↗</a></p>
    <select id="ob-provider"></select>
    <input id="ob-key" type="password" placeholder="API key" autocomplete="off">
    <div class="row"><button id="ob-test">Test key</button><span id="ob-status"></span></div>
    <button id="ob-save">Save & start</button>
    <p class="hint">Your key is stored locally in this browser and only sent to the provider you choose. Otto acts autonomously in your tabs.</p>
  </section>
  <main id="log"></main>
  <footer><textarea id="input" rows="2" placeholder="Ask Otto to do something…"></textarea><button id="send">Send</button></footer>
  <script type="module" src="sidepanel.js"></script>
</body></html>
```

- [ ] **Step 2: Write `sidepanel.css`**

```css
:root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
body { margin: 0; display: flex; flex-direction: column; height: 100vh; }
#bar { display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid #8884; align-items: center; }
#model { flex: 1; }
#log { flex: 1; overflow-y: auto; padding: 10px; }
.msg { margin: 8px 0; white-space: pre-wrap; }
.msg.user { font-weight: 600; }
.msg.tool { opacity: .7; font-size: 12px; font-family: ui-monospace, monospace; }
.msg.error { color: #c00; }
footer { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #8884; }
#input { flex: 1; resize: none; }
#onboarding { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
#onboarding input, #onboarding select { padding: 8px; }
.hint { color: #888; font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 3: Write `sidepanel.js`**

```js
import { getSettings, setSettings } from "./config.js";
import { PROVIDERS, findModel } from "./providers/registry.js";

const $ = (id) => document.getElementById(id);
const log = $("log");
function add(cls, text) { const d = document.createElement("div"); d.className = `msg ${cls}`; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }

// --- model dropdown (flattened provider/endpoint/model) ---
function modelOptions() {
  const opts = [];
  for (const p of PROVIDERS) for (const e of p.endpoints) for (const m of e.models)
    opts.push({ value: `${p.id}|${e.id}|${m.id}`, label: `${p.label} · ${m.label}` });
  return opts;
}
function fillModelSelect(sel, current) {
  sel.innerHTML = "";
  for (const o of modelOptions()) { const el = document.createElement("option"); el.value = o.value; el.textContent = o.label; sel.appendChild(el); }
  if (current) sel.value = current;
}

async function refreshHeader() {
  const s = await getSettings();
  fillModelSelect($("model"), `${s.provider}|${s.endpoint}|${s.model}`);
}

$("model").addEventListener("change", async () => {
  const [provider, endpoint, model] = $("model").value.split("|");
  await setSettings({ provider, endpoint, model });
});

// --- onboarding ---
function fillProviderSelect() {
  const sel = $("ob-provider"); sel.innerHTML = "";
  for (const p of PROVIDERS) { const el = document.createElement("option"); el.value = p.id; el.textContent = p.label; sel.appendChild(el); }
}
function currentProvider() { return PROVIDERS.find(p => p.id === $("ob-provider").value); }
$("ob-provider")?.addEventListener("change", () => { $("getkey").href = currentProvider().keyUrl; });

async function maybeOnboard() {
  const s = await getSettings();
  if (s.apiKeys[s.provider]) return;
  fillProviderSelect();
  $("ob-provider").value = s.provider;
  $("getkey").href = currentProvider().keyUrl;
  $("onboarding").hidden = false;
}

$("ob-test").addEventListener("click", async () => {
  const p = currentProvider(); const key = $("ob-key").value.trim();
  $("ob-status").textContent = "Testing…";
  // A cheap validation: connect the port and send a trivial "say hi" turn is heavy;
  // instead just check the key is non-empty and prefix-plausible.
  if (!key || (p.keyPrefixHint && !key.startsWith(p.keyPrefixHint))) { $("ob-status").textContent = `Key should start with "${p.keyPrefixHint}"`; return; }
  $("ob-status").textContent = "Looks valid ✓";
});

$("ob-save").addEventListener("click", async () => {
  const p = currentProvider(); const key = $("ob-key").value.trim();
  if (!key) { $("ob-status").textContent = "Enter a key first"; return; }
  const endpoint = p.endpoints[0]; const model = endpoint.models[0];
  await setSettings({ provider: p.id, endpoint: endpoint.id, model: model.id, apiKeys: { [p.id]: key } });
  $("onboarding").hidden = true;
  await refreshHeader();
});

$("gear").addEventListener("click", async () => { $("ob-key").value = ""; await maybeOnboard(); $("onboarding").hidden = false; });

// --- chat over the port ---
let port, live;
function connect() {
  port = chrome.runtime.connect({ name: "otto-chat" });
  port.onMessage.addListener((m) => {
    if (m.type === "text") { if (!live) live = add("assistant", ""); live.textContent += m.text; log.scrollTop = log.scrollHeight; }
    else if (m.type === "toolStart") add("tool", `→ ${m.name}(${JSON.stringify(m.input)})`);
    else if (m.type === "toolResult") { live = null; }
    else if (m.type === "done") { live = null; }
    else if (m.type === "error") add("error", m.error);
  });
  port.onDisconnect.addListener(() => { port = null; });
}

function send() {
  const text = $("input").value.trim(); if (!text) return;
  $("input").value = ""; add("user", text); live = null;
  if (!port) connect();
  port.postMessage({ type: "user", text });
}
$("send").addEventListener("click", send);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

refreshHeader().then(maybeOnboard);
```

- [ ] **Step 4: Load the extension and smoke-test manually**

1. `chrome://extensions` → reload Otto (or Load unpacked → `extension/`).
2. Click the toolbar icon → side panel opens → onboarding appears.
3. Pick Claude, paste a real `sk-ant-` key, Save.
4. Type "list my open tabs and tell me how many." → expect a `→ listTabs({})` tool line, then a text answer.
5. Type "open youtube.com in a new tab and tell me the page title." → expect newTab + eval + answer.

Expected: autonomous multi-step completion; no focus theft; the Chrome "Otto is debugging this browser" banner appears on first eval.

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.css extension/sidepanel.js
git commit -m "feat(otto): side-panel chat UI + onboarding"
```

---

### Task 11: TEST-PLAN update + README quick-start

**Files:**
- Modify: `test/TEST-PLAN.md`, `README.md`

- [ ] **Step 1: Add a "Chat sidebar (v0.2)" section to `test/TEST-PLAN.md`**

Document the offline suites (`tools.test.js`, `adapters.test.js`, `agent.test.js` — run via `npm test`) and the manual chat checklist from Task 10 Step 4, plus a "switch provider mid-session" manual check (change the header dropdown to Gemini, send a turn, confirm it routes to the Gemini adapter).

- [ ] **Step 2: Prepend a "Quick Start (chat)" to `README.md`**

Three steps: Load unpacked `extension/` → click the toolbar icon → pick a provider, paste an API key, chat. Note the terminal-bridge section that follows is the advanced/optional mode.

- [ ] **Step 3: Run the full suite once more**

Run: `npm test`
Expected: all offline tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/TEST-PLAN.md README.md
git commit -m "docs(otto): v0.2 chat sidebar test plan + README quick-start"
```

---

## Notes for the implementer

- **Do not touch** `server/server.js`, `server/cli.js`, or `test/protocol.test.js` / `test/integration.sh` — the v0.1 terminal bridge stays exactly as-is (it still passes). The only shared surface is `handle()` in `background.js`, which you reuse, not rewrite.
- The shared modules (`tools.js`, `providers/*.js`, `agent.js`, `config.js`, `registry.js`) must not touch `chrome.*` at import time — that's what makes them Node-testable. `config.js` guards on `typeof chrome`.
- Adapter `stream()` takes `fetchImpl` for tests; in the worker it defaults to the global `fetch` (host_permissions make it CORS-exempt).
- If a provider's real wire format differs slightly from the fixtures here (field names drift), fix the adapter and its fixture together — the normalization contract (`{text|toolCall|done}`) is the stable part.

## Self-review notes (author)

- Spec coverage: side panel (T10), worker-owned network + CORS (T8/T9 host_permissions + module worker), provider adapter interface (T3–T6), Claude+Gemini+OpenAI-compat (T3/T5/T4), model registry + switcher (T2/T10), vision-strip for text-only (T4 test), autonomy + 25-turn cap (T6), onboarding + key storage (T7/T10), distribution icons/manifest (T9), tests (T1–T6 offline + T10 manual). Build.sh/dist zip is deferred to a packaging follow-up (not blocking a working extension) — noted here so it isn't lost.
- Placeholder scan: no TBDs; every code step has complete code.
- Type consistency: internal message format `{role, text | toolCalls | (toolCallId,name,content,image)}` is used identically across claude/gemini/openai-compat adapters and agent.js; event shape `{type:text|toolCall|done}` consistent; `execTool → {content, image?}` consistent between T6 and T8.
