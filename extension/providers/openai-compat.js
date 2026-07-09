// One adapter for any OpenAI-compatible chat-completions endpoint (OpenAI, DeepSeek,
// Mistral, Groq). Vision via image_url data-URI parts; dropped when vision=false.
import { fetchRetry, httpError } from "./http.js";

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

export function openaiCompatAdapter({ apiKey, baseURL, name = "The model API" }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch, signal }) {
      const msgs = [];
      if (system) msgs.push({ role: "system", content: system });
      msgs.push(...toOpenAIMessages(messages, vision));
      const body = {
        model, stream: true, messages: msgs,
        tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      };
      const res = await fetchRetry(fetchImpl, `${baseURL}/chat/completions`, {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }, { signal });
      if (!res.ok) throw await httpError(name, res);

      const acc = {};
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
