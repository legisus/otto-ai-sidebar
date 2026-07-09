import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, findModel, DEFAULT } from "../extension/providers/registry.js";
import { TOOLS } from "../extension/tools.js";
import { claudeAdapter } from "../extension/providers/claude.js";
import { openaiCompatAdapter } from "../extension/providers/openai-compat.js";
import { geminiAdapter } from "../extension/providers/gemini.js";

// ---------- registry ----------
test("default resolves to a real vision-capable model", () => {
  const hit = findModel(DEFAULT.provider, DEFAULT.endpoint, DEFAULT.model);
  assert.ok(hit, "default model must exist in the registry");
  assert.equal(hit.model.vision, true);
});
test("adapter ids are one of the three known adapters", () => {
  const ok = new Set(["claude", "gemini", "openai-compat"]);
  for (const p of PROVIDERS) assert.ok(ok.has(p.adapter), `${p.id} → unknown adapter ${p.adapter}`);
});
test("every model declares a boolean vision flag", () => {
  for (const p of PROVIDERS) for (const e of p.endpoints) for (const m of e.models)
    assert.equal(typeof m.vision, "boolean", `${p.id}/${e.id}/${m.id} vision must be boolean`);
});
test("claude, gemini and openai providers are present at launch", () => {
  const ids = PROVIDERS.map(p => p.id);
  for (const need of ["claude", "gemini", "openai"]) assert.ok(ids.includes(need), `missing provider ${need}`);
});

// ---------- fake stream helpers ----------
function oneShotBody(text) {
  return { getReader() {
    const bytes = new TextEncoder().encode(text); let done = false;
    return { read() { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ value: bytes, done: false }); } };
  } };
}
function anthropicSSE(lines) { return { ok: true, status: 200, body: oneShotBody(lines.map(l => `event: ${l.event}\ndata: ${JSON.stringify(l.data)}\n\n`).join("")) }; }
function openaiSSE(chunks) { return { ok: true, status: 200, body: oneShotBody(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n") }; }
function geminiSSE(objs) { return { ok: true, status: 200, body: oneShotBody(objs.map(o => `data: ${JSON.stringify(o)}\n\n`).join("")) }; }

// ---------- claude ----------
test("claude adapter normalizes text + tool_use + stop", async () => {
  // Anthropic includes `type` inside the data payload (not just the event: line).
  const fakeFetch = async () => anthropicSSE([
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "listTabs", input: {} } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" } } },
  ]);
  const ad = claudeAdapter({ apiKey: "sk-ant-x", baseURL: "https://api.anthropic.com/v1" });
  const events = [];
  for await (const ev of ad.stream({ model: "claude-sonnet-5", system: "", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: true, fetchImpl: fakeFetch })) events.push(ev);
  assert.equal(events.filter(e => e.type === "text").map(e => e.text).join(""), "Hello");
  const call = events.find(e => e.type === "toolCall");
  assert.equal(call.name, "listTabs");
  assert.deepEqual(call.input, {});
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).stopReason, "tool_use");
});

// ---------- openai-compat ----------
test("openai-compat normalizes text + tool_calls + finish", async () => {
  const fakeFetch = async () => openaiSSE([
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "listTabs", arguments: "{}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls" }] },
  ]);
  const ad = openaiCompatAdapter({ apiKey: "x", baseURL: "https://api.deepseek.com/v1" });
  const events = [];
  for await (const ev of ad.stream({ model: "deepseek-chat", system: "s", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: false, fetchImpl: fakeFetch })) events.push(ev);
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
  assert.ok(!JSON.stringify(sentBody).includes("BASE64PNG"), "image data must not be sent when vision=false");
});

// ---------- gemini ----------
test("gemini normalizes text + functionCall + finish", async () => {
  const fakeFetch = async () => geminiSSE([
    { candidates: [{ content: { parts: [{ text: "Yo" }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "listTabs", args: {} } }] } }] },
    { candidates: [{ finishReason: "STOP" }] },
  ]);
  const ad = geminiAdapter({ apiKey: "AIza-x", baseURL: "https://generativelanguage.googleapis.com/v1beta" });
  const events = [];
  for await (const ev of ad.stream({ model: "gemini-3.5-flash", system: "s", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: true, fetchImpl: fakeFetch })) events.push(ev);
  assert.equal(events.find(e => e.type === "text").text, "Yo");
  assert.equal(events.find(e => e.type === "toolCall").name, "listTabs");
  assert.equal(events.at(-1).type, "done");
});

test("gemini strips additionalProperties (rejected by the Gemini API)", async () => {
  let sentBody;
  const fakeFetch = async (_url, opts) => { sentBody = opts.body; return geminiSSE([{ candidates: [{ finishReason: "STOP" }] }]); };
  const ad = geminiAdapter({ apiKey: "AIza-x", baseURL: "https://generativelanguage.googleapis.com/v1beta" });
  for await (const _ of ad.stream({ model: "gemini-3.5-flash", system: "", messages: [{ role: "user", text: "hi" }], tools: TOOLS, vision: true, fetchImpl: fakeFetch })) {}
  assert.ok(!sentBody.includes("additionalProperties"), "additionalProperties must be stripped for Gemini");
  const decls = JSON.parse(sentBody).tools[0].functionDeclarations;
  const listTabs = decls.find(d => d.name === "listTabs");
  assert.ok(!("parameters" in listTabs), "no-arg tools omit parameters (Gemini rejects empty properties)");
});
