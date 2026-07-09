import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRetry, httpError } from "../extension/providers/http.js";

test("fetchRetry retries a transient 503 then returns the eventual 200", async () => {
  let n = 0;
  const f = async () => (++n < 3 ? { ok: false, status: 503, headers: { get: () => null } } : { ok: true, status: 200 });
  const res = await fetchRetry(f, "u", {}, { retries: 5, baseDelay: 0 });
  assert.equal(res.ok, true);
  assert.equal(n, 3);
});

test("fetchRetry does not retry a 400 (not transient)", async () => {
  let n = 0;
  const f = async () => { n++; return { ok: false, status: 400, headers: { get: () => null } }; };
  const res = await fetchRetry(f, "u", {}, { retries: 5, baseDelay: 0 });
  assert.equal(res.status, 400);
  assert.equal(n, 1);
});

test("httpError makes 503 and 401 human-friendly", async () => {
  const busy = await httpError("Gemini", { status: 503, text: async () => "{}" });
  assert.match(busy.message, /busy/i);
  const auth = await httpError("Claude", { status: 401, text: async () => "{}" });
  assert.match(auth.message, /key/i);
});
