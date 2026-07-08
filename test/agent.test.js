import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../extension/agent.js";
import { TOOLS } from "../extension/tools.js";

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
    onText: (t) => texts.push(t), onToolStart: () => {}, onToolResult: () => {},
  });
  assert.deepEqual(calls, [["listTabs", {}]]);
  assert.equal(texts.join(""), "You have 2 tabs.");
  assert.equal(res.stopReason, "end_turn");
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
  assert.equal(res.history.filter(m => m.role === "tool").length, 3);
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

test("runAgent stops when the signal is aborted", async () => {
  const ac = new AbortController();
  const ad = { async *stream() { ac.abort(); yield { type: "toolCall", id: "t1", name: "listTabs", input: {} }; yield { type: "done", stopReason: "tool_use" }; } };
  const res = await runAgent({
    adapter: ad, model: "m", system: "", tools: TOOLS, vision: true,
    history: [{ role: "user", text: "go" }],
    execTool: async () => ({ content: "[]" }),
    onText: () => {}, onToolStart: () => {}, onToolResult: () => {}, signal: ac.signal,
  });
  assert.equal(res.stopReason, "stopped");
});
