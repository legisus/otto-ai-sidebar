// Maps Otto internal format to Gemini generateContent and normalizes the SSE stream.
import { fetchRetry, httpError, sseJSON } from "./http.js";

// Gemini's function-declaration parameters use a restricted OpenAPI subset that rejects
// `additionalProperties` (and a few other JSON-Schema keywords). Strip them recursively.
const GEMINI_DROP = new Set(["additionalProperties", "$schema", "$id", "$ref", "definitions"]);
function geminiSchema(s) {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (s && typeof s === "object") {
    const out = {};
    for (const [k, v] of Object.entries(s)) { if (GEMINI_DROP.has(k)) continue; out[k] = geminiSchema(v); }
    return out;
  }
  return s;
}
// A no-argument tool: omit `parameters` entirely (Gemini dislikes empty properties objects).
function geminiParams(schema) {
  const clean = geminiSchema(schema);
  if (!clean.properties || Object.keys(clean.properties).length === 0) return undefined;
  return clean;
}
function geminiFunctionDeclarations(tools) {
  return tools.map((t) => {
    const fn = { name: t.name, description: t.description };
    const params = geminiParams(t.input_schema);
    if (params) fn.parameters = params;
    return fn;
  });
}

let seq = 0;
export function geminiAdapter({ apiKey, baseURL }) {
  // Thinking models attach a `thoughtSignature` to each functionCall; it must be echoed
  // back on the next turn or the model loses its reasoning context. Keep them per adapter
  // (one adapter instance spans a single user request's multi-turn tool loop).
  const sigs = new Map();

  function toContents(messages, vision) {
    const contents = [];
    for (const m of messages) {
      if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.text }] });
      else if (m.role === "assistant" && m.toolCalls)
        contents.push({ role: "model", parts: m.toolCalls.map((tc) => {
          const fc = { functionCall: { name: tc.name, args: tc.input } };
          const sig = sigs.get(tc.id); if (sig) fc.thoughtSignature = sig;
          return fc;
        }) });
      else if (m.role === "assistant") contents.push({ role: "model", parts: [{ text: m.text }] });
      else if (m.role === "tool") {
        const parts = [{ functionResponse: { name: m.name, response: { result: m.content ?? "" } } }];
        if (vision && m.image) parts.push({ inlineData: { mimeType: "image/png", data: m.image } });
        contents.push({ role: "user", parts });
      }
    }
    return contents;
  }

  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch, signal }) {
      const body = {
        contents: toContents(messages, vision),
        tools: [{ functionDeclarations: geminiFunctionDeclarations(tools) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const url = `${baseURL}/models/${model}:streamGenerateContent?alt=sse`;
      const res = await fetchRetry(fetchImpl, url, {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }, { signal });
      if (!res.ok) throw await httpError("Gemini", res);

      let stop = "STOP";
      for await (const ev of sseJSON(res)) {
        const cand = ev.candidates?.[0]; if (!cand) continue;
        for (const part of cand.content?.parts ?? []) {
          if (part.functionCall) {
            const id = `gem_${part.functionCall.name}_${seq++}`;
            if (part.thoughtSignature) sigs.set(id, part.thoughtSignature);
            yield { type: "toolCall", id, name: part.functionCall.name, input: part.functionCall.args ?? {} };
          } else if (part.text && !part.thought) {
            yield { type: "text", text: part.text };
          }
        }
        if (cand.finishReason) stop = cand.finishReason;
      }
      yield { type: "done", stopReason: stop };
    },
  };
}
