// Tool registry: one entry per browser-control command handled by background.js `handle()`.
// Pure data — safe to import in Node (no chrome.* here).
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const S = { string: { type: "string" }, int: { type: "integer" }, bool: { type: "boolean" } };

export const TOOLS = [
  { name: "listTabs", description: "List all open browser tabs with their id, url, title, and active flag.",
    input_schema: obj({}) },
  { name: "newTab", description: "Open a new tab. Set active=false to open in the background without stealing focus.",
    input_schema: obj({ url: S.string, active: S.bool }, ["url"]) },
  { name: "activateTab", description: "Focus a tab and bring its window to the front.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "navigate", description: "Navigate a tab to a URL.",
    input_schema: obj({ tabId: S.int, url: S.string }, ["tabId", "url"]) },
  { name: "closeTab", description: "Close a tab by id.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "eval", description: "Run JavaScript in a tab and return its value (CSP-proof, via the DevTools protocol). Use this to read page text/DOM and scrape.",
    input_schema: obj({ tabId: S.int, code: S.string }, ["tabId", "code"]) },
  { name: "click", description: "Trusted mouse click at viewport coordinates (CSS px). Use for buttons that reject synthetic clicks.",
    input_schema: obj({ tabId: S.int, x: S.int, y: S.int }, ["tabId", "x", "y"]) },
  { name: "insertText", description: "Trusted text insertion at the current caret (equivalent to a real paste).",
    input_schema: obj({ tabId: S.int, text: S.string }, ["tabId", "text"]) },
  { name: "key", description: "Trusted key press, e.g. Enter or Tab.",
    input_schema: obj({ tabId: S.int, key: S.string, code: S.string, modifiers: S.int }, ["tabId", "key"]) },
  { name: "screenshot", description: "Capture a PNG screenshot of the tab. Returns base64. Use to SEE the page.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "pdf", description: "Render the tab to PDF. Returns base64.",
    input_schema: obj({ tabId: S.int }, ["tabId"]) },
  { name: "download", description: "Download a URL to the user's Downloads folder using the browser's cookies.",
    input_schema: obj({ url: S.string, filename: S.string }, ["url", "filename"]) },
];

export function toolNames() { return TOOLS.map(t => t.name); }
