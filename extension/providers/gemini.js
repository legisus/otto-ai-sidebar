// Maps Otto internal format to Gemini generateContent and normalizes the SSE stream.

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

let seq = 0;
export function geminiAdapter({ apiKey, baseURL }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch, signal }) {
      const body = {
        contents: toGeminiContents(messages, vision),
        tools: [{ functionDeclarations: geminiFunctionDeclarations(tools) }],
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const url = `${baseURL}/models/${model}:streamGenerateContent?alt=sse`;
      const res = await fetchImpl(url, {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const txt = await (res.text?.() ?? Promise.resolve("")); throw new Error(`Gemini API ${res.status}: ${txt}`); }

      let stop = "STOP";
      for await (const ev of parseSSE(res)) {
        const cand = ev.candidates?.[0]; if (!cand) continue;
        for (const part of cand.content?.parts ?? []) {
          if (part.text) yield { type: "text", text: part.text };
          else if (part.functionCall) yield { type: "toolCall", id: `gem_${part.functionCall.name}_${seq++}`, name: part.functionCall.name, input: part.functionCall.args ?? {} };
        }
        if (cand.finishReason) stop = cand.finishReason;
      }
      yield { type: "done", stopReason: stop };
    },
  };
}
