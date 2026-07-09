import { getSettings, setSettings } from "./config.js";
import { PROVIDERS } from "./providers/registry.js";

const $ = (id) => document.getElementById(id);
const log = $("log");

// Plain-language action labels — name what the user recognizes, not the tool call.
function actionLabel(name, input = {}) {
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  switch (name) {
    case "newTab": return `opened ${host(input.url)}`;
    case "navigate": return `went to ${host(input.url)}`;
    case "activateTab": return "switched tabs";
    case "closeTab": return "closed a tab";
    case "listTabs": return "checked your open tabs";
    case "eval": return "read the page";
    case "click": return "clicked";
    case "insertText": return "typed some text";
    case "key": return `pressed ${input.key}`;
    case "screenshot": return "took a screenshot";
    case "pdf": return "saved the page as PDF";
    case "download": return "downloaded a file";
    default: return name;
  }
}

function hideEmpty() { const e = $("empty"); if (e) e.remove(); }
function add(cls, text) { hideEmpty(); const d = document.createElement("div"); d.className = `msg ${cls}`; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
function addAction(name, input) {
  hideEmpty();
  let trace = log.lastElementChild;
  if (!trace || !trace.classList.contains("trace")) { trace = document.createElement("div"); trace.className = "trace"; log.appendChild(trace); }
  const a = document.createElement("div"); a.className = "act"; a.textContent = actionLabel(name, input); trace.appendChild(a);
  log.scrollTop = log.scrollHeight;
}

// --- header model dropdown (flattened provider/endpoint/model) ---
function fillModelSelect(current) {
  const sel = $("model"); sel.innerHTML = "";
  for (const p of PROVIDERS) for (const e of p.endpoints) for (const m of e.models) {
    const el = document.createElement("option"); el.value = `${p.id}|${e.id}|${m.id}`;
    el.textContent = `${p.label.split(" ")[0]} · ${m.label}`; sel.appendChild(el);
  }
  if (current) sel.value = current;
}
async function refreshHeader() {
  const s = await getSettings();
  fillModelSelect(`${s.provider}|${s.endpoint}|${s.model}`);
}
$("model").addEventListener("change", async () => {
  const [provider, endpoint, model] = $("model").value.split("|");
  await setSettings({ provider, endpoint, model });
});

// --- onboarding ---
// Fall back to the first provider so a not-yet-populated select never yields undefined.
function currentProvider() { return PROVIDERS.find((p) => p.id === $("ob-provider").value) || PROVIDERS[0]; }
function fillProviderSelect(selected) {
  const sel = $("ob-provider"); sel.innerHTML = "";
  for (const p of PROVIDERS) { const el = document.createElement("option"); el.value = p.id; el.textContent = p.label; sel.appendChild(el); }
  sel.value = selected && PROVIDERS.some((p) => p.id === selected) ? selected : PROVIDERS[0].id;
}
function syncKeyLink() { $("getkey").href = currentProvider().keyUrl; }
$("ob-provider").addEventListener("change", syncKeyLink);
// Populate immediately so the select is valid before any interaction.
fillProviderSelect(PROVIDERS[0].id); syncKeyLink();

async function openOnboarding() {
  const s = await getSettings();
  fillProviderSelect(s.provider); syncKeyLink();
  $("ob-key").value = ""; $("ob-status").textContent = "";
  $("onboarding").hidden = false;
}
async function maybeOnboard() { const s = await getSettings(); if (!s.apiKeys[s.provider]) await openOnboarding(); }

$("ob-test").addEventListener("click", async () => {
  const p = currentProvider(); const key = $("ob-key").value.trim();
  if (!key) { $("ob-status").textContent = "Enter a key first."; return; }
  $("ob-status").textContent = "Testing…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "otto-validate", provider: p.id, endpointId: p.endpoints[0].id, key });
    $("ob-status").textContent = res?.ok ? "Key works ✓" : `Key rejected — ${res?.error || "no response"}`;
  } catch (e) {
    $("ob-status").textContent = `Couldn't reach Otto's engine — reload the extension in chrome://extensions, then try again. (${e.message})`;
  }
});
$("ob-save").addEventListener("click", async () => {
  const p = currentProvider(); const key = $("ob-key").value.trim();
  if (!key) { $("ob-status").textContent = "Enter a key first."; return; }
  const endpoint = p.endpoints[0], model = endpoint.models[0];
  await setSettings({ provider: p.id, endpoint: endpoint.id, model: model.id, apiKeys: { [p.id]: key } });
  $("onboarding").hidden = true; await refreshHeader();
});
$("gear").addEventListener("click", openOnboarding);

// --- run state ---
function setRunning(on) {
  $("dot").classList.toggle("live", on);
  $("dot").title = on ? "Working…" : "Idle";
  $("send").hidden = on; $("stop").hidden = !on;
}

// --- chat over the port ---
let port, live;
function connect() {
  port = chrome.runtime.connect({ name: "otto-chat" });
  port.onMessage.addListener((m) => {
    if (m.type === "text") { if (!live) live = add("assistant", ""); live.textContent += m.text; log.scrollTop = log.scrollHeight; }
    else if (m.type === "toolStart") { live = null; addAction(m.name, m.input); }
    else if (m.type === "done") { setRunning(false); live = null; if (m.stopReason === "stopped") add("assistant", "Stopped."); }
    else if (m.type === "error") { setRunning(false); live = null; add("error", m.error); }
  });
  port.onDisconnect.addListener(() => { port = null; setRunning(false); });
}

function send(text) {
  text = (text ?? $("input").value).trim(); if (!text) return;
  $("input").value = ""; add("user", text); live = null;
  if (!port) connect();
  setRunning(true);
  port.postMessage({ type: "user", text });
}
$("send").addEventListener("click", () => send());
$("stop").addEventListener("click", () => { port?.postMessage({ type: "stop" }); });
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
log.addEventListener("click", (e) => { if (e.target.classList.contains("example")) send(e.target.textContent); });

refreshHeader().then(maybeOnboard);
