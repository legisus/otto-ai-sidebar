// Provider-agnostic tool-use loop. No chrome.* — adapter and execTool are injected.

export async function runAgent({ adapter, model, system, tools, vision, history, execTool, onText, onToolStart, onToolResult, maxTurns = 25, signal }) {
  let turns = 0;
  for (;;) {
    if (signal?.aborted) return { history, stopReason: "stopped" };
    const toolCalls = [];
    let stopReason = "end_turn";
    for await (const ev of adapter.stream({ model, system, messages: history, tools, vision, signal })) {
      if (ev.type === "text") onText(ev.text);
      else if (ev.type === "toolCall") toolCalls.push(ev);
      else if (ev.type === "done") stopReason = ev.stopReason;
    }

    if (toolCalls.length === 0) return { history, stopReason };
    if (signal?.aborted) return { history, stopReason: "stopped" };

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
