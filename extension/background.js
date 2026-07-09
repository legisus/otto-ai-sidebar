// Otto — browser-control assistant (service worker).
// The side panel talks to this worker over chrome.runtime; the worker runs the agent
// loop against the selected provider (with the user's API key) and drives the browser
// via chrome.debugger (trusted input, CSP-proof eval), chrome.tabs, and chrome.downloads.
// Everything is in-browser — there is no server and no localhost connection.

import { TOOLS } from "./tools.js";
import { PROVIDERS, findModel } from "./providers/registry.js";
import { getSettings } from "./config.js";
import { runAgent } from "./agent.js";
import { claudeAdapter } from "./providers/claude.js";
import { geminiAdapter } from "./providers/gemini.js";
import { openaiCompatAdapter } from "./providers/openai-compat.js";

// ---------- browser control (chrome.debugger + tabs + downloads) ----------

const attached = new Set(); // tabIds with the debugger attached

async function dbgAttach(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
}
chrome.debugger.onDetach.addListener((src) => { if (src.tabId) attached.delete(src.tabId); });
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));
function dbg(tabId, method, params) { return chrome.debugger.sendCommand({ tabId }, method, params || {}); }

async function handle(cmd, p) {
  switch (cmd) {
    case "listTabs": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url, title: t.title }));
    }

    case "newTab": {
      const tab = await chrome.tabs.create({ url: p.url, active: !!p.active });
      return { id: tab.id, windowId: tab.windowId };
    }

    case "navigate": {
      await chrome.tabs.update(p.tabId, { url: p.url });
      return { ok: true };
    }

    case "activateTab": {
      const tab = await chrome.tabs.update(p.tabId, { active: true });
      if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, tabId: p.tabId, windowId: tab && tab.windowId };
    }

    case "closeTab":
      await chrome.tabs.remove(p.tabId);
      return { ok: true };

    case "eval": {
      // Runtime.evaluate via debugger: immune to page CSP, returns values.
      await dbgAttach(p.tabId);
      const r = await dbg(p.tabId, "Runtime.evaluate", { expression: p.code, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    }

    case "click": {
      // Trusted click at viewport coordinates (CSS px).
      await dbgAttach(p.tabId);
      const base = { x: p.x, y: p.y, button: "left", clickCount: 1 };
      await dbg(p.tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...base, button: "none" });
      await dbg(p.tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await dbg(p.tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
      return { ok: true };
    }

    case "insertText": {
      await dbgAttach(p.tabId);
      await dbg(p.tabId, "Input.insertText", { text: p.text });
      return { ok: true };
    }

    case "key": {
      await dbgAttach(p.tabId);
      const ev = { key: p.key, code: p.code || p.key, modifiers: p.modifiers || 0 };
      await dbg(p.tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...ev });
      await dbg(p.tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...ev });
      return { ok: true };
    }

    case "screenshot": {
      await dbgAttach(p.tabId);
      const r = await dbg(p.tabId, "Page.captureScreenshot", { format: "png" });
      return { base64: r.data };
    }

    case "pdf": {
      await dbgAttach(p.tabId);
      const r = await dbg(p.tabId, "Page.printToPDF", { printBackground: true, displayHeaderFooter: false });
      return { base64: r.data };
    }

    case "download": {
      const id = await chrome.downloads.download({ url: p.url, filename: p.filename, conflictAction: "uniquify", saveAs: false });
      const deadline = Date.now() + (p.timeoutMs || 60000);
      while (Date.now() < deadline) {
        const [item] = await chrome.downloads.search({ id });
        if (item && item.state === "complete") return { id, path: item.filename };
        if (item && item.state === "interrupted") throw new Error(`download interrupted: ${item.error}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("download timeout");
    }

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

// ---------- chat agent host ----------

function makeAdapter(providerId, endpoint, apiKey) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const args = { apiKey, baseURL: endpoint.baseURL, name: `${p.label.split(" ")[0]} (${endpoint.label})` };
  if (p.adapter === "claude") return claudeAdapter(args);
  if (p.adapter === "gemini") return geminiAdapter(args);
  return openaiCompatAdapter(args);
}

// A screenshot (PNG) is fed back to the model as an image so it can SEE the page.
// A PDF is a document, not an image — save it to Downloads and report that in text.
async function execTool(name, input) {
  const r = await handle(name, input);
  if (name === "screenshot" && r?.base64) return { content: "[screenshot captured]", image: r.base64 };
  if (name === "pdf" && r?.base64) {
    try {
      const filename = (input && input.filename) || "otto-page.pdf";
      await chrome.downloads.download({ url: `data:application/pdf;base64,${r.base64}`, filename, saveAs: false, conflictAction: "uniquify" });
      return { content: `Saved the page as a PDF to your Downloads folder (${filename}).` };
    } catch (e) { return { content: `Rendered a PDF but couldn't save it: ${e.message}` }; }
  }
  return { content: typeof r === "string" ? r : JSON.stringify(r) };
}

const SYSTEM =
  "You are Otto, an assistant that controls the user's web browser to complete tasks. " +
  "Use the tools to read pages (eval returns DOM text/values), click, type, navigate, open/close tabs, and screenshot. " +
  "Prefer eval to read a page's text; use screenshot when you need to SEE layout or find click coordinates. " +
  "Coordinates for click are CSS pixels in the tab's viewport — get them from an eval that returns getBoundingClientRect. " +
  "Work autonomously to completion, then reply to the user concisely in plain language.";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "otto-chat") return;
  const history = [];
  let ac = null;
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "stop") { ac?.abort(); return; }
    if (msg.type !== "user") return;
    try {
      const s = await getSettings();
      const hit = findModel(s.provider, s.endpoint, s.model);
      if (!hit) { port.postMessage({ type: "error", error: "No model selected — open settings (⚙)." }); return; }
      const apiKey = s.apiKeys[s.provider];
      if (!apiKey) { port.postMessage({ type: "error", error: `I don't have an API key for ${hit.provider.label} yet — add one in settings (⚙).` }); return; }
      const adapter = makeAdapter(s.provider, hit.endpoint, apiKey);
      history.push({ role: "user", text: msg.text });
      ac = new AbortController();
      const res = await runAgent({
        adapter, model: s.model, system: SYSTEM, tools: TOOLS, vision: hit.model.vision, history,
        execTool, signal: ac.signal,
        onText: (t) => port.postMessage({ type: "text", text: t }),
        onToolStart: (tc) => port.postMessage({ type: "toolStart", name: tc.name, input: tc.input }),
        onToolResult: (tc) => port.postMessage({ type: "toolResult", name: tc.name }),
      });
      port.postMessage({ type: "done", stopReason: res.stopReason });
    } catch (e) {
      port.postMessage({ type: "error", error: String(e.message || e) });
    } finally { ac = null; }
  });
});

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

// ---------- key validation (real, not prefix-guessing) ----------
// A cheap GET /models with the provider's auth style — free, and it actually verifies
// the key. Runs in the worker so host_permissions make it CORS-exempt.
async function validateKey(providerId, endpointId, key) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const e = p?.endpoints.find((x) => x.id === endpointId) || p?.endpoints[0];
  if (!p || !e) return { ok: false, error: "unknown provider" };
  let headers;
  if (p.adapter === "claude") headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  else if (p.adapter === "gemini") headers = { "x-goog-api-key": key };
  else headers = { authorization: `Bearer ${key}` };
  try {
    const res = await fetch(`${e.baseURL}/models`, { headers });
    if (res.ok) return { ok: true };
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}${txt ? ": " + txt.slice(0, 140) : ""}` };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "otto-validate") return;
  validateKey(msg.provider, msg.endpointId, msg.key).then(sendResponse);
  return true; // keep the channel open for the async response
});
