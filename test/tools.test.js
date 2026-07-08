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
