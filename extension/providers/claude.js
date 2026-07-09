// Maps Otto's internal message/tool format to the Anthropic Messages API and
// normalizes the SSE stream back to Otto events. No chrome.* — fetch is injected.
import { fetchRetry, httpError, sseJSON } from "./http.js";

function toAnthropicMessages(messages) {
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

export function claudeAdapter({ apiKey, baseURL }) {
  return {
    async *stream({ model, system, messages, tools, vision, fetchImpl = fetch, signal }) {
      const body = {
        model, max_tokens: 8000, stream: true,
        thinking: { type: "adaptive" }, output_config: { effort: "high" },
        system: system || undefined,
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages: toAnthropicMessages(messages),
      };
      const res = await fetchRetry(fetchImpl, `${baseURL}/messages`, {
        method: "POST", signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      }, { signal });
      if (!res.ok) throw await httpError("Claude", res);

      const toolAcc = {};
      for await (const ev of sseJSON(res)) {
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
